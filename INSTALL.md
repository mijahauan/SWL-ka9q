# Installation Guide

Quick and easy setup for SWL-ka9q.

## One-Command Setup

```bash
git clone https://github.com/mijahauan/SWL-ka9q.git
cd SWL-ka9q
npm run setup && npm start
```

That's it! The setup script will guide you through configuration.

---

## Step-by-Step Setup

### 1. Prerequisites

**Required:**
- **Node.js** >= 16.0.0 ([Download](https://nodejs.org/))
- **Python 3** (usually pre-installed on Linux/macOS)
- **Git** (for cloning and installing dependencies)

**For Python virtual environment (Debian/Ubuntu users):**
```bash
sudo apt install python3-venv
# OR
sudo apt install python3-full
```

**For Git (if not installed):**
```bash
# Ubuntu/Debian
sudo apt install git

# macOS
brew install git
```

### 2. Clone Repository

```bash
git clone https://github.com/mijahauan/SWL-ka9q.git
cd SWL-ka9q
```

### 3. Run Setup

```bash
npm run setup
```

This single command will:
- Create a Python virtual environment
- Install ka9q-python package from GitHub
- Install Node.js dependencies

**If you get an error about `python3-venv`**, run:
```bash
sudo apt install python3-venv
npm run setup
```

### 4. Start the Server

```bash
npm start
```

On first run, you'll be prompted for your radiod hostname:
- If radiod is on the same machine: use `localhost`
- If radiod is on another machine: use the hostname or IP (e.g., `bee1-hf-status.local` or `192.168.1.100`)

### 5. Open in Browser

Navigate to: **http://localhost:3100**

---

## Troubleshooting Common Setup Issues

### Error: "externally-managed-environment"

**Problem:** Python 3.11+ on Debian/Ubuntu prevents system-wide package installation.

**Solution:**
```bash
sudo apt install python3-venv
npm run setup
```

### Error: "python3: command not found"

**Problem:** Python 3 is not installed.

**Solution:**
```bash
# Ubuntu/Debian
sudo apt install python3

# macOS
brew install python3
```

### Error: "git: command not found"

**Problem:** Git is not installed (needed for installing ka9q-python).

**Solution:**
```bash
# Ubuntu/Debian
sudo apt install git

# macOS
brew install git
```

### Error: "Failed to install ka9q-python"

**Possible causes:**
1. No internet connection
2. Git not installed
3. GitHub unavailable

**Solution:**
1. Check internet connection
2. Install git: `sudo apt install git`
3. Try again later if GitHub is down

### Error: "node: command not found"

**Problem:** Node.js is not installed.

**Solution:** Install Node.js from [nodejs.org](https://nodejs.org/) or:
```bash
# Ubuntu/Debian
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install nodejs

# macOS
brew install node
```

---

## Manual Setup (Alternative)

If `npm run setup` doesn't work, you can run steps manually:

```bash
# 1. Set up Python environment
./setup-venv.sh

# 2. Install Node.js dependencies
npm install

# 3. Start server
npm start
```

---

## Next Steps

Once installed and running:

1. **Browse Stations**: The interface shows all broadcast schedules
2. **Filter Active**: Click "Show Active Only" to see what's on air now
3. **Listen**: Click the play button (▶️) next to any active station
4. **Tune**: Use the tuning controls to adjust audio quality

For detailed usage instructions, see [README.md](README.md)

---

## Configuration

### Radiod Hostname

The server automatically prompts for radiod hostname on first run and saves it to `.radiod-hostname`.

To change it later:
```bash
rm .radiod-hostname
npm start
```

Or set via environment variable:
```bash
export RADIOD_HOSTNAME=192.168.1.100
npm start
```

### Schedule Updates

To update broadcast schedules (published twice yearly by EiBi):
```bash
./update-schedule.sh
```

See [SCHEDULE_UPDATE.md](SCHEDULE_UPDATE.md) for details.

---

## Getting Help

- **Documentation**: See [README.md](README.md)
- **Configuration**: See [CONFIGURATION.md](CONFIGURATION.md)
- **Troubleshooting**: See [TROUBLESHOOTING.md](TROUBLESHOOTING.md)
- **Quick Start**: See [QUICKSTART.md](QUICKSTART.md)
