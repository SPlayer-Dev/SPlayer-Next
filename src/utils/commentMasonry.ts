export const getMasonryRowSpan = (height: number, rowHeight: number, gap: number): number =>
  Math.max(1, Math.ceil((height + gap) / (rowHeight + gap)));
