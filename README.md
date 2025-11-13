# Broadcast Station Monitor (SWL-ka9q)

A web-based interface for monitoring shortwave broadcast stations with live audio streaming capabilities. Built on top of [ka9q-radio](https://github.com/ka9q/ka9q-radio) and the [ka9q-python](https://github.com/mijahauan/ka9q-python) package, this tool highlights stations currently on the air and provides one-click audio playback via WebSocket streaming.

![Version](https://img.shields.io/badge/version-1.0.0-blue)
![License](https://img.shields.io/badge/license-MIT-green)

## Features

✨ **Real-Time Station Monitoring**
- Automatically highlights broadcast stations currently on the air based on UTC schedule
- Displays 7300+ broadcast schedules from EiBi database
- Monitors 1400+ unique frequencies across HF bands
- Updates every 60 seconds to reflect schedule changes
- Auto-downloads latest EiBi schedule on first run if missing

🎧 **Live Audio Streaming**
- One-click toggle to listen to any active station
- WebSocket-based PCM audio streaming from ka9q-radio RTP multicast
- Server-side RTP parsing with PCM extraction and byte-swapping
- Web Audio API for seamless browser-based playback at 12 kHz mono
- Supports multiple simultaneous streams

🎛️ **Advanced Tuning Controls**
- Main frequency tuning (change the tuned frequency)
- Real-time AGC (Automatic Gain Control) adjustment
- Manual gain control (channels created with AGC disabled by default)
- Filter bandwidth adjustment (low/high edge)
- Frequency shift for fine-tuning (useful for CW/SSB)
- Output level control
- Per-station tuning while streaming

📡 **Advanced Filtering**
- Filter by on-air status
- Search by station name, frequency, language, or target area
- Quick band filters (49m, 41m, 31m, 25m, 19m, 16m)
- Frequency-based organization

📊 **Rich Station Information**
- Broadcast schedule with UTC times
- Transmitter location and power
- Target coverage area
- Language and programming details
- Technical specifications

## Architecture

```
┌─────────────────────────┐
│   Web Browser Client    │
│  HTML/CSS/JavaScript    │
│   WebSocket Audio       │
└────────────┬────────────┘
             │
┌────────────▼────────────┐
│   Node.js Server        │
│  Express.js + WebSocket │
│  • Schedule parsing     │
│  • API endpoints        │
│  • ka9q-radio proxy     │
└────────────┬────────────┘
             │
┌────────────▼────────────┐
│  ka9q-python Package    │
│  RadiodControl API      │
│  • Channel creation     │
│  • Stream management    │
└────────────┬────────────┘
             │
┌────────────▼────────────┐
│   ka9q-radio (radiod)   │
│  RTP Multicast Streams  │
│  • SDR control          │
│  • Audio processing     │
└─────────────────────────┘
```

## Prerequisites

### Required

- **Node.js** >= 16.0.0
- **ka9q-radio** (radiod running and accessible)
- **Python 3** with **ka9q-python** package (custom package, not on PyPI):
  ```bash
  # Installed automatically by setup-venv.sh, or manually:
  pip3 install git+https://github.com/mijahauan/ka9q-python.git
  ```

### Optional but Recommended

- SDR hardware compatible with ka9q-radio (e.g., RX888, Airspy, RTL-SDR)
- Network access to radiod multicast streams

### Notes

- ✅ **No external executables required**: The ka9q-python package now uses native Python channel discovery. The `control` executable from ka9q-radio is no longer needed.
- ✅ **Cross-platform compatible**: Works on macOS, Linux, and Windows with zero external dependencies beyond Python itself.

## Installation

### Quick Start (One Command)

```bash
git clone https://github.com/mijahauan/SWL-ka9q.git
cd SWL-ka9q
npm run setup && npm start
```

The setup script handles everything automatically and guides you through configuration.

**Note for Debian/Ubuntu users:** If you get a Python error about "externally-managed-environment", install the venv package first:
```bash
sudo apt install python3-venv
npm run setup && npm start
```

📘 **For detailed installation instructions and troubleshooting, see [INSTALL.md](INSTALL.md)**

### Manual Setup (Alternative)

1. **Clone the repository:**
   ```bash
   git clone https://github.com/mijahauan/SWL-ka9q.git
   cd SWL-ka9q
   ```

2. **Set up Python virtual environment and install ka9q-python:**
   ```bash
   ./setup-venv.sh
   ```
   This creates a `venv/` directory and installs the **custom ka9q-python package from GitHub** (not available on PyPI).
   
   **Debian/Ubuntu users:** You may need to install `python3-venv` first:
   ```bash
   sudo apt install python3-venv
   ```

3. **Install Node.js dependencies:**
   ```bash
   npm install
   ```

4. **Broadcast schedules included:**
   - `bc-time.txt` contains 7337 EiBi broadcast schedules
   - `bc-freq.txt` contains 1482 frequency entries
   - Files are ready to use, or customize with your own schedules
   - **Auto-download:** If `bc-time.txt` is missing, the server automatically downloads the latest EiBi schedule on first run

5. **Configure radiod hostname (if needed):**
   
   **Default:** Works out-of-the-box if radiod is on the same machine (uses `localhost`)
   
   **For interactive setup (recommended):**
   ```bash
   npm start
   # You'll be prompted to enter the radiod hostname on first run
   ```
   
   **Or set manually if radiod is on a different machine:**
   ```bash
   export RADIOD_HOSTNAME=192.168.1.100
   npm run start-direct
   ```
   
   **See [CONFIGURATION.md](CONFIGURATION.md) and [QUICKSTART.md](QUICKSTART.md) for detailed setup.**

## Configuration

### Server Configuration

Edit the constants in `server.js` if needed:

```javascript
const PORT = 3100;                            // Web server port
const KA9Q_STATUS_MULTICAST = '239.192.152.141';  // radiod status multicast
const KA9Q_STATUS_PORT = 5006;                // radiod status port
const KA9Q_AUDIO_PORT = 5004;                 // RTP audio port
const RADIOD_HOSTNAME = '192.168.1.100';      // YOUR radiod hostname (REQUIRED)
```

### Updating Broadcast Schedules

**EiBi publishes new schedules twice a year:**
- **A-season** (late March): Spring/Summer schedules
- **B-season** (late October): Fall/Winter schedules

**Automatic Update (Recommended):**

The server now automatically checks for and downloads schedule updates:

1. **On startup** - Checks if schedule is current
2. **Smart detection** - Determines current season automatically (A/B schedule)
3. **Age-based updates** - Updates if schedule is older than 14 days
4. **Seamless application** - Server applies updates automatically

You can also manually trigger an update check:
```bash
./auto-update-schedule.sh
```

**Manual Update Method:**

If you prefer manual control or need a specific schedule:

1. **Interactive download:**
   ```bash
   ./update-schedule.sh
   # Then enter: sked-b25.txt (or desired season)
   ```

2. **The server automatically detects and applies the update:**
   - Checks for `new_schedule.txt` every 5 minutes
   - Backs up current schedule to `bc-time.backup.[timestamp].txt`
   - Replaces `bc-time.txt` with new schedule
   - Reloads station data automatically

**Alternative Manual Method:**

1. **Download from EiBi:**
   ```bash
   wget https://www.eibispace.de/dx/sked-b25.txt -O new_schedule.txt
   # or: curl -o new_schedule.txt https://www.eibispace.de/dx/sked-b25.txt
   ```

2. **Place in root directory:**
   ```bash
   # File should be named: new_schedule.txt
   # Server will auto-detect within 5 minutes
   ```

3. **Or apply immediately:**
   ```bash
   pnpm start  # Restart server
   ```

**Available EiBi schedules:** https://www.eibispace.de/dx/

📘 **See [SCHEDULE_UPDATE.md](SCHEDULE_UPDATE.md) for detailed schedule update guide**

### Broadcast Schedule Format

**bc-time.txt** (EiBi format):
```
Time(start) Time(end) [Days] ITU Station Lang Target Frequencies
0130 0200 SVK RSI E NAm 5850 9700
```

**bc-freq.txt** (Pipe-delimited):
```
Frequency(kHz) | Station | Power(kW) | Location | Target | Notes
5850 | RSI | 100 | Rimavska Sobota | NAm,Eu | Multiple broadcasts
```

- **Days**: Optional field, 1=Mon through 7=Sun, or omit for daily
- **Time**: 24-hour UTC format (HHMM)
- **Frequency**: In kHz (converted to Hz internally)
- Files use EiBi database format for maximum compatibility

## Usage

### Start the Server

```bash
pnpm start
# or: npm start
```

The server will start on http://localhost:3100

### Development Mode (with auto-reload)

```bash
pnpm run dev
# or: npm run dev
```

### Environment Variables

Optional configuration via environment variables:
```bash
export PORT=3100                              # Web server port (default: 3100)
export RADIOD_HOSTNAME=your-radiod-hostname   # radiod hostname (default: localhost)
npm run start-direct                          # Skip interactive prompt
```

### Access the Interface

1. Open your browser to **http://localhost:3100**
2. The interface will display all broadcast stations
3. Stations currently on-air are highlighted with a green border and 🔴 ON AIR badge
4. Click **▶️ Listen Live** to start audio streaming
5. Use filters to find specific stations:
   - **Show Only Active Stations** checkbox
   - **Search** by station name, frequency, language, or target
   - **Band Filter** buttons for quick frequency range selection

### Audio Streaming

When you click "Listen Live":
1. The server requests a new audio channel from ka9q-radio via ka9q-python
2. A WebSocket connection is established for PCM audio streaming
3. Server receives RTP multicast, parses headers, extracts PCM payload
4. Server byte-swaps PCM data for correct endianness and forwards to browser
5. Browser schedules PCM buffers using Web Audio API for gapless playback
6. Multiple stations can be played simultaneously
7. Click **⏹️ Stop Listening** to end the stream

**Channel Creation:**
- Channels are created with AM demodulation preset at 12 kHz sample rate
- AGC (Automatic Gain Control) is **disabled by default** to allow manual control
- Initial gain set to 30 dB for good audio levels
- All tuning controls are immediately available for adjustment

**Channel Cleanup:**
- When stopping a stream, the server deletes the channel from radiod by setting its frequency to 0 Hz
- This prevents accumulation of unused channels on the radiod server
- Channels are automatically removed on radiod's next polling cycle

**Real-Time Tuning:**
- Click **🎛️ Tune** button on any playing station to open the tuning panel
- Change main frequency (tune to different stations/signals)
- Adjust AGC settings: enable/disable, hangtime, headroom
- Control manual gain (channels default to AGC off for manual control)
- Modify filter bandwidth (low/high edge in Hz)
- Apply frequency shift for fine-tuning (CW beat note, SSB clarity)
- Adjust output level/volume
- Changes apply immediately to the active stream

## API Endpoints

### Station Data

- `GET /api/stations` - Get all stations with on-air status
- `GET /api/stations/active` - Get only currently active stations
- `GET /api/stations/frequency/:freq` - Get station info for specific frequency

### Audio Streaming

- `GET /api/audio/stream/:frequency` - Start audio stream for frequency (kHz)
- `DELETE /api/audio/stream/:ssrc` - Stop audio stream
- `GET /api/audio/health` - Check audio proxy status

### Tuning Controls

- `POST /api/audio/tune/:ssrc/frequency` - Change main frequency
  - Body: `{ frequency_hz: float }`
- `POST /api/audio/tune/:ssrc/agc` - Adjust AGC settings
  - Body: `{ enable: boolean, hangtime: float, headroom: float }`
- `POST /api/audio/tune/:ssrc/gain` - Set manual gain
  - Body: `{ gain_db: float }`
- `POST /api/audio/tune/:ssrc/filter` - Adjust filter bandwidth
  - Body: `{ low_edge: float, high_edge: float }`
- `POST /api/audio/tune/:ssrc/shift` - Set frequency shift
  - Body: `{ shift_hz: float }`
- `POST /api/audio/tune/:ssrc/output-level` - Set output level
  - Body: `{ level: float }`

### Management

- `POST /api/reload` - Reload broadcast schedules from files

## WebSocket Protocol

Audio streaming uses a simple binary protocol:

**Client → Server (text messages):**
```
A:START    # Activate audio streaming
A:STOP     # Deactivate audio streaming
```

**Server → Client (binary messages):**
```
Raw PCM audio data (16-bit signed integers, little-endian, mono, 12 kHz)
```

The server handles:
- RTP packet reception from ka9q-radio multicast
- RTP header parsing (including CSRC and extension fields)
- PCM payload extraction
- Byte-swapping for correct endianness

The client-side JavaScript:
- Receives PCM binary data via WebSocket
- Converts 16-bit integers to Float32 for Web Audio API
- Schedules audio buffers for gapless playback

## File Structure

```
SWL-ka9q/
├── server.js                 # Node.js backend server
├── package.json              # Node.js dependencies
├── start.sh                  # Interactive startup script (prompts for hostname)
├── setup-venv.sh             # Python venv setup script
├── auto-update-schedule.sh   # Automatic schedule updater (runs on startup)
├── update-schedule.sh        # Manual schedule updater (interactive)
├── bc-time.txt               # EiBi time-based schedules (7337 entries)
├── bc-freq.txt               # Frequency database (1482 entries)
├── .radiod-hostname          # Saved radiod hostname (created by start.sh)
├── public/
│   ├── index.html            # Main web interface with table/card views
│   ├── styles.css            # Styling (includes table view styles)
│   └── app.js                # Frontend JavaScript (AudioSession, table/card rendering)
├── README.md                 # This file
├── QUICKSTART.md             # Quick start guide
├── CONFIGURATION.md          # Configuration guide
├── SCHEDULE_UPDATE.md        # Schedule update guide
├── TROUBLESHOOTING.md        # Detailed troubleshooting
└── .gitignore                # Git ignore patterns
```

## Troubleshooting

### No stations showing as "On Air"

- Verify UTC time is correct: `date -u`
- Check schedule format in `bc-time.txt`
- Ensure time ranges are in 24-hour format (e.g., `0130-0200`)

### Audio streaming fails

1. **Verify ka9q-radio is running:**
   ```bash
   ps aux | grep radiod
   ```

2. **Check ka9q-python installation:**
   ```bash
   python3 -c "from ka9q import RadiodControl; c = RadiodControl('localhost'); print('✅ Connected')"
   # Or use your radiod hostname instead of localhost
   ```

3. **Verify multicast connectivity:**
   ```bash
   sudo tcpdump -i any 'host 239.192.152.141'
   ```

4. **Check browser console** (F12) for JavaScript errors

5. **Firewall/Network:** Ensure UDP ports 5004 and 5006 are accessible

### Connection issues

- **Confirm the radiod hostname is configured correctly**
  - Find your radiod's status hostname in `/etc/radio/radiod.conf`:
    ```bash
    grep "^status" /etc/radio/radiod.conf
    # Example output: status = bee1-hf-status.local
    ```
  - Ensure SWL-ka9q matches this hostname:
    - Run `npm start` and enter the hostname when prompted
    - Or check `server.js` line 34: `RADIOD_HOSTNAME` constant
    - Or set via environment variable: `export RADIOD_HOSTNAME=your-radiod-hostname`
- **Test connectivity:**
  ```bash
  ping your-radiod-hostname
  python3 -c "from ka9q import RadiodControl; c = RadiodControl('your-radiod-hostname'); print('✅ OK')"
  ```

## Integration with Other Projects

This project is designed to work alongside:

- **[ka9q-radio](https://github.com/ka9q/ka9q-radio)** - SDR control and RTP streaming
- **[ka9q-python](https://github.com/mijahauan/ka9q-python)** - Python API wrapper
- **[signal-recorder](https://github.com/mijahauan/signal-recorder)** - Reference for WebSocket streaming architecture

## Credits

- **ka9q-radio** by Phil Karn (KA9Q)
- **ka9q-python** by mijahauan
- **signal-recorder** by mijahauan (WebSocket streaming architecture reference)

## Contributing

Contributions welcome! Please:
1. Fork the repository
2. Create a feature branch
3. Submit a pull request

## License

MIT License - See LICENSE file for details

## Support

For issues or questions:
- Open an issue on GitHub
- Check ka9q-radio and ka9q-python documentation
- Verify your SDR and radiod configuration

---

**Happy Listening! 📻🌍**