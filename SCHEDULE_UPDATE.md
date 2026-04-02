# Schedule Update Guide

## Overview

SWL-ka9q uses the **EiBi broadcast schedule database**. EiBi publishes updated schedules twice per year for each broadcast season.
Starting with recent updates, SWL-ka9q uses the split schedule files provided by EiBi:
- `bc-XXX.txt`: The time-based broadcast schedule
- `freq-XXX.txt`: The frequency-based broadcast schedule

## EiBi Schedule Seasons

| Season | Published | Prefix | Coverage Period |
|--------|-----------|-----------|-----------------|
| **A-season** | Late March | `a26` | Spring/Summer |
| **B-season** | Late October | `b26` | Fall/Winter |

Example: `a26` = A-season (Spring/Summer) 2026.
This correlates to files `bc-a26.txt` and `freq-a26.txt`.

**EiBi Website:** http://www.eibispace.de/dx/

> [!WARNING]
> Due to an expired SSL certificate on the EiBi servers since 2019, downloads must enforce `http://` or skip certificate verification (`--no-check-certificate` or `-k`). The included scripts handle this automatically.

## How Schedule Updates Work

### Automatic Detection System

The server actively checks for the presence of BOTH `new_time_schedule.txt` and `new_freq_schedule.txt` in the root directory:
- **Check interval:** Every 5 minutes
- **On detection:** 
  1. Backs up current `bc-time.txt` → `bc-time.backup.[timestamp].txt`
  2. Backs up current `bc-freq.txt` → `bc-freq.backup.[timestamp].txt`
  3. Hot-swaps `new_time_schedule.txt` over `bc-time.txt`
  4. Hot-swaps `new_freq_schedule.txt` over `bc-freq.txt`
  5. Deletes the temporary `new_` files
  6. Reloads station database automatically without restarting the server!

## Update Methods

### Method 1: Auto-Update Script (Recommended)

```bash
# Run the automatic update script
./auto-update-schedule.sh

# The script will:
# - Detect the current season based on the current month and year
# - Download both bc- and freq- files from the EiBi website
# - Save them as new_time_schedule.txt and new_freq_schedule.txt
# - Verify they are valid schedules
# - The server will automatically apply them within 5 minutes!
```

You can place this script in a `cron` job to execute automatically on a daily basis.

### Method 2: Manual Update Script

```bash
# Run the interactive update script
./update-schedule.sh

# When prompted, enter the schedule season identifier
# Example: a26

# The script will download the corresponding files and prepare them for the server.
```

### Method 3: Manual Command Line (Advanced)

```bash
# Download directly from EiBi bypassing security prompts
wget --no-check-certificate http://www.eibispace.de/dx/bc-a26.txt -O new_time_schedule.txt
wget --no-check-certificate http://www.eibispace.de/dx/freq-a26.txt -O new_freq_schedule.txt

# Place in SWL-ka9q root directory
# Server will detect and apply both automatically within 5 minutes
```

## Best Practices

1. **Update at season changes:**
   - Late March (A-season)
   - Late October (B-season)

2. **Keep backups:**
   - Backups are created automatically in the root folder when an update occurs.
   - Keep at least 2-3 recent backups to roll back if necessary.
   - You can easily clean up older backups.

3. **Schedule during low-usage:**
   - Active audio streams will continue uninterrupted while parsing the new schedule.
   - Web interface will seamlessly display the hot-swapped database.

## Troubleshooting

### Download Failures

If `auto-update-schedule.sh` or `update-schedule.sh` throw an error:
1. EiBi might have not uploaded the season file yet. Try the previous season identifier.
2. Ensure you have `curl` or `wget` installed locally.

### Invalid Schedule Format
If the server parser fails to read the schedule, check the top of the file:
```bash
# Should show EiBi header
head -20 bc-time.txt | grep "Time(UTC)"
```

### Restore Previous Schedule
```bash
# Locate latest backups
ls -t bc-time.backup.*.txt | head -1
ls -t bc-freq.backup.*.txt | head -1

# Restore them
cp bc-time.backup.X.txt bc-time.txt
cp bc-freq.backup.X.txt bc-freq.txt

# The easiest way to reload them is to simply restart the Node server
pnpm start
```
