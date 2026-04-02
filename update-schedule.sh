#!/bin/bash

# Update EiBi Schedule Helper
# Downloads the latest EiBi broadcast schedule and prepares it for SWL-ka9q

echo "📻 EiBi Schedule Updater for SWL-ka9q"
echo ""

# Ask user for the season identifier
echo "Which EiBi season schedule do you want to download?"
echo ""
echo "Examples:"
echo "  a25  (Spring 2025)"
echo "  b25  (Winter 2025/2026)"
echo "  a26  (Spring 2026)"
echo ""
read -p "Enter season identifier (e.g., a26): " SEASON_ID

if [ -z "$SEASON_ID" ]; then
    echo "❌ No season identifier provided"
    exit 1
fi

# Download the schedules
URL_TIME="http://eibispace.de/dx/bc-${SEASON_ID}.txt"
URL_FREQ="http://eibispace.de/dx/freq-${SEASON_ID}.txt"

echo ""
echo "📥 Downloading Time Schedule from: $URL_TIME"

if command -v wget &> /dev/null; then
    wget -q --no-check-certificate -O new_time_schedule.txt "$URL_TIME"
elif command -v curl &> /dev/null; then
    curl -s -k -o new_time_schedule.txt "$URL_TIME"
else
    echo "❌ Neither wget nor curl found. Please install one of them."
    exit 1
fi

if [ $? -ne 0 ] || [ ! -s new_time_schedule.txt ]; then
    echo "❌ Download failed for Time Schedule. Check the season identifier and try again."
    rm -f new_time_schedule.txt
    exit 1
fi

echo "📥 Downloading Frequency Schedule from: $URL_FREQ"

if command -v wget &> /dev/null; then
    wget -q --no-check-certificate -O new_freq_schedule.txt "$URL_FREQ"
elif command -v curl &> /dev/null; then
    curl -s -k -o new_freq_schedule.txt "$URL_FREQ"
fi

if [ $? -ne 0 ] || [ ! -s new_freq_schedule.txt ]; then
    echo "❌ Download failed for Frequency Schedule."
    rm -f new_time_schedule.txt new_freq_schedule.txt
    exit 1
fi

# Validate schedules
if ! grep -q "Time(UTC)" new_time_schedule.txt; then
    echo "⚠️  Warning: Downloaded Time file doesn't look like an EiBi schedule"
    rm -f new_time_schedule.txt new_freq_schedule.txt
    exit 1
fi

ENTRY_COUNT=$(grep -a -E "^[0-9]{4}\s+[0-9]{4}" new_time_schedule.txt | wc -l)

echo ""
echo "✅ Downloaded successfully!"
echo "   Entries: ~$ENTRY_COUNT broadcasts"
echo ""
echo "📋 Next steps:"
echo "   1. Server will automatically detect it on next reload (within 5 minutes)"
echo "   2. Or restart the server to apply immediately"
echo ""
echo "   Your current schedules will be backed up automatically."
echo ""
echo "🎉 Done! The schedule will update automatically."
