#!/usr/bin/env python3
"""
Helper script to discover multicast addresses from radiod.
Uses both multicast and control socket methods for maximum compatibility.
"""

import sys
import json
import argparse
from ka9q.discovery import discover_channels_native

def discover_multicast_addresses(radiod_host, interface=None, duration=2.0):
    """
    Discover multicast addresses from radiod by finding active channels.
    Returns a list of unique multicast addresses.
    """
    try:
        # Try multicast discovery first (works for local/same-subnet clients)
        channels = discover_channels_native(radiod_host, listen_duration=duration, interface=interface)
        
        if not channels:
            # Try control socket method (works for remote clients)
            try:
                from ka9q.discovery import discover_channels_via_control
                channels = discover_channels_via_control(radiod_host, listen_duration=duration)
            except Exception as e:
                pass  # Control socket discovery failed
        
        # Extract unique multicast addresses
        multicast_addrs = set()
        for ssrc, ch in channels.items():
            if hasattr(ch, 'multicast_address') and ch.multicast_address:
                multicast_addrs.add(ch.multicast_address)
        
        result = {
            'success': True,
            'count': len(multicast_addrs),
            'addresses': sorted(list(multicast_addrs)),
            'channel_count': len(channels),
            'method': 'multicast' if channels else 'none'
        }
        
        print(json.dumps(result))
        return 0
        
    except Exception as e:
        error = {
            'success': False,
            'error': str(e),
            'addresses': []
        }
        print(json.dumps(error))
        return 1


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Discover multicast addresses from radiod')
    parser.add_argument('--radiod-host', required=True, help='Radiod hostname')
    parser.add_argument('--interface', help='Network interface IP for multicast')
    parser.add_argument('--duration', type=float, default=2.0, help='Listen duration in seconds')
    
    args = parser.parse_args()
    sys.exit(discover_multicast_addresses(args.radiod_host, args.interface, args.duration))
