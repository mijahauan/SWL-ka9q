from ka9q import RadiodControl
import json

HOST = 'localhost'

try:
    with RadiodControl(HOST) as control:
        print(f"Connected to radiod at {HOST}")
        # There might not be a direct 'list_channels' in RadiodControl if it only wraps the control socket for commands.
        # But let's check what it can do or if we can infer state.
        # Actually RadiodControl sends commands. We can't query state easily unless radiod supports a 'status' command.
        # However, the user provided a log with channels. That log likely came from 'radiod' stdout or a status tool.
        # Use discover_channels_native again but catch the Errno 22 explicitly to debug it.
        pass
except Exception as e:
    print(f"Error: {e}")
