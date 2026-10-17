/** 小位图的可分离盒式模糊，不依赖 WebKit 尚未实现的 Canvas filter。 */
export function blurBackground(image: ImageData): void {
  const { data, width, height } = image;
  const scratch = new Uint8ClampedArray(data.length);
  const radius = 12;
  const size = radius * 2 + 1;
  for (let pass = 0; pass < 3; pass++) {
    for (let y = 0; y < height; y++) {
      for (let channel = 0; channel < 3; channel++) {
        let sum = 0;
        for (let i = -radius; i <= radius; i++)
          sum += data[(y * width + Math.max(0, Math.min(width - 1, i))) * 4 + channel];
        for (let x = 0; x < width; x++) {
          scratch[(y * width + x) * 4 + channel] = sum / size;
          sum +=
            data[(y * width + Math.min(width - 1, x + radius + 1)) * 4 + channel] -
            data[(y * width + Math.max(0, x - radius)) * 4 + channel];
        }
      }
    }
    for (let x = 0; x < width; x++) {
      for (let channel = 0; channel < 3; channel++) {
        let sum = 0;
        for (let i = -radius; i <= radius; i++)
          sum += scratch[(Math.max(0, Math.min(height - 1, i)) * width + x) * 4 + channel];
        for (let y = 0; y < height; y++) {
          data[(y * width + x) * 4 + channel] = sum / size;
          sum +=
            scratch[(Math.min(height - 1, y + radius + 1) * width + x) * 4 + channel] -
            scratch[(Math.max(0, y - radius) * width + x) * 4 + channel];
        }
      }
    }
  }
}
