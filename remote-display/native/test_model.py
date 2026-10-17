import unittest
from model import Clock, progress, smooth_scroll, line_emphasis, find_interludes, interlude_visual


class ModelTests(unittest.TestCase):
    def test_network_clock_speed_pause_and_disconnect(self):
        clock = Clock()
        clock.calibrate(1000, 1020, 5010)
        clock.sync(dict(position=30000, playing=True, speed=2, sendTimestamp=5100), 1110)
        self.assertEqual(clock.current(1120), 30040)
        clock.sync(dict(position=30100, playing=False, speed=2, sendTimestamp=5200), 1200)
        self.assertEqual(clock.current(10000), 30100)
        clock.sync(dict(position=40000, playing=True, speed=1, sendTimestamp=6000), 2000)
        clock.freeze(2500)
        self.assertEqual(clock.current(8000), 40500)

    def test_jitter_and_backward_seek(self):
        clock = Clock()
        data = dict(position=10000, playing=True, speed=1, sendTimestamp=0)
        self.assertTrue(clock.sync(data, 0))
        data["position"] = 10220
        self.assertFalse(clock.sync(data, 200))
        self.assertEqual(clock.current(200), 10200)
        data["position"] = 1000
        self.assertTrue(clock.sync(data, 400))
        self.assertEqual(clock.current(400), 1000)

    def test_scroll_is_frame_rate_independent(self):
        states = []
        for fps in (30, 60, 120):
            position, velocity = 0, 0
            for _ in range(fps):
                position, velocity = smooth_scroll(position, velocity, 800, 1 / fps)
            states.append(position)
        self.assertAlmostEqual(states[0], states[1], places=8)
        self.assertAlmostEqual(states[1], states[2], places=8)
        self.assertLess(abs(states[0] - 800), .1)

    def test_word_boundaries_and_zero_length(self):
        self.assertEqual(progress(1000, 2000, 500), 0)
        self.assertEqual(progress(1000, 2000, 1500), .5)
        self.assertEqual(progress(1000, 2000, 2500), 1)
        self.assertEqual(progress(1000, 1000, 999), 0)
        self.assertEqual(progress(1000, 1000, 1000), 1)

    def test_line_fade_is_continuous_at_the_end(self):
        self.assertEqual(line_emphasis(1000, 2000, 999), 0)
        self.assertAlmostEqual(line_emphasis(1000, 2000, 1150), .5)
        self.assertEqual(line_emphasis(1000, 2000, 2000), 1)
        self.assertGreater(line_emphasis(1000, 2000, 2001), .999)
        self.assertAlmostEqual(line_emphasis(1000, 2000, 2225), .5)
        self.assertEqual(line_emphasis(1000, 2000, 2450), 0)
        values = [line_emphasis(1000, 2000, t) for t in range(2000, 2451)]
        self.assertEqual(values, sorted(values, reverse=True))

    def test_interlude_uses_union_of_overlapping_voices(self):
        lines = [dict(startTime=8000, endTime=10000),
                 dict(startTime=9000, endTime=17000, isBG=True),
                 dict(startTime=16000, endTime=18000),
                 dict(startTime=30000, endTime=32000)]
        self.assertEqual(find_interludes(lines), [(0, 8000, 0), (18000, 30000, 3)])
        self.assertEqual(find_interludes([dict(startTime=6999, endTime=8000)]), [])
        self.assertEqual(find_interludes([dict(startTime=7000, endTime=8000)]), [(0, 7000, 0)])
        self.assertEqual(find_interludes([]), [])

    def test_dots_enter_light_in_sequence_and_leave(self):
        gap = (4000, 16000, 1)
        self.assertEqual(interlude_visual(gap, 4499)[1], 0)
        scale, alpha, dots = interlude_visual(gap, 8000)
        self.assertGreater(alpha, .99)
        self.assertGreater(dots[0], dots[1])
        self.assertGreaterEqual(dots[1], dots[2])
        self.assertEqual(interlude_visual(gap, 16000)[1], 0)
        for t in range(0, 18000, 17):
            scale, alpha, dots = interlude_visual(gap, t)
            self.assertTrue(.39 <= scale <= 1.251)
            self.assertTrue(0 <= alpha <= 1)
            self.assertTrue(all(0 <= opacity <= .901 for opacity in dots))


if __name__ == "__main__":
    unittest.main()
