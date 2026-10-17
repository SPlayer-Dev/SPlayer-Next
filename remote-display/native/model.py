"""原生显示端的时钟和滚动模型；时间单位为毫秒。"""
import math


class Clock:
    def __init__(self):
        self.position = self.at = 0.0
        self.playing = False
        self.speed = 1.0
        self.offset = None
        self.best_rtt = math.inf
        self.initialized = False

    def current(self, now):
        return max(0, self.position + (max(0, now - self.at) * self.speed if self.playing else 0))

    def calibrate(self, sent, received, server):
        rtt = received - sent
        if 0 <= rtt <= self.best_rtt * 1.5:
            self.best_rtt = min(self.best_rtt, rtt)
            self.offset = server - (sent + received) / 2

    def sync(self, data, now, force=False):
        age = 0 if self.offset is None else max(0, min(2000, now + self.offset - data["sendTimestamp"]))
        candidate = data["position"] + (age * data["speed"] if data["playing"] else 0)
        projected = self.current(now)
        jump = force or not self.initialized or abs(candidate - projected) > 500
        changed = self.playing != data["playing"] or self.speed != data["speed"]
        if jump or changed or not data["playing"]:
            self.position, self.at = candidate, now
        elif abs(candidate - projected) > 50:
            self.position, self.at = projected + (candidate - projected) * 0.15, now
        self.playing, self.speed, self.initialized = data["playing"], data["speed"], True
        return jump

    def freeze(self, now):
        self.position, self.at, self.playing = self.current(now), now, False


def smooth_scroll(position, velocity, target, dt):
    """临界阻尼弹簧的解析解，避免帧率变化改变滚动速度。"""
    distance = position - target
    decay = math.exp(-12 * dt)
    impulse = velocity + 12 * distance
    position = target + (distance + impulse * dt) * decay
    velocity = (velocity - 12 * impulse * dt) * decay
    if abs(position - target) < 0.1 and abs(velocity) < 0.1:
        return target, 0.0
    return position, velocity


def progress(start, end, time):
    if end <= start:
        return float(time >= start)
    return max(0.0, min(1.0, (time - start) / (end - start)))


def smoothstep(value):
    value = max(0.0, min(1.0, value))
    return value * value * (3 - 2 * value)


def line_emphasis(start, end, time):
    """结束后保留已点亮字形并渐暗，避免整行在时间边界突然熄灭。"""
    enter = smoothstep((time - start) / 300)
    leave = 1 - smoothstep((time - end) / 450)
    return enter * leave


def find_interludes(lines):
    """沿用 AMLL 的 7 秒门槛，区间并集避免与和声、重叠歌词冲突。"""
    result = []
    max_end = 0
    for index, line in enumerate(lines):
        start = line["startTime"]
        if start - max_end >= 7000:
            result.append((max_end, start, index))
        max_end = max(max_end, line["endTime"])
    return result


def bezier(x, x1, y1, x2, y2):
    """求时间轴对应的三次贝塞尔值；仅用于三个间奏圆点。"""
    x = max(0.0, min(1.0, x))
    if x in (0, 1):
        return x
    lo, hi = 0.0, 1.0
    for _ in range(16):
        t = (lo + hi) / 2
        projected = 3 * (1 - t) ** 2 * t * x1 + 3 * (1 - t) * t * t * x2 + t ** 3
        if projected < x:
            lo = t
        else:
            hi = t
    t = (lo + hi) / 2
    return 3 * (1 - t) ** 2 * t * y1 + 3 * (1 - t) * t * t * y2 + t ** 3


def interlude_visual(gap, time):
    """AMLL 间奏的三段点亮、呼吸和退场节奏；返回缩放、整体和单点透明度。"""
    start, end, next_index = gap
    delay = 0 if next_index == 0 else 500
    internal = time - start - delay
    body = end - start - delay - 1000
    if internal < 0 or time >= end or body < 910:
        return 1.0, 0.0, (0.0, 0.0, 0.0)
    enter = bezier(internal / 180, .59, .02, .07, 1)
    segment = math.floor((body + 750) / 3 + .5)
    third_duration = body - 2 * segment
    third_target = third_duration / segment
    if internal >= body:
        elapsed = internal - body
        opacity = enter * (1 - bezier((elapsed - 750) / 250, .43, .08, .83, .31))
        if elapsed < 750:
            scale = 1 + .25 * bezier(elapsed / 750, .14, .06, .25, 1)
        else:
            scale = 1.25 - .85 * bezier((elapsed - 750) / 250, .29, .03, 1, .38)
        fractions = [1, 1, third_target + (1 - third_target) * progress(0, 750, elapsed)]
    else:
        opacity = enter
        cycles = max(1, math.floor(body / 4000))
        cycle = (internal % (body / cycles)) / (body / cycles)
        angle = 4 * math.pi * cycle
        s, c = math.sin(angle), math.cos(angle)
        breath = cycle - .084 * s + .008 * (1 - c) + .0046 * s * (c - s)
        scale = 1 + .5 * (breath if breath <= .5 else 1 - breath)
        fractions = [bezier(internal / segment, .56, .01, .45, 1),
                     bezier((internal - segment) / segment, .56, .01, .45, 1),
                     bezier((internal - 2 * segment) / third_duration, .56, .01, .45, 1) * third_target]
    dots = tuple((.2 + .7 * max(0, min(1, fraction))) * progress(0, 750, internal - index * 80) ** 2
                 for index, fraction in enumerate(fractions))
    return scale, opacity, dots
