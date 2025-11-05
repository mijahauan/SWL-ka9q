# Configuration Guide

## Prerequisites

Before configuring, make sure you've installed the dependencies:

```bash
# 1. Install ka9q-python (custom package from GitHub)
./setup-venv.sh

# 2. Install Node.js dependencies
npm install
```

The `setup-venv.sh` script creates a Python virtual environment and installs the **ka9q-python** package from GitHub (not available on PyPI).

## Zero Configuration for Local Setup!

**If radiod is running on the same machine as SWL-ka9q** (the most common setup), no configuration is needed! The default is `localhost`.

Just run:
```bash
npm start
```

## Remote Radiod Configuration

**Only configure this if radiod is on a different machine:**

The `RADIOD_HOSTNAME` tells SWL-ka9q where to find your ka9q-radio server.

#### Option 1: Environment Variable (Recommended)

```bash
export RADIOD_HOSTNAME=your-radiod-hostname
npm start
```

**Examples:**
```bash
# If radiod is on another machine by IP (most reliable):
export RADIOD_HOSTNAME=192.168.1.100
npm start

# If radiod is on another machine by hostname:
export RADIOD_HOSTNAME=radiod-server.local
npm start
```

To make it permanent, add to `~/.bashrc` or `~/.zshrc`:
```bash
echo 'export RADIOD_HOSTNAME=192.168.1.100' >> ~/.bashrc
```

#### Option 2: Edit server.js

Edit line 34 in `server.js` to change the default:

```javascript
// Default is localhost (same machine):
const RADIOD_HOSTNAME = process.env.RADIOD_HOSTNAME || 'localhost';

// Change to IP address for remote radiod:
const RADIOD_HOSTNAME = process.env.RADIOD_HOSTNAME || '192.168.1.100';
```

## Finding Your Remote Radiod Address

### Method 1: Use IP Address (Most Reliable)

Find the IP address of the machine running radiod:

```bash
# On the radiod machine:
hostname -I
# or
ip addr show
```

Use that IP address in your configuration.

### Method 2: Use Hostname (Requires mDNS)

If both machines support mDNS/Avahi, you can use `.local` hostnames. Check `/etc/radio/radiod.conf` on the radiod machine:

```ini
[global]
status = bee1-hf-status.local    # Use this hostname
```

**Note:** This requires Avahi (Linux) or Bonjour (macOS). If `.local` names don't resolve, use the IP address instead.

## Testing Your Configuration

After setting `RADIOD_HOSTNAME`, test the connection:

```bash
# Test with Python ka9q package
python3 -c "from ka9q import RadiodControl; c = RadiodControl('$RADIOD_HOSTNAME'); print('✅ Connected to radiod')"
```

If this works, SWL-ka9q will work.

## Common Scenarios

### Scenario 1: Radiod and SWL-ka9q on Same Machine (Default)
**No configuration needed!** Just run:
```bash
npm start
```
The default `localhost` will connect to radiod on the same machine.

### Scenario 2: Radiod on Remote Machine (Use IP)
```bash
export RADIOD_HOSTNAME=192.168.1.100
npm start
```

### Scenario 3: Radiod on Remote Machine (Use .local hostname)
```bash
export RADIOD_HOSTNAME=radiod-server.local
npm start
```
**Note:** Only works if mDNS is available on both machines. Use IP address if unsure.

## No Other Configuration Needed!

Once `RADIOD_HOSTNAME` is set correctly, SWL-ka9q will:
- ✅ Connect to radiod automatically
- ✅ Create and manage audio channels
- ✅ Stream audio via WebSocket
- ✅ Handle multicast groups automatically
- ✅ Parse status packets from radiod

The default settings for ports and multicast addresses work with standard ka9q-radio installations.

## Advanced Configuration (Optional)

If you need to customize other settings, edit `server.js`:

```javascript
const PORT = 3100;                              // Web server port
const KA9Q_STATUS_MULTICAST = '239.192.152.141'; // radiod status multicast
const KA9Q_STATUS_PORT = 5006;                   // radiod status port
const KA9Q_AUDIO_PORT = 5004;                    // RTP audio port
```

These rarely need to be changed unless you have a custom radiod configuration.

## Troubleshooting

### "ModuleNotFoundError: No module named 'ka9q'"

The ka9q-python package is not installed. Run:
```bash
./setup-venv.sh
```

This installs the custom **ka9q-python** package from GitHub (it's not available on PyPI).

### Verify ka9q-python Installation

Check if the package is installed correctly:
```bash
# Using the venv Python:
./venv/bin/python3 -c "from ka9q import RadiodControl; print('✅ ka9q-python installed')"

# Or activate venv first:
source venv/bin/activate
python3 -c "from ka9q import RadiodControl; print('✅ ka9q-python installed')"
```

### Manual ka9q-python Installation

If `setup-venv.sh` fails, install manually:
```bash
# Create virtual environment
python3 -m venv venv
source venv/bin/activate

# Install ka9q-python from GitHub
pip3 install git+https://github.com/mijahauan/ka9q-python.git

# Verify
python3 -c "from ka9q import RadiodControl; print('✅ Installed')"
```
