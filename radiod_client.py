#!/usr/bin/env python3
"""
Radiod client abstraction layer.

This module provides a clean interface between applications (like Node.js) and radiod,
handling all the complexity of channel discovery, creation, and stream information.

Channel management:
- App generates random SSRC for new channels
- Uses tune() to create channel and wait for radiod confirmation
- App provides an RTP destination IP address for all channels
- Discovery searches the RTP stream by frequency to find existing channels
- Default preset is 'am', sample rate is 12000
"""

import sys
import json
import os
import argparse
import secrets
import logging
from typing import Dict, List, Optional
from ka9q import RadiodControl
from ka9q.discovery import discover_channels_native
from ka9q.utils import resolve_multicast_address

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')


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
                              tolerance_hz: float = 1.0,
                              listen_duration: float = 2.0,
                              preset: Optional[str] = None,
                              sample_rate: Optional[int] = None) -> Optional[Dict]:
    """
    Find an existing channel by frequency in the RTP stream.
    
    Args:
        radiod_host: Radiod hostname
        frequency_hz: Frequency to search for
        interface: Network interface IP for multicast
        rtp_destination: RTP destination to search in (filters results)
        tolerance_hz: Frequency matching tolerance in Hz
        listen_duration: How long to listen for status packets (default 2.0s)
        preset: Optional preset to filter by (e.g. 'am')
        sample_rate: Optional sample rate to filter by (e.g. 12000)
    
    Returns:
        Channel info dict if found, None otherwise
    """
    discovered = discover_channels(radiod_host, interface, listen_duration=listen_duration,
                                   rtp_destination=rtp_destination)
    
    # Iterate all channels to find best match that satisfies criteria
    best_match = None
    min_diff = float('inf')
    
    for ch_info in discovered.get('channels', {}).values():
        # Skip closing/closed channels (0 Hz)
        if ch_info.get('frequency_hz', 0) <= 0:
            continue

        # Filter by preset if specified
        if preset and ch_info.get('preset') != preset:
            continue

        # Filter by sample_rate if specified
        if sample_rate and ch_info.get('sample_rate') != sample_rate:
            continue
            
        diff = abs(ch_info['frequency_hz'] - frequency_hz)
        if diff <= tolerance_hz:
            # Found a match within tolerance
            # If we have multiple matches (unlikely), pick closest frequency
            if diff < min_diff:
                min_diff = diff
                best_match = ch_info
    
    return best_match


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


def get_or_create_channel(radiod_host: str, frequency: float,
                          interface: Optional[str] = None,
                          rtp_destination: str = DEFAULT_RTP_DESTINATION,
                          rtp_port: int = DEFAULT_RTP_PORT,
                          preset: str = DEFAULT_PRESET,
                          sample_rate: int = DEFAULT_SAMPLE_RATE,
                          gain: float = 30.0,
                          agc_enable: bool = False,
                          include_metrics: bool = False) -> Dict:
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
        gain: Manual gain in dB
        agc_enable: Enable AGC
        include_metrics: Include ka9q-python metrics in response
    
    Returns:
        Dict with channel information including SSRC, multicast address and port
    """
    rtp_destination = rtp_destination or DEFAULT_RTP_DESTINATION
    rtp_port = rtp_port or DEFAULT_RTP_PORT
    preset = preset or DEFAULT_PRESET
    sample_rate = sample_rate or DEFAULT_SAMPLE_RATE
    
    start_frequency = frequency  # Keep original for offset logic
    frequency_hz = int(frequency)

    # Strategy 1: Check if channel already exists via discovery
    # Pass preset and sample_rate to ensure we don't pick up a channel with wrong modulation or rate
    existing = find_channel_by_frequency(
        radiod_host, frequency_hz, interface, rtp_destination, preset=preset, sample_rate=sample_rate
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
    
    # Strategy 2: Request new channel using ensure_channel (standard API)
    # This methodology verifies the channel creation before returning
    try:
        with RadiodControl(radiod_host) as control:
            print(f"DEBUG: Requesting channel via ensure_channel: {frequency_hz} Hz, "
                  f"{preset}, {sample_rate} Hz, AGC={agc_enable}", file=sys.stderr)
            
            # ensure_channel handles request + verification polling internally
            # It will raise TimeoutError if the channel doesn't appear or match specs
            # (e.g. if radiod closes it due to collision)
            channel = control.ensure_channel(
                frequency_hz=frequency_hz,
                destination=f"{rtp_destination}:{rtp_port}",
                preset=preset,
                sample_rate=sample_rate,
                agc_enable=1 if agc_enable else 0,
                gain=gain,
                timeout=10.0  # Reduced from 20s as ensures are typically fast
            )
            
            found = channel.__dict__  # Convert ChannelInfo to dict
            found['success'] = True
            found['mode'] = 'created'
            found['confirmed'] = True
            found['existed'] = False
            
            # Add metrics if requested
            return _add_metrics(found, control, include_metrics)

    except Exception as e:
        # If ensure_channel failed (TimeoutError or other), it means collision or failure
        # Check for collision handling
        print(f"DEBUG: ensure_channel failed for {frequency_hz} Hz: {e}. "
              f"Checking for collision retry...", file=sys.stderr)
        
        # Retry with offset if appropriate
        if frequency_hz % 100 == 0:
             print(f"DEBUG: Retrying with +100 Hz offset...", file=sys.stderr)
             # Recursive call with offset frequency
             return get_or_create_channel(
                 radiod_host, start_frequency + 100, interface, rtp_destination, 
                 rtp_port, preset, sample_rate, gain, agc_enable, include_metrics
             )
        
        return {
            'success': False,
            'error': f'Failed to ensure channel: {str(e)}',
            'frequency_hz': frequency_hz
        }


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
        # remove_channel sets frequency to 0, which marks channel for removal
        control.remove_channel(ssrc=ssrc)
        
        return _add_metrics({
            'success': True,
            'ssrc': ssrc
        }, control, include_metrics)


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
    
    # Get-or-create command (recommended - searches first, then requests)
    get_create_parser = subparsers.add_parser('get-or-create',
                                              help='Get existing or create new channel')
    get_create_parser.add_argument('--frequency', type=float, required=True, help='Frequency in Hz')
    get_create_parser.add_argument('--preset', default=DEFAULT_PRESET)
    get_create_parser.add_argument('--sample-rate', type=int, default=DEFAULT_SAMPLE_RATE)
    get_create_parser.add_argument('--gain', type=float, default=30.0)
    get_create_parser.add_argument('--agc-enable', action='store_true', help='Enable AGC')
    
    # Remove command (can use SSRC or frequency)
    remove_parser = subparsers.add_parser('remove', help='Remove a channel')
    remove_parser.add_argument('--ssrc', type=int, help='Channel SSRC to remove')
    remove_parser.add_argument('--frequency', type=float, help='Frequency to find and remove')
    
    
    args = parser.parse_args()
    
    try:
        include_metrics = args.include_metrics
        rtp_dest = args.rtp_destination or DEFAULT_RTP_DESTINATION
        rtp_port = args.rtp_port or DEFAULT_RTP_PORT
        
        if args.command == 'discover':
            result = discover_channels(args.radiod_host, args.interface, args.duration,
                                       rtp_destination=rtp_dest)
        elif args.command == 'get-or-create':
            result = get_or_create_channel(args.radiod_host, args.frequency,
                                           interface=args.interface,
                                           rtp_destination=rtp_dest, rtp_port=rtp_port,
                                           preset=args.preset, sample_rate=args.sample_rate,
                                           gain=args.gain, agc_enable=args.agc_enable,
                                           include_metrics=include_metrics)
        elif args.command == 'remove':
            result = remove_channel(args.radiod_host, ssrc=args.ssrc, frequency_hz=args.frequency,
                                    interface=args.interface, rtp_destination=rtp_dest,
                                    include_metrics=include_metrics)
        
        # Ensure output is valid JSON (handle Infinity/NaN)
        def clean_floats(obj):
            if isinstance(obj, float):
                import math
                if math.isinf(obj) or math.isnan(obj):
                    return None
            elif isinstance(obj, dict):
                return {k: clean_floats(v) for k, v in obj.items()}
            elif isinstance(obj, list):
                return [clean_floats(i) for i in obj]
            return obj
            
        print(json.dumps(clean_floats(result)))
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
