#!/bin/bash

# Configuration
RADIOD_HOSTNAME=$(cat .radiod-hostname 2>/dev/null || echo "localhost")
PYTHON_CMD="venv/bin/python3"

echo "🧹 SWL-ka9q Channel Cleanup"
echo "Radiod Host: $RADIOD_HOSTNAME"
echo ""

# Get active channels
echo "Finding active channels..."
CHANNELS_JSON=$($PYTHON_CMD radiod_client.py --radiod-host "$RADIOD_HOSTNAME" discover)
echo "$CHANNELS_JSON" > /tmp/channels.json

# Extract SSRCs using python (safer than jq/grep)
$PYTHON_CMD -c "
import sys, json
try:
    data = json.load(open('/tmp/channels.json'))
    channels = data.get('channels', {})
    print(f'Found {len(channels)} channels.')
    if len(channels) > 0:
        print('Removing channels...')
        for ssrc, ch in channels.items():
            print(f'{ssrc}')
except Exception as e:
    print(f'Error: {e}', file=sys.stderr)
" > /tmp/ssrcs_to_remove

# Remove each channel
while read ssrc; do
    if [ ! -z "$ssrc" ]; then
        echo "Removing SSRC $ssrc..."
        $PYTHON_CMD radiod_client.py --radiod-host "$RADIOD_HOSTNAME" remove --ssrc "$ssrc"
    fi
done < /tmp/ssrcs_to_remove

rm -f /tmp/channels.json /tmp/ssrcs_to_remove
echo ""
echo "✅ Cleanup complete."
