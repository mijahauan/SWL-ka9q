#!/usr/bin/env python3
"""
Radiod client abstraction layer.

This module provides a clean interface between applications (like Node.js) and radiod,
handling all the complexity of channel discovery, creation, and stream information.
"""

import sys
import json
import os
import argparse
from typing import Dict, Optional
from ka9q import RadiodControl
from ka9q.discovery import discover_channels_native
from ka9q.utils import resolve_multicast_address


# NOTE: patch_discovery_for_interface() has been removed
# ka9q-python now natively supports the 'interface' parameter in discover_channels_native()


def discover_channels(radiod_host: str, interface: Optional[str] = None, 
                     listen_duration: float = 3.0) -> Dict:
    """
    Discover all active channels from radiod.
    
    Note: This uses multicast discovery which only works for local clients
    on the same network segment as radiod. For remote clients, this will
    return 0 channels (which is expected).
    
    Args:
        radiod_host: Radiod hostname (e.g., 'bee1-hf-status.local')
        interface: Network interface IP for multicast (e.g., '192.168.0.161')
        listen_duration: How long to listen for status packets
    
    Returns:
        Dict with channel information (may be empty for remote clients)
    """
    try:
        # Resolve radiod hostname
        mcast_addr = resolve_multicast_address(radiod_host, timeout=3.0)
        
        # Discover channels (pass interface to ka9q-python's native support)
        channels = discover_channels_native(radiod_host, listen_duration=listen_duration, interface=interface)
    except Exception as e:
        # Multicast discovery failed (expected for remote clients)
        return {
            'multicast_address': 'unknown',
            'channel_count': 0,
            'channels': {},
            'note': 'Multicast discovery not available (remote client or network issue)'
        }
    
    # Format results
    result = {
        'multicast_address': mcast_addr,
        'channel_count': len(channels),
        'channels': {}
    }
    
    # Add note if no channels discovered (common for remote clients)
    if len(channels) == 0:
        result['note'] = 'No channels discovered via multicast (may be remote client)'
    
    for ssrc, ch in channels.items():
        result['channels'][ssrc] = {
            'ssrc': ssrc,
            'preset': ch.preset,
            'frequency_hz': ch.frequency,
            'frequency_mhz': ch.frequency / 1e6,
            'sample_rate': ch.sample_rate,
            'snr': ch.snr,
            'multicast_address': ch.multicast_address,
            'port': ch.port
        }
    
    return result


def create_channel(radiod_host: str, ssrc: int, frequency_hz: float,
                  preset: str = 'am', sample_rate: int = 12000,
                  agc_enable: bool = False, gain: float = 30.0) -> Dict:
    """
    Create a channel on radiod.
    
    Args:
        radiod_host: Radiod hostname
        ssrc: Channel SSRC identifier
        frequency_hz: Frequency in Hz
        preset: Demodulation preset ('am', 'usb', 'lsb', etc.)
        sample_rate: Audio sample rate
        agc_enable: Enable automatic gain control
        gain: Manual gain in dB
    
    Returns:
        Dict with success status
    """
    control = RadiodControl(radiod_host)
    
    control.create_channel(
        ssrc=ssrc,
        frequency_hz=frequency_hz,
        preset=preset,
        sample_rate=sample_rate,
        agc_enable=1 if agc_enable else 0,
        gain=gain
    )
    
    return {'success': True, 'ssrc': ssrc}


def get_or_create_channel(radiod_host: str, ssrc: int, frequency_hz: float,
                         interface: Optional[str] = None,
                         preset: str = 'am', sample_rate: int = 12000,
                         agc_enable: bool = False, gain: float = 30.0,
                         fallback_multicast: str = None) -> Dict:
    """
    Get an existing channel or create it if it doesn't exist.
    
    This is the main entry point that applications should use.
    Attempts multiple strategies to get the correct multicast address:
    1. Multicast discovery (for local clients)
    2. Query radiod status via control socket (for remote clients)
    3. Fallback to configured multicast (if query fails)
    
    Args:
        radiod_host: Radiod hostname
        ssrc: Channel SSRC identifier
        frequency_hz: Frequency in Hz
        interface: Network interface IP for multicast reception
        preset: Demodulation preset
        sample_rate: Audio sample rate
        agc_enable: Enable AGC
        gain: Manual gain in dB
        fallback_multicast: Fallback multicast address for remote clients
                           (e.g., '239.103.26.231'). If None, will error for remote clients.
    
    Returns:
        Dict with channel information including multicast address and port
    """
    control = RadiodControl(radiod_host)
    
    # Create or update the channel (radiod ignores if identical)
    control.create_channel(
        ssrc=ssrc,
        frequency_hz=frequency_hz,
        preset=preset,
        sample_rate=sample_rate,
        agc_enable=1 if agc_enable else 0,
        gain=gain
    )
    
    # Wait briefly for radiod to update
    import time
    time.sleep(0.3)
    
    # Strategy 1: Try multicast discovery first (works for local clients)
    try:
        channels = discover_channels_native(radiod_host, listen_duration=1.0, interface=interface)
        if ssrc in channels:
            ch = channels[ssrc]
            return {
                'success': True,
                'ssrc': ssrc,
                'frequency_hz': ch.frequency,
                'multicast_address': ch.multicast_address,
                'port': ch.port,
                'sample_rate': ch.sample_rate,
                'preset': ch.preset,
                'mode': 'discovered'
            }
    except Exception as e:
        pass  # Multicast discovery failed, try querying status
    
    # Strategy 2: Query radiod's status via control socket
    # This works for remote clients because it uses TCP, not multicast
    try:
        from ka9q.discovery import discover_channels_via_control
        
        # This polls radiod via control socket and waits for response
        channels = discover_channels_via_control(radiod_host, listen_duration=1.0)
        if ssrc in channels:
            ch = channels[ssrc]
            return {
                'success': True,
                'ssrc': ssrc,
                'frequency_hz': ch.frequency,
                'multicast_address': ch.multicast_address,
                'port': ch.port,
                'sample_rate': ch.sample_rate,
                'preset': ch.preset,
                'mode': 'queried'
            }
    except Exception as e:
        pass  # Query failed, fall through to fallback
    
    # Strategy 3: Use fallback address (least reliable)
    if not fallback_multicast:
        raise Exception(
            f'Cannot discover multicast address for SSRC {ssrc} (all methods failed) '
            f'and no fallback_multicast configured. '
            f'Please set RADIOD_AUDIO_MULTICAST environment variable or pass fallback_multicast parameter.'
        )
    
    return {
        'success': True,
        'ssrc': ssrc,
        'frequency_hz': frequency_hz,
        'multicast_address': fallback_multicast,
        'port': 5004,
        'sample_rate': sample_rate,
        'preset': preset,
        'mode': 'fallback'
    }


def main():
    parser = argparse.ArgumentParser(description='Radiod client interface')
    parser.add_argument('--radiod-host', required=True, help='Radiod hostname')
    parser.add_argument('--interface', help='Network interface IP for multicast')
    parser.add_argument('--fallback-multicast', 
                       help='Fallback multicast address for remote clients (e.g., 239.103.26.231)')
    
    subparsers = parser.add_subparsers(dest='command', required=True)
    
    # Discover command
    discover_parser = subparsers.add_parser('discover', help='Discover active channels')
    discover_parser.add_argument('--duration', type=float, default=3.0,
                                help='Listen duration in seconds')
    
    # Create command
    create_parser = subparsers.add_parser('create', help='Create a channel')
    create_parser.add_argument('--ssrc', type=int, required=True)
    create_parser.add_argument('--frequency', type=float, required=True, help='Frequency in Hz')
    create_parser.add_argument('--preset', default='am')
    create_parser.add_argument('--sample-rate', type=int, default=12000)
    create_parser.add_argument('--gain', type=float, default=30.0)
    
    # Get-or-create command (recommended)
    get_create_parser = subparsers.add_parser('get-or-create',
                                              help='Get existing or create new channel')
    get_create_parser.add_argument('--ssrc', type=int, required=True)
    get_create_parser.add_argument('--frequency', type=float, required=True, help='Frequency in Hz')
    get_create_parser.add_argument('--preset', default='am')
    get_create_parser.add_argument('--sample-rate', type=int, default=12000)
    get_create_parser.add_argument('--gain', type=float, default=30.0)
    
    args = parser.parse_args()
    
    try:
        if args.command == 'discover':
            result = discover_channels(args.radiod_host, args.interface, args.duration)
        elif args.command == 'create':
            create_channel(args.radiod_host, args.ssrc, args.frequency,
                          args.preset, args.sample_rate, False, args.gain)
            result = {'success': True}
        elif args.command == 'get-or-create':
            # Get fallback from arg or environment variable
            fallback = args.fallback_multicast or os.environ.get('RADIOD_AUDIO_MULTICAST')
            result = get_or_create_channel(args.radiod_host, args.ssrc, args.frequency,
                                          args.interface, args.preset, args.sample_rate,
                                          False, args.gain, fallback)
        
        print(json.dumps(result))
        sys.stdout.flush()
        return 0
        
    except Exception as e:
        import traceback
        error = {
            'success': False,
            'error': str(e),
            'traceback': traceback.format_exc()
        }
        print(json.dumps(error), file=sys.stderr)
        sys.stderr.flush()
        print(json.dumps({'success': False, 'error': str(e)}))
        sys.stdout.flush()
        return 1


if __name__ == '__main__':
    sys.exit(main())
