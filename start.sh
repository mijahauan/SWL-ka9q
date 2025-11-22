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

# Check if radiod is on a different machine (remote client mode)
if [ "$RADIOD_HOSTNAME" != "localhost" ] && [ "$RADIOD_HOSTNAME" != "127.0.0.1" ]; then
    # Check if we have a saved multicast address
    if [ -z "$RADIOD_AUDIO_MULTICAST" ] && [ -f ".radiod-multicast" ]; then
        RADIOD_AUDIO_MULTICAST=$(cat .radiod-multicast)
        echo -e "${GREEN}✅ Using saved multicast: ${RADIOD_AUDIO_MULTICAST}${NC}"
        echo ""
    fi
    
    if [ -z "$RADIOD_AUDIO_MULTICAST" ]; then
        echo -e "${YELLOW}📡 Remote radiod detected: ${RADIOD_HOSTNAME}${NC}"
        echo ""
        echo "Discovering available multicast groups from radiod..."
        
        # Discover multicast addresses using dedicated script
        DISCOVERY_OUTPUT=$(venv/bin/python3 discover_multicast.py --radiod-host "$RADIOD_HOSTNAME" --duration 2 2>/dev/null)
        
        if [ $? -eq 0 ] && [ ! -z "$DISCOVERY_OUTPUT" ]; then
            # Extract addresses from JSON output
            MULTICAST_ADDRS=$(echo "$DISCOVERY_OUTPUT" | venv/bin/python3 -c "
import sys
import json
try:
    data = json.load(sys.stdin)
    if data.get('success') and data.get('addresses'):
        for i, addr in enumerate(data['addresses'], 1):
            print(f'{i}) {addr}')
except:
    pass
" 2>/dev/null)
            
            if [ ! -z "$MULTICAST_ADDRS" ]; then
                echo ""
                echo "Discovered multicast addresses from radiod:"
                echo "$MULTICAST_ADDRS"
                echo ""
                
                # Count how many addresses we found
                ADDR_COUNT=$(echo "$MULTICAST_ADDRS" | wc -l)
                
                if [ $ADDR_COUNT -eq 1 ]; then
                    # Only one address, use it automatically
                    RADIOD_AUDIO_MULTICAST=$(echo "$MULTICAST_ADDRS" | sed 's/^[0-9]*) //')
                    echo -e "${GREEN}✅ Using discovered multicast: ${RADIOD_AUDIO_MULTICAST}${NC}"
                    
                    # Save for next time
                    echo "$RADIOD_AUDIO_MULTICAST" > .radiod-multicast
                else
                    # Multiple addresses, let user choose
                    echo "For remote radiod connections, you need to specify a fallback multicast address."
                    echo "This is required for creating new audio channels."
                    echo ""
                    read -p "Enter option [1-$ADDR_COUNT] or full address (or press Enter to use first): " MULTICAST_CHOICE
                    
                    if [ -z "$MULTICAST_CHOICE" ]; then
                        # Use first address by default
                        RADIOD_AUDIO_MULTICAST=$(echo "$MULTICAST_ADDRS" | head -n 1 | sed 's/^[0-9]*) //')
                        echo "$RADIOD_AUDIO_MULTICAST" > .radiod-multicast
                    elif [[ "$MULTICAST_CHOICE" =~ ^[0-9]+$ ]] && [ "$MULTICAST_CHOICE" -le "$ADDR_COUNT" ]; then
                        # User selected a number
                        RADIOD_AUDIO_MULTICAST=$(echo "$MULTICAST_ADDRS" | sed -n "${MULTICAST_CHOICE}p" | sed 's/^[0-9]*) //')
                        echo "$RADIOD_AUDIO_MULTICAST" > .radiod-multicast
                    else
                        # User entered a full address
                        RADIOD_AUDIO_MULTICAST="$MULTICAST_CHOICE"
                        echo "$RADIOD_AUDIO_MULTICAST" > .radiod-multicast
                    fi
                    
                    echo ""
                    echo -e "${GREEN}✅ Using fallback multicast: ${RADIOD_AUDIO_MULTICAST}${NC}"
                fi
                echo ""
            else
                echo -e "${YELLOW}⚠️  No active channels found - you'll need to specify multicast manually${NC}"
                echo "   Set RADIOD_AUDIO_MULTICAST environment variable and restart"
                echo ""
            fi
        else
            echo -e "${YELLOW}⚠️  Discovery failed - you may need to set RADIOD_AUDIO_MULTICAST manually${NC}"
            echo "   Example: export RADIOD_AUDIO_MULTICAST=239.113.49.249"
            echo ""
        fi
    else
        echo -e "${GREEN}✅ Using configured multicast: ${RADIOD_AUDIO_MULTICAST}${NC}"
        echo ""
    fi
fi

# Detect the physical network interface IP (ignore ZeroTier/VPN interfaces)
if [ -z "$KA9Q_MULTICAST_INTERFACE" ]; then
    # Get the interface that can reach radiod (but only if it's a physical interface)
    PHYSICAL_IP=$(ip addr show enp4s0f0 2>/dev/null | grep -oP 'inet \K[\d.]+' | head -1)
    if [ ! -z "$PHYSICAL_IP" ]; then
        KA9Q_MULTICAST_INTERFACE="$PHYSICAL_IP"
        echo -e "${GREEN}📡 Using physical network interface: ${PHYSICAL_IP} (enp4s0f0)${NC}"
    fi
fi

# Start the server
export RADIOD_HOSTNAME
export KA9Q_MULTICAST_INTERFACE
export RADIOD_AUDIO_MULTICAST
exec node server.js
