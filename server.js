#!/usr/bin/env node

/**
 * Broadcast Station Monitor - Web Interface
 * Monitors shortwave broadcast schedules and provides audio streaming
 * Based on ka9q-radio and signal-recorder architecture
 */

import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dgram from 'dgram';
import { EventEmitter } from 'events';
import { WebSocketServer } from 'ws';
import { exec } from 'child_process';
import { promisify } from 'util';
import https from 'https';

const execAsync = promisify(exec);

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = process.env.PORT || 3100;

// Configuration
const TIME_SCHEDULE_FILE = path.join(__dirname, 'bc-time.txt');
const FREQ_SCHEDULE_FILE = path.join(__dirname, 'bc-freq.txt');
const NEW_SCHEDULE_FILE = path.join(__dirname, 'new_schedule.txt');
const KA9Q_STATUS_MULTICAST = '239.192.152.141';
const KA9Q_STATUS_PORT = 5006;
const KA9Q_AUDIO_PORT = 5004;
const RADIOD_HOSTNAME = process.env.RADIOD_HOSTNAME || 'localhost';

// Python configuration - use venv if available, otherwise system python3
const VENV_PYTHON = path.join(__dirname, 'venv', 'bin', 'python3');
const PYTHON_CMD = fs.existsSync(VENV_PYTHON) ? VENV_PYTHON : 'python3';

// In-memory station database
let stations = [];
let frequencyInfo = new Map();

// Performance: Cache on-air status calculations
let cachedOnAirMinute = null;
let cachedActiveStations = [];

/**
 * Ka9q-Radio Audio Proxy
 * Handles RTP stream reception and WebSocket forwarding
 */
class Ka9qRadioProxy extends EventEmitter {
  constructor() {
    super();
    this.controlSocket = null;
    this.audioSocket = null;
    this.activeStreams = new Map();
    this.joinedMulticastGroups = new Set();
    
    this.init();
  }

  init() {
    // Create control socket for radiod status
    this.controlSocket = dgram.createSocket('udp4');
    this.controlSocket.bind(KA9Q_STATUS_PORT, () => {
      // Join status multicast
      try {
        this.controlSocket.addMembership(KA9Q_STATUS_MULTICAST, '0.0.0.0');
      } catch (err) {
        console.warn(`⚠️  Could not join multicast (radiod may not be running): ${err.message}`);
      }
      
      this.setupStatusReception();
    });

    // Create audio socket for RTP reception
    this.audioSocket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    
    this.audioSocket.on('listening', () => {
      // Enable multicast loopback for local testing
      this.audioSocket.setMulticastLoopback(true);
      
      this.setupAudioReception();
    });
    
    this.audioSocket.on('error', (err) => {
      console.error('❌ Audio socket error:', err);
    });
    
    // Bind to 0.0.0.0 to receive multicast traffic
    this.audioSocket.bind(KA9Q_AUDIO_PORT, '0.0.0.0');
  }
  
  setupStatusReception() {
    this.controlSocket.on('message', (msg, rinfo) => {
      try {
        const status = this.parseStatusMessage(msg);
        if (status && status.ssrc) {
          const stream = this.activeStreams.get(status.ssrc);
          if (stream && !stream.multicastAddress) {
            stream.multicastAddress = status.multicast_address;
            stream.multicastPort = status.multicast_port;
            
            // Join multicast group
            if (!this.joinedMulticastGroups.has(status.multicast_address)) {
              this.audioSocket.addMembership(status.multicast_address, '0.0.0.0');
              this.joinedMulticastGroups.add(status.multicast_address);
            }
          }
        }
      } catch (err) {
        // Ignore parse errors
      }
    });
  }
  
  parseStatusMessage(msg) {
    let offset = 0;
    const status = {};
    
    while (offset < msg.length) {
      if (offset + 2 > msg.length) break;
      
      const tag = msg.readUInt8(offset++);
      const len = msg.readUInt8(offset++);
      
      if (offset + len > msg.length) break;
      
      // SSRC (tag 10)
      if (tag === 10 && len === 4) {
        status.ssrc = msg.readUInt32BE(offset);
      }
      // Multicast address (tag 20) 
      else if (tag === 20) {
        status.multicast_address = msg.slice(offset, offset + len).toString('utf8');
      }
      // Multicast port (tag 21)
      else if (tag === 21 && len === 2) {
        status.multicast_port = msg.readUInt16BE(offset);
      }
      
      offset += len;
    }
    
    return status.ssrc ? status : null;
  }

  setupAudioReception() {
    let packetCounts = new Map();
    let forwardedCounts = new Map();
    let lastLogTime = new Map();
    
    this.audioSocket.on('message', (msg, rinfo) => {
      if (msg.length < 12) return; // Minimum RTP header size

      const ssrc = msg.readUInt32BE(8);
      
      // Count packets per SSRC
      packetCounts.set(ssrc, (packetCounts.get(ssrc) || 0) + 1);
      const now = Date.now();
      const lastLog = lastLogTime.get(ssrc) || 0;
      
      // Suppress periodic packet logging - only log errors
      
      // Forward to WebSocket clients
      if (global.audioSessions) {
        const session = global.audioSessions.get(ssrc);
        if (session) {
          if (!session.audio_active) {
            // Packet for inactive session - client hasn't sent START yet
            return;
          }
          if (session.ws.readyState !== 1) {
            console.warn(`⚠️ WebSocket not ready for SSRC ${ssrc}, state: ${session.ws.readyState}`);
            return;
          }
          
          try {
            // Parse RTP header to find PCM payload (like signal-recorder does)
            const byte0 = msg.readUInt8(0);
            const byte1 = msg.readUInt8(1);
            const csrcCount = byte0 & 0x0F;
            const extension = (byte0 >> 4) & 0x01;
            const payloadType = byte1 & 0x7F;
            
            // Mark first packet as logged
            session.debugLogged = true;
            
            // Calculate header length (from signal-recorder)
            let payloadOffset = 12 + (csrcCount * 4);
            
            // Skip extension header if present (from signal-recorder)
            if (extension && msg.length >= payloadOffset + 4) {
              const extLengthWords = msg.readUInt16BE(payloadOffset + 2);
              payloadOffset += 4 + (extLengthWords * 4);
            }
            
            if (payloadOffset >= msg.length) {
              return;
            }
            
            // Extract PCM payload and byte-swap (like ka9q-web does)
            const pcmPayload = Buffer.from(msg.slice(payloadOffset));
            
            // Byte swap for endianness (ka9q-web swaps bytes)
            for (let i = 0; i < pcmPayload.length; i += 2) {
              const tmp = pcmPayload[i];
              pcmPayload[i] = pcmPayload[i + 1];
              pcmPayload[i + 1] = tmp;
            }
            
            // Forward PCM data to browser
            session.ws.send(pcmPayload);
            forwardedCounts.set(ssrc, (forwardedCounts.get(ssrc) || 0) + 1);
          } catch (err) {
            console.error(`❌ Error processing RTP for SSRC ${ssrc}:`, err.message);
          }
        }
      }
    });
  }

  async startAudioStream(frequency) {
    const ssrc = Math.floor(frequency); // Frequency is already in Hz, use as SSRC
    const freqKHz = frequency / 1000;
    
    console.log(`🎵 Starting stream: ${freqKHz} kHz`);
    
    // Performance: Use stdin to pass Python script (properly handles multiline code)
    const pythonScript = `import sys
import json
try:
    from ka9q import RadiodControl
    import socket
    import struct
    import time
    
    control = RadiodControl('${RADIOD_HOSTNAME}')
    
    # Create and configure AM channel (outputs PCM audio)
    # AGC is disabled to allow manual gain control from the web UI
    control.create_channel(
        ssrc=${ssrc},
        frequency_hz=${frequency},
        preset='am',
        sample_rate=12000,
        agc_enable=0,
        gain=30.0
    )
    
    # Wait a moment for channel creation
    time.sleep(0.5)
    
    # Get channel info from status multicast
    # Create UDP socket to listen for status packets
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.bind(('', 5006))
    
    # Join status multicast group
    mreq = struct.pack('4sl', socket.inet_aton('239.192.152.141'), socket.INADDR_ANY)
    sock.setsockopt(socket.IPPROTO_IP, socket.IP_ADD_MEMBERSHIP, mreq)
    sock.settimeout(3.0)
    
    # Listen for our channel's status packet
    found = False
    for _ in range(10):  # Try up to 10 packets
        try:
            data, addr = sock.recvfrom(8192)
            # Parse status packet to find our SSRC
            offset = 0
            packet_ssrc = None
            multicast_address = None
            multicast_port = None
            
            while offset < len(data) - 2:
                tag = data[offset]
                length = data[offset + 1]
                offset += 2
                
                if offset + length > len(data):
                    break
                    
                if tag == 10 and length == 4:  # SSRC tag
                    packet_ssrc = struct.unpack('>I', data[offset:offset+4])[0]
                elif tag == 20:  # Multicast address tag
                    if length == 4:  # IPv4 address in binary
                        multicast_address = socket.inet_ntoa(data[offset:offset+4])
                    else:  # String format
                        multicast_address = data[offset:offset+length].decode('utf-8', errors='ignore')
                elif tag == 21 and length == 2:  # Multicast port tag
                    multicast_port = struct.unpack('>H', data[offset:offset+2])[0]
                    
                offset += length
            
            if packet_ssrc == ${ssrc}:
                result = {
                    'success': True,
                    'ssrc': ${ssrc},
                    'frequency': ${frequency},
                    'multicast_address': multicast_address,
                    'multicast_port': multicast_port,
                    'sample_rate': 12000
                }
                found = True
                break
        except socket.timeout:
            break
    
    sock.close()
    
    if not found:
        # Channel created but status not received yet - use defaults
        result = {
            'success': True,
            'ssrc': ${ssrc},
            'frequency': ${frequency},
            'multicast_address': None,
            'multicast_port': 5004,
            'sample_rate': 12000
        }
    
    print(json.dumps(result))
except Exception as e:
    import traceback
    error_detail = traceback.format_exc()
    print(json.dumps({'success': False, 'error': str(e), 'detail': error_detail}), file=sys.stderr)
    print(json.dumps({'success': False, 'error': str(e)}))
    sys.exit(1)
`;
    
    try {
      // Async execution using stdin (no temp files, proper multiline support)
      const { stdout, stderr } = await execAsync(
        `echo "${pythonScript.replace(/"/g, '\\"')}" | ${PYTHON_CMD}`,
        { timeout: 15000 }
      );
      
      const result = JSON.parse(stdout.trim());
      
      if (!result.success) {
        console.error(`❌ Stream request failed: ${result.error}`);
        throw new Error(result.error);
      }
      
      if (Math.abs(result.frequency - frequency) > 1) {
        console.warn(`⚠️ Frequency mismatch! Requested ${frequency} Hz but got ${result.frequency} Hz`);
      }
      
      const stream = {
        ssrc: result.ssrc,
        active: true,
        frequency: result.frequency,
        multicastAddress: result.multicast_address,
        multicastPort: result.multicast_port,
        sampleRate: result.sample_rate
      };
      
      this.activeStreams.set(ssrc, stream);
      
      // Join multicast group
      if (result.multicast_address && !this.joinedMulticastGroups.has(result.multicast_address)) {
        this.audioSocket.addMembership(result.multicast_address, '0.0.0.0');
        this.joinedMulticastGroups.add(result.multicast_address);
      }
      
      return stream;
    } catch (error) {
      console.error(`❌ Failed to start audio stream:`, error.message);
      throw error;
    }
  }
  
  async stopAudioStream(ssrc) {
    const stream = this.activeStreams.get(ssrc);
    if (stream) {
      stream.active = false;
      this.activeStreams.delete(ssrc);
      
      // Delete channel from radiod by setting frequency to 0 Hz
      try {
        const pythonScript = `import sys
import json
from ka9q import RadiodControl
control = RadiodControl('${RADIOD_HOSTNAME}')
control.set_frequency(${ssrc}, 0)
print(json.dumps({'success': True, 'ssrc': ${ssrc}}))`;
        
        // Async execution using stdin
        await execAsync(`echo "${pythonScript.replace(/"/g, '\\"')}" | ${PYTHON_CMD}`, { timeout: 5000 });
        console.log(`✅ Channel ${ssrc} deleted`);
      } catch (err) {
        console.error(`❌ Error deleting channel ${ssrc}:`, err.message);
      }
    }
  }

  async setAGC(ssrc, enable, hangtime, headroom) {
    const enablePython = enable ? 'True' : 'False';
    return this.executeTuningCommand(ssrc, `control.set_agc(ssrc=${ssrc}, enable=${enablePython}, hangtime=${hangtime}, headroom=${headroom})`);
  }

  async setGain(ssrc, gain_db) {
    return this.executeTuningCommand(ssrc, `control.set_gain(ssrc=${ssrc}, gain_db=${gain_db})`);
  }

  async setFilter(ssrc, low_edge, high_edge) {
    return this.executeTuningCommand(ssrc, `control.set_filter(ssrc=${ssrc}, low_edge=${low_edge}, high_edge=${high_edge})`);
  }

  async setFrequency(ssrc, frequency_hz) {
    return this.executeTuningCommand(ssrc, `control.set_frequency(ssrc=${ssrc}, frequency_hz=${frequency_hz})`);
  }

  async setShift(ssrc, shift_hz) {
    return this.executeTuningCommand(ssrc, `control.set_shift_frequency(ssrc=${ssrc}, shift_hz=${shift_hz})`);
  }

  async setOutputLevel(ssrc, level) {
    return this.executeTuningCommand(ssrc, `control.set_output_level(ssrc=${ssrc}, level=${level})`);
  }

  async executeTuningCommand(ssrc, command) {
    try {
      const pythonScript = `import sys
import json
try:
    from ka9q import RadiodControl
    control = RadiodControl('${RADIOD_HOSTNAME}')
    ${command}
    print(json.dumps({'success': True, 'ssrc': ${ssrc}}))
except Exception as e:
    import traceback
    error_detail = traceback.format_exc()
    print(json.dumps({'success': False, 'error': str(e), 'detail': error_detail}), file=sys.stderr)
    print(json.dumps({'success': False, 'error': str(e)}))
    sys.exit(1)`;
      
      // Async execution using stdin
      const { stdout, stderr } = await execAsync(
        `echo "${pythonScript.replace(/"/g, '\\"')}" | ${PYTHON_CMD}`,
        { timeout: 5000 }
      );
      
      // Log stderr if present for debugging
      if (stderr && stderr.trim()) {
        console.error(`⚠️ Python stderr for SSRC ${ssrc}:`, stderr.trim());
      }
      
      const result = JSON.parse(stdout.trim());
      if (result.success) {
        console.log(`✅ Tuning command succeeded for SSRC ${ssrc}: ${command}`);
        return result;
      } else {
        console.error(`❌ Tuning command returned error:`, result.error);
        throw new Error(result.error || 'Unknown error');
      }
    } catch (error) {
      console.error(`❌ Tuning command failed for SSRC ${ssrc}:`, error.message);
      throw error;
    }
  }

  shutdown() {
    console.log('🛑 Shutting down ka9q-radio proxy...');
    
    for (const [ssrc] of this.activeStreams) {
      this.stopAudioStream(ssrc);
    }
    
    if (this.controlSocket) this.controlSocket.close();
    if (this.audioSocket) this.audioSocket.close();
  }
}

// Create proxy instance
const radioProxy = new Ka9qRadioProxy();

/**
 * Parse broadcast schedule files
 */
function parseTimeSchedule() {
  const stations = [];
  
  try {
    const content = fs.readFileSync(TIME_SCHEDULE_FILE, 'utf-8');
    const lines = content.split('\n');
    
    // Join continuation lines
    const fullLines = [];
    let currentLine = '';
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      // Skip headers and separators
      if (line.startsWith('BC ') || line.startsWith('====') || line.startsWith('Valid ') ||
          line.startsWith('Free to') || line.startsWith('Days,') || line.startsWith('For country') ||
          line.startsWith('Last update') || line.includes('http://') || line.startsWith('Time(UTC)')) {
        continue;
      }
      
      // If line starts with timestamp, it's a new entry
      if (line.match(/^\d{4}\s+\d{4}/)) {
        if (currentLine) {
          fullLines.push(currentLine);
        }
        currentLine = line;
      } else if (line.trim() && currentLine) {
        // Continuation line - append to current
        currentLine += ' ' + line.trim();
      }
    }
    
    if (currentLine) {
      fullLines.push(currentLine);
    }
    
    // Suppress processing logs
    
    // Parse each full line using fixed column positions (EiBi format is column-based)
    for (const line of fullLines) {
      // Skip if line is too short or doesn't start with time
      if (line.length < 54 || !/^\d{4}\s+\d{4}/.test(line)) continue;
      
      // EiBi fixed column format:
      // Columns 0-3:   Start time (4 digits)
      // Columns 5-8:   End time (4 digits)
      // Columns 10-15: Days (optional, 6 chars)
      // Columns 16-19: Country code (3-4 chars)
      // Columns 20-45: Station name (26 chars)
      // Columns 46-49: Language (4 chars)
      // Columns 50-53: Target (4 chars)
      // Columns 54+:   Frequencies
      
      const startTime = line.substring(0, 4).trim();
      const endTime = line.substring(5, 9).trim();
      const daysPart = line.substring(10, 16).trim() || 'daily';
      const countryCode = line.substring(16, 20).trim();
      const stationName = line.substring(20, 46).trim();
      const language = line.substring(46, 50).trim();
      const target = line.substring(50, 54).trim();
      const frequencies = line.substring(54).trim();
      
      // Validate required fields
      if (!startTime || !endTime || !countryCode || !stationName || !language || !target || !frequencies) continue;
      
      // Extract frequencies (numbers, possibly with decimals)
      const freqMatches = frequencies.match(/(\d+(?:\.\d+)?)/g);
      if (!freqMatches) continue;
      
      // Create a station entry for each frequency
      for (const freqStr of freqMatches) {
        const freq = parseFloat(freqStr) * 1000;  // Convert kHz to Hz
        if (freq > 1000000 && freq < 30000000) {  // Valid HF range (1-30 MHz)
          stations.push({
            frequency: freq,
            station: stationName.trim(),
            time: `${startTime}-${endTime}`,
            days: daysPart ? daysPart.trim() : 'daily',
            language: language.trim(),
            target: target.trim(),
            country: countryCode.trim()
          });
        }
      }
    }
    
    // Suppress parse success log
  } catch (err) {
    console.error('Error parsing time schedule:', err.message, err.stack);
  }
  
  return stations;
}

function parseFreqSchedule() {
  const freqMap = new Map();
  
  try {
    const content = fs.readFileSync(FREQ_SCHEDULE_FILE, 'utf-8');
    const lines = content.split('\n');
    
    // EiBi frequency file format (column-based):
    // Columns 0-13:   Frequency (with decimal)
    // Columns 14-27:  Time range
    // Columns 28-31:  Country code
    // Columns 32-61:  Station name (30 chars)
    // Columns 62-65:  Language
    // Columns 66-69:  Target
    // Columns 70+:    Notes/additional info
    
    for (const line of lines) {
      // Skip headers, empty lines, and short lines
      if (line.length < 60 || !/^\d/.test(line)) continue;
      
      const freqStr = line.substring(0, 14).trim();
      const timeRange = line.substring(14, 28).trim();
      const countryCode = line.substring(28, 32).trim();
      const stationName = line.substring(32, 62).trim();
      const language = line.substring(62, 66).trim();
      const target = line.substring(66, 70).trim();
      const notes = line.substring(70).trim();
      
      if (!freqStr || !stationName) continue;
      
      const frequency = parseFloat(freqStr) * 1000; // Convert kHz to Hz
      if (frequency < 1000000 || frequency > 30000000) continue; // Skip if not HF range
      
      freqMap.set(frequency, {
        station: stationName,
        power: '', // Not in frequency file
        location: countryCode, // Use country code as location
        target: target,
        notes: notes
      });
    }
  } catch (err) {
    console.error('Error parsing frequency schedule:', err.message);
  }
  
  return freqMap;
}

/**
 * Check if a broadcast is currently on air
 */
function isOnAir(schedule) {
  // Stations without schedules are never on-air
  if (!schedule.time || schedule.time === 'N/A' || !schedule.time.includes('-')) {
    return false;
  }
  
  const now = new Date();
  const utcHours = now.getUTCHours();
  const utcMinutes = now.getUTCMinutes();
  const currentTime = utcHours * 100 + utcMinutes;
  const dayOfWeek = now.getUTCDay() || 7; // 1-7 (Sunday = 7)
  
  // Parse time range (e.g., "0130-0200")
  const [startStr, endStr] = schedule.time.split('-');
  const startTime = parseInt(startStr);
  const endTime = parseInt(endStr);
  
  // Check day of week
  const daysMatch = schedule.days === 'daily' || 
                    schedule.days.split(',').map(d => parseInt(d.trim())).includes(dayOfWeek);
  
  if (!daysMatch) return false;
  
  // Handle time ranges that cross midnight
  if (endTime < startTime) {
    return currentTime >= startTime || currentTime <= endTime;
  } else {
    return currentTime >= startTime && currentTime <= endTime;
  }
}

/**
 * Get currently active stations
 * Performance: Cache results per minute to avoid redundant calculations
 */
function getActiveStations() {
  const now = new Date();
  const currentMinute = now.getUTCHours() * 60 + now.getUTCMinutes();
  
  // Return cached results if still valid for this minute
  if (currentMinute === cachedOnAirMinute && cachedActiveStations.length > 0) {
    return cachedActiveStations;
  }
  
  // Recalculate and cache
  const active = [];
  
  for (const schedule of stations) {
    if (isOnAir(schedule)) {
      const freqInfo = frequencyInfo.get(schedule.frequency);
      
      active.push({
        ...schedule,
        ...(freqInfo || {}),
        onAir: true
      });
    }
  }
  
  cachedOnAirMinute = currentMinute;
  cachedActiveStations = active;
  
  return active;
}

/**
 * Determine current EiBi schedule season (A or B)
 */
function getCurrentEiBiSeason() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth(); // 0-11
  
  // EiBi seasons:
  // A-season (Spring/Summer): Published late March, valid ~April-October
  // B-season (Fall/Winter): Published late October, valid ~November-March
  
  // If Jan-March or Nov-Dec, use B-season
  // If April-October, use A-season
  if (month >= 3 && month <= 9) {
    // April-October: Use A-season
    return `sked-a${year.toString().slice(-2)}.txt`;
  } else {
    // November-March: Use B-season
    // If Jan-March, use previous year's B-season
    const scheduleYear = month <= 2 ? year - 1 : year;
    return `sked-b${scheduleYear.toString().slice(-2)}.txt`;
  }
}

/**
 * Download EiBi schedule if bc-time.txt is missing
 */
async function downloadScheduleIfMissing() {
  if (fs.existsSync(TIME_SCHEDULE_FILE)) {
    return false; // Schedule exists, no download needed
  }
  
  console.log('📥 Downloading latest EiBi schedule...');
  
  const scheduleFile = getCurrentEiBiSeason();
  const url = `https://www.eibispace.de/dx/${scheduleFile}`;
  
  return new Promise((resolve) => {
    https.get(url, (response) => {
      if (response.statusCode !== 200) {
        console.error(`❌ Download failed: HTTP ${response.statusCode}`);
        console.log('   Please manually download a schedule:');
        console.log('   ./update-schedule.sh');
        resolve(false);
        return;
      }
      
      const fileStream = fs.createWriteStream(TIME_SCHEDULE_FILE);
      response.pipe(fileStream);
      
      fileStream.on('finish', () => {
        fileStream.close();
        console.log(`✅ Downloaded ${scheduleFile}`);
        
        // Verify it's a valid EiBi file
        try {
          const content = fs.readFileSync(TIME_SCHEDULE_FILE, 'utf-8');
          if (!content.includes('Time(UTC)')) {
            console.warn('⚠️  Downloaded file may not be valid EiBi format');
          }
        } catch (err) {
          console.error('⚠️  Could not verify schedule:', err.message);
        }
        
        resolve(true);
      });
      
      fileStream.on('error', (err) => {
        console.error('❌ Error saving schedule:', err.message);
        fs.unlink(TIME_SCHEDULE_FILE, () => {});
        console.log('   Please manually download a schedule:');
        console.log('   ./update-schedule.sh');
        resolve(false);
      });
      
    }).on('error', (err) => {
      console.error('❌ Download error:', err.message);
      console.log('   Please manually download a schedule:');
      console.log('   ./update-schedule.sh');
      resolve(false);
    });
  });
}

/**
 * Check for new schedule file and update if present
 */
function checkAndUpdateSchedule() {
  try {
    if (fs.existsSync(NEW_SCHEDULE_FILE)) {
      console.log('🔄 New schedule file detected: new_schedule.txt');
      
      // Backup current schedule
      const backupFile = path.join(__dirname, `bc-time.backup.${Date.now()}.txt`);
      fs.copyFileSync(TIME_SCHEDULE_FILE, backupFile);
      console.log(`💾 Backed up current schedule to ${path.basename(backupFile)}`);
      
      // Replace with new schedule
      fs.copyFileSync(NEW_SCHEDULE_FILE, TIME_SCHEDULE_FILE);
      console.log('✅ Updated bc-time.txt with new schedule');
      
      // Remove new_schedule.txt
      fs.unlinkSync(NEW_SCHEDULE_FILE);
      console.log('🗑️  Removed new_schedule.txt');
      
      return true;
    }
  } catch (err) {
    console.error('❌ Error updating schedule:', err.message);
  }
  return false;
}

/**
 * Load and reload schedules
 */
async function loadSchedules() {
  console.log('📡 Loading broadcast schedules...');
  
  // Download schedule if missing
  await downloadScheduleIfMissing();
  
  // Check for new schedule file
  const updated = checkAndUpdateSchedule();
  if (updated) {
    console.log('🎉 Schedule updated! Loading new data...');
  }
  
  const timeSchedules = parseTimeSchedule();
  frequencyInfo = parseFreqSchedule();
  
  // Create a map to merge stations by frequency
  const stationMap = new Map();
  
  // First, add all time-scheduled stations
  for (const schedule of timeSchedules) {
    const key = schedule.frequency;
    if (!stationMap.has(key)) {
      stationMap.set(key, []);
    }
    stationMap.get(key).push(schedule);
  }
  
  // Then, add any stations from freq file that don't have time schedules
  for (const [freq, info] of frequencyInfo) {
    if (!stationMap.has(freq)) {
      // Create a station entry with no schedule (always off-air)
      stationMap.set(freq, [{
        frequency: freq,
        station: info.station,
        time: 'N/A',
        days: 'N/A',
        language: 'Various',
        target: info.target || 'N/A'
      }]);
    }
  }
  
  // Flatten to array (some frequencies may have multiple time slots)
  stations = [];
  for (const schedules of stationMap.values()) {
    stations.push(...schedules);
  }
  
  // Performance: Invalidate cache when schedules change
  cachedOnAirMinute = null;
  cachedActiveStations = [];
  
  console.log(`✅ Loaded ${stations.length} total station entries`);
  console.log(`   - ${timeSchedules.length} scheduled broadcasts`);
  console.log(`   - ${frequencyInfo.size} frequency entries`);
  console.log(`   - ${stationMap.size} unique frequencies`);
}

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// API Routes

// Get all stations with their current on-air status (time-based view)
app.get('/api/stations', (req, res) => {
  const allStations = stations.map(schedule => {
    const freqInfo = frequencyInfo.get(schedule.frequency);
    return {
      ...schedule,
      // Only add location and notes from frequency data, don't overwrite station/target
      location: freqInfo?.location || schedule.country,
      power: freqInfo?.power || '',
      notes: freqInfo?.notes || '',
      onAir: isOnAir(schedule)
    };
  });
  
  res.json(allStations);
});

// Get frequency-organized view (grouped by frequency)
app.get('/api/stations/by-frequency', (req, res) => {
  // Group stations by frequency
  const byFrequency = new Map();
  
  for (const schedule of stations) {
    const freq = schedule.frequency;
    if (!byFrequency.has(freq)) {
      byFrequency.set(freq, []);
    }
    byFrequency.get(freq).push({
      ...schedule,
      onAir: isOnAir(schedule)
    });
  }
  
  // Convert to array format
  const result = Array.from(byFrequency.entries()).map(([frequency, schedules]) => {
    const freqInfo = frequencyInfo.get(frequency);
    const anyOnAir = schedules.some(s => s.onAir);
    
    return {
      frequency,
      ...(freqInfo || {}),
      schedules,
      onAir: anyOnAir,
      broadcastCount: schedules.length
    };
  });
  
  res.json(result);
});

// Get only currently active stations
app.get('/api/stations/active', (req, res) => {
  const active = getActiveStations();
  res.json(active);
});

// Get station by frequency
app.get('/api/stations/frequency/:freq', (req, res) => {
  const freq = parseFloat(req.params.freq);
  const schedules = stations.filter(s => s.frequency === freq);
  
  if (schedules.length === 0) {
    return res.status(404).json({ error: 'No stations found for this frequency' });
  }
  
  const freqInfo = frequencyInfo.get(freq);
  const stationData = schedules.map(schedule => ({
    ...schedule,
    ...(freqInfo || {}),
    onAir: isOnAir(schedule)
  }));
  
  res.json(stationData);
});

// Audio streaming endpoint
app.get('/api/audio/stream/:frequency', async (req, res) => {
  const frequency = parseFloat(req.params.frequency);
  
  console.log(`🎵 Requesting audio stream for ${frequency / 1000} kHz`);
  
  try {
    const stream = await radioProxy.startAudioStream(frequency);
    
    res.json({
      success: true,
      ssrc: stream.ssrc,
      frequency: stream.frequency,
      websocket: `ws://${req.headers.host}/api/audio/ws/${stream.ssrc}`,
      multicast: `${stream.multicastAddress}:${stream.multicastPort}`
    });
  } catch (error) {
    console.error('❌ Failed to create audio stream:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to create audio stream', 
      details: error.message 
    });
  }
});

// Stop audio stream
app.delete('/api/audio/stream/:ssrc', (req, res) => {
  const ssrc = parseInt(req.params.ssrc);
  radioProxy.stopAudioStream(ssrc);
  res.json({ success: true, message: 'Stream stopped' });
});

// Tuning endpoints
app.post('/api/audio/tune/:ssrc/agc', async (req, res) => {
  try {
    const ssrc = parseInt(req.params.ssrc);
    const { enable, hangtime, headroom } = req.body;
    
    await radioProxy.setAGC(ssrc, enable, hangtime, headroom);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/audio/tune/:ssrc/gain', async (req, res) => {
  try {
    const ssrc = parseInt(req.params.ssrc);
    const { gain_db } = req.body;
    
    console.log(`🎚️ Gain adjustment request: SSRC ${ssrc}, gain ${gain_db} dB`);
    await radioProxy.setGain(ssrc, gain_db);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/audio/tune/:ssrc/filter', async (req, res) => {
  try {
    const ssrc = parseInt(req.params.ssrc);
    const { low_edge, high_edge } = req.body;
    
    await radioProxy.setFilter(ssrc, low_edge, high_edge);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/audio/tune/:ssrc/frequency', async (req, res) => {
  try {
    const ssrc = parseInt(req.params.ssrc);
    const { frequency_hz } = req.body;
    
    console.log(`📻 Frequency change request: SSRC ${ssrc}, frequency ${frequency_hz} Hz`);
    await radioProxy.setFrequency(ssrc, frequency_hz);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/audio/tune/:ssrc/shift', async (req, res) => {
  try {
    const ssrc = parseInt(req.params.ssrc);
    const { shift_hz } = req.body;
    
    await radioProxy.setShift(ssrc, shift_hz);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/audio/tune/:ssrc/output-level', async (req, res) => {
  try {
    const ssrc = parseInt(req.params.ssrc);
    const { level } = req.body;
    
    await radioProxy.setOutputLevel(ssrc, level);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Audio proxy health check
app.get('/api/audio/health', async (req, res) => {
  const streamInfo = Array.from(radioProxy.activeStreams.entries()).map(([ssrc, stream]) => ({
    ssrc,
    frequency: stream.frequency,
    active: stream.active
  }));
  
  // Test Python ka9q connectivity
  let pythonStatus = 'unknown';
  let pythonError = null;
  
  try {
    const pythonScript = `import sys
import json
from ka9q import RadiodControl
print(json.dumps({'success': True, 'message': 'ka9q package available'}))`;
    
    const { stdout } = await execAsync(
      `echo "${pythonScript.replace(/"/g, '\\"')}" | ${PYTHON_CMD}`,
      { timeout: 5000 }
    );
    
    const result = JSON.parse(stdout.trim());
    pythonStatus = result.success ? 'ok' : 'error';
    pythonError = result.error || null;
  } catch (e) {
    pythonStatus = 'error';
    pythonError = e.message;
  }
  
  res.json({ 
    status: pythonStatus === 'ok' ? 'ok' : 'degraded',
    service: 'broadcast-station-monitor',
    radiodHostname: RADIOD_HOSTNAME,
    activeStreams: radioProxy.activeStreams.size,
    streams: streamInfo,
    python: {
      status: pythonStatus,
      error: pythonError
    }
  });
});

// Reload schedules
app.post('/api/reload', async (req, res) => {
  await loadSchedules();
  res.json({ success: true, message: 'Schedules reloaded' });
});

// Start server
async function startServer() {
  await loadSchedules();
  
  const server = app.listen(PORT, () => {
    console.log(`🚀 Broadcast Station Monitor running on http://localhost:${PORT}/`);
    console.log(`📡 Monitoring ${stations.length} broadcast schedules`);
    console.log(`🎵 WebSocket audio streaming enabled`);
    console.log(`🐍 Using Python: ${PYTHON_CMD}`);
    console.log(`📻 Radiod hostname: ${RADIOD_HOSTNAME}`);
  });
  
  // WebSocket server for audio streaming
  const wss = new WebSocketServer({ noServer: true });

  // Audio session management
  global.audioSessions = new Map();

  // Handle WebSocket upgrade
  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url, `http://${request.headers.host}`);
    
    if (url.pathname.startsWith('/api/audio/ws/')) {
      const ssrc = parseInt(url.pathname.split('/')[4]);
      if (!isNaN(ssrc)) {
        wss.handleUpgrade(request, socket, head, (ws) => {
          wss.emit('connection', ws, request, ssrc);
        });
      } else {
        socket.destroy();
      }
    } else {
      socket.destroy();
    }
  });

  wss.on('connection', (ws, request, ssrc) => {
    console.log(`🎵 WebSocket audio connection for SSRC ${ssrc}`);
    
    const session = {
      ws,
      ssrc,
      audio_active: false
    };
    
    global.audioSessions.set(ssrc, session);
    
    ws.on('message', (message) => {
      const msg = message.toString();
      
      if (msg.startsWith('A:')) {
        if (msg.includes('START')) {
          session.audio_active = true;
          console.log(`✅ Audio activated for SSRC ${ssrc}`);
        } else if (msg.includes('STOP')) {
          session.audio_active = false;
          console.log(`⏹️  Audio deactivated for SSRC ${ssrc}`);
        }
      }
    });
    
    ws.on('close', () => {
      console.log(`👋 WebSocket connection closed for SSRC ${ssrc}`);
      global.audioSessions.delete(ssrc);
    });
    
    ws.on('error', (error) => {
      console.error(`❌ WebSocket error for SSRC ${ssrc}:`, error);
      global.audioSessions.delete(ssrc);
    });
  });
  
  // Performance: Watch for schedule file changes instead of polling
  // This eliminates unnecessary file I/O and parsing
  let reloadDebounce = null;
  const scheduleWatcher = fs.watch(TIME_SCHEDULE_FILE, (eventType) => {
    if (eventType === 'change') {
      // Debounce to avoid multiple rapid reloads
      if (reloadDebounce) clearTimeout(reloadDebounce);
      reloadDebounce = setTimeout(() => {
        console.log('📝 Schedule file changed, reloading...');
        loadSchedules();
      }, 1000);
    }
  });
  
  // Also check for new_schedule.txt every 5 minutes (for manual updates)
  setInterval(() => {
    if (fs.existsSync(NEW_SCHEDULE_FILE)) {
      loadSchedules();
    }
  }, 5 * 60 * 1000);
}

startServer();

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down Broadcast Station Monitor...');
  radioProxy.shutdown();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Received SIGTERM, shutting down...');
  radioProxy.shutdown();
  process.exit(0);
});
