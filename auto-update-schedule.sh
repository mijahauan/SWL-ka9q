#!/bin/bash

# Auto-Update EiBi Schedule
# Automatically checks for and downloads the latest EiBi broadcast schedule
# Can be run on startup or via cron

# Determine current season automatically
get_current_season() {
    local YEAR=$(date +%y)
    local MONTH=$(date +%m)
    
    # A-season: March-September (Spring/Summer)
    # B-season: October-February (Fall/Winter)
    if [ "$MONTH" -ge 3 ] && [ "$MONTH" -lt 10 ]; then
        echo "sked-a${YEAR}.txt"
    else
        # B-season continues into next year
        if [ "$MONTH" -ge 10 ]; then
            echo "sked-b${YEAR}.txt"
        else
            # January-February use previous year's B schedule
            YEAR=$((YEAR - 1))
            echo "sked-b${YEAR}.txt"
        fi
    fi
}

# Check if we need to update
need_update() {
    local CURRENT_SEASON=$(get_current_season)
    local SCHEDULE_FILE="bc-time.txt"
    
    # If schedule file doesn't exist, we need to download
    if [ ! -f "$SCHEDULE_FILE" ]; then
        echo "true"
        return
    fi
    
    # Check if existing schedule has a season marker
    if grep -q "# Season: $CURRENT_SEASON" "$SCHEDULE_FILE" 2>/dev/null; then
        echo "false"  # Already have current season
        return
    fi
    
    # Check file age - update if older than 14 days
    local FILE_AGE=$(($(date +%s) - $(stat -c %Y "$SCHEDULE_FILE" 2>/dev/null || echo 0)))
    local DAYS_OLD=$((FILE_AGE / 86400))
    
    if [ $DAYS_OLD -gt 14 ]; then
        echo "true"
    else
        echo "false"
    fi
}

# Download the latest schedule
download_schedule() {
    local SCHEDULE_FILE=$(get_current_season)
    local URL="https://www.eibispace.de/dx/$SCHEDULE_FILE"
    local TEMP_FILE="new_schedule.txt.tmp"
    
    echo "📥 Downloading latest EiBi schedule: $SCHEDULE_FILE"
    echo "   From: $URL"
    
    # Download to temp file
    if command -v wget &> /dev/null; then
        wget -q -O "$TEMP_FILE" "$URL"
    elif command -v curl &> /dev/null; then
        curl -s -o "$TEMP_FILE" "$URL"
    else
        echo "❌ Neither wget nor curl found"
        return 1
    fi
    
    if [ $? -ne 0 ]; then
        echo "❌ Download failed"
        rm -f "$TEMP_FILE"
        return 1
    fi
    
    # Verify it's a valid schedule
    if ! grep -q "Time(UTC)" "$TEMP_FILE"; then
        echo "❌ Downloaded file doesn't appear to be valid"
        rm -f "$TEMP_FILE"
        return 1
    fi
    
    # Add season marker to the file
    echo "# Season: $SCHEDULE_FILE" > new_schedule.txt
    cat "$TEMP_FILE" >> new_schedule.txt
    rm -f "$TEMP_FILE"
    
    # Count entries
    local ENTRY_COUNT=$(grep -E "^[0-9]{4}\s+[0-9]{4}" new_schedule.txt | wc -l)
    
    echo "✅ Downloaded successfully!"
    echo "   Entries: ~$ENTRY_COUNT broadcasts"
    echo "   File: new_schedule.txt (will be applied automatically)"
    
    return 0
}

# Main logic
main() {
    local QUIET=false
    
    # Parse arguments
    if [ "$1" = "--quiet" ] || [ "$1" = "-q" ]; then
        QUIET=true
    fi
    
    if [ "$QUIET" = false ]; then
        echo "📻 EiBi Schedule Auto-Updater"
        echo ""
    fi
    
    # Check if update needed
    if [ "$(need_update)" = "true" ]; then
        if [ "$QUIET" = false ]; then
            echo "🔍 Update available - downloading..."
            echo ""
        fi
        
        if download_schedule; then
            if [ "$QUIET" = false ]; then
                echo ""
                echo "🎉 Schedule updated! Server will apply it automatically."
            fi
            exit 0
        else
            if [ "$QUIET" = false ]; then
                echo ""
                echo "⚠️  Update failed - will retry later"
            fi
            exit 1
        fi
    else
        if [ "$QUIET" = false ]; then
            echo "✅ Schedule is up to date ($(get_current_season))"
            
            if [ -f "bc-time.txt" ]; then
                local ENTRY_COUNT=$(grep -E "^[0-9]{4}\s+[0-9]{4}" bc-time.txt | wc -l)
                echo "   Current entries: ~$ENTRY_COUNT broadcasts"
            fi
        fi
        exit 0
    fi
}

# Run main function
main "$@"
