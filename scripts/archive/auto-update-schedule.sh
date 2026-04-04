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
        echo "a${YEAR}"
    else
        # B-season continues into next year
        if [ "$MONTH" -ge 10 ]; then
            echo "b${YEAR}"
        else
            # January-February use previous year's B schedule
            YEAR=$((YEAR - 1))
            echo "b${YEAR}"
        fi
    fi
}

# Check if we need to update
need_update() {
    local CURRENT_SEASON=$(get_current_season)
    local SCHEDULE_FILE="bc-time.txt"
    local FREQ_FILE="bc-freq.txt"
    
    # If schedule file doesn't exist, we need to download
    if [ ! -f "$SCHEDULE_FILE" ] || [ ! -f "$FREQ_FILE" ]; then
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
    local SEASON_ID=$(get_current_season)
    local URL_TIME="http://eibispace.de/dx/bc-${SEASON_ID}.txt"
    local URL_FREQ="http://eibispace.de/dx/freq-${SEASON_ID}.txt"
    local TEMP_TIME="new_time_schedule.tmp"
    local TEMP_FREQ="new_freq_schedule.tmp"
    
    echo "📥 Downloading latest EiBi schedule season: $SEASON_ID"
    
    # Download to temp file
    if command -v wget &> /dev/null; then
        wget -q --no-check-certificate -O "$TEMP_TIME" "$URL_TIME"
        wget -q --no-check-certificate -O "$TEMP_FREQ" "$URL_FREQ"
    elif command -v curl &> /dev/null; then
        curl -s -k -o "$TEMP_TIME" "$URL_TIME"
        curl -s -k -o "$TEMP_FREQ" "$URL_FREQ"
    else
        echo "❌ Neither wget nor curl found"
        return 1
    fi
    
    if [ ! -s "$TEMP_TIME" ] || [ ! -s "$TEMP_FREQ" ]; then
        echo "❌ Download failed"
        rm -f "$TEMP_TIME" "$TEMP_FREQ"
        return 1
    fi
    
    # Verify it's a valid schedule
    if ! grep -q "Time(UTC)" "$TEMP_TIME"; then
        echo "❌ Downloaded file doesn't appear to be valid"
        rm -f "$TEMP_TIME" "$TEMP_FREQ"
        return 1
    fi
    
    # Add season marker to the files
    echo "# Season: $SEASON_ID" > new_time_schedule.txt
    cat "$TEMP_TIME" >> new_time_schedule.txt
    
    echo "# Season: $SEASON_ID" > new_freq_schedule.txt
    cat "$TEMP_FREQ" >> new_freq_schedule.txt
    
    rm -f "$TEMP_TIME" "$TEMP_FREQ"
    
    # Count entries
    local ENTRY_COUNT=$(grep -a -E "^[0-9]{4}\s+[0-9]{4}" new_time_schedule.txt | wc -l)
    
    echo "✅ Downloaded successfully!"
    echo "   Entries: ~$ENTRY_COUNT broadcasts"
    echo "   Files: new_time_schedule.txt & new_freq_schedule.txt"
    
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
                local ENTRY_COUNT=$(grep -a -E "^[0-9]{4}\s+[0-9]{4}" bc-time.txt | wc -l)
                echo "   Current entries: ~$ENTRY_COUNT broadcasts"
            fi
        fi
        exit 0
    fi
}

# Run main function
main "$@"
