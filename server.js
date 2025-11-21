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
import dns from 'dns';

const execAsync = promisify(exec);
const dnsLookup = promisify(dns.lookup);

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
const MULTICAST_INTERFACE = process.env.KA9Q_MULTICAST_INTERFACE || null;
const RADIOD_AUDIO_MULTICAST = process.env.RADIOD_AUDIO_MULTICAST || null;

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
    this.loggedStatus = new Set();
    this.loggedRtp = new Set();
    this.loggedOrphanRtp = new Set();
    this.discoveredChannels = new Map(); // Map of multicast IP -> channel info
    this.statusMulticastGroups = new Set(); // Track which status groups we've joined
    this.bonjour = null;
    this.browser = null;
    
    this.init();
  }

  async init() {
    console.log(`✅ Initialized`);
    console.log(`   Radiod: ${RADIOD_HOSTNAME}`);
    console.log(`   Interface: ${MULTICAST_INTERFACE || 'default'}`);
    console.log(`   Note: Remote client mode - using control socket + hardcoded multicast`);
    this.setupAudioSocket();
  }
  
  // testRadiodDiscovery removed - caused timeouts and isn't essential
  // Radiod connectivity will be verified when audio is requested
  
  async resolveRadiodAddress() {
    // Use dns-sd (macOS) or avahi-resolve (Linux) or Node.js dns to resolve mDNS hostname
    
    try {
      // Try dns-sd (macOS)
      const { stdout } = await execAsync(`dns-sd -G v4 ${RADIOD_HOSTNAME}`, { timeout: 5000 });
      const match = stdout.match(/(\d+\.\d+\.\d+\.\d+)/);
      if (match) return match[1];
    } catch (e) {
      // dns-sd not available or failed
    }
    
    try {
      // Try avahi-resolve (Linux)  
      const { stdout } = await execAsync(`avahi-resolve -n ${RADIOD_HOSTNAME}`, { timeout: 5000 });
      const parts = stdout.trim().split(/\s+/);
      if (parts.length >= 2) return parts[1];
    } catch (e) {
      // avahi not available or failed
    }
    
    // Fallback to Node.js dns.lookup (uses getaddrinfo, supports mDNS)
    try {
      const result = await dnsLookup(RADIOD_HOSTNAME, { family: 4 });
      return result.address;
    } catch (e) {
      throw new Error(`Could not resolve ${RADIOD_HOSTNAME}: ${e.message}`);
    }
  }
  
  setupAudioSocket() {

    // Create audio socket for RTP reception with large buffer
    this.audioSocket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    this.audioSocket.on('listening', () => {
      // Enable multicast loopback for local testing
      this.audioSocket.setMulticastLoopback(true);
      if (MULTICAST_INTERFACE) {
        try {
          this.audioSocket.setMulticastInterface(MULTICAST_INTERFACE);
        } catch (err) {
          console.warn(`⚠️  Could not set multicast interface ${MULTICAST_INTERFACE}: ${err.message}`);
        }
      }
      
      // Increase socket buffer to handle multiple high-rate streams
      try {
        const requestedSize = 8 * 1024 * 1024; // 8MB
        this.audioSocket.setRecvBufferSize(requestedSize);
        const actualSize = this.audioSocket.getRecvBufferSize();
        console.log(`✅ Set audio socket receive buffer: requested ${requestedSize}, actual ${actualSize}`);
        if (actualSize < requestedSize / 2) {
          console.warn(`⚠️  Socket buffer smaller than requested - may experience packet loss`);
          console.warn(`   Run: sudo sysctl -w net.inet.udp.recvspace=8388608`);
        }
      } catch (err) {
        console.warn(`⚠️  Could not set socket buffer size: ${err.message}`);
      }
      
      // Join all known radiod multicast groups
      // Radiod uses multiple groups for different receivers/channels
      const knownGroups = [
        '239.113.49.249',  // USB channels (receiver 1)
        '239.160.155.125', // USB channels (receiver 2)
        '239.179.238.97',  // USB channels (receiver 3)
        '239.103.26.231'   // IQ channels
      ];
      
      for (const group of knownGroups) {
        try {
          this.audioSocket.addMembership(group, MULTICAST_INTERFACE || '0.0.0.0');
          this.joinedMulticastGroups.add(group);
          console.log(`✅ Joined radiod audio group: ${group}:5004`);
        } catch (err) {
          console.warn(`⚠️  Could not join ${group}: ${err.message}`);
        }
      }
      
      this.setupAudioReception();
    });
    this.audioSocket.on('error', (err) => {
      console.error('❌ Audio socket error:', err);
    });
    
    // Bind to 0.0.0.0 to receive multicast traffic
    this.audioSocket.bind(KA9Q_AUDIO_PORT, '0.0.0.0');
  }
  
  setupStatusReception() {
    let statusPacketCount = 0;
    this.controlSocket.on('message', (msg, rinfo) => {
      statusPacketCount++;
      if (statusPacketCount % 100 === 1) {
        console.log(`📊 Received ${statusPacketCount} status packets from ${rinfo.address}:${rinfo.port}`);
      }
      
      try {
        const status = this.parseStatusMessage(msg);
        if (status && status.ssrc) {
          // Always log 15770000 for debugging
          if (status.ssrc === 15770000) {
            console.log(`🔴 DEBUG: Status SSRC 15770000: ${status.multicast_address}:${status.multicast_port}`);
            const stream = this.activeStreams.get(status.ssrc);
            console.log(`🔴 DEBUG: activeStreams has 15770000? ${!!stream}, multicastAddress already set? ${stream?.multicastAddress}`);
          }
          
          // Log first time we see any SSRC
          if (!this.loggedStatus.has(status.ssrc)) {
            console.log(`📡 Status SSRC ${status.ssrc}: ${status.multicast_address}:${status.multicast_port}`);
            this.loggedStatus.add(status.ssrc);
          }
          
          const stream = this.activeStreams.get(status.ssrc);
          if (stream && !stream.multicastAddress) {
            stream.multicastAddress = status.multicast_address;
            stream.multicastPort = status.multicast_port;
            
            console.log(`✅ Matched active stream SSRC ${status.ssrc}, joining audio group ${status.multicast_address}:${status.multicast_port}`);
            
            // Join multicast group
            if (!this.joinedMulticastGroups.has(status.multicast_address)) {
              this.audioSocket.addMembership(status.multicast_address, MULTICAST_INTERFACE || '0.0.0.0');
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
    if (msg.length < 1) return null;
    
    // First byte is packet type - only process STATUS packets (type 0)
    const packetType = msg.readUInt8(0);
    if (packetType !== 0) {
      // Skip non-STATUS packets (1=RESPONSE, 2=COMMAND, etc.)
      return null;
    }
    
    let offset = 1;
    const status = {};
    let debugOnce = !this.statusParserDebugShown;
    
    if (debugOnce) {
      console.log(`   [Parser] Message length: ${msg.length} bytes, packet type: ${packetType}`);
      console.log(`   [Parser] First 64 bytes (hex): ${msg.slice(0, 64).toString('hex')}`);
    }
    
    while (offset < msg.length) {
      if (offset + 2 > msg.length) break;
      
      const tag = msg.readUInt8(offset++);
      const len = msg.readUInt8(offset++);
      
      if (debugOnce) {
        console.log(`   [Parser] Tag ${tag}, length ${len}`);
      }
      
      if (offset + len > msg.length) break;
      
      // OUTPUT_SSRC (tag 18) - variable length (1-4 bytes)
      if (tag === 18 && len >= 1 && len <= 4) {
        // Read variable-length integer (big-endian)
        let ssrc = 0;
        for (let i = 0; i < len; i++) {
          ssrc = (ssrc << 8) | msg[offset + i];
        }
        status.ssrc = ssrc;
        if (debugOnce) console.log(`   [Parser] Found SSRC tag 18 (${len} bytes): ${status.ssrc}`);
      }
      // OUTPUT_DATA_DEST_SOCKET (tag 17) - compact format: 4 bytes IP + 2 bytes port
      else if (tag === 17) {
        if (debugOnce) {
          console.log(`   [Parser] Tag 17 bytes (hex): ${msg.slice(offset, offset + len).toString('hex')}`);
        }
        // Compact format: IPv4 (4 bytes) + port (2 bytes big-endian)
        if (len >= 6) {
          const ip = `${msg[offset]}.${msg[offset + 1]}.${msg[offset + 2]}.${msg[offset + 3]}`;
          const port = msg.readUInt16BE(offset + 4);
          status.multicast_address = ip;
          status.multicast_port = port;
          if (debugOnce) console.log(`   [Parser] Found DATA_DEST_SOCKET tag 17: ${ip}:${port}`);
        }
      }
      
      offset += len;
    }
    
    if (debugOnce) {
      console.log(`   [Parser] Final status: ssrc=${status.ssrc}, addr=${status.multicast_address}, port=${status.multicast_port}`);
      this.statusParserDebugShown = true;
    }
    
    return status.ssrc ? status : null;
  }

  setupAudioReception() {
    let packetCounts = new Map();
    let forwardedCounts = new Map();
    let lastLogTime = new Map();
    
    this.audioSocket.on('message', (msg, rinfo) => {
      if (msg.length < 12) return; // Minimum RTP header size

      // OPTIMIZATION: Extract SSRC first, then early-exit if no active session
      const ssrc = msg.readUInt32BE(8);
      
      // Quick check: do we even care about this SSRC?
      const session = global.audioSessions ? global.audioSessions.get(ssrc) : null;
      if (!session) {
        // Log first packet from each unknown SSRC, then ignore
        if (!this.loggedOrphanRtp.has(ssrc)) {
          console.warn(`📭 RTP packets arriving for SSRC ${ssrc} but no WebSocket session is active`);
          this.loggedOrphanRtp.add(ssrc);
        }
        return; // Early exit - don't process packets we don't need
      }
      
      // Log first packet for active SSRCs
      if (!this.loggedRtp.has(ssrc)) {
        console.log(`🔊 RTP packet for SSRC ${ssrc} from ${rinfo.address}:${rinfo.port} (${msg.length} bytes)`);
        this.loggedRtp.add(ssrc);
      }

      // Count packets per SSRC
      packetCounts.set(ssrc, (packetCounts.get(ssrc) || 0) + 1);
      const now = Date.now();
      const lastLog = lastLogTime.get(ssrc) || 0;
      
      // Debug: log packet rate for active SSRCs every 2 seconds
      if (now - lastLog > 2000) {
        const count = packetCounts.get(ssrc);
        const fwdCount = forwardedCounts.get(ssrc) || 0;
        console.log(`📊 SSRC ${ssrc}: ${count} RTP packets received, ${fwdCount} forwarded to browser`);
        lastLogTime.set(ssrc, now);
      }
      
      // Forward to WebSocket clients
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
    });
  }

  async startAudioStream(frequency) {
    const ssrc = Math.floor(frequency); // Frequency is already in Hz, use as SSRC
    const freqKHz = frequency / 1000;
    
    console.log(`🎵 Starting stream: ${freqKHz} kHz`);
    
    // Use the radiod_client.py abstraction layer
    const interfaceArg = MULTICAST_INTERFACE ? `--interface ${MULTICAST_INTERFACE}` : '';
    const fallbackArg = RADIOD_AUDIO_MULTICAST ? `--fallback-multicast ${RADIOD_AUDIO_MULTICAST}` : '';
    const scriptPath = path.join(__dirname, 'radiod_client.py');
    // Use -u for unbuffered Python output
    const cmd = `${PYTHON_CMD} -u ${scriptPath} --radiod-host ${RADIOD_HOSTNAME} ${interfaceArg} ${fallbackArg} get-or-create --ssrc ${ssrc} --frequency ${frequency} --preset am --sample-rate 12000 --gain 30.0`;
    
    try {
      const { stdout, stderr } = await execAsync(cmd, { timeout: 30000 });
      
      if (stderr) {
        console.log(`   [Python]: ${stderr}`);
      }
      
      const result = JSON.parse(stdout.trim());
      
      if (!result.success) {
        console.error(`❌ Stream request failed: ${result.error}`);
        if (result.detail) console.error(`   Detail: ${result.detail}`);
        throw new Error(result.error);
      }
      
      const existed = result.existed ? '(reused existing)' : '(created new)';
      console.log(`✅ Channel ready: SSRC ${result.ssrc} ${existed}`);
      
      if (Math.abs(result.frequency_hz - frequency) > 1) {
        console.warn(`⚠️ Frequency mismatch! Requested ${frequency} Hz but got ${result.frequency_hz} Hz`);
      }
      
      const stream = {
        ssrc: result.ssrc,
        active: true,
        frequency: result.frequency_hz,
        multicastAddress: result.multicast_address,
        multicastPort: result.port,
        sampleRate: result.sample_rate
      };
      
      this.activeStreams.set(ssrc, stream);
      
      // Join the audio multicast group NOW that we have the address
      if (result.multicast_address) {
        if (!this.joinedMulticastGroups.has(result.multicast_address)) {
          try {
            this.audioSocket.addMembership(result.multicast_address, MULTICAST_INTERFACE || '0.0.0.0');
            this.joinedMulticastGroups.add(result.multicast_address);
            console.log(`✅ Joined audio multicast: ${result.multicast_address}:${result.port}`);
          } catch (err) {
            console.warn(`⚠️  Could not join audio group: ${err.message}`);
          }
        } else {
          console.log(`   ℹ️  Already member of ${result.multicast_address}`);
        }
      } else {
        console.warn(`⚠️  No multicast address from Python discovery`);
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
      // Note: We bypass the library's set_frequency validation which rejects 0 Hz,
      // but radiod itself accepts 0 Hz as a deletion signal
      try {
        const pythonScript = `import sys
import json
import random
from ka9q import RadiodControl
from ka9q.control import encode_double, encode_int, encode_eol
from ka9q.types import StatusType, CMD

control = RadiodControl('${RADIOD_HOSTNAME}')

# Manually construct TLV command to set frequency to 0 (bypasses validation)
cmdbuffer = bytearray()
cmdbuffer.append(CMD)
encode_double(cmdbuffer, StatusType.RADIO_FREQUENCY, 0.0)
encode_int(cmdbuffer, StatusType.OUTPUT_SSRC, ${ssrc})
encode_int(cmdbuffer, StatusType.COMMAND_TAG, random.randint(1, 2**31))
encode_eol(cmdbuffer)

# Send command to radiod
control.send_command(cmdbuffer)
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

  async setSquelch(ssrc, threshold) {
    return this.executeTuningCommand(ssrc, `control.set_squelch_open(ssrc=${ssrc}, level=${threshold})`);
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

  startServiceDiscovery() {
    console.log('🔍 Starting mDNS service discovery for radiod channels...');
    
    this.bonjour = new Bonjour();
    
    // Browse for RTP streams advertised by radiod
    this.browser = this.bonjour.find({ type: 'rtp', protocol: 'udp' });
    
    this.browser.on('up', (service) => {
      try {
        // Extract multicast address and hostname from service
        const address = service.addresses?.[0] || service.host;
        const port = service.port;
        const hostname = service.host;
        
        // Debug: log all discovered services
        console.log(`🔍 DEBUG: Service discovered - name: "${service.name}", host: "${hostname}", address: "${address}"`);
        
        // Only track channels from our configured radiod host
        // Extract base hostname (e.g., "bee1" from "bee1-hf-status.local")
        const radiodBase = RADIOD_HOSTNAME.split('-')[0]; // e.g., "bee1"
        if (!hostname.startsWith(radiodBase) && !service.name.startsWith(radiodBase)) {
          console.log(`   ⏭️  Skipping (not from ${radiodBase})`);
          return;
        }
        
        console.log(`📡 Discovered channel on ${RADIOD_HOSTNAME}: ${service.name}`);
        console.log(`   RTP: ${address}:${port}`);
        
        // Store discovered channel info
        this.discoveredChannels.set(address, {
          name: service.name,
          rtpAddress: address,
          rtpPort: port,
          statusPort: 5006,
          txt: service.txt,
          hostname: hostname
        });
        
        // Join STATUS group (5006) to receive status packets - these are small
        // Do NOT join AUDIO group (5004) - that's joined on demand to avoid data flood
        try {
          this.controlSocket.addMembership(address, MULTICAST_INTERFACE || '0.0.0.0');
          console.log(`✅ Joined status group: ${address}:5006 (not audio)`);
        } catch (err) {
          console.warn(`⚠️  Could not join status group: ${err.message}`);
        }
      } catch (err) {
        console.error(`❌ Error processing discovered service:`, err.message);
      }
    });
    
    this.browser.on('down', (service) => {
      const address = service.addresses?.[0] || service.host;
      console.log(`📭 Channel removed: ${service.name} (${address})`);
      this.discoveredChannels.delete(address);
    });
  }

  joinChannelMulticast(address) {
    if (this.joinedMulticastGroups.has(address)) {
      return; // Already joined
    }
    
    // Join the status multicast group (same IP, port 5006)
    try {
      this.controlSocket.addMembership(address, MULTICAST_INTERFACE || '0.0.0.0');
      console.log(`✅ Joined status group: ${address}:5006`);
    } catch (err) {
      console.warn(`⚠️  Could not join status group ${address}: ${err.message}`);
    }
    
    // Join the audio/RTP multicast group
    try {
      this.audioSocket.addMembership(address, MULTICAST_INTERFACE || '0.0.0.0');
      this.joinedMulticastGroups.add(address);
      console.log(`✅ Joined audio group: ${address}:5004`);
    } catch (err) {
      console.warn(`⚠️  Could not join audio group ${address}: ${err.message}`);
    }
  }

  shutdown() {
    console.log('🛑 Shutting down ka9q-radio proxy...');
    
    for (const [ssrc] of this.activeStreams) {
      this.stopAudioStream(ssrc);
    }
    
    if (this.browser) this.browser.stop();
    if (this.bonjour) this.bonjour.destroy();
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

app.post('/api/audio/tune/:ssrc/squelch', async (req, res) => {
  try {
    const ssrc = parseInt(req.params.ssrc);
    const { threshold } = req.body;
    
    await radioProxy.setSquelch(ssrc, threshold);
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
        console.log(`🔄 WebSocket upgrade request for SSRC ${ssrc}`);
        wss.handleUpgrade(request, socket, head, (ws) => {
          console.log(`✅ WebSocket upgrade successful for SSRC ${ssrc}`);
          wss.emit('connection', ws, request, ssrc);
        });
      } else {
        console.warn(`❌ Invalid SSRC in WebSocket path: ${url.pathname}`);
        socket.destroy();
      }
    } else {
      console.warn(`❌ Non-audio WebSocket path: ${url.pathname}`);
      socket.destroy();
    }
  });

  wss.on('connection', (ws, request, ssrc) => {
    console.log(`🎵 WebSocket audio connection for SSRC ${ssrc}`);
    
    // Close any existing session for this SSRC (handles reconnection)
    const existingSession = global.audioSessions.get(ssrc);
    if (existingSession && existingSession.ws) {
      console.log(`♻️  Replacing existing WebSocket session for SSRC ${ssrc}`);
      try {
        existingSession.ws.close(1000, 'Replaced by new connection');
      } catch (e) {
        // Ignore errors closing old connection
      }
    }
    
    const session = {
      ws,
      ssrc,
      audio_active: true  // Start active immediately - browser sends START message quickly
    };
    
    global.audioSessions.set(ssrc, session);
    console.log(`✅ Audio activated for SSRC ${ssrc} (ready to forward packets)`);
    
    ws.on('message', (message) => {
      const msg = message.toString();
      
      if (msg.startsWith('A:')) {
        if (msg.includes('START')) {
          session.audio_active = true;
          console.log(`▶️  Audio START command received for SSRC ${ssrc}`);
        } else if (msg.includes('STOP')) {
          session.audio_active = false;
          console.log(`⏹️  Audio deactivated for SSRC ${ssrc}`);
        }
      }
    });
    
    ws.on('close', (code, reason) => {
      console.log(`👋 WebSocket connection closed for SSRC ${ssrc} (code: ${code}, reason: ${reason})`);
      if (session.audio_active) {
        session.audio_active = false;
      }
      // Don't delete session immediately - allow reconnection
      // Delete after a timeout to allow browser to reconnect
      setTimeout(() => {
        if (global.audioSessions.has(ssrc)) {
          const currentSession = global.audioSessions.get(ssrc);
          if (currentSession === session) {
            global.audioSessions.delete(ssrc);
            console.log(`🗑️  Session cleaned up for SSRC ${ssrc}`);
          }
        }
      }, 5000); // 5 second grace period for reconnection
    });
    
    ws.on('error', (error) => {
      console.error(`❌ WebSocket error for SSRC ${ssrc}:`, error.message);
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
