#!/usr/bin/env python3
"""
Radiod client abstraction layer.

This module provides a clean interface between applications (like Node.js) and radiod,
handling all the complexity of channel discovery, creation, and stream information.

New channel request paradigm (ka9q-python 2.2+):
- Channel requests do NOT include SSRC; radiod assigns it
- App provides an RTP destination IP address for all channels
- Discovery searches the RTP stream by frequency to find existing channels
- Default preset is 'am', sample rate is 12000
"""

import sys
import json
import os
import argparse
from typing import Dict, List, Optional
from ka9q import RadiodControl
from ka9q.discovery import discover_channels_native
from ka9q.utils import resolve_multicast_address


# Default RTP destination for all SWL-ka9q channels
# This can be overridden via environment variable or CLI argument
DEFAULT_RTP_DESTINATION = os.environ.get('SWL_RTP_DESTINATION', '239.1.2.100')
DEFAULT_RTP_PORT = int(os.environ.get('SWL_RTP_PORT', '5004'))
DEFAULT_PRESET = 'am'
DEFAULT_SAMPLE_RATE = 12000


def discover_channels(radiod_host: str, interface: Optional[str] = None, 
                     listen_duration: float = 3.0,
                     rtp_destination: Optional[str] = None) -> Dict:
    """
    Discover all active channels from radiod.
    
    Note: This uses multicast discovery which only works for local clients
    on the same network segment as radiod. For remote clients, this will
    return 0 channels (which is expected).
    
    Args:
        radiod_host: Radiod hostname (e.g., 'bee1-hf-status.local')
        interface: Network interface IP for multicast (e.g., '192.168.0.161')
        listen_duration: How long to listen for status packets
        rtp_destination: If provided, only return channels on this RTP destination
    
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
            'channels_by_freq': {},
            'note': 'Multicast discovery not available (remote client or network issue)'
        }
    
    # Format results
    result = {
        'multicast_address': mcast_addr,
        'channel_count': 0,
        'channels': {},
        'channels_by_freq': {}  # Index by frequency for easy lookup
    }
    
    for ssrc, ch in channels.items():
        # Filter by RTP destination if specified
        if rtp_destination and ch.multicast_address != rtp_destination:
            continue
            
        channel_info = {
            'ssrc': ssrc,
            'preset': ch.preset,
            'frequency_hz': ch.frequency,
            'frequency_mhz': ch.frequency / 1e6,
            'sample_rate': ch.sample_rate,
            'snr': ch.snr,
            'multicast_address': ch.multicast_address,
            'port': ch.port
        }
        result['channels'][ssrc] = channel_info
        # Also index by frequency (Hz) for lookup
        result['channels_by_freq'][int(ch.frequency)] = channel_info
    
    result['channel_count'] = len(result['channels'])
    
    # Add note if no channels discovered (common for remote clients)
    if result['channel_count'] == 0:
        result['note'] = 'No channels discovered via multicast (may be remote client)'
    
    return result


def find_channel_by_frequency(radiod_host: str, frequency_hz: float,
                              interface: Optional[str] = None,
                              rtp_destination: Optional[str] = None,
                              tolerance_hz: float = 1.0) -> Optional[Dict]:
    """
    Find an existing channel by frequency in the RTP stream.
    
    Args:
        radiod_host: Radiod hostname
        frequency_hz: Frequency to search for
        interface: Network interface IP for multicast
        rtp_destination: RTP destination to search in (filters results)
        tolerance_hz: Frequency matching tolerance in Hz
    
    Returns:
        Channel info dict if found, None otherwise
    """
    discovered = discover_channels(radiod_host, interface, listen_duration=1.0,
                                   rtp_destination=rtp_destination)
    
    # First try exact match by frequency
    freq_int = int(frequency_hz)
    if freq_int in discovered.get('channels_by_freq', {}):
        return discovered['channels_by_freq'][freq_int]
    
    # Try fuzzy match within tolerance
    for ch_info in discovered.get('channels', {}).values():
        if abs(ch_info['frequency_hz'] - frequency_hz) <= tolerance_hz:
            return ch_info
    
    return None


def _add_metrics(result: Dict, control: RadiodControl, include_metrics: bool) -> Dict:
    """
    Optionally attach RadiodControl metrics to the result payload.
    """
    if include_metrics and control:
        try:
            result['metrics'] = control.get_metrics()
        except Exception:
            # Metrics gathering should never break the primary result
            pass
    return result


def request_channel(radiod_host: str, frequency_hz: float,
                    rtp_destination: str = None,
                    rtp_port: int = None,
                    preset: str = None,
                    sample_rate: int = None,
                    agc_enable: bool = False, gain: float = 30.0,
                    include_metrics: bool = False) -> Dict:
    """
    Request a channel from radiod (new paradigm: no SSRC, radiod assigns it).
    
    The app provides an RTP destination IP address; radiod assigns the SSRC.
    After requesting, we discover the channel to get the assigned SSRC.
    
    Args:
        radiod_host: Radiod hostname
        frequency_hz: Frequency in Hz
        rtp_destination: RTP destination IP for audio stream (default: SWL_RTP_DESTINATION)
        rtp_port: RTP destination port (default: 5004)
        preset: Demodulation preset (default: 'am')
        sample_rate: Audio sample rate (default: 12000)
        agc_enable: Enable automatic gain control
        gain: Manual gain in dB
        include_metrics: Include ka9q-python metrics in response
    
    Returns:
        Dict with success status and assigned SSRC
    """
    rtp_destination = rtp_destination or DEFAULT_RTP_DESTINATION
    rtp_port = rtp_port or DEFAULT_RTP_PORT
    preset = preset or DEFAULT_PRESET
    sample_rate = sample_rate or DEFAULT_SAMPLE_RATE
    
    with RadiodControl(radiod_host) as control:
        # Request channel with destination but no SSRC
        # radiod will assign an SSRC
        control.request_channel(
            frequency_hz=frequency_hz,
            destination=f"{rtp_destination}:{rtp_port}",
            preset=preset,
            sample_rate=sample_rate,
            agc_enable=1 if agc_enable else 0,
            gain=gain
        )
        
        return _add_metrics({
            'success': True,
            'frequency_hz': frequency_hz,
            'rtp_destination': rtp_destination,
            'rtp_port': rtp_port,
            'preset': preset,
            'sample_rate': sample_rate,
            'note': 'Channel requested; SSRC assigned by radiod'
        }, control, include_metrics)


def create_channel(radiod_host: str, ssrc: int, frequency_hz: float,
                  preset: str = None, sample_rate: int = None,
                  agc_enable: bool = False, gain: float = 30.0,
                  include_metrics: bool = False) -> Dict:
    """
    Create a channel on radiod (legacy API with explicit SSRC).
    
    DEPRECATED: Use request_channel() or get_or_create_channel() instead.
    This is kept for backward compatibility.
    
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
    preset = preset or DEFAULT_PRESET
    sample_rate = sample_rate or DEFAULT_SAMPLE_RATE
    
    with RadiodControl(radiod_host) as control:
        control.create_channel(
            ssrc=ssrc,
            frequency_hz=frequency_hz,
            preset=preset,
            sample_rate=sample_rate,
            agc_enable=1 if agc_enable else 0,
            gain=gain
        )
        
        return _add_metrics({'success': True, 'ssrc': ssrc}, control, include_metrics)


def get_or_create_channel(radiod_host: str, frequency_hz: float,
                         interface: Optional[str] = None,
                         rtp_destination: str = None,
                         rtp_port: int = None,
                         preset: str = None,
                         sample_rate: int = None,
                         agc_enable: bool = False, gain: float = 30.0,
                         include_metrics: bool = False,
                         ssrc: int = None) -> Dict:
    """
    Get an existing channel or create it if it doesn't exist.
    
    This is the main entry point that applications should use.
    
    New paradigm (ka9q-python 2.2+):
    - First searches the RTP stream for an existing channel at this frequency
    - If found, returns the existing channel info (including radiod-assigned SSRC)
    - If not found, requests a new channel (radiod assigns SSRC)
    
    Args:
        radiod_host: Radiod hostname
        frequency_hz: Frequency in Hz
        interface: Network interface IP for multicast reception
        rtp_destination: RTP destination IP for audio (default: SWL_RTP_DESTINATION env)
        rtp_port: RTP destination port (default: 5004)
        preset: Demodulation preset (default: 'am')
        sample_rate: Audio sample rate (default: 12000)
        agc_enable: Enable AGC
        gain: Manual gain in dB
        include_metrics: Include ka9q-python metrics in response
        ssrc: DEPRECATED - ignored, radiod assigns SSRC
    
    Returns:
        Dict with channel information including SSRC, multicast address and port
    """
    import time
    
    rtp_destination = rtp_destination or DEFAULT_RTP_DESTINATION
    rtp_port = rtp_port or DEFAULT_RTP_PORT
    preset = preset or DEFAULT_PRESET
    sample_rate = sample_rate or DEFAULT_SAMPLE_RATE
    
    # Strategy 1: Check if channel already exists at this frequency in our RTP stream
    existing = find_channel_by_frequency(
        radiod_host, frequency_hz, interface, rtp_destination
    )
    if existing:
        return {
            'success': True,
            'ssrc': existing['ssrc'],
            'frequency_hz': existing['frequency_hz'],
            'multicast_address': existing['multicast_address'],
            'port': existing['port'],
            'sample_rate': existing['sample_rate'],
            'preset': existing['preset'],
            'mode': 'existing',
            'existed': True
        }
    
    # Strategy 2: Request a new channel (radiod assigns SSRC)
    fallback_ssrc = None
    with RadiodControl(radiod_host) as control:
        try:
            # Try new API: request_channel with destination, no SSRC
            control.request_channel(
                frequency_hz=frequency_hz,
                destination=f"{rtp_destination}:{rtp_port}",
                preset=preset,
                sample_rate=sample_rate,
                agc_enable=1 if agc_enable else 0,
                gain=gain
            )
        except AttributeError:
            # Fallback: older ka9q-python without request_channel
            # Use frequency as SSRC (legacy behavior)
            fallback_ssrc = int(frequency_hz)
            control.create_channel(
                ssrc=fallback_ssrc,
                frequency_hz=frequency_hz,
                preset=preset,
                sample_rate=sample_rate,
                agc_enable=1 if agc_enable else 0,
                gain=gain
            )
        
        # Wait briefly for radiod to create the channel
        time.sleep(0.3)
        
        # Discover the newly created channel to get assigned SSRC
        created = find_channel_by_frequency(
            radiod_host, frequency_hz, interface, rtp_destination
        )
        
        if created:
            return _add_metrics({
                'success': True,
                'ssrc': created['ssrc'],
                'frequency_hz': created['frequency_hz'],
                'multicast_address': created['multicast_address'],
                'port': created['port'],
                'sample_rate': created['sample_rate'],
                'preset': created['preset'],
                'mode': 'created',
                'existed': False
            }, control, include_metrics)
        
        # Discovery failed - if we used fallback, we know the SSRC
        if fallback_ssrc is not None:
            return _add_metrics({
                'success': True,
                'ssrc': fallback_ssrc,  # We know the SSRC because we set it
                'frequency_hz': frequency_hz,
                'multicast_address': rtp_destination,
                'port': rtp_port,
                'sample_rate': sample_rate,
                'preset': preset,
                'mode': 'created_fallback',
                'existed': False
            }, control, include_metrics)
        
        # Channel requested but SSRC unknown (new API, discovery failed)
        return _add_metrics({
            'success': True,
            'ssrc': None,  # Will be assigned by radiod
            'frequency_hz': frequency_hz,
            'multicast_address': rtp_destination,
            'port': rtp_port,
            'sample_rate': sample_rate,
            'preset': preset,
            'mode': 'requested',
            'existed': False,
            'note': 'Channel requested; SSRC pending discovery'
        }, control, include_metrics)


def remove_channel(radiod_host: str, ssrc: int = None, frequency_hz: float = None,
                   interface: Optional[str] = None,
                   rtp_destination: str = None,
                   include_metrics: bool = False) -> Dict:
    """
    Remove a channel from radiod.
    
    Can specify either SSRC directly, or frequency to look up the SSRC.
    
    Args:
        radiod_host: Radiod hostname
        ssrc: Channel SSRC to remove (if known)
        frequency_hz: Frequency to find and remove (if SSRC not known)
        interface: Network interface for discovery
        rtp_destination: RTP destination to search in
        include_metrics: Include ka9q-python metrics
    
    Returns:
        Dict with success status
    """
    rtp_destination = rtp_destination or DEFAULT_RTP_DESTINATION
    
    # If no SSRC provided, look it up by frequency
    if ssrc is None and frequency_hz is not None:
        existing = find_channel_by_frequency(
            radiod_host, frequency_hz, interface, rtp_destination
        )
        if existing:
            ssrc = existing['ssrc']
        else:
            return {
                'success': False,
                'error': f'No channel found at frequency {frequency_hz} Hz'
            }
    
    if ssrc is None:
        return {
            'success': False,
            'error': 'Must provide either ssrc or frequency_hz'
        }
    
    with RadiodControl(radiod_host) as control:
        control.remove_channel(ssrc=ssrc)
        return _add_metrics({'success': True, 'ssrc': ssrc}, control, include_metrics)


def main():
    parser = argparse.ArgumentParser(description='Radiod client interface')
    parser.add_argument('--radiod-host', required=True, help='Radiod hostname')
    parser.add_argument('--interface', help='Network interface IP for multicast')
    parser.add_argument('--rtp-destination', 
                       help=f'RTP destination IP for channels (default: {DEFAULT_RTP_DESTINATION})')
    parser.add_argument('--rtp-port', type=int,
                       help=f'RTP destination port (default: {DEFAULT_RTP_PORT})')
    parser.add_argument('--include-metrics', action='store_true',
                       help='Include ka9q-python metrics in the output payload')
    
    subparsers = parser.add_subparsers(dest='command', required=True)
    
    # Discover command
    discover_parser = subparsers.add_parser('discover', help='Discover active channels')
    discover_parser.add_argument('--duration', type=float, default=3.0,
                                help='Listen duration in seconds')
    
    # Request command (new paradigm: no SSRC)
    request_parser = subparsers.add_parser('request', help='Request a channel (radiod assigns SSRC)')
    request_parser.add_argument('--frequency', type=float, required=True, help='Frequency in Hz')
    request_parser.add_argument('--preset', default=DEFAULT_PRESET)
    request_parser.add_argument('--sample-rate', type=int, default=DEFAULT_SAMPLE_RATE)
    request_parser.add_argument('--gain', type=float, default=30.0)
    
    # Get-or-create command (recommended - searches first, then requests)
    get_create_parser = subparsers.add_parser('get-or-create',
                                              help='Get existing or create new channel')
    get_create_parser.add_argument('--frequency', type=float, required=True, help='Frequency in Hz')
    get_create_parser.add_argument('--preset', default=DEFAULT_PRESET)
    get_create_parser.add_argument('--sample-rate', type=int, default=DEFAULT_SAMPLE_RATE)
    get_create_parser.add_argument('--gain', type=float, default=30.0)
    get_create_parser.add_argument('--ssrc', type=int, help='DEPRECATED: ignored, radiod assigns SSRC')
    
    # Remove command (can use SSRC or frequency)
    remove_parser = subparsers.add_parser('remove', help='Remove a channel')
    remove_parser.add_argument('--ssrc', type=int, help='Channel SSRC to remove')
    remove_parser.add_argument('--frequency', type=float, help='Frequency to find and remove')
    
    # Legacy create command (deprecated, kept for compatibility)
    create_parser = subparsers.add_parser('create', help='[DEPRECATED] Create channel with explicit SSRC')
    create_parser.add_argument('--ssrc', type=int, required=True)
    create_parser.add_argument('--frequency', type=float, required=True, help='Frequency in Hz')
    create_parser.add_argument('--preset', default=DEFAULT_PRESET)
    create_parser.add_argument('--sample-rate', type=int, default=DEFAULT_SAMPLE_RATE)
    create_parser.add_argument('--gain', type=float, default=30.0)
    
    args = parser.parse_args()
    
    try:
        include_metrics = args.include_metrics
        rtp_dest = args.rtp_destination or DEFAULT_RTP_DESTINATION
        rtp_port = args.rtp_port or DEFAULT_RTP_PORT
        
        if args.command == 'discover':
            result = discover_channels(args.radiod_host, args.interface, args.duration,
                                       rtp_destination=rtp_dest)
        elif args.command == 'request':
            result = request_channel(args.radiod_host, args.frequency,
                                     rtp_destination=rtp_dest, rtp_port=rtp_port,
                                     preset=args.preset, sample_rate=args.sample_rate,
                                     gain=args.gain, include_metrics=include_metrics)
        elif args.command == 'get-or-create':
            result = get_or_create_channel(args.radiod_host, args.frequency,
                                           interface=args.interface,
                                           rtp_destination=rtp_dest, rtp_port=rtp_port,
                                           preset=args.preset, sample_rate=args.sample_rate,
                                           gain=args.gain, include_metrics=include_metrics)
        elif args.command == 'remove':
            result = remove_channel(args.radiod_host, ssrc=args.ssrc, frequency_hz=args.frequency,
                                    interface=args.interface, rtp_destination=rtp_dest,
                                    include_metrics=include_metrics)
        elif args.command == 'create':
            # Legacy command - deprecated
            result = create_channel(args.radiod_host, args.ssrc, args.frequency,
                                    args.preset, args.sample_rate, False, args.gain,
                                    include_metrics=include_metrics)
        
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
