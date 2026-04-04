# Troubleshooting

## Quick Diagnostic

```bash
# 1. Server running?
./swl status

# 2. ka9q-python installed?
./venv/bin/python3 -c "from ka9q import RadiodControl; print('OK')"

# 3. Can reach radiod?
./venv/bin/python3 -c "from ka9q import RadiodControl; RadiodControl('YOUR_HOST'); print('OK')"

# 4. Server health
curl -k https://localhost:3100/api/audio/health
```

## No Stations Showing as "On Air"

- Verify UTC time: `date -u`
- Compare with schedule times in `bc-time.txt`
- Check that schedule files exist and have valid EiBi format:
  ```bash
  head -5 bc-time.txt | grep "Time(UTC)"
  ```

## Audio Streaming Fails

### "Failed to start audio stream"

1. **Is radiod running?**
   ```bash
   ps aux | grep radiod
   ```

2. **Check radiod hostname matches your config:**
   ```bash
   cat .radiod-hostname
   # Compare with: grep "^status" /etc/radio/radiod.conf  (on radiod machine)
   ```

3. **Test Python connection:**
   ```bash
   ./venv/bin/python3 -c "
   from ka9q import RadiodControl
   RadiodControl('$(cat .radiod-hostname)')
   print('Connected')
   "
   ```

4. **Check server logs:**
   ```bash
   tail -50 swl.log
   ```

### Audio Works Locally but Not Remotely

- **Check TTL**: radiod must have TTL >= 1 for multicast to leave the interface
- **Firewall**: Ensure UDP port 5004 is open on the radiod machine
- **Multicast routing**: See [CONFIGURATION.md](CONFIGURATION.md) network topology section

### Audio is Garbled or Silent

- **Wrong radiod instance**: If you see `SNR: -NaN` in logs, you may be connected to a status-only radiod node instead of one with SDR hardware
- **No signal**: Verify the broadcast is actually on-air at that frequency
- **Packet loss**: Check multicast reception:
  ```bash
  # Should see ~50 packets/sec, not ~2
  # Check server logs for RTP packet counts
  ```

### "Cannot discover multicast address" (Remote radiod)

The launcher auto-discovers multicast on first run. If it fails:

```bash
# Find the address on the radiod machine:
control bee1-hf-status.local
# Look for address:port (e.g., 239.103.26.231:5004)

# Set it manually:
export RADIOD_AUDIO_MULTICAST=239.103.26.231
./swl
```

Common radiod multicast addresses:
- `239.113.49.249` (USB/AM channels)
- `239.160.155.125` (USB/AM channels, receiver 2)
- `239.103.26.231` (IQ channels)

## Installation Issues

### "python3-venv not found" (Debian/Ubuntu)

```bash
sudo apt install python3-venv
./swl   # Will auto-create venv on next run
```

### "node: command not found"

Install Node.js >= 16:
```bash
# Ubuntu/Debian
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install nodejs

# macOS
brew install node
```

### Dependencies won't install

Delete and let `./swl` rebuild:
```bash
rm -rf node_modules venv
./swl
```

## Browser Issues

### SSL Certificate Warning

Expected on first visit. The server uses a self-signed certificate for HTTPS (required for WebCodecs Opus decoding). Accept the warning to proceed.

### No Audio (Browser Console Errors)

- **AudioContext suspended**: Click somewhere on the page first (browsers require user interaction)
- **WebCodecs not available**: Ensure you're on HTTPS (not HTTP). The server auto-provisions HTTPS.

## Server Won't Start

```bash
# Check if port is already in use
lsof -i :3100

# Check logs
tail -20 swl.log

# Force stop and restart
./swl stop
./swl
```

## Getting Help

- Check [ka9q-radio docs](https://github.com/ka9q/ka9q-radio)
- Check [ka9q-python docs](https://github.com/mijahauan/ka9q-python)
- Open an issue on [GitHub](https://github.com/mijahauan/SWL-ka9q/issues)
