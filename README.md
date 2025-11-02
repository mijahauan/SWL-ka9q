# Broadcast Station Monitor (SWL-ka9q)

A modern web-based interface for monitoring shortwave broadcast stations with live audio streaming capabilities. Built on top of [ka9q-radio](https://github.com/ka9q/ka9q-radio) and the [ka9q-python](https://github.com/mijahauan/ka9q-python) package, this tool highlights stations currently on the air and provides one-click audio playback via WebSocket streaming.

![Version](https://img.shields.io/badge/version-1.0.0-blue)
![License](https://img.shields.io/badge/license-MIT-green)

## Features

✨ **Real-Time Station Monitoring**
- Automatically highlights broadcast stations currently on the air based on UTC schedule
- Displays 50+ international shortwave broadcasters
- Updates every 60 seconds to reflect schedule changes

🎧 **Live Audio Streaming**
- One-click toggle to listen to any active station
- WebSocket-based RTP audio streaming (following signal-recorder architecture)
- Web Audio API for seamless browser-based playback
- Supports multiple simultaneous streams

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
- **Python 3** with ka9q-python package installed:
  ```bash
  pip3 install git+https://github.com/mijahauan/ka9q-python.git
  ```

### Optional but Recommended

- SDR hardware compatible with ka9q-radio (e.g., RX888, Airspy, RTL-SDR)
- Network access to radiod multicast streams

## Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/mijahauan/SWL-ka9q.git
   cd SWL-ka9q
   ```

2. **Set up Python virtual environment and install ka9q-python:**
   ```bash
   ./setup-venv.sh
   ```
   This creates a `venv/` directory and installs ka9q-python from GitHub.

3. **Install Node.js dependencies:**
   ```bash
   npm install
   ```

4. **Configure broadcast schedules** (optional):
   - Edit `bc-time.txt` for time-based schedules
   - Edit `bc-freq.txt` for frequency/station information

## Configuration

### Server Configuration

Edit the constants in `server.js` if needed:

```javascript
const PORT = 3100;                            // Web server port
const KA9Q_STATUS_MULTICAST = '239.192.152.141';  // radiod status multicast
const KA9Q_STATUS_PORT = 5006;                // radiod status port
const KA9Q_AUDIO_PORT = 5004;                 // RTP audio port
```

### Broadcast Schedule Format

**bc-time.txt** (Time-based schedules):
```
# Format: Frequency(kHz) | Station | Time (UTC) | Days | Language | Target
5850 | Radio Slovakia Int | 0130-0200 | daily | English | North America
9700 | Radio Bulgaria | 2000-2100 | 1,2,3,4,5 | English | Europe
```

**bc-freq.txt** (Station details):
```
# Format: Frequency(kHz) | Station | Power(kW) | Location | Target | Notes
5850 | Radio Slovakia Int | 100 | Rimavska Sobota | Europe/North America | Multiple daily broadcasts
```

- **Days**: Use `daily` or comma-separated numbers (1=Mon, 2=Tue, ..., 7=Sun)
- **Time**: 24-hour UTC format (HHMM-HHMM)
- **Frequency**: In kHz

## Usage

### Start the Server

```bash
npm start
```

The server will start on http://localhost:3100

### Development Mode (with auto-reload)

```bash
npm run dev
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
2. A WebSocket connection is established for RTP packet streaming
3. Audio packets are decoded in the browser using Web Audio API
4. Multiple stations can be played simultaneously
5. Click **⏹️ Stop Listening** to end the stream

## API Endpoints

### Station Data

- `GET /api/stations` - Get all stations with on-air status
- `GET /api/stations/active` - Get only currently active stations
- `GET /api/stations/frequency/:freq` - Get station info for specific frequency

### Audio Streaming

- `GET /api/audio/stream/:frequency` - Start audio stream for frequency (kHz)
- `DELETE /api/audio/stream/:ssrc` - Stop audio stream
- `GET /api/audio/health` - Check audio proxy status

### Management

- `POST /api/reload` - Reload broadcast schedules from files

## WebSocket Protocol

Audio streaming follows the signal-recorder architecture:

**Client → Server:**
```
A:START    # Activate audio streaming
A:STOP     # Deactivate audio streaming
```

**Server → Client:**
```
Binary RTP packets (12-byte header + PCM audio payload)
```

The client-side JavaScript handles RTP parsing and feeds PCM data to the Web Audio API.

## File Structure

```
SWL-ka9q/
├── server.js              # Node.js backend server
├── package.json           # Node.js dependencies
├── bc-time.txt            # Time-based broadcast schedules
├── bc-freq.txt            # Frequency-based station info
├── public/
│   ├── index.html         # Main web interface
│   ├── styles.css         # Styling
│   └── app.js             # Frontend JavaScript
└── README.md              # This file
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
   python3 -c "from ka9q import RadiodControl; c = RadiodControl('bee1-hf-status.local'); print('✅ Connected')"
   ```

3. **Verify multicast connectivity:**
   ```bash
   sudo tcpdump -i any 'host 239.192.152.141'
   ```

4. **Check browser console** (F12) for JavaScript errors

5. **Firewall/Network:** Ensure UDP ports 5004 and 5006 are accessible

### Connection issues

- Confirm the radiod hostname in server.js matches your setup
- Default is `bee1-hf-status.local` - change if using different hostname
- Edit the Python script in `startAudioStream()` method

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