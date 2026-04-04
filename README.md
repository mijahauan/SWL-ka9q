# SWL-ka9q

A web-based shortwave broadcast station monitor with live audio streaming. Built on [ka9q-radio](https://github.com/ka9q/ka9q-radio) and [ka9q-python](https://github.com/mijahauan/ka9q-python).

Displays 7300+ broadcast schedules from the EiBi database, highlights stations currently on the air, and provides one-click audio playback via WebSocket streaming with Opus compression.

## Quick Start

```bash
git clone https://github.com/mijahauan/SWL-ka9q.git
cd SWL-ka9q
./swl --status-host bee1-status.local
```

That's it. The `./swl` launcher handles everything:

1. Checks for code updates and prompts to install
2. Downloads/updates the EiBi broadcast schedule
3. Installs dependencies on first run (Node.js packages, Python venv, SSL cert)
4. Starts the server and opens your browser

After the first run, just:

```bash
./swl
```

### Other Commands

```bash
./swl stop                    # Stop the server
./swl restart                 # Restart
./swl status                  # Check if running
./swl --no-browser            # Start without opening browser
./swl --status-host NEW_HOST  # Change radiod host
```

### Prerequisites

- **Node.js** >= 16.0.0
- **Python 3** >= 3.8 (with `python3-venv` on Debian/Ubuntu)
- **ka9q-radio** (radiod) running and accessible
- **curl** or **wget** (for EiBi schedule downloads)

## Features

**Real-Time Station Monitoring**
- 7300+ broadcast schedules from EiBi database
- Highlights stations currently on the air (updated every 60 seconds)
- Auto-downloads latest EiBi schedule, checks for updates on each launch

**Live Audio Streaming**
- One-click listen on any active station
- Opus audio transport (WebCodecs API) with PCM fallback
- WebSocket streaming from ka9q-radio RTP multicast
- Multiple simultaneous streams
- Automatic HTTPS for Secure Context support

**Tuning Controls**
- Main frequency, AGC, manual gain, filter bandwidth
- Frequency shift (CW/SSB), squelch threshold
- Per-station tuning while streaming

**Filtering and Search**
- On-air status filter
- Search by station name, frequency, language, or target area
- Quick band filters (49m, 41m, 31m, 25m, 19m, 16m)
- Table and card view modes

## Architecture

```
Browser (HTML/JS) ──WebSocket──> Node.js Server ──> ka9q-python ──> radiod (SDR)
                                      │
                                RTP multicast ◄─── ka9q-radio
```

## Configuration

The `./swl` launcher saves configuration automatically:

| File | Purpose |
|------|---------|
| `.radiod-hostname` | Saved radiod status stream address |
| `.radiod-multicast` | Saved multicast address (remote radiod) |
| `cert.pem`, `key.pem` | Auto-generated SSL certificate |

To change the radiod host:
```bash
./swl --status-host new-host.local
```

For advanced configuration (rarely needed), see [CONFIGURATION.md](CONFIGURATION.md).

### Environment Variables (Optional)

| Variable | Default | Description |
|----------|---------|-------------|
| `RADIOD_HOSTNAME` | from `.radiod-hostname` | Radiod status stream address |
| `PORT` | `3100` | Web server port |
| `KA9Q_MULTICAST_INTERFACE` | auto-detected | Network interface IP for multicast |
| `RADIOD_AUDIO_MULTICAST` | auto-discovered | Multicast group for remote radiod |

### EiBi Schedule Updates

The `./swl` launcher checks the EiBi schedule on every startup. Schedules are published twice yearly:

- **A-season** (late March): Spring/Summer
- **B-season** (late October): Fall/Winter

The server also hot-swaps schedules if `new_time_schedule.txt` and `new_freq_schedule.txt` appear in the project directory (checked every 5 minutes).

## Audio Streaming

When you click "Listen Live":
1. Server creates a channel on radiod via ka9q-python (AM preset, Opus encoding)
2. A WebSocket connection streams audio from the server to your browser
3. Browser decodes Opus via WebCodecs API (or PCM fallback)

**Channel cleanup**: Channels are properly closed when you stop listening, close the tab, or shut down the server. The server sets frequency to 0 Hz on radiod, which marks the channel for removal.

## API Endpoints

### Station Data
- `GET /api/stations` - All stations with on-air status
- `GET /api/stations/active` - Currently active stations only
- `GET /api/stations/by-frequency` - Grouped by frequency
- `GET /api/stations/frequency/:freq` - Single frequency

### Audio
- `GET /api/audio/stream/:frequency` - Start stream (returns WebSocket URL)
- `DELETE /api/audio/stream/:ssrc` - Stop stream
- `POST /api/audio/stream/:ssrc/close` - Stop stream (beacon-friendly)
- `GET /api/audio/health` - Proxy health status

### Tuning
- `POST /api/audio/tune/:ssrc/frequency` - `{ frequency_hz }`
- `POST /api/audio/tune/:ssrc/agc` - `{ enable, hangtime, headroom }`
- `POST /api/audio/tune/:ssrc/gain` - `{ gain_db }`
- `POST /api/audio/tune/:ssrc/filter` - `{ low_edge, high_edge }`
- `POST /api/audio/tune/:ssrc/shift` - `{ shift_hz }`
- `POST /api/audio/tune/:ssrc/squelch` - `{ threshold }`

## File Structure

```
SWL-ka9q/
├── swl                       # Launcher (the one command you need)
├── server.js                 # Node.js backend
├── radiod_client.py          # Python bridge to radiod
├── package.json              # Node.js dependencies
├── public/
│   ├─��� index.html            # Web interface
│   ├── app.js                # Frontend JavaScript
│   └── styles.css            # Styling
├── bc-time.txt               # EiBi time-based schedules
├── bc-freq.txt               # EiBi frequency database
├── CONFIGURATION.md          # Advanced configuration
├── TROUBLESHOOTING.md        # Troubleshooting guide
├── CHANGELOG.md              # Version history
└── scripts/
    ├── diagnostic/            # Diagnostic tools
    └── archive/               # Legacy scripts (install.sh, start.sh, etc.)
```

## Troubleshooting

See [TROUBLESHOOTING.md](TROUBLESHOOTING.md) for common issues.

Quick checks:
```bash
# Is radiod reachable?
./venv/bin/python3 -c "from ka9q import RadiodControl; RadiodControl('YOUR_HOST'); print('OK')"

# Server health
curl -k https://localhost:3100/api/audio/health
```

## Credits

- **ka9q-radio** by Phil Karn (KA9Q)
- **ka9q-python** by mijahauan
- **EiBi** broadcast schedule database

## License

MIT License - See LICENSE file for details.
