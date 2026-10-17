"""只消费主机频段强度；不采集、解码或播放音频。"""


class Spectrum:
    def __init__(self):
        self.reset()

    def reset(self):
        self.target = [0.0] * 128
        self.previous = [0.0] * 128
        self.levels = [0.0] * 128
        self.received = self.updated = 0

    def feed(self, packet, now):
        if len(packet) != 132 or packet[:4] != b"SPF1":
            return False
        self.previous = self.target
        self.target = [v / 255 for v in packet[4:]]
        self.received = now
        return True

    def update(self, now):
        dt = min(100, max(0, now - self.updated)) if self.updated else 1000 / 60
        self.updated = now
        stale = now - self.received > 350
        fraction = max(0, min(1, (now - self.received) / 50))
        attack = 1 - .6 ** (dt * .06)
        decay = 1 - .88 ** (dt * .06)
        moving = False
        for i, value in enumerate(self.levels):
            target = 0 if stale else self.previous[i] + (self.target[i] - self.previous[i]) * fraction
            value += (target - value) * (attack if target > value else decay)
            self.levels[i] = 0 if value < .001 else value
            moving |= self.levels[i] > 0
        return moving or not stale
