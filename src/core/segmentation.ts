export interface ComponentBox {
  x: number;
  y: number;
  width: number;
  height: number;
  area: number;
}

/**
 * Extract connected foreground components.
 * The returned boxes are only translated/cropped later;
 * no resizing is performed.
 */
export function extractComponents(
  mask: Uint8Array,
  width: number,
  height: number,
  minArea = 64,
): ComponentBox[] {
  const visited = new Uint8Array(mask.length);
  const result: ComponentBox[] = [];
  const queue = new Int32Array(mask.length);

  for (let i = 0; i < mask.length; i += 1) {
    if (!mask[i] || visited[i]) continue;

    let head = 0;
    let tail = 0;
    queue[tail++] = i;
    visited[i] = 1;

    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;
    let area = 0;

    while (head < tail) {
      const current = queue[head++];
      const x = current % width;
      const y = Math.floor(current / width);
      area += 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);

      for (const next of [current - 1, current + 1, current - width, current + width]) {
        if (next < 0 || next >= mask.length || visited[next] || !mask[next]) continue;
        const nx = next % width;
        if (Math.abs(nx - x) > 1) continue;
        visited[next] = 1;
        queue[tail++] = next;
      }
    }

    if (area >= minArea) {
      result.push({
        x: minX,
        y: minY,
        width: maxX - minX + 1,
        height: maxY - minY + 1,
        area,
      });
    }
  }

  return result.sort((a, b) => b.area - a.area);
}
