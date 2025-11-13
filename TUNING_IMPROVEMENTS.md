# Tuning Panel Improvements - Implementation Guide

## Overview

The tuning panel has been significantly enhanced with professional-grade controls inspired by ka9q-web, providing a much better user experience for broadcast monitoring and signal tuning.

## What Changed

### 1. Mode Presets (NEW)
Quick one-click switching between different reception modes:

| Mode | Filter Range | Shift | Use Case |
|------|-------------|-------|----------|
| **AM Broadcast** | ±5000 Hz | 0 Hz | Default for shortwave broadcasts |
| **USB** | 200-2800 Hz | 0 Hz | Upper sideband voice |
| **LSB** | -2800 to -200 Hz | 0 Hz | Lower sideband voice |
| **CW** | ±250 Hz | 800 Hz | Morse code reception |

### 2. Filter Bandwidth Presets (NEW)
Predefined filter widths for AM reception:

- **Narrow**: ±3 kHz (6 kHz total) - Best for crowded bands
- **Medium**: ±5 kHz (10 kHz total) - Balanced (default)
- **Wide**: ±7.5 kHz (15 kHz total) - Maximum audio fidelity
- **Custom**: Manual low/high edge adjustment

### 3. Quick Frequency Tuning (NEW)
Fast frequency adjustment buttons around the main frequency input:

```
[-10] [-5] [-1] [Frequency] [+1] [+5] [+10]
```

- Click buttons to adjust frequency by 1, 5, or 10 kHz
- Useful for quickly scanning across bands
- Updates both UI and radiod in real-time

### 4. Fine Tuning (Shift) Controls (NEW)
Precise frequency adjustment in Hz:

```
[-100] [-10] [Shift] [+10] [+100]
```

- Adjust shift by 10 or 100 Hz increments
- Perfect for off-frequency carriers
- Essential for SSB/CW reception

### 5. Squelch Control (NEW)
Audio squelch threshold to mute weak/noise signals:

- **Range**: -80 to 0 dB
- **Default**: -60 dB
- **Purpose**: Mutes audio when signal falls below threshold
- **Use**: Reduces noise during band scanning

### 6. Settings Persistence (NEW)
Automatic saving of tuning preferences per frequency:

**Saved Settings**:
- Mode preset (AM/USB/LSB/CW)
- Filter preset and custom values
- AGC enable/disable state
- Manual gain setting
- Frequency shift
- Output level
- Squelch threshold

**Storage**: Browser localStorage (per frequency key)

**Benefits**:
- Settings restored automatically when returning to a frequency
- No need to reconfigure each time
- Per-station customization

### 7. Reset to Defaults (NEW)
One-click restoration of optimal settings:

- Resets to AM mode with medium filter
- AGC disabled, gain 30 dB
- Zero shift, 50% output, -60 dB squelch
- Useful after experimentation

### 8. Save Preset (NEW)
Manual save button with visual feedback:

- Saves all current settings for the frequency
- Button shows "✓ Saved!" confirmation
- Settings persist across browser sessions

## Enhanced Existing Controls

### AGC (Automatic Gain Control)
- **Improved**: Better UI organization
- **Parameters**: Enable/disable, hangtime (0-5s), headroom (0-20 dB)
- **Default**: Disabled to allow manual control

### Manual Gain
- **Improved**: Extended range from 40 to 60 dB max
- **Range**: -20 to +60 dB
- **Default**: 30 dB

### Filter Controls
- **Improved**: Hidden by default, shown when "Custom" preset selected
- **Input**: Manual Hz entry for precise control
- **Integration**: Works with preset system

### Main Frequency
- **Improved**: Now with +/- quick tune buttons
- **Input**: Direct kHz entry still available
- **Updates**: Immediate application to radiod

### Output Level
- **Unchanged**: 0 to 1.0 range
- **Display**: Shows two decimal places
- **Default**: 0.50 (50%)

## UI/UX Improvements

### Visual Organization
- **Sections**: Clear emoji-labeled sections (📡 Mode, 🎚️ Filter, etc.)
- **Grouping**: Related controls grouped logically
- **Spacing**: Better padding and margins

### Button States
- **Active State**: Blue background for selected presets
- **Hover Effects**: Subtle lift on hover
- **Click Feedback**: Scale animation on press

### Color Scheme
- **Primary**: #2a5298 (blue) for controls
- **Active**: Solid blue background for selected items
- **Hover**: Light blue (#e3f2fd) for hover states

### Responsive Design
- **Desktop**: Multi-column grid layout
- **Mobile**: Single column, full-width buttons
- **Scrolling**: Custom scrollbar styling

## Backend Changes

### New API Endpoint
```javascript
POST /api/audio/tune/:ssrc/squelch
Body: { threshold: float }
```

### New Proxy Method
```javascript
async setSquelch(ssrc, threshold)
```

Executes Python command:
```python
control.set_squelch_open(ssrc=ssrc, level=threshold)
```

## Testing Checklist

When testing with real broadcasts:

- [ ] Mode presets switch correctly and apply appropriate filters
- [ ] Filter presets adjust bandwidth as expected
- [ ] Quick tune buttons change frequency correctly
- [ ] Fine tune buttons adjust shift precisely
- [ ] Squelch mutes audio below threshold
- [ ] Settings save and restore per frequency
- [ ] Reset to defaults works correctly
- [ ] All controls update radiod properly
- [ ] AGC enable/disable toggles manual gain visibility
- [ ] Custom filter mode shows/hides filter inputs
- [ ] UI is responsive on mobile devices
- [ ] Preset button states update correctly

## Keyboard Shortcuts (Future Enhancement)

Potential future additions:
- `Arrow Up/Down`: Adjust frequency by 5 kHz
- `Shift + Arrow Up/Down`: Adjust frequency by 1 kHz
- `Alt + Arrow Up/Down`: Adjust shift by 10 Hz
- `M`: Cycle through modes
- `R`: Reset to defaults
- `S`: Save preset

## Known Limitations

1. **Squelch Parameter**: Uses `set_squelch_open()` - verify this is the correct ka9q-python method
2. **Mode Changes**: Don't automatically switch ka9q preset (stays on 'am' preset)
3. **Custom Filter**: Values not validated (user can enter invalid ranges)
4. **Settings Storage**: Limited to localStorage (cleared if browser data cleared)

## Migration Notes

### For Users
- Old tuning panel layout still works (all old controls present)
- New features are additions, nothing removed
- Settings from previous sessions won't be restored (new feature)

### For Developers
- No breaking changes to API
- New endpoint is additive (`/squelch`)
- Frontend functions are new (no conflicts)
- CSS is additive (new classes only)

## Performance Considerations

- **localStorage**: Minimal impact, only reads/writes on panel open/save
- **API Calls**: Each control change makes one async request
- **UI Updates**: Smooth transitions with CSS (hardware accelerated)
- **Memory**: Negligible increase from preset data structures

## Future Enhancements

Consider adding:
1. **Spectrum Display**: Visual frequency spectrum
2. **S-Meter**: Real-time signal strength indicator
3. **Waterfall**: Visual signal waterfall display
4. **Audio Quality Meter**: SNR or audio quality indicators
5. **Preset Management**: Named presets with import/export
6. **Macros**: Record/playback tuning sequences
7. **RIT/XIT**: Receiver/transmitter incremental tuning
8. **Split Operation**: Separate RX/TX frequencies
9. **Memory Channels**: Quick-recall favorite frequencies
10. **Scan Function**: Automatic frequency scanning

## References

- **ka9q-web**: https://github.com/wa2n-code/ka9q-web
- **ka9q-radio**: https://github.com/ka9q/ka9q-radio
- **ka9q-python**: https://github.com/mijahauan/ka9q-python

## Support

For issues or questions:
1. Check TROUBLESHOOTING.md
2. Verify ka9q-radio is running and accessible
3. Check browser console for error messages
4. Test API endpoints with curl or browser dev tools
