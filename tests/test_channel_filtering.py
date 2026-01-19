
import unittest
from unittest.mock import patch, MagicMock
import sys
import os

# Add parent directory to path to import radiod_client
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import radiod_client

class TestChannelFiltering(unittest.TestCase):
    def setUp(self):
        # Mock channel data structure from discover_channels
        self.mock_channels = {
            'channels': {
                # Channel 1: Correct freq, wrong preset (iq)
                1001: {
                    'ssrc': 1001, 'frequency_hz': 10000000.0, 'preset': 'iq', 
                    'sample_rate': 24000, 'multicast_address': '239.1.2.3'
                },
                # Channel 2: Correct freq, correct preset (am), wrong sample_rate (48000)
                1002: {
                    'ssrc': 1002, 'frequency_hz': 10000000.0, 'preset': 'am', 
                    'sample_rate': 48000, 'multicast_address': '239.1.2.3'
                },
                # Channel 3: Correct freq, correct preset (am), correct sample_rate (12000) - THIS SHOULD MATCH
                1003: {
                    'ssrc': 1003, 'frequency_hz': 10000000.0, 'preset': 'am', 
                    'sample_rate': 12000, 'multicast_address': '239.1.2.3'
                },
                # Channel 4: Correct freq, correct preset (am), correct sample_rate (12000), but wrong noise
                # (Duplicate valid channel simulation)
                1004: {
                    'ssrc': 1004, 'frequency_hz': 10000000.0, 'preset': 'am', 
                    'sample_rate': 12000, 'multicast_address': '239.1.2.3'
                }
            },
            'channels_by_freq': {
                10000000: {'ssrc': 1001} # Usually points to first found
            }
        }

    @patch('radiod_client.discover_channels')
    def test_find_channel_strict_filtering(self, mock_discover):
        mock_discover.return_value = self.mock_channels
        
        # Test 1: Search for AM, 12000 Hz sample rate (Should find 1003 or 1004)
        result = radiod_client.find_channel_by_frequency(
            radiod_host='localhost', 
            frequency_hz=10000000.0,
            preset='am',
            sample_rate=12000
        )
        self.assertIsNotNone(result)
        self.assertTrue(result['ssrc'] in [1003, 1004], f"Expected SSRC 1003 or 1004, got {result['ssrc'] if result else 'None'}")
        self.assertEqual(result['sample_rate'], 12000)
        self.assertEqual(result['preset'], 'am')

        # Test 2: Search for IQ (Should find 1001)
        result = radiod_client.find_channel_by_frequency(
            radiod_host='localhost', 
            frequency_hz=10000000.0,
            preset='iq'
        )
        self.assertIsNotNone(result)
        self.assertEqual(result['ssrc'], 1001)
        self.assertEqual(result['preset'], 'iq')

        # Test 3: Search for AM, 48000 Hz (Should find 1002)
        result = radiod_client.find_channel_by_frequency(
            radiod_host='localhost', 
            frequency_hz=10000000.0,
            preset='am',
            sample_rate=48000
        )
        self.assertIsNotNone(result)
        self.assertEqual(result['ssrc'], 1002)
        self.assertEqual(result['sample_rate'], 48000)

        # Test 4: Search for non-existent sample rate (Should return None)
        result = radiod_client.find_channel_by_frequency(
            radiod_host='localhost', 
            frequency_hz=10000000.0,
            preset='am',
            sample_rate=96000
        )
        self.assertIsNone(result)

if __name__ == '__main__':
    unittest.main()
