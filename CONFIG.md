# SWL-ka9q Configuration Guide

## Environment Variables

### Required

- **`RADIOD_HOSTNAME`**: Hostname or IP of your radiod instance
  - Example: `bee1-hf-status.local`, `192.168.1.100`, `localhost`
  - Default: `localhost`

### Optional (depends on your network setup)

- **`KA9Q_MULTICAST_INTERFACE`**: IP address of the network interface to use for multicast reception
  - **Required for multi-homed systems** (multiple network interfaces)
  - Example: `192.168.0.161`
  - Default: System default (works for single-interface systems)
  - To find yours: `ifconfig` (look for your LAN interface's IP)

  > **Note**: If you have multiple `radiod` instances on your network (e.g., status-only nodes vs. SDR nodes), ensure you set `RADIOD_HOSTNAME` to the one with the actual SDR hardware attached. Connecting to a status-only node will result in silent audio (SNR -NaN).

- **`RADIOD_AUDIO_MULTICAST`**: Multicast group address for radiod audio streams
  - **Required for remote clients** (when radiod is on a different machine and multicast discovery doesn't work)
  - Example: `239.103.26.231`
  - Default: Auto-discovered for local clients
  - To find yours: Run `control` command on radiod machine, look at the "output channel" column

## Network Modes

### Local Mode (radiod on same machine or LAN segment)

```bash
export RADIOD_HOSTNAME=localhost
# OR
export RADIOD_HOSTNAME=bee1.local
export KA9Q_MULTICAST_INTERFACE=192.168.0.161  # Only if multi-homed

npm start
```

- Multicast discovery works
- Audio multicast address auto-detected
- Lowest latency

### Remote Mode (radiod across router/network)

```bash
export RADIOD_HOSTNAME=bee1-hf-status.local
export KA9Q_MULTICAST_INTERFACE=192.168.0.161  # Your local interface
export RADIOD_AUDIO_MULTICAST=239.103.26.231   # Radiod's audio multicast

npm start
```

- Multicast discovery doesn't work (multicast doesn't cross routers)
- Must configure audio multicast address manually
- Uses control socket + configured multicast address

## How to Find Your Radiod's Audio Multicast Address

SSH to your radiod machine and run:

```bash
control bee1-hf-status.local
```

Look for the "output channel" column. For example:

```
15770000        am     12,000    15,770,000  39.6 239.103.26.231:5004
                                                  ^^^^^^^^^^^^^^^^^^
                                                  This is the multicast address
```

Set `RADIOD_AUDIO_MULTICAST=239.103.26.231` in your environment.

## Startup Script

The `start.sh` script will export these variables and start the server:

```bash
export RADIOD_HOSTNAME=bee1-hf-status.local
export KA9Q_MULTICAST_INTERFACE=192.168.0.161
export RADIOD_AUDIO_MULTICAST=239.103.26.231
npm start
```

## Generic Installation (Any Platform)

For a truly generic installation that works anywhere:

1. **Auto-detect local vs remote mode**
   - App tries multicast discovery first
   - If discovery finds 0 channels after 3 seconds, asks user for fallback multicast address

2. **Create config file** (recommended for permanent installation)

   ```bash
   # ~/.swl-ka9q.conf
   RADIOD_HOSTNAME=bee1-hf-status.local
   KA9Q_MULTICAST_INTERFACE=192.168.0.161
   RADIOD_AUDIO_MULTICAST=239.103.26.231
   ```

3. **System-specific notes:**
   - **macOS**: May need to increase UDP buffer: `sudo sysctl -w net.inet.udp.recvspace=8388608`
   - **Linux**: Usually works out of the box
   - **Windows**: Multicast interface might need to be set explicitly

## Troubleshooting

### "Cannot discover multicast address" error

- You're a remote client and need to set `RADIOD_AUDIO_MULTICAST`
- Find the address using the `control` command (see above)

### Choppy/intermittent audio

- Radiod might have silence suppression enabled
- Check radiod configuration for VAD (Voice Activity Detection)
- Try a different channel with continuous audio (e.g., FT8 frequencies)

### No audio at all

- Check firewall allows UDP port 5004
- Verify multicast is enabled on your network switches
- Check `KA9Q_MULTICAST_INTERFACE` is correct for your active network interface

## Example Configurations

### Home LAN (all on same network)

```bash
export RADIOD_HOSTNAME=ka9q-sdr.local
npm start
```

### Multi-homed Mac connecting to remote radiod

```bash
export RADIOD_HOSTNAME=remote-sdr.example.com
export KA9Q_MULTICAST_INTERFACE=192.168.0.100
export RADIOD_AUDIO_MULTICAST=239.103.26.231
npm start
```

### Docker container

```yaml
environment:
  - RADIOD_HOSTNAME=host.docker.internal
  - RADIOD_AUDIO_MULTICAST=239.103.26.231
```
