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
import https from 'https';

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
const RADIOD_HOSTNAME = process.env.RADIOD_HOSTNAME || 'bee1-hf-status.local';

// Python configuration - use venv if available, otherwise system python3
const VENV_PYTHON = path.join(__dirname, 'venv', 'bin', 'python3');
const PYTHON_CMD = fs.existsSync(VENV_PYTHON) ? VENV_PYTHON : 'python3';

// In-memory station database
let stations = [];
let frequencyInfo = new Map();

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
      console.log(`🎛️  Control socket bound to port ${KA9Q_STATUS_PORT}`);
      
      // Join status multicast
      try {
        this.controlSocket.addMembership(KA9Q_STATUS_MULTICAST, '0.0.0.0');
        console.log(`📡 Joined status multicast ${KA9Q_STATUS_MULTICAST}`);
      } catch (err) {
        console.warn(`⚠️  Could not join multicast (radiod may not be running): ${err.message}`);
      }
      
      this.setupStatusReception();
    });

    // Create audio socket for RTP reception
    this.audioSocket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    
    this.audioSocket.on('listening', () => {
      const address = this.audioSocket.address();
      console.log(`🎧 Audio socket bound to ${address.address}:${address.port}`);
      
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
            console.log(`✅ Discovered PCM stream: SSRC=${status.ssrc} → ${status.multicast_address}:${status.multicast_port}`);
            
            stream.multicastAddress = status.multicast_address;
            stream.multicastPort = status.multicast_port;
            
            // Join multicast group
            if (!this.joinedMulticastGroups.has(status.multicast_address)) {
              this.audioSocket.addMembership(status.multicast_address, '0.0.0.0');
              this.joinedMulticastGroups.add(status.multicast_address);
              console.log(`📡 Joined audio multicast ${status.multicast_address} for SSRC ${status.ssrc}`);
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
      
      // Log every 30 seconds per SSRC (reduced to avoid flooding console)
      if (now - lastLog > 30000) {
        const fwd = forwardedCounts.get(ssrc) || 0;
        console.log(`📦 Received ${packetCounts.get(ssrc)} packets for SSRC ${ssrc} (forwarded: ${fwd})`);
        lastLogTime.set(ssrc, now);
      }
      
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
            
            // Debug first packet
            if (!session.debugLogged) {
              console.log(`🔍 RTP Debug for SSRC ${ssrc}:`);
              console.log(`   Packet length: ${msg.length}`);
              console.log(`   Payload Type: ${payloadType}`);
              console.log(`   CSRC count: ${csrcCount}`);
              console.log(`   Extension: ${extension}`);
              session.debugLogged = true;
            }
            
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
    
    console.log(`\n${'='.repeat(60)}`);
    console.log(`🎵 Starting audio stream for ${freqKHz} kHz (SSRC: ${ssrc})`);
    console.log(`📡 Using radiod hostname: ${RADIOD_HOSTNAME}`);
    
    return new Promise((resolve, reject) => {
      // Write Python script to temp file to avoid escaping issues
      const scriptPath = path.join(__dirname, '.ka9q-stream.py');
      const pythonScript = `import sys
import json
try:
    from ka9q import RadiodControl, discover_channels
    
    control = RadiodControl('${RADIOD_HOSTNAME}')
    
    # Create and configure AM channel (outputs PCM audio)
    print(f"DEBUG: Creating channel SSRC={${ssrc}}, frequency={${frequency}} Hz", file=sys.stderr)
    control.create_and_configure_channel(
        ssrc=${ssrc},
        frequency_hz=${frequency},
        preset='am',
        sample_rate=12000,
        agc_enable=1,
        gain=50.0
    )
    print(f"DEBUG: Channel created successfully", file=sys.stderr)
    
    # Get channel info
    channels = discover_channels('${RADIOD_HOSTNAME}')
    
    # Debug: print all discovered SSRCs and frequencies
    print(f"DEBUG: Discovered {len(channels)} channels", file=sys.stderr)
    
    # Find channel by frequency instead of SSRC
    found_ssrc = None
    target_freq = ${frequency}
    
    for ssrc, info in channels.items():
        if abs(info.frequency - target_freq) < 100:  # Within 100 Hz
            found_ssrc = ssrc
            print(f"DEBUG: Found channel with SSRC={ssrc} tuned to {info.frequency} Hz (requested {target_freq} Hz)", file=sys.stderr)
            result = {
                'success': True,
                'ssrc': ssrc,  # Use radiod's SSRC, not our requested one
                'frequency': info.frequency,
                'multicast_address': info.multicast_address,
                'multicast_port': info.port,
                'sample_rate': info.sample_rate
            }
            break
    
    if not found_ssrc:
        print(f"DEBUG: No channel found with frequency {target_freq} Hz", file=sys.stderr)
        print(f"DEBUG: Available frequencies: {[info.frequency for info in list(channels.values())[:10]]}", file=sys.stderr)
        result = {'success': False, 'error': f'Channel not found for frequency {target_freq} Hz'}
    
    print(json.dumps(result))
except Exception as e:
    import traceback
    error_detail = traceback.format_exc()
    print(json.dumps({'success': False, 'error': str(e), 'detail': error_detail}), file=sys.stderr)
    print(json.dumps({'success': False, 'error': str(e)}))
    sys.exit(1)
`;
      
      fs.writeFileSync(scriptPath, pythonScript);
      
      exec(`${PYTHON_CMD} ${scriptPath}`, { timeout: 10000 }, (error, stdout, stderr) => {
        // Clean up temp file
        try {
          fs.unlinkSync(scriptPath);
        } catch (e) {
          // Ignore cleanup errors
        }
        
        if (error && !stdout) {
          console.error(`❌ Failed to execute Python script:`, error.message);
          if (stderr) console.error(`Python stderr: ${stderr}`);
          reject(new Error(`Python execution failed: ${error.message}${stderr ? '\n' + stderr : ''}`));
          return;
        }
        
        if (stderr) {
          // Log stderr (contains DEBUG messages)
          console.log(stderr.trim());
        }
        
        try {
          const result = JSON.parse(stdout.trim());
          
          if (!result.success) {
            console.error(`❌ Stream request failed: ${result.error}`);
            if (result.detail) console.error(`Detail: ${result.detail}`);
            reject(new Error(result.error));
            return;
          }
          
          console.log(`✅ Audio stream created: SSRC=${result.ssrc}`);
          console.log(`   📻 Requested: ${frequency} Hz (${frequency / 1000} kHz)`);
          console.log(`   📻 Radiod reports: ${result.frequency} Hz (${result.frequency / 1000} kHz)`);
          console.log(`   📡 Multicast: ${result.multicast_address}:${result.multicast_port}`);
          
          if (Math.abs(result.frequency - frequency) > 1) {
            console.warn(`⚠️ Frequency mismatch! Requested ${frequency} Hz but radiod tuned to ${result.frequency} Hz`);
          }
          console.log(`${'='.repeat(60)}\n`);
          
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
            console.log(`📡 Joined multicast ${result.multicast_address} for SSRC ${ssrc}`);
          }
          
          resolve(stream);
        } catch (parseError) {
          console.error(`❌ Failed to parse Python output:`, parseError);
          console.error(`stdout: ${stdout}`);
          console.error(`stderr: ${stderr}`);
          reject(new Error(`Failed to parse Python output: ${parseError.message}`));
        }
      });
    });
  }
  
  stopAudioStream(ssrc) {
    console.log(`🛑 Stopping audio stream for SSRC ${ssrc}`);
    
    const stream = this.activeStreams.get(ssrc);
    if (stream) {
      stream.active = false;
      this.activeStreams.delete(ssrc);
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
    
    console.log(`📊 Processing ${fullLines.length} broadcast entries...`);
    
    // Parse each full line
    for (const line of fullLines) {
      // EiBi format: Time(start) Time(end) [Days] ITU Station Lang Target Frequencies
      const match = line.match(/^(\d{4})\s+(\d{4})\s+(.+)$/);
      if (!match) continue;
      
      const startTime = match[1];
      const endTime = match[2];
      const rest = match[3].trim();
      
      // Parse with regex to handle variable spacing
      // Format can be: [Days] CountryCode StationName Lang Target Freqs
      const parseMatch = rest.match(/^(?:([^\s]+)\s+)?([A-Z]{2,3})\s+(.+?)\s+([A-Z,-]{1,6})\s+([A-Za-z]{2,4})\s+(.+)$/);
      
      if (!parseMatch) {
        // Try simpler pattern without days
        const simpleMatch = rest.match(/^([A-Z]{2,3})\s+(.+?)\s+([A-Z,-]{1,6})\s+([A-Za-z]{2,4})\s+(.+)$/);
        if (!simpleMatch) continue;
        
        const [, countryCode, stationName, language, target, frequencies] = simpleMatch;
        
        // Extract frequencies
        const freqMatches = frequencies.match(/(\d+(?:\.\d+)?)/g);
        if (!freqMatches) continue;
        
        for (const freqStr of freqMatches) {
          const freq = parseFloat(freqStr) * 1000;
          if (freq > 1000000 && freq < 30000000) {  // Valid HF range
            stations.push({
              frequency: freq,
              station: stationName.trim(),
              time: `${startTime.substring(0,2)}${startTime.substring(2,4)}-${endTime.substring(0,2)}${endTime.substring(2,4)}`,
              days: 'daily',
              language: language.trim(),
              target: target.trim(),
              country: countryCode.trim()
            });
          }
        }
      } else {
        const [, daysPart, countryCode, stationName, language, target, frequencies] = parseMatch;
        
        // Extract frequencies
        const freqMatches = frequencies.match(/(\d+(?:\.\d+)?)/g);
        if (!freqMatches) continue;
        
        for (const freqStr of freqMatches) {
          const freq = parseFloat(freqStr) * 1000;
          if (freq > 1000000 && freq < 30000000) {  // Valid HF range
            stations.push({
              frequency: freq,
              station: stationName.trim(),
              time: `${startTime.substring(0,2)}${startTime.substring(2,4)}-${endTime.substring(0,2)}${endTime.substring(2,4)}`,
              days: daysPart ? daysPart.trim() : 'daily',
              language: language.trim(),
              target: target.trim(),
              country: countryCode.trim()
            });
          }
        }
      }
    }
    
    console.log(`✅ Parsed ${stations.length} station/frequency combinations`);
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
    
    for (const line of lines) {
      if (line.trim() === '' || line.startsWith('#')) continue;
      
      const parts = line.split('|').map(s => s.trim());
      if (parts.length >= 6) {
        const [frequency, station, power, location, target, notes] = parts;
        
        freqMap.set(parseFloat(frequency) * 1000, { // Convert kHz to Hz
          station,
          power,
          location,
          target,
          notes
        });
      }
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
 */
function getActiveStations() {
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
  
  console.log('⚠️  No broadcast schedule found (bc-time.txt missing)');
  console.log('📥 Attempting to download latest EiBi schedule...');
  
  const scheduleFile = getCurrentEiBiSeason();
  const url = `https://www.eibispace.de/dx/${scheduleFile}`;
  
  console.log(`   Downloading: ${scheduleFile}`);
  console.log(`   From: ${url}`);
  
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
        console.log(`✅ Downloaded ${scheduleFile} successfully!`);
        console.log(`   Saved to: bc-time.txt`);
        
        // Verify it's a valid EiBi file
        try {
          const content = fs.readFileSync(TIME_SCHEDULE_FILE, 'utf-8');
          if (!content.includes('Time(UTC)')) {
            console.warn('⚠️  Downloaded file may not be a valid EiBi schedule');
          } else {
            const entryCount = (content.match(/^\d{4}\s+\d{4}/gm) || []).length;
            console.log(`   Entries: ~${entryCount} broadcasts`);
          }
        } catch (err) {
          console.error('⚠️  Could not verify downloaded schedule:', err.message);
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
      ...(freqInfo || {}),
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
    const testScript = `
import sys
import json
try:
    from ka9q import RadiodControl
    print(json.dumps({'success': True, 'message': 'ka9q package available'}))
except ImportError as e:
    print(json.dumps({'success': False, 'error': 'ka9q package not installed: ' + str(e)}))
except Exception as e:
    print(json.dumps({'success': False, 'error': str(e)}))
`;
    
    const result = await new Promise((resolve) => {
      exec(`${PYTHON_CMD} -c "${testScript.replace(/"/g, '\\"')}"`, { timeout: 5000 }, (error, stdout, stderr) => {
        if (error) {
          resolve({ success: false, error: error.message, stderr });
        } else {
          try {
            resolve(JSON.parse(stdout.trim()));
          } catch (e) {
            resolve({ success: false, error: 'Failed to parse output', stdout, stderr });
          }
        }
      });
    });
    
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
  
  // Reload schedules every 5 minutes
  setInterval(loadSchedules, 5 * 60 * 1000);
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
