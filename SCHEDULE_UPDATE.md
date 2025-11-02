# Schedule Update Guide

## Overview

SWL-ka9q uses the **EiBi broadcast schedule database** in `sked-XXX.txt` format. EiBi publishes updated schedules twice per year for each broadcast season.

## EiBi Schedule Seasons

| Season | Published | File Name | Coverage Period |
|--------|-----------|-----------|-----------------|
| **A-season** | Late March | `sked-a25.txt` | Spring/Summer |
| **B-season** | Late October | `sked-b25.txt` | Fall/Winter |

Example: `sked-b25.txt` = B-season (Fall/Winter) 2025/2026

**EiBi Website:** https://www.eibispace.de/dx/

## How Schedule Updates Work

### Automatic Detection System

The server checks for `new_schedule.txt` in the root directory:
- **Check interval:** Every 5 minutes (automatic)
- **On detection:** 
  1. Backs up current `bc-time.txt` → `bc-time.backup.[timestamp].txt`
  2. Copies `new_schedule.txt` → `bc-time.txt`
  3. Deletes `new_schedule.txt`
  4. Reloads station database
  5. Updates web interface automatically

### File Format

The app uses EiBi's **time-based schedule format** (`sked-XXX.txt`):

```
Time(UTC) Days  ITU Station                Lang. Target Frequencies
===========================================================================
0130 0200       SVK Radio Slovakia Int     E     NAm   5850 9700
0200 0300 1-5   USA WBCQ Monticello        E     NAm   9330
```

Format fields:
- **Time(UTC)**: Start and end times (HHMM format)
- **Days**: Optional (1-7 for Mon-Sun, or blank for daily)
- **ITU**: Country code (3 letters)
- **Station**: Station name
- **Lang**: Language code (E=English, etc.)
- **Target**: Target area (NAm=North America, Eu=Europe, etc.)
- **Frequencies**: Space-separated frequencies in kHz

## Update Methods

### Method 1: Update Script (Recommended)

```bash
# Run the update script
./update-schedule.sh

# When prompted, enter the schedule filename
# Example: sked-b25.txt

# The script will:
# - Download from EiBi website
# - Save as new_schedule.txt
# - Verify it's a valid schedule file
# - Server auto-applies within 5 minutes
```

### Method 2: Manual Download

```bash
# Download directly from EiBi
wget https://www.eibispace.de/dx/sked-b25.txt -O new_schedule.txt

# Or with curl
curl -o new_schedule.txt https://www.eibispace.de/dx/sked-b25.txt

# Place in SWL-ka9q root directory
# Server will detect and apply automatically
```

### Method 3: Direct Replacement (Immediate)

```bash
# Download schedule
wget https://www.eibispace.de/dx/sked-b25.txt

# Replace directly
mv sked-b25.txt bc-time.txt

# Restart server for immediate update
pnpm start
```

## Verification

### Check Current Schedule

```bash
# View header of current schedule
head -20 bc-time.txt | grep "Last update"

# Count entries
grep -E "^[0-9]{4}\s+[0-9]{4}" bc-time.txt | wc -l
```

### Check for Backups

```bash
# List backup files
ls -lht bc-time.backup.*.txt | head -5

# View latest backup
ls -t bc-time.backup.*.txt | head -1
```

### Server Logs

When a schedule updates, you'll see:
```
🔄 New schedule file detected: new_schedule.txt
💾 Backed up current schedule to bc-time.backup.1730547123456.txt
✅ Updated bc-time.txt with new schedule
🗑️  Removed new_schedule.txt
🎉 Schedule updated! Loading new data...
📊 Processing 7337 broadcast entries...
✅ Parsed 12000+ station/frequency combinations
```

## Frequency Database (bc-freq.txt)

The frequency database (`bc-freq.txt`) is **optional** and provides additional station information:

```
Frequency(kHz) | Station | Power(kW) | Location | Target | Notes
5850 | RSI | 100 | Rimavska Sobota | NAm,Eu | Multiple broadcasts
```

To update:
- Edit `bc-freq.txt` manually
- Or replace entire file
- Automatic reload every 5 minutes
- Or restart server: `pnpm start`

## Troubleshooting

### Schedule Not Updating

1. **Check file exists:**
   ```bash
   ls -l new_schedule.txt
   ```

2. **Check file permissions:**
   ```bash
   chmod 644 new_schedule.txt
   ```

3. **Check server logs:**
   ```bash
   # Server console should show detection message
   # If not, restart server
   pnpm start
   ```

### Invalid Schedule Format

If the parser fails:
```
Error parsing time schedule: ...
```

Verify the file format:
```bash
# Should show EiBi header
head -20 new_schedule.txt | grep "Time(UTC)"

# Should have entries like:
grep -E "^[0-9]{4}\s+[0-9]{4}" new_schedule.txt | head -5
```

### Restore Previous Schedule

```bash
# Find latest backup
BACKUP=$(ls -t bc-time.backup.*.txt | head -1)

# Restore it
cp $BACKUP bc-time.txt

# Restart server
pnpm start
```

## Best Practices

1. **Update at season changes:**
   - Late March (A-season)
   - Late October (B-season)

2. **Check EiBi website for announcements:**
   - https://www.eibispace.de/dx/

3. **Keep backups:**
   - Backups are created automatically
   - Keep at least 2-3 recent backups
   - Old backups can be deleted manually

4. **Verify after update:**
   - Check station count in server logs
   - Browse a few stations in the web UI
   - Verify on-air stations match current UTC time

5. **Schedule during low-usage:**
   - Updates cause brief reload (~1-2 seconds)
   - Active audio streams continue uninterrupted
   - Web interface may show stale data briefly

## Related Files

- `bc-time.txt` - Main schedule file (EiBi format)
- `bc-freq.txt` - Optional frequency database
- `new_schedule.txt` - Trigger file for updates (auto-deleted)
- `bc-time.backup.*.txt` - Automatic backups
- `update-schedule.sh` - Helper script for downloading
- `.gitignore` - Excludes schedule update files from git

## Additional Resources

- **EiBi Database:** https://www.eibispace.de/dx/
- **EiBi Format Documentation:** https://www.eibispace.de/dx/readme.txt
- **SWL-ka9q Documentation:** [README.md](README.md)
