#!/usr/bin/env python3
"""
Radiod client abstraction layer.

This module provides a clean interface between applications (like Node.js) and radiod,
handling all the complexity of channel discovery, creation, and stream information.

Following user advice:
- Let ka9q-python manage SSRCs and RTP streams.
- Client app simply requests parameters: frequency, rate, encoding, preset, agc.
"""

import sys
import json
import os
import argparse
import logging
import time
from typing import Dict, List, Optional
from ka9q import RadiodControl
from ka9q.discovery import discover_channels_native
from ka9q.utils import resolve_multicast_address

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s', stream=sys.stderr)

DEFAULT_PRESET = 'am'
DEFAULT_SAMPLE_RATE = 12000

def get_or_create_channel(radiod_host: str, frequency: float,
                          interface: Optional[str] = None,
                          preset: str = DEFAULT_PRESET,
                          sample_rate: int = DEFAULT_SAMPLE_RATE,
                          gain: float = 30.0,
                          agc_enable: bool = False,
                          encoding: int = 0) -> Dict:
    """
    Get or create an audio channel via ka9q-python.
    """
    logging.info(f"Requesting channel: {frequency/1e3} kHz, {preset}, {sample_rate}Hz, AGC={agc_enable}")
    
    try:
        with RadiodControl(radiod_host) as control:
            # Create channel - ka9q-python assigns SSRC and returns it
            # We do NOT specify SSRC; we let ka9q-python manage it.
            ssrc = control.create_channel(
                frequency_hz=frequency,
                preset=preset,
                sample_rate=sample_rate,
                agc_enable=1 if agc_enable else 0,
                gain=gain,
                encoding=encoding,
                ssrc=None  # Hardware manages SSRC
            )
            logging.info(f"ka9q-python assigned SSRC: {ssrc}")
            
        # Give radiod a moment to start streaming and announce the new channel in status
        time.sleep(0.5)
        
        # Discovery to find the multicast address assigned by radiod
        logging.info("Polling for channel discovery...")
        channels = discover_channels_native(radiod_host, listen_duration=2.0)
        channel_info = channels.get(ssrc)
        
        if channel_info:
            logging.info(f"Discovered channel {ssrc} streaming to {channel_info.multicast_address}:{channel_info.port}")
            return {
                'success': True,
                'ssrc': ssrc,
                'frequency_hz': channel_info.frequency,
                'multicast_address': channel_info.multicast_address,
                'port': channel_info.port,
                'sample_rate': channel_info.sample_rate,
                'preset': getattr(channel_info, 'preset', preset),
                'mode': 'managed',
                'existed': False # In this simplified flow, we just report it's active
            }
        else:
            # If discovery fails (common on remote/VPN), we still have the SSRC.
            # We return what we know.
            logging.warning(f"SSRC {ssrc} created but not yet discovered via multicast.")
            return {
                'success': True,
                'ssrc': ssrc,
                'frequency_hz': frequency,
                'multicast_address': None, # Server will have to wait for status packet anyway
                'port': 5004,
                'sample_rate': sample_rate,
                'preset': preset,
                'mode': 'blind',
                'warning': 'Channel created but not yet discovered via multicast'
            }

    except Exception as e:
        logging.error(f"Channel operation failed: {e}")
        return {
            'success': False,
            'error': str(e),
            'frequency_hz': frequency
        }

def remove_channel(radiod_host: str, ssrc: int) -> Dict:
    """
    Remove a channel by SSRC.
    """
    try:
        with RadiodControl(radiod_host) as control:
            control.remove_channel(ssrc)
            return {'success': True, 'ssrc': ssrc}
    except Exception as e:
        return {'success': False, 'error': str(e)}

def main():
    parser = argparse.ArgumentParser(description='Radiod client interface')
    parser.add_argument('--radiod-host', required=True, help='Radiod hostname')
    parser.add_argument('--interface', help='Network interface IP for multicast')
    
    subparsers = parser.add_subparsers(dest='command', required=True)
    
    # Get-or-create command
    get_create_parser = subparsers.add_parser('get-or-create', help='Get existing or create new channel')
    get_create_parser.add_argument('--frequency', type=float, required=True, help='Frequency in Hz')
    get_create_parser.add_argument('--preset', default=DEFAULT_PRESET)
    get_create_parser.add_argument('--sample-rate', type=int, default=DEFAULT_SAMPLE_RATE)
    get_create_parser.add_argument('--gain', type=float, default=30.0)
    get_create_parser.add_argument('--agc-enable', action='store_true', help='Enable AGC')
    get_create_parser.add_argument('--encoding', type=int, default=3, help='Output encoding (0=PCM, 3=Opus)')
    
    # Remove command
    remove_parser = subparsers.add_parser('remove', help='Remove a channel')
    remove_parser.add_argument('--ssrc', type=int, required=True, help='Channel SSRC to remove')
    
    args = parser.parse_args()
    
    if args.command == 'get-or-create':
        result = get_or_create_channel(args.radiod_host, args.frequency,
                                       interface=args.interface,
                                       preset=args.preset, sample_rate=args.sample_rate,
                                       gain=args.gain, agc_enable=args.agc_enable,
                                       encoding=args.encoding)
    elif args.command == 'remove':
        result = remove_channel(args.radiod_host, args.ssrc)
    else:
        result = {'success': False, 'error': 'Unknown command'}
        
    print(json.dumps(result))
    return 0 if result.get('success') else 1

if __name__ == '__main__':
    sys.exit(main())
