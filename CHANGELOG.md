# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased] - 2025-12-11
- **Fixed:** Critical bug in `radiod_client.py` interfering with audio stream creation (replaced `request_channel` with `create_channel` and added robust timeout handling).
- **Fixed:** Resolved a JavaScript error (`ReferenceError`) when switching radiod instances in the web interface.
- **Fixed:** Increased audio channel discovery timeout to 20s to reliably detect new channels even with network latency or packet loss.
### Fixed - Audio Stream Reliability

**Critical Fix**: Resolved 500 Internal Server Errors during audio stream creation.

- ✅ **Channel Creation Refactor**: Removed legacy method of specifying SSRC during channel creation. Now relies on `radiod` to assign SSRC and client to discover it via multicast.
- ✅ **Increased Timeout**: Increased channel discovery timeout from 7s to 15s to accommodate slower `radiod` responses during channel creation.
- ✅ **Robust SSRC Discovery**: Implemented backward compatibility for older `ka9q` libraries. Automatically detects if `request_channel` is missing and falls back to `tune` with local SSRC generation.
- ✅ **JSON Sanitization**: Fixed server crashes caused by `radiod` reporting `-Infinity` for signal metrics. `radiod_client.py` now sanitizes all float outputs to ensure valid JSON.

### Added - Radiod Instance Discovery UI

- ✅ **Instance Selection**: New dropdown menu in the header to select discovered `radiod` instances.
- ✅ **Refresh Button**: Ability to re-scan for `radiod` instances on the network.

## [Unreleased] - 2025-11-12

### Added - Target Region and Language Filtering

**New Feature**: Advanced filtering by broadcast target region and language with interactive legends.

**Features**:
- ✅ **Dynamic Filter Generation**: Automatically extracts and displays all unique target regions and languages from loaded schedules
- ✅ **Target Region Filter**: Click to filter broadcasts by intended audience region (e.g., "NAm", "EAs", "Eu")
- ✅ **Language Filter**: Click to filter broadcasts by language (e.g., "English", "Chinese", "Spanish")
- ✅ **Hover Tooltips**: Hover over any filter button to see full name/description
- ✅ **Collapsible Legends**: Click ℹ️ icon to show/hide comprehensive reference guides
- ✅ **Multi-Filter Support**: Combine with existing band and search filters for precise results
- ✅ **Smart Frequency View**: In frequency view, filters individual schedules within each frequency
- ✅ **Visual Feedback**: Active filter buttons highlighted with blue background
- ✅ **Responsive Design**: Filter buttons and legends adapt to mobile screens

**UI Elements**:
- "🌍 Filter by Target Region" section with dynamically populated region buttons
- "🗣️ Filter by Language" section with dynamically populated language buttons
- "All Regions" and "All Languages" buttons to clear filters
- Alphabetically sorted filter options

**Technical Details**:
- Filters work on both Time Schedule and Frequency views
- Frequency view filters schedules within each frequency entry
- Filters update on every station load
- Console logging shows active filters for debugging

### Added - Effective Frequency Display

**New Feature**: Real-time display of effective tuning frequency.

**Features**:
- ✅ **Effective Frequency**: Shows main frequency + shift in kHz with 3 decimal precision
- ✅ **Real-time Updates**: Updates instantly when frequency or shift controls change
- ✅ **Prominent Display**: Large blue gradient display box in tuning panel
- ✅ **Always Visible**: Located in Fine Tuning section for easy reference

### Added - Enhanced Tuning Controls

**Major Feature Update**: Completely redesigned tuning panel with professional-grade controls inspired by ka9q-web.

**New Features**:
- ✅ **Mode Presets**: One-click switching between AM, USB, LSB, and CW modes with appropriate filters
- ✅ **Filter Bandwidth Presets**: Quick selection of Narrow (6 kHz), Medium (10 kHz), Wide (15 kHz), or Custom filters
- ✅ **Quick Frequency Tuning**: +/- buttons for rapid frequency adjustments (-10, -5, -1, +1, +5, +10 kHz)
- ✅ **Fine Tuning Controls**: Quick shift adjustments with -100, -10, +10, +100 Hz buttons
- ✅ **Squelch Control**: Audio squelch threshold to mute weak signals (-80 to 0 dB)
- ✅ **Settings Persistence**: Tuning preferences automatically saved per frequency in browser localStorage
- ✅ **Reset to Defaults**: One-click restoration of optimal broadcast listening settings
- ✅ **Improved UI/UX**: Better organized controls with emoji icons and clear labeling

**Mode Presets**:
- **AM Broadcast**: ±5 kHz filter (default for shortwave broadcasts)
- **USB**: 200-2800 Hz filter for upper sideband
- **LSB**: -2800 to -200 Hz filter for lower sideband  
- **CW**: ±250 Hz filter with 800 Hz shift for Morse code

**Backend API Additions**:
- `POST /api/audio/tune/:ssrc/squelch` - Set squelch threshold
- `setSquelch()` method in Ka9qRadioProxy class

**Frontend Enhancements**:
- Mode preset system with visual feedback
- Filter preset buttons with active state tracking
- Frequency adjustment helpers (adjustFrequency, adjustShift)
- localStorage integration for per-frequency settings
- Improved tuning panel layout with better section organization
- Enhanced CSS with hover effects and smooth transitions

**Technical Improvements**:
- Better control ranges optimized for broadcast monitoring
- Visual feedback on all preset buttons
- Persistent settings across sessions
- Graceful fallback to defaults if no saved settings exist

### Fixed - Channel Deletion

**Bug Fix**: Fixed channel deletion error when stopping audio streams.

**Problem**: The ka9q-python library validates that frequency must be `0 < freq < 10 THz`, which prevented setting frequency to 0 Hz. However, radiod itself accepts frequency 0 as a signal to poll and delete the channel.

**Solution**:
- ✅ **Bypass Validation**: Manually construct TLV command to set frequency to 0 Hz
- ✅ **Direct Command**: Use `encode_double()`, `encode_int()`, and `encode_eol()` to build command buffer
- ✅ **Proper Cleanup**: Channels now properly deleted from radiod when audio stops

**Technical Details**:
- Modified `stopAudioStream()` in server.js
- Constructs TLV command buffer directly instead of calling `control.set_frequency(ssrc, 0)`
- Sends command via `control.send_command(cmdbuffer)` to bypass library validation
- Prevents "ValidationError: Invalid frequency: 0 Hz" errors

### Enhanced - Language Filter Tooltips

**Improvement**: Expanded language code mappings from 8 to 80+ languages.

**Changes**:
- ✅ **Comprehensive Coverage**: Added all EiBi standard language codes
- ✅ **Better Tooltips**: Hover over language buttons now shows full language names instead of abbreviations
- ✅ **Regional Variants**: Includes regional language variants (e.g., Mandarin vs Cantonese)

**Language Coverage**:
- **Common languages**: Arabic, Chinese, English, French, German, Spanish, Russian, Portuguese
- **European languages**: Albanian, Bulgarian, Croatian, Czech, Danish, Finnish, Greek, Hungarian
- **Asian languages**: Bengali, Hindi, Indonesian, Japanese, Korean, Khmer, Thai, Vietnamese
- **Middle Eastern**: Farsi/Persian, Hebrew, Kurdish, Turkish, Urdu
- **African**: Amharic, Hausa, Somali, Swahili, Zulu
- **Special codes**: Multilingual, Music, Various

### Added - Installation Guide and Setup Improvements

**New Documentation**: Created comprehensive INSTALL.md guide for first-time users.

**Setup Script Enhancements**:
- ✅ **Python Version Check**: Detects and displays Python version before setup
- ✅ **Venv Error Handling**: Catches venv creation failures and provides clear fix instructions
- ✅ **Colored Output**: Green/red/yellow/blue colors for better readability
- ✅ **Dependency Checks**: Validates Python, git availability before proceeding
- ✅ **Better Error Messages**: Specific instructions for each failure scenario

**Start Script Improvements**:
- ✅ **Dependency Validation**: Checks for venv/ and node_modules/ before starting
- ✅ **Helpful Errors**: Guides users to run setup if dependencies missing
- ✅ **Prevents Confusion**: Won't try to start with incomplete setup

**Documentation Updates**:
- ✅ **INSTALL.md**: Comprehensive installation guide with troubleshooting section
- ✅ **README.md**: Added one-command setup and python3-venv requirement note
- ✅ **QUICKSTART.md**: Updated with npm run setup command and error handling

**Fixes Python 3.11+ Issue**:
On Debian/Ubuntu with Python 3.11+, users encounter "externally-managed-environment" error (PEP 668). Setup script now detects this and provides clear solution: `sudo apt install python3-venv`

## [Unreleased] - 2025-11-02

### Changed

#### Upgraded to ka9q-python v1.0.0 with Native Discovery

**Major Improvement**: The application now uses native Python channel discovery instead of relying on the external `control` executable from ka9q-radio.

**Benefits**:
- ✅ **No external dependencies**: `control` executable no longer required
- ✅ **Cross-platform**: Works on macOS, Linux, Windows without ka9q-radio tools
- ✅ **More reliable**: Direct multicast listener implementation in pure Python
- ✅ **Better performance**: No subprocess overhead
- ✅ **Easier deployment**: One less dependency to install

**Technical Details**:
- Updated ka9q-python from old version to v1.0.0 (commit d4c2e27)
- `discover_channels()` now uses native Python multicast listener by default
- Automatically falls back to `control` utility if needed (but not required)
- Enhanced mDNS resolution with multi-tier fallback (avahi-resolve → dns-sd → getaddrinfo)

**What Changed**:
- Python virtual environment (`venv/`) now includes latest ka9q-python package
- Channel discovery happens via pure Python (listens to radiod status multicast)
- Server.js code uses same API but benefits from native implementation
- No changes needed to application code - upgrade is transparent

**Migration**: 
Simply run `./setup-venv.sh` to upgrade the ka9q-python package:
```bash
./setup-venv.sh
```

Or manually upgrade:
```bash
./venv/bin/pip3 install --upgrade git+https://github.com/mijahauan/ka9q-python.git
```

**Verification**:
```bash
./venv/bin/python3 -c "import ka9q; print(f'ka9q v{ka9q.__version__}'); print('Native discovery:', 'discover_channels_native' in ka9q.__all__)"
```

### Documentation

- Added comments in server.js clarifying use of native discovery
- Updated README.md to note that control executable is no longer required
- Created this CHANGELOG.md to track updates

---

## [1.0.0] - 2025-11-01

### Initial Release

- Web-based broadcast station monitor
- Real-time station highlighting based on UTC schedules
- Live audio streaming via WebSocket
- 7300+ broadcast schedules from EiBi database
- Advanced filtering and search
- Integration with ka9q-radio and ka9q-python
