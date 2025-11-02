#!/bin/bash

echo "🐍 Setting up Python virtual environment for ka9q-python..."

# Create virtual environment
if [ ! -d "venv" ]; then
    echo "📦 Creating virtual environment..."
    python3 -m venv venv
    echo "✅ Virtual environment created"
else
    echo "✅ Virtual environment already exists"
fi

# Activate and install ka9q-python
echo "📥 Installing ka9q-python from GitHub..."
./venv/bin/pip3 install git+https://github.com/mijahauan/ka9q-python.git

# Verify installation
echo ""
echo "🔍 Verifying installation..."
./venv/bin/python3 -c "from ka9q import RadiodControl; print('✅ ka9q-python installed successfully')" && \
echo "" && \
echo "🎉 Python setup complete!" && \
echo "" && \
echo "Next steps:" && \
echo "  1. Install Node.js dependencies:" && \
echo "     pnpm install" && \
echo "     (or: npm install)" && \
echo "" && \
echo "  2. Configure radiod hostname in server.js (line 30)" && \
echo "     - Check /etc/radio/radiod.conf for the 'status' entry" && \
echo "     - Set RADIOD_HOSTNAME to match that hostname" && \
echo "" && \
echo "  3. Start the server:" && \
echo "     pnpm start" && \
echo "     (or: npm start)" || \
echo "❌ Installation verification failed"
