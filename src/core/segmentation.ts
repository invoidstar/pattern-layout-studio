export interface ComponentBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Browser-side foreground component extraction placeholder.
// The implementation avoids resizing and returns object-level boxes.
export function extractComponents(mask: Uint8Array, width: number, height: number): ComponentBox[] {
  const visited = new Uint8Array(mask.length);
  const result: ComponentBox[] = [];
  const queue: number[] = [];

  for (let i = 0; i < mask.length; i++) {
    if (!mask[i] || visited[i]) continue;

    queue.length = 0;
    queue.push(i);
    visited[i] = 1;

    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;

    while (queue.length) {
      const current = queue.shift()!;
      const x = current % width;
      const y = Math.floor(current / width);

      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);

      for (const next of [current - 1, current + 1, current - width, current + width]) {
        if (next < 0 || next >= mask.length || visited[next] || !mask[next]) continue;
        visited[next] = 1;
        queue.push(next);
      }
    }

    result.push({
      x: minX,
      y: minY,
      width: maxX - minX + 1,
      height: maxY - minY + 1,
    });
  }

  return result;
}
