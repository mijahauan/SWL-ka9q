# Advanced Configuration

Most users only need `./swl --status-host <hostname>`. This guide covers advanced and edge-case configuration.

## Radiod Host

The `./swl` launcher saves the radiod hostname to `.radiod-hostname`. To change it:

```bash
./swl --status-host new-host.local
```

Or set via environment variable (overrides saved config):
```bash
RADIOD_HOSTNAME=192.168.1.100 ./swl
```

### Finding Your Radiod Address

Check `/etc/radio/radiod.conf` on the radiod machine:
```bash
grep "^status" /etc/radio/radiod.conf
# Example output: status = bee1-hf-status.local
```

Use the `status` value as your `--status-host`.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `RADIOD_HOSTNAME` | from `.radiod-hostname` | Radiod status stream address |
| `PORT` | `3100` | Web server port |
| `KA9Q_MULTICAST_INTERFACE` | auto-detected | Network interface IP for multicast |
| `RADIOD_AUDIO_MULTICAST` | auto-discovered | Audio multicast group (remote radiod) |
| `SWL_RTP_DESTINATION` | `239.1.2.100` | RTP destination IP for SWL channels |
| `SWL_RTP_PORT` | `5004` | RTP destination port |
| `KA9Q_INCLUDE_METRICS` | `true` | Include ka9q-python metrics in logs |

## Network Topology

### Same Machine as radiod (Best)

```bash
./swl --status-host localhost
```

Perfect multicast reception, zero network overhead.

### Same Network Switch (Very Good)

```bash
./swl --status-host bee1-status.local
```

Multicast works via IGMP. The launcher auto-detects your network interface.

### Across Routers/Switches (Limited)

Multicast doesn't cross routers by default. You may need to manually set:

```bash
export RADIOD_AUDIO_MULTICAST=239.113.49.249
./swl --status-host bee1-status.local
```

To find the multicast address, run on the radiod machine:
```bash
control bee1-hf-status.local
# Look for the address:port in the output (e.g., 239.103.26.231:5004)
```

The launcher saves this to `.radiod-multicast` for future runs.

### Multi-Homed Systems

If you have multiple network interfaces, set the interface explicitly:
```bash
export KA9Q_MULTICAST_INTERFACE=192.168.0.161
./swl
```

## Channel Defaults

SWL-ka9q creates channels with:
- **Preset**: `am` (AM demodulation)
- **Sample rate**: 12 kHz
- **Encoding**: Opus (falls back to PCM if browser lacks WebCodecs)
- **AGC**: Disabled by default (manual gain control at 30 dB)
- **SSRC**: Auto-allocated by radiod

## Server Constants

These rarely need changing. Edit `server.js` if needed:

```javascript
const PORT = 3100;
const KA9Q_STATUS_PORT = 5006;
const KA9Q_AUDIO_PORT = 5004;
```

## Platform Notes

- **macOS**: May need larger UDP buffer: `sudo sysctl -w net.inet.udp.recvspace=8388608`
- **Debian/Ubuntu**: Install `python3-venv` if not present: `sudo apt install python3-venv`
- **Docker**: Set `RADIOD_HOSTNAME=host.docker.internal` and `RADIOD_AUDIO_MULTICAST` explicitly
