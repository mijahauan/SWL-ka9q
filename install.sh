#!/bin/bash

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║        SWL-ka9q Installation and Setup Wizard              ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════╝${NC}"
echo ""

# Function to check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Function to compare versions (returns 0 if $1 >= $2)
version_ge() {
    [ "$(printf '%s\n' "$2" "$1" | sort -V | head -n1)" = "$2" ]
}

echo -e "${BLUE}[1/7] Checking system requirements...${NC}"

# Check OS
if [[ "$OSTYPE" == "linux-gnu"* ]]; then
    echo -e "  ${GREEN}✓${NC} Linux detected"
elif [[ "$OSTYPE" == "darwin"* ]]; then
    echo -e "  ${GREEN}✓${NC} macOS detected"
else
    echo -e "  ${RED}✗${NC} Unsupported OS: $OSTYPE"
    exit 1
fi

# Check Node.js
if command_exists node; then
    NODE_VERSION=$(node --version | sed 's/v//')
    if version_ge "$NODE_VERSION" "16.0.0"; then
        echo -e "  ${GREEN}✓${NC} Node.js $NODE_VERSION (>= 16.0.0)"
    else
        echo -e "  ${YELLOW}⚠${NC}  Node.js $NODE_VERSION found, but 16.0.0+ recommended"
    fi
else
    echo -e "  ${RED}✗${NC} Node.js not found"
    echo ""
    echo "Please install Node.js 16 or later:"
    echo "  Ubuntu/Debian: curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt-get install -y nodejs"
    echo "  macOS: brew install node"
    exit 1
fi

# Check npm
if ! command_exists npm; then
    echo -e "  ${RED}✗${NC} npm not found (should come with Node.js)"
    exit 1
else
    echo -e "  ${GREEN}✓${NC} npm $(npm --version)"
fi

# Check Python
if command_exists python3; then
    PYTHON_VERSION=$(python3 --version | awk '{print $2}')
    if version_ge "$PYTHON_VERSION" "3.8.0"; then
        echo -e "  ${GREEN}✓${NC} Python $PYTHON_VERSION (>= 3.8.0)"
    else
        echo -e "  ${RED}✗${NC} Python $PYTHON_VERSION found, but 3.8.0+ required"
        exit 1
    fi
else
    echo -e "  ${RED}✗${NC} Python 3 not found"
    echo ""
    echo "Please install Python 3.8 or later:"
    echo "  Ubuntu/Debian: sudo apt-get install python3 python3-pip python3-venv"
    echo "  macOS: brew install python3"
    exit 1
fi

# Check for venv module
if ! python3 -m venv --help >/dev/null 2>&1; then
    echo -e "  ${RED}✗${NC} Python venv module not found"
    echo "  Install: sudo apt-get install python3-venv"
    exit 1
else
    echo -e "  ${GREEN}✓${NC} Python venv module"
fi

echo ""
echo -e "${BLUE}[2/7] Installing Node.js dependencies...${NC}"

if [ ! -d "node_modules" ]; then
    npm install
    echo -e "  ${GREEN}✓${NC} Node.js packages installed"
else
    echo -e "  ${GREEN}✓${NC} Node.js packages already installed (run 'npm install' to update)"
fi

echo ""
echo -e "${BLUE}[3/7] Setting up Python virtual environment...${NC}"

# Remove old venv if it exists and is broken
if [ -d "venv" ]; then
    if ! venv/bin/python3 --version >/dev/null 2>&1; then
        echo -e "  ${YELLOW}⚠${NC}  Existing venv is broken, removing..."
        rm -rf venv
    else
        echo -e "  ${YELLOW}⚠${NC}  Virtual environment already exists"
        read -p "  Recreate it? (y/N): " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            rm -rf venv
        fi
    fi
fi

if [ ! -d "venv" ]; then
    python3 -m venv venv
    echo -e "  ${GREEN}✓${NC} Virtual environment created"
else
    echo -e "  ${GREEN}✓${NC} Using existing virtual environment"
fi

echo ""
echo -e "${BLUE}[4/7] Installing Python dependencies...${NC}"

# Activate venv and install packages
source venv/bin/activate

# Upgrade pip
pip install --upgrade pip >/dev/null 2>&1

# Install ka9q-python
if pip show ka9q-python >/dev/null 2>&1; then
    INSTALLED_VERSION=$(pip show ka9q-python | grep Version | awk '{print $2}')
    echo -e "  ${GREEN}✓${NC} ka9q-python $INSTALLED_VERSION already installed"
    read -p "  Upgrade to latest version? (y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        pip install --upgrade ka9q-python
        NEW_VERSION=$(pip show ka9q-python | grep Version | awk '{print $2}')
        echo -e "  ${GREEN}✓${NC} Upgraded to ka9q-python $NEW_VERSION"
    fi
else
    echo "  Installing ka9q-python..."
    pip install ka9q-python
    INSTALLED_VERSION=$(pip show ka9q-python | grep Version | awk '{print $2}')
    echo -e "  ${GREEN}✓${NC} ka9q-python $INSTALLED_VERSION installed"
fi

deactivate

echo ""
echo -e "${BLUE}[5/7] Checking network configuration...${NC}"

# Detect network interfaces
echo "  Detecting network interfaces..."
INTERFACES=$(ip -o link show | awk -F': ' '{print $2}' | grep -v "lo")
echo "  Available interfaces:"
for iface in $INTERFACES; do
    IP=$(ip -4 addr show "$iface" 2>/dev/null | grep -oP '(?<=inet\s)\d+(\.\d+){3}' | head -1)
    if [ ! -z "$IP" ]; then
        echo -e "    - ${GREEN}$iface${NC}: $IP"
    fi
done

echo ""
echo -e "${BLUE}[6/7] Configuring radiod connection...${NC}"

if [ -f ".radiod-hostname" ]; then
    SAVED_HOST=$(cat .radiod-hostname)
    echo -e "  Found saved radiod hostname: ${GREEN}$SAVED_HOST${NC}"
    read -p "  Use this hostname? (Y/n): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Nn]$ ]]; then
        RADIOD_HOST="$SAVED_HOST"
    fi
fi

if [ -z "$RADIOD_HOST" ]; then
    echo ""
    echo "  Where is your radiod server running?"
    echo "    1) localhost (same machine)"
    echo "    2) Remote machine (hostname or IP)"
    echo ""
    read -p "  Select option [1-2]: " -n 1 -r OPTION
    echo ""
    
    if [[ $OPTION == "1" ]]; then
        RADIOD_HOST="localhost"
    else
        read -p "  Enter radiod hostname or IP: " RADIOD_HOST
    fi
    
    echo "$RADIOD_HOST" > .radiod-hostname
fi

# Test connectivity
echo ""
echo "  Testing connection to radiod at $RADIOD_HOST..."
source venv/bin/activate
if python3 -c "from ka9q import RadiodControl; RadiodControl('${RADIOD_HOST}')" 2>/dev/null; then
    echo -e "  ${GREEN}✓${NC} Successfully connected to radiod"
else
    echo -e "  ${YELLOW}⚠${NC}  Could not connect to radiod (will try at runtime)"
fi
deactivate

# Check if remote and warn about multicast
if [ "$RADIOD_HOST" != "localhost" ] && [ "$RADIOD_HOST" != "127.0.0.1" ]; then
    echo ""
    echo -e "${YELLOW}╔════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${YELLOW}║           IMPORTANT: Remote radiod Setup                   ║${NC}"
    echo -e "${YELLOW}╚════════════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo "Your radiod is on a different machine. For best performance:"
    echo ""
    echo "  ${GREEN}✓ RECOMMENDED${NC}: Run SWL-ka9q on the SAME side of your"
    echo "    network switch as radiod to ensure multicast works"
    echo ""
    echo "  ${YELLOW}⚠ LIMITED${NC}: If on different sides of an IGMP-aware switch,"
    echo "    audio quality may be degraded due to multicast routing"
    echo ""
    echo "Network topology:"
    echo "  • Same machine as radiod: ★★★★★ (best)"
    echo "  • Same switch as radiod:  ★★★★☆ (very good)"
    echo "  • Across IGMP switches:   ★★☆☆☆ (may have issues)"
    echo ""
    read -p "Press Enter to continue..."
fi

echo ""
echo -e "${BLUE}[7/7] Installation complete!${NC}"
echo ""
echo -e "${GREEN}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║                    Setup Complete!                         ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo "To start SWL-ka9q:"
echo ""
echo -e "  ${BLUE}./start.sh${NC}"
echo ""
echo "First-time setup will:"
echo "  • Discover available multicast addresses from radiod"
echo "  • Let you select which one to use"
echo "  • Save your settings for future runs"
echo ""
echo "Access the web interface at:"
echo -e "  ${BLUE}http://localhost:3100${NC}"
echo ""
echo "For detailed configuration, see:"
echo "  • README.md - Overview and features"
echo "  • CONFIGURATION.md - Detailed setup guide"
echo "  • TROUBLESHOOTING.md - Common issues"
echo ""
