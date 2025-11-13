#!/bin/bash

# Interactive startup script for SWL-ka9q
# Prompts for radiod hostname and starts the server

CONFIG_FILE=".radiod-hostname"

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${BLUE}🚀 SWL-ka9q Startup${NC}"
echo ""

# Check if Python venv exists
if [ ! -d "venv" ] || [ ! -f "venv/bin/python3" ]; then
    echo -e "${YELLOW}⚠️  Python virtual environment not found${NC}"
    echo ""
    echo "First-time setup required. Please run:"
    echo -e "  ${GREEN}npm run setup${NC}"
    echo ""
    echo "Or manually:"
    echo -e "  ${GREEN}./setup-venv.sh${NC}"
    echo -e "  ${GREEN}npm install${NC}"
    echo ""
    exit 1
fi

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo -e "${YELLOW}⚠️  Node.js dependencies not installed${NC}"
    echo ""
    echo "Please run:"
    echo -e "  ${GREEN}npm install${NC}"
    echo ""
    exit 1
fi

# Check if hostname is already configured
if [ -f "$CONFIG_FILE" ]; then
    SAVED_HOSTNAME=$(cat "$CONFIG_FILE")
    echo -e "${GREEN}Found saved radiod hostname: ${SAVED_HOSTNAME}${NC}"
    echo ""
    read -p "Use this hostname? [Y/n] " -n 1 -r
    echo ""
    
    if [[ ! $REPLY =~ ^[Nn]$ ]]; then
        RADIOD_HOSTNAME="$SAVED_HOSTNAME"
    fi
fi

# Prompt for hostname if not set
if [ -z "$RADIOD_HOSTNAME" ]; then
    echo -e "${YELLOW}Enter the radiod status stream hostname:${NC}"
    echo "Examples: bee1-hf-status.local, localhost, 192.168.1.100"
    echo ""
    read -p "Hostname: " RADIOD_HOSTNAME
    
    # Save for next time
    if [ ! -z "$RADIOD_HOSTNAME" ]; then
        echo "$RADIOD_HOSTNAME" > "$CONFIG_FILE"
        echo ""
        echo -e "${GREEN}✅ Saved hostname to $CONFIG_FILE${NC}"
    fi
fi

# Validate hostname is set
if [ -z "$RADIOD_HOSTNAME" ]; then
    echo -e "${YELLOW}⚠️  No hostname provided, using default: localhost${NC}"
    RADIOD_HOSTNAME="localhost"
fi

echo ""
echo -e "${BLUE}📻 Starting server with radiod hostname: ${RADIOD_HOSTNAME}${NC}"
echo ""

# Check for schedule updates
if [ -f "auto-update-schedule.sh" ]; then
    echo "Checking for schedule updates..."
    ./auto-update-schedule.sh --quiet
    echo ""
fi

# Test connection first (optional)
if command -v venv/bin/python3 &> /dev/null; then
    echo "Testing connection to radiod..."
    if venv/bin/python3 -c "from ka9q import RadiodControl; RadiodControl('${RADIOD_HOSTNAME}')" 2>/dev/null; then
        echo -e "${GREEN}✅ Connected to radiod${NC}"
    else
        echo -e "${YELLOW}⚠️  Could not verify radiod connection (server will try anyway)${NC}"
    fi
    echo ""
fi

# Start the server
export RADIOD_HOSTNAME
exec node server.js
