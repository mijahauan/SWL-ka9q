#!/bin/bash

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🐍 Setting up Python virtual environment for ka9q-python...${NC}"
echo ""

# Check if Python 3 is installed
if ! command -v python3 &> /dev/null; then
    echo -e "${RED}❌ Error: python3 is not installed${NC}"
    echo ""
    echo "Please install Python 3:"
    echo "  Ubuntu/Debian: sudo apt install python3"
    echo "  macOS:         brew install python3"
    exit 1
fi

PYTHON_VERSION=$(python3 --version 2>&1 | awk '{print $2}')
echo -e "${GREEN}✓ Found Python ${PYTHON_VERSION}${NC}"

# Create virtual environment
if [ ! -d "venv" ]; then
    echo -e "${BLUE}📦 Creating virtual environment...${NC}"
    
    if ! python3 -m venv venv 2>/dev/null; then
        echo -e "${RED}❌ Failed to create virtual environment${NC}"
        echo ""
        echo -e "${YELLOW}This is likely due to missing python3-venv package.${NC}"
        echo ""
        echo "To fix this, run ONE of the following commands:"
        echo ""
        echo -e "  ${GREEN}Ubuntu/Debian (recommended):${NC}"
        echo "    sudo apt install python3-venv"
        echo ""
        echo -e "  ${GREEN}Ubuntu/Debian (alternative):${NC}"
        echo "    sudo apt install python3-full"
        echo ""
        echo "Then run this script again: ./setup-venv.sh"
        exit 1
    fi
    
    echo -e "${GREEN}✅ Virtual environment created${NC}"
else
    echo -e "${GREEN}✅ Virtual environment already exists${NC}"
fi

# Upgrade pip first (suppresses warnings)
echo ""
echo -e "${BLUE}📦 Upgrading pip...${NC}"
./venv/bin/pip3 install --upgrade pip --quiet

# Install ka9q-python
echo ""
echo -e "${BLUE}📥 Installing ka9q-python from GitHub...${NC}"
if ! ./venv/bin/pip3 install git+https://github.com/mijahauan/ka9q-python.git; then
    echo -e "${RED}❌ Failed to install ka9q-python${NC}"
    echo ""
    echo "Common issues:"
    echo "  - No internet connection"
    echo "  - Git not installed (run: sudo apt install git)"
    echo "  - GitHub unavailable"
    exit 1
fi

# Verify installation
echo ""
echo -e "${BLUE}🔍 Verifying installation...${NC}"
if ./venv/bin/python3 -c "from ka9q import RadiodControl; print('✅ ka9q-python installed successfully')" 2>/dev/null; then
    echo ""
    echo -e "${GREEN}🎉 Python setup complete!${NC}"
    echo ""
    echo -e "${BLUE}Next steps:${NC}"
    echo ""
    echo "  1. Install Node.js dependencies:"
    echo -e "     ${GREEN}npm install${NC}"
    echo ""
    echo "  2. Start the server (handles radiod configuration automatically):"
    echo -e "     ${GREEN}npm start${NC}"
    echo ""
    echo "  Or run everything at once:"
    echo -e "     ${GREEN}npm run setup && npm start${NC}"
    echo ""
else
    echo -e "${RED}❌ Installation verification failed${NC}"
    echo ""
    echo "The package was installed but cannot be imported."
    echo "Please check for errors above."
    exit 1
fi
