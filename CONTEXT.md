# ------------------------------
# AI PROJECT CONTEXT MANIFEST
# ------------------------------
# Instructions: Paste this entire file at the start of any new chat session
# to provide ground-truth context for the project.

## 1. 🎯 Core Mission & Objectives

* **Project:** SWL-ka9q - Broadcast Station Monitor
* **Mission:** A web-based interface for monitoring shortwave broadcast stations with live audio streaming capabilities. Built on top of ka9q-radio and ka9q-python, this tool highlights stations currently on the air and provides one-click audio playback via WebSocket streaming.
* **Core Goal:** Must provide seamless, real-time broadcast monitoring with minimal latency audio streaming for shortwave radio enthusiasts. The interface should be intuitive enough for non-technical users while providing advanced tuning controls for experienced operators.

## 2. 📜 Guiding Principles (Director's Mandate)

These are the non-negotiable rules for all development.

* **Tech Stack:**
    * Backend: Node.js (ES modules), Express.js v4.18.2, WebSocket (ws v8.14.2)
    * Frontend: Vanilla JavaScript (no framework), Web Audio API, WebSocket client
    * Python Integration: ka9q-python package (custom, from GitHub: mijahauan/ka9q-python)
    * External Dependency: ka9q-radio (radiod) for SDR control and RTP streaming
    * Package Manager: pnpm (or npm)
    * Runtime: Node.js >= 16.0.0, Python 3

* **Code Style:**
    * Use ES6+ features (async/await, arrow functions, template literals)
    * All async operations must use `async/await` pattern with proper error handling
    * Use `execAsync` (promisified exec) for Python scripts - NEVER use blocking `exec`
    * Python scripts should be passed via stdin using: `echo "script" | python` (no temp files)
    * Multiline Python code must preserve indentation - use proper string templates
    * Use console logging with emoji prefixes for different types of messages (🎵 audio, 📻 frequency, ✅ success, ❌ error, ⚠️ warning)

* **Performance Requirements:**
    * All Python execution must be non-blocking (async)
    * No temporary file I/O - use stdin piping for Python scripts
    * Cache on-air status calculations per-minute to avoid redundant time checks
    * Use file watching (fs.watch) instead of polling for schedule updates
    * Audio streaming must be low-latency with gapless playback

* **Audio Architecture:**
    * Server receives RTP multicast from ka9q-radio (port 5004)
    * Server parses RTP headers (handles CSRC count and extension headers correctly)
    * Server byte-swaps PCM payload for correct endianness (like ka9q-web does)
    * Server forwards PCM to browser via WebSocket as raw binary
    * Client converts 16-bit PCM to Float32 for Web Audio API
    * Client schedules audio buffers for gapless playback using nextPlayTime tracking
    * Sample rate: 12 kHz mono, 16-bit signed integers

* **Channel Management:**
    * Channels created with AM preset, 12 kHz sample rate
    * AGC disabled by default (agc_enable=0) to allow manual control from UI
    * Initial gain set to 30 dB
    * Channels deleted on stop by setting frequency to 0 Hz
    * Use SSRC = frequency (in Hz) for channel identification

* **Git Process:**
    * Main branch: `main`
    * Document all major changes in CHANGELOG.md
    * Keep documentation up-to-date (README.md, CONFIGURATION.md, QUICKSTART.md, etc.)

## 3. 🗺️ Key Components (The API Map)

This is a high-level map of the project's most important, stable interfaces.

### Backend: `server.js` (Node.js/Express)

#### Ka9qRadioProxy Class (Main Audio Control)
* `startAudioStream(frequency)`: Creates ka9q channel, returns stream object with SSRC
* `stopAudioStream(ssrc)`: Stops stream and deletes channel (sets frequency to 0 Hz)
* `setFrequency(ssrc, frequency_hz)`: Changes main tuned frequency
* `setAGC(ssrc, enable, hangtime, headroom)`: Controls automatic gain control
* `setGain(ssrc, gain_db)`: Sets manual gain in dB
* `setFilter(ssrc, low_edge, high_edge)`: Adjusts filter bandwidth
* `setShift(ssrc, shift_hz)`: Sets frequency shift for fine-tuning
* `executeTuningCommand(ssrc, command)`: Generic Python command executor for tuning

#### Schedule Management Functions
* `parseTimeSchedule()`: Parses bc-time.txt (EiBi format, column-based)
* `parseFreqSchedule()`: Parses bc-freq.txt (EiBi frequency database)
* `isOnAir(schedule)`: Checks if broadcast is currently active based on UTC time
* `getActiveStations()`: Returns all currently on-air stations (cached per-minute)
* `checkAndUpdateSchedule()`: Monitors for new_schedule.txt and auto-applies updates

#### REST API Endpoints
* `GET /api/stations`: Get all stations with on-air status
* `GET /api/stations/active`: Get only currently active stations
* `GET /api/stations/by-frequency`: Get stations grouped by frequency
* `GET /api/stations/frequency/:freq`: Get station info for specific frequency
* `GET /api/audio/stream/:frequency`: Start audio stream (returns SSRC and WebSocket URL)
* `DELETE /api/audio/stream/:ssrc`: Stop audio stream
* `POST /api/audio/tune/:ssrc/frequency`: Change main frequency (body: `{ frequency_hz: float }`)
* `POST /api/audio/tune/:ssrc/agc`: Adjust AGC (body: `{ enable: bool, hangtime: float, headroom: float }`)
* `POST /api/audio/tune/:ssrc/gain`: Set manual gain (body: `{ gain_db: float }`)
* `POST /api/audio/tune/:ssrc/filter`: Adjust filter bandwidth (body: `{ low_edge: float, high_edge: float }`)
* `POST /api/audio/tune/:ssrc/shift`: Set frequency shift (body: `{ shift_hz: float }`)
* `GET /api/audio/health`: Check audio proxy status and Python connectivity
* `POST /api/reload`: Reload broadcast schedules from files

#### WebSocket Protocol
* Client sends: `A:START` to begin audio streaming
* Client sends: `A:STOP` to pause audio streaming
* Server sends: Raw PCM audio data (16-bit signed integers, little-endian, mono, 12 kHz)

### Frontend: `public/app.js`

#### AudioSession Class (WebSocket Audio Client)
* `constructor(frequency, ssrc, websocketUrl)`: Initialize audio session
* `start()`: Connect WebSocket, create Web Audio API context, start playback
* `handlePcmPacket(data)`: Convert PCM to Float32, schedule gapless playback
* `stop()`: Close WebSocket, cleanup audio context

#### Main Functions
* `loadStations()`: Fetch station data from API
* `renderStations()`: Display stations in table or card view based on filters
* `startListening(frequency)`: Create audio session and start playback
* `stopListening(frequency, ssrc)`: Stop playback and cleanup
* `openTuningPanel(frequency, station)`: Open tuning controls UI
* `updateFrequency(value)`: Change main tuned frequency
* `updateAGC(enabled)`: Toggle AGC on/off
* `updateGain(value)`: Adjust manual gain (use this for volume control)
* `updateFilter(lowEdge, highEdge)`: Change filter bandwidth
* `updateShift(value)`: Apply frequency shift

### Configuration Files

#### `package.json`
* Scripts: `start` (interactive with hostname prompt), `start-direct` (skip prompt), `dev` (nodemon)
* Dependencies: express, ws
* DevDependencies: nodemon

#### Environment Variables
* `RADIOD_HOSTNAME`: ka9q-radio status hostname (default: localhost)
* `PORT`: Web server port (default: 3100)

#### Data Files
* `bc-time.txt`: EiBi broadcast schedules (7300+ entries, column-based format)
* `bc-freq.txt`: EiBi frequency database (1400+ entries)
* `.radiod-hostname`: Saved radiod hostname from interactive setup
* `new_schedule.txt`: Drop file for schedule updates (auto-applied by server)

#### Python Integration
* Virtual environment: `venv/` (created by setup-venv.sh)
* Python command: Uses venv Python if available, falls back to system python3
* ka9q-python package: Installed from GitHub (mijahauan/ka9q-python)
* Python command pattern: `echo "script" | python` with proper multiline/indentation support

## 4. ⚡ Current Task & Git Context

This section should be updated for each specific coding session.

* **Current Branch:** `main`
* **Task Goal:** Improve the tune function when listening to any broadcast with guidance from ka9q-web implementation
* **Reference Implementation:** https://github.com/wa2n-code/ka9q-web (C implementation using Onion framework and WebSockets)
* **Key Steps:**
    1. Review ka9q-web's tuning approach and UI/UX patterns
    2. Analyze current tuning implementation in `server.js` (Ka9qRadioProxy class methods)
    3. Analyze current tuning UI in `public/app.js` (tuning panel and controls)
    4. Identify improvements from ka9q-web: better controls, additional parameters, UX enhancements
    5. Implement improvements while maintaining JavaScript/Node.js stack (no C code)
    6. Test tuning controls with real broadcasts
    7. Update documentation if significant changes made

## 5. 🔧 Technical Implementation Details

### RTP Packet Parsing (Critical for Audio)
The server parses RTP headers to extract PCM payload:
1. Read byte 0: Extract CSRC count (bits 0-3) and extension flag (bit 4)
2. Calculate payload offset: 12 bytes (base RTP header) + (CSRC count × 4 bytes)
3. If extension flag set: Add 4 bytes + (extension length × 4 bytes) to offset
4. Extract PCM payload starting at calculated offset
5. Byte-swap PCM data (swap adjacent bytes) for correct endianness
6. Forward byte-swapped PCM to WebSocket client

### Schedule Format (EiBi Database)
**bc-time.txt** uses fixed column positions (NOT whitespace-delimited):
- Columns 0-3: Start time (HHMM)
- Columns 5-8: End time (HHMM)
- Columns 10-15: Days (optional, "daily" if blank)
- Columns 16-19: Country code
- Columns 20-45: Station name (26 chars)
- Columns 46-49: Language (4 chars)
- Columns 50-53: Target area (4 chars)
- Columns 54+: Frequencies in kHz (space-separated)

### Performance Optimizations Applied
* Async Python execution (non-blocking)
* Stdin-based Python script execution (no temp files)
* Per-minute caching of on-air status
* File watching instead of polling for schedule updates
* See PERFORMANCE_IMPROVEMENTS.md for full details

### Known Limitations
* Python script length limited by shell command length (current scripts ~1000 chars, well within limits)
* File watching behavior varies by OS (handled with 1-second debouncing)
* On-air status cache invalidates per-minute (max 59 seconds stale if system time changes)

## 6. 📚 Documentation Reference

* **README.md**: Full project documentation, installation, usage
* **QUICKSTART.md**: 5-minute setup guide
* **CONFIGURATION.md**: radiod hostname configuration details
* **SCHEDULE_UPDATE.md**: EiBi schedule update procedures
* **TROUBLESHOOTING.md**: Detailed troubleshooting for audio streaming issues
* **PERFORMANCE_IMPROVEMENTS.md**: Performance optimization details and testing procedures
* **CHANGELOG.md**: Project version history and major changes

## 7. 🎨 UI/UX Patterns

* **Station Highlighting**: Green border and 🔴 ON AIR badge for active broadcasts
* **Faded Appearance**: Off-air stations shown with reduced opacity
* **Controls**: Only show tuning controls when actively listening to a station
* **View Modes**: Table view (compact) and card view (detailed)
* **Time Display**: UTC time prominently displayed (critical for schedule matching)
* **Band Filters**: Quick buttons for common shortwave bands (49m, 41m, 31m, 25m, 19m, 16m)
* **Search**: Real-time filtering by station name, frequency, language, or target area

## 8. 🔗 External Dependencies & Integration

* **ka9q-radio (radiod)**: SDR control and RTP streaming server
  - Status multicast: 239.192.152.141:5006
  - Audio RTP port: 5004
  - Configuration file: /etc/radio/radiod.conf
  
* **ka9q-python**: Python API wrapper for ka9q-radio
  - Repository: https://github.com/mijahauan/ka9q-python
  - Not on PyPI - must install from GitHub
  - Used for channel creation and control commands
  
* **EiBi Database**: Broadcast schedules
  - Website: https://www.eibispace.de/dx/
  - Updates: Twice yearly (A-season: late March, B-season: late October)
  - Auto-download: Server downloads if bc-time.txt missing

## 9. 🚨 Common Issues & Solutions

* **"Failed to start audio stream"**: Check radiod hostname matches /etc/radio/radiod.conf status entry
* **No stations showing as "On Air"**: Verify system UTC time is correct
* **Audio stuttering**: Check network connectivity to radiod, ensure multicast routing works
* **ModuleNotFoundError: ka9q**: Run ./setup-venv.sh to install ka9q-python from GitHub
* **Python scripts failing**: Ensure proper string escaping in `executeTuningCommand` - use echo with stdin piping

## 10. 🎯 Next Session Preparation

For the tuning function improvement task, you should:

1. **Review ka9q-web source code** to understand their tuning implementation:
   - Look for tuning controls in their web interface
   - Identify any additional parameters or methods they use
   - Study their UI/UX patterns for tuning
   
2. **Current tuning capabilities** (already implemented):
   - Main frequency tuning
   - AGC control (enable/disable, hangtime, headroom)
   - Manual gain control (also controls volume)
   - Filter bandwidth (low/high edge)
   - Frequency shift
   - Squelch threshold
   
3. **Potential improvements to consider**:
   - Better UI layout for tuning controls
   - Real-time feedback/monitoring during tuning
   - Preset tuning profiles
   - Visual spectrum display
   - S-meter or signal strength indicator
   - Audio quality indicators
   - Better control ranges and step sizes
   
4. **Testing approach**:
   - Test with actual on-air broadcasts
   - Verify all tuning parameters apply correctly
   - Check for smooth audio transitions when tuning
   - Ensure no audio dropouts during parameter changes

---

**Context File Created:** 2025-01-12  
**Project Version:** 1.0.0  
**Last Major Update:** 2025-11-03 (Performance improvements)  
**Next Intended Work:** Improve tune function using ka9q-web guidance
