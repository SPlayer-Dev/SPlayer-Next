/** 与上游线性关键帧等价的取样；二分查找也覆盖倒退跳转与重复 offset。 */
export function sampleMask(frames, time) {
  if (time < frames[0].offset) return frames[0].position;
  let lo = 0,
    hi = frames.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (frames[mid].offset <= time) lo = mid + 1;
    else hi = mid;
  }
  if (lo >= frames.length) return frames[frames.length - 1].position;
  const a = frames[lo - 1],
    b = frames[lo];
  return a.position + ((b.position - a.position) * (time - a.offset)) / (b.offset - a.offset);
}
