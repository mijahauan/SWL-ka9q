# Troubleshooting Audio Streaming

## Error: "Failed to start audio stream"

This error occurs when the Python ka9q integration cannot create an audio channel. Follow these steps to diagnose:

### Step 1: Check System Health

Visit the health endpoint:
```bash
curl http://localhost:3100/api/audio/health
```

Look for the `python.status` field:
- **"ok"** - Python and ka9q package are working
- **"error"** - There's a problem (check `python.error` for details)

### Step 2: Verify ka9q-python Installation

```bash
# Test if ka9q package is installed
python3 -c "from ka9q import RadiodControl; print('✅ ka9q-python OK')"
```

**If you get an error:**
```bash
# Install ka9q-python from GitHub repository
pip3 install git+https://github.com/mijahauan/ka9q-python.git

# Or with user install (if you don't have system pip permissions)
pip3 install --user git+https://github.com/mijahauan/ka9q-python.git
```

### Step 3: Check ka9q-radio (radiod) Status

```bash
# Is radiod running?
ps aux | grep radiod

# Expected output: Should see radiod process
```

**If radiod is not running:**
- Start ka9q-radio according to its documentation
- Ensure it's configured for your SDR hardware
- Verify it's listening on the network

### Step 4: Test Python Connection to Radiod

```bash
python3 << 'EOF'
from ka9q import RadiodControl
try:
    control = RadiodControl('bee1-hf-status.local')
    print("✅ Connected to radiod")
except Exception as e:
    print(f"❌ Failed to connect: {e}")
EOF
```

**If connection fails:**

1. **Check hostname** - Default is `bee1-hf-status.local`
   ```bash
   # Try pinging
   ping bee1-hf-status.local
   
   # Or use IP address
   ping 192.168.1.100  # Replace with your radiod IP
   ```

2. **Configure correct hostname:**
   ```bash
   # Set via environment variable
   export RADIOD_HOSTNAME=192.168.1.100  # or your hostname
   npm start
   ```

3. **Check firewall/network:**
   ```bash
   # Verify UDP ports are accessible
   sudo netstat -ulnp | grep -E '5004|5006'
   ```

### Step 5: Test Channel Creation

```bash
python3 << 'EOF'
from ka9q import RadiodControl

control = RadiodControl('bee1-hf-status.local')
try:
    control.create_and_configure_channel(
        ssrc=9700000,
        frequency_hz=9700000,
        preset='am',
        sample_rate=12000,
        agc_enable=1,
        gain=50.0
    )
    print("✅ Channel created successfully")
except Exception as e:
    print(f"❌ Failed to create channel: {e}")
EOF
```

### Step 6: Check Server Logs

Look at the Node.js server console output when you try to play audio:

```
🎵 Starting audio stream for 9700 kHz (SSRC: 9700000)
📡 Using radiod hostname: bee1-hf-status.local
```

**Look for Python errors:**
- `ModuleNotFoundError: No module named 'ka9q'` → Install ka9q-python
- `socket.gaierror` or `ConnectionRefusedError` → Check hostname/network
- `Timeout` → radiod not responding, check if it's running

## Common Issues and Solutions

### Issue: "ka9q package not installed"

**Solution:**
```bash
pip3 install git+https://github.com/mijahauan/ka9q-python.git
# or (if you don't have system pip permissions)
pip3 install --user git+https://github.com/mijahauan/ka9q-python.git
```

### Issue: "Connection refused" or "Name or service not known"

**Solution:** Wrong hostname or radiod not accessible

1. **Find your radiod hostname/IP:**
   ```bash
   # If on same machine
   hostname -I
   
   # If remote, check your network config
   ```

2. **Set the hostname:**
   ```bash
   # Temporary
   export RADIOD_HOSTNAME=192.168.1.100
   npm start
   
   # Or edit server.js line 29
   const RADIOD_HOSTNAME = '192.168.1.100';
   ```

### Issue: "Channel not found after creation"

**Solution:** radiod may not have created the channel

- Check radiod has capacity for more channels
- Verify SDR is working and receiving
- Check radiod logs for errors

### Issue: Audio plays but is garbled/silent

**Possible causes:**
1. **SDR not tuned correctly** - Check radiod configuration
2. **No signal at frequency** - Verify broadcast is actually on-air
3. **Sample rate mismatch** - Default is 12000 Hz
4. **Network packet loss** - Check multicast routing

## Testing Without ka9q-radio

If you don't have ka9q-radio set up yet, you can still test the interface:

1. **View all stations** - Works without ka9q-radio
2. **See on-air status** - Works based on schedule files
3. **Search and filter** - Works without ka9q-radio
4. **Audio playback** - Requires ka9q-radio running

The interface will show which stations should be on-air, but audio won't work until ka9q-radio is accessible.

## Get More Help

### Check Server Health
```bash
curl http://localhost:3100/api/audio/health | jq
```

### Enable Debug Logging

In `server.js`, the Python script errors are logged to console. Check:
```bash
npm start
# Then try to play audio and watch the console
```

### Verify Complete Setup

```bash
# 1. Node.js server running
curl http://localhost:3100/api/stations

# 2. Python ka9q accessible
python3 -c "from ka9q import RadiodControl; print('OK')"

# 3. radiod running
ps aux | grep radiod

# 4. Network connectivity
ping bee1-hf-status.local  # or your radiod hostname
```

## Still Having Issues?

1. Check [ka9q-radio documentation](https://github.com/ka9q/ka9q-radio)
2. Check [ka9q-python documentation](https://github.com/mijahauan/ka9q-python)
3. Verify your SDR hardware is working with ka9q-radio directly
4. Test radiod connectivity with the `control` utility (if installed)

## Quick Diagnostic Script

Save this as `diagnose.sh` and run it:

```bash
#!/bin/bash

echo "=== Broadcast Station Monitor Diagnostics ==="
echo ""

echo "1. Node.js version:"
node --version

echo ""
echo "2. Python version:"
python3 --version

echo ""
echo "3. ka9q-python package:"
python3 -c "from ka9q import RadiodControl; print('✅ Installed')" 2>&1

echo ""
echo "4. radiod process:"
ps aux | grep -E '[r]adiod|[r]x888d' || echo "❌ Not running"

echo ""
echo "5. API Health:"
curl -s http://localhost:3100/api/audio/health | jq '.' 2>/dev/null || echo "❌ Server not responding"

echo ""
echo "6. Network connectivity to radiod:"
ping -c 1 bee1-hf-status.local 2>&1 | head -n 1

echo ""
echo "=== End Diagnostics ==="
```

Run with: `bash diagnose.sh`
