import unittest
from spectrum import Spectrum


class SpectrumTests(unittest.TestCase):
    def test_protocol_and_stereo_are_preserved(self):
        s = Spectrum()
        packet = b"SPF1" + bytes([255] * 64 + [0] * 64)
        self.assertTrue(s.feed(packet, 1000))
        self.assertFalse(s.feed(b"SPF1", 1010))
        self.assertFalse(s.feed(b"BAD!" + packet[4:], 1010))
        self.assertTrue(s.update(1033))
        self.assertGreater(s.levels[0], 0)
        self.assertEqual(s.levels[64], 0)

    def test_stale_frames_decay_to_silence_and_reset_clears(self):
        s = Spectrum()
        s.feed(b"SPF1" + bytes([255] * 128), 1000)
        s.update(1033)
        peak = s.levels[0]
        s.update(1400)
        self.assertLess(s.levels[0], peak)
        for now in range(1433, 5000, 33):
            active = s.update(now)
        self.assertFalse(active)
        self.assertEqual(max(s.levels), 0)
        s.feed(b"SPF1" + bytes([128] * 128), 6000)
        s.update(6033)
        s.reset()
        self.assertEqual(max(s.levels), 0)
        self.assertEqual(max(s.target), 0)


if __name__ == "__main__":
    unittest.main()
