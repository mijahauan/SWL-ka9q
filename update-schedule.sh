#!/bin/bash

# Update EiBi Schedule Helper
# Downloads the latest EiBi broadcast schedule and prepares it for SWL-ka9q

echo "📻 EiBi Schedule Updater for SWL-ka9q"
echo ""

# EiBi publishes two schedules per year:
# - A-season (late March): sked-aXX.txt (XX = year like 25 for 2025)
# - B-season (late October): sked-bXX.txt
#
# Example URLs:
# https://www.eibispace.de/dx/sked-a25.txt (Spring 2025)
# https://www.eibispace.de/dx/sked-b25.txt (Winter 2025/2026)

# Ask user for the schedule file to download
echo "Which EiBi schedule do you want to download?"
echo ""
echo "Examples:"
echo "  sked-a25.txt  (Spring 2025)"
echo "  sked-b25.txt  (Winter 2025/2026)"
echo "  sked-a26.txt  (Spring 2026)"
echo ""
read -p "Enter filename (e.g., sked-b25.txt): " SCHEDULE_FILE

if [ -z "$SCHEDULE_FILE" ]; then
    echo "❌ No filename provided"
    exit 1
fi

# Download the schedule
URL="https://www.eibispace.de/dx/$SCHEDULE_FILE"
echo ""
echo "📥 Downloading from: $URL"

if command -v wget &> /dev/null; then
    wget -O new_schedule.txt "$URL"
elif command -v curl &> /dev/null; then
    curl -o new_schedule.txt "$URL"
else
    echo "❌ Neither wget nor curl found. Please install one of them."
    exit 1
fi

if [ $? -ne 0 ]; then
    echo "❌ Download failed. Check the filename and try again."
    echo ""
    echo "Available schedules: https://www.eibispace.de/dx/"
    exit 1
fi

# Verify the file looks like an EiBi schedule
if ! grep -q "Time(UTC)" new_schedule.txt; then
    echo "⚠️  Warning: Downloaded file doesn't look like an EiBi schedule"
    echo "    First few lines:"
    head -5 new_schedule.txt
    read -p "Continue anyway? (y/N): " CONTINUE
    if [ "$CONTINUE" != "y" ] && [ "$CONTINUE" != "Y" ]; then
        rm new_schedule.txt
        echo "❌ Aborted"
        exit 1
    fi
fi

# Count entries
ENTRY_COUNT=$(grep -E "^[0-9]{4}\s+[0-9]{4}" new_schedule.txt | wc -l)

echo ""
echo "✅ Downloaded successfully!"
echo "   File: new_schedule.txt"
echo "   Entries: ~$ENTRY_COUNT broadcasts"
echo ""
echo "📋 Next steps:"
echo "   1. The file is now saved as 'new_schedule.txt'"
echo "   2. Server will automatically detect it on next reload (within 5 minutes)"
echo "   3. Or restart the server to apply immediately: pnpm start"
echo ""
echo "   Your current bc-time.txt will be backed up automatically."
echo ""
echo "🎉 Done! The schedule will update automatically."
