# Changelog

All notable changes to this project will be documented in this file.

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
