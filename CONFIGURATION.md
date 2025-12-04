# Configuration Guide

## Prerequisites

Before configuring, make sure you've installed the dependencies:

```bash
# 1. Install ka9q-python (official package from PyPI)
./setup-venv.sh

# 2. Install Node.js dependencies
npm install
```

The `setup-venv.sh` script creates a Python virtual environment and installs the **ka9q-python** package from PyPI (now officially published).

## Quick Start with Interactive Setup

The easiest way to configure SWL-ka9q is to use the interactive startup script:

```bash
npm start
```

**On first run**, you'll be prompted to enter the radiod hostname:
- For local radiod: enter `localhost` (or just press Enter for default)
- For remote radiod: enter the hostname or IP address (e.g., `bee1-hf-status.local` or `192.168.1.100`)

Your choice is saved to `.radiod-hostname` and used for future runs. You can change it anytime by:
- Deleting `.radiod-hostname` and running `npm start` again
- Answering 'n' when asked if you want to use the saved hostname

## Alternative Configuration Methods

If you prefer not to use the interactive prompt, you have other options:

#### Option 1: Environment Variable

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

## Remote Radiod Configuration (Automatic Discovery)

When running SWL-ka9q on a **different machine** than radiod, the startup script automatically discovers available multicast addresses from radiod. This is required for creating new audio channels.

### How It Works

1. Run `./start.sh` with a remote radiod hostname
2. The script connects to radiod and discovers active channels
3. Available multicast addresses are extracted and presented to you
4. Select one (or press Enter to use the first one)
5. The address is saved as `RADIOD_AUDIO_MULTICAST` environment variable

### Example Session

```
📡 Remote radiod detected: bee1-hf-status.local

Discovering available multicast groups from radiod...

Discovered multicast addresses from radiod:
  1) 239.103.26.231
  2) 239.113.49.249
  3) 239.160.155.125
  4) 239.179.238.97

Enter option [1-4] or full address (or press Enter to use first): 2

✅ Using fallback multicast: 239.113.49.249
```

### Manual Configuration (Optional)

If automatic discovery fails or you want to specify manually:

```bash
export RADIOD_AUDIO_MULTICAST=239.113.49.249
./start.sh
```

Or make it permanent:

```bash
echo 'export RADIOD_AUDIO_MULTICAST=239.113.49.249' >> ~/.bashrc
```

## Advanced Configuration (Optional)

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `RADIOD_HOSTNAME` | `localhost` | Radiod hostname or IP address |
| `KA9Q_MULTICAST_INTERFACE` | (auto) | Network interface IP for multicast |
| `SWL_RTP_DESTINATION` | `239.1.2.100` | RTP destination IP for all SWL channels |
| `SWL_RTP_PORT` | `5004` | RTP destination port |
| `KA9Q_INCLUDE_METRICS` | `true` | Include ka9q-python metrics in logs |

### Channel Request Paradigm (ka9q-python 2.2+)

SWL-ka9q uses a new channel request paradigm:
- **No SSRC in requests** - radiod assigns the SSRC automatically
- **Single RTP destination** - all SWL channels stream to `SWL_RTP_DESTINATION`
- **Search by frequency** - existing channels are found by frequency, not SSRC
- **Default preset: `am`** - optimized for shortwave broadcast listening
- **Default sample rate: `12000`** - sufficient for AM broadcast audio

This simplifies channel management and allows radiod to optimize SSRC allocation.

### Customizing server.js

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

This installs the **ka9q-python** package from PyPI (official release).

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

# Install ka9q-python from PyPI
pip3 install "ka9q>=2.2,<3"

# Verify
python3 -c "from ka9q import RadiodControl; print('✅ Installed')"
```
