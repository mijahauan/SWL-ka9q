# Quick Start Guide

Get your Broadcast Station Monitor up and running in 5 minutes!

## Prerequisites Check

```bash
# Check Node.js (need >= 16.0.0)
node --version

# Check Python 3
python3 --version

# Verify ka9q-radio is running (optional but needed for audio)
ps aux | grep radiod
```

## Installation

```bash
# 1. Set up Python virtual environment and install ka9q-python
./setup-venv.sh

# 2. Install Node.js dependencies
pnpm install
# or: npm install
```

## Start the Server

The server will prompt you for the radiod hostname on first run:

```bash
npm start
```

**You'll be asked to enter the radiod status stream hostname:**
- For local radiod: `localhost` (default)
- For remote radiod by hostname: `bee1-hf-status.local`
- For remote radiod by IP: `192.168.1.100`

Your choice is saved to `.radiod-hostname` and used for future runs.

### Alternative: Manual Configuration

If you prefer to set the hostname via environment variable:

```bash
# Set environment variable to remote radiod:
export RADIOD_HOSTNAME=bee1-hf-status.local
npm run start-direct

# Or add to ~/.bashrc for permanent:
echo 'export RADIOD_HOSTNAME=bee1-hf-status.local' >> ~/.bashrc
```

**Note:** If `bc-time.txt` is missing, the server will automatically download the latest EiBi broadcast schedule on first run.

Open your browser to: **http://localhost:3100**

## What You'll See

### Interface Overview

- **All stations displayed** - Full broadcast schedule visible at all times
- **Green highlighted cards** - Stations currently broadcasting (based on UTC schedule)
- **Faded cards** - Stations off-air (can't play audio yet)
- **▶️ Listen Live button** - Only enabled for stations currently on-air

### Navigation

1. **UTC Time** (top right) - Current time used for schedule matching
2. **On Air counter** - Number of stations currently broadcasting
3. **Search bar** - Filter by station name, frequency, language, or target
4. **Band filters** - Quick access to common shortwave bands
5. **Station cards** - Each shows full broadcast details

### Using Audio

**To listen to a station:**
1. Find a station with 🔴 ON AIR badge (green highlight)
2. Click **▶️ Listen Live**
3. Audio starts streaming via WebSocket
4. Click **⏹️ Stop Listening** to end

**Multiple stations:**
- You can listen to multiple stations simultaneously
- Bottom status bar shows active audio count

## Customization

### Change Server Port

Edit `server.js` line 25:
```javascript
const PORT = process.env.PORT || 3100;  // Change default port if needed
```

Or use an environment variable:
```bash
export PORT=8080
pnpm start
```

### Add/Edit Station Schedules

**bc-time.txt** - Add broadcast schedules (EiBi format):
```
0000 0100 CUB RHC E NAm 6000
```

**bc-freq.txt** - Add station details (pipe-delimited):
```
6000 | Radio Havana Cuba | 100 | Bauta | NAm | Spanish/English
```

Then reload: Click **🔄 Reload Schedules** button

## Troubleshooting

### No stations showing as "On Air"

**Check UTC time:**
```bash
date -u
```
Compare with schedule times in `bc-time.txt`

### Can't play audio

**First, verify you configured the radiod hostname correctly (see Configuration section above)**

1. **Is radiod running?**
   ```bash
   ps aux | grep radiod
   ```

2. **Can you reach radiod?**
   ```bash
   # Replace with YOUR radiod hostname
   python3 -c "from ka9q import RadiodControl; c = RadiodControl('your-radiod-hostname'); print('✅ Connected')"
   ```

3. **Check server logs** for connection errors
   ```bash
   # Look for errors like:
   # "socket.gaierror" or "Connection refused"
   # This means radiod hostname is wrong
   ```

4. **Check browser console** (F12) for errors

5. **Network:** Ensure UDP ports 5004 and 5006 are accessible

### Nothing loads

- Check `npm start` output for errors
- Verify `bc-time.txt` and `bc-freq.txt` exist and have valid format
- Check browser console (F12) for JavaScript errors

## Next Steps

- **Add more stations** - Edit schedule files with your favorite broadcasts
- **Customize styling** - Edit `public/styles.css` for your preferred look
- **API integration** - Use REST endpoints for external tools (see README.md)
- **Schedule updates** - Station schedules reload automatically every 5 minutes

## Common Issues

**"Failed to start audio stream"**
- ka9q-radio not running or not accessible
- Check radiod hostname in server.js
- Verify Python ka9q package installed

**"No stations found"**
- Check schedule file format (pipe-delimited)
- Verify time format (HHMM-HHMM)
- Search/band filters may be active

**Stations not highlighting correctly**
- Verify system time is accurate
- Schedule uses UTC time (not local time)
- Check "Days" field format (daily or 1,2,3...)

## Tips

💡 **Keep the interface open** - It auto-refreshes every 60 seconds to update on-air status

💡 **Band filters** - Use 49m, 41m, etc. buttons for quick navigation to popular bands

💡 **Search** - Type language (e.g., "English") to find all broadcasts in that language

💡 **Multiple streams** - Listen to several stations at once for signal comparison

---

Need more help? See full [README.md](README.md) or check [ka9q-python docs](https://github.com/mijahauan/ka9q-python)
