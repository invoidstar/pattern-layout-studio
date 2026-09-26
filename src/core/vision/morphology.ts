export type SmoothingMode = 'off' | 'standard' | 'strong';

export interface MorphologyStats {
  removedIslandCount: number;
  removedIslandPixels: number;
  filledHoleCount: number;
  filledHolePixels: number;
}

function horizontalPass(
  source: Uint8Array,
  width: number,
  height: number,
  radius: number,
  dilate: boolean,
): Uint8Array {
  if (radius <= 0) return source.slice();
  const output = new Uint8Array(source.length);

  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    let sum = 0;
    for (let x = 0; x <= Math.min(width - 1, radius); x += 1) sum += source[row + x];

    for (let x = 0; x < width; x += 1) {
      const left = Math.max(0, x - radius);
      const right = Math.min(width - 1, x + radius);
      const count = right - left + 1;
      output[row + x] = dilate ? (sum > 0 ? 1 : 0) : (sum === count ? 1 : 0);

      const removeX = x - radius;
      const addX = x + radius + 1;
      if (removeX >= 0) sum -= source[row + removeX];
      if (addX < width) sum += source[row + addX];
    }
  }

  return output;
}

function verticalPass(
  source: Uint8Array,
  width: number,
  height: number,
  radius: number,
  dilate: boolean,
): Uint8Array {
  if (radius <= 0) return source.slice();
  const output = new Uint8Array(source.length);

  for (let x = 0; x < width; x += 1) {
    let sum = 0;
    for (let y = 0; y <= Math.min(height - 1, radius); y += 1) sum += source[y * width + x];

    for (let y = 0; y < height; y += 1) {
      const top = Math.max(0, y - radius);
      const bottom = Math.min(height - 1, y + radius);
      const count = bottom - top + 1;
      const index = y * width + x;
      output[index] = dilate ? (sum > 0 ? 1 : 0) : (sum === count ? 1 : 0);

      const removeY = y - radius;
      const addY = y + radius + 1;
      if (removeY >= 0) sum -= source[removeY * width + x];
      if (addY < height) sum += source[addY * width + x];
    }
  }

  return output;
}

export function dilateSquare(
  source: Uint8Array,
  width: number,
  height: number,
  radius: number,
): Uint8Array {
  return verticalPass(
    horizontalPass(source, width, height, radius, true),
    width,
    height,
    radius,
    true,
  );
}

export function erodeSquare(
  source: Uint8Array,
  width: number,
  height: number,
  radius: number,
): Uint8Array {
  return verticalPass(
    horizontalPass(source, width, height, radius, false),
    width,
    height,
    radius,
    false,
  );
}

export function closeMask(
  source: Uint8Array,
  width: number,
  height: number,
  radius: number,
): Uint8Array {
  if (radius <= 0) return source.slice();
  return erodeSquare(dilateSquare(source, width, height, radius), width, height, radius);
}

export function openMask(
  source: Uint8Array,
  width: number,
  height: number,
  radius: number,
): Uint8Array {
  if (radius <= 0) return source.slice();
  return dilateSquare(erodeSquare(source, width, height, radius), width, height, radius);
}

function neighbours4(index: number, width: number, height: number, callback: (next: number) => void) {
  const x = index % width;
  const y = Math.floor(index / width);
  if (x > 0) callback(index - 1);
  if (x + 1 < width) callback(index + 1);
  if (y > 0) callback(index - width);
  if (y + 1 < height) callback(index + width);
}

export function removeSmallIslands(
  source: Uint8Array,
  width: number,
  height: number,
  minArea: number,
): { mask: Uint8Array; count: number; pixels: number } {
  if (minArea <= 1) return { mask: source.slice(), count: 0, pixels: 0 };

  const output = source.slice();
  const visited = new Uint8Array(source.length);
  const queue = new Int32Array(source.length);
  let removedCount = 0;
  let removedPixels = 0;

  for (let start = 0; start < source.length; start += 1) {
    if (!source[start] || visited[start]) continue;

    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    visited[start] = 1;

    while (head < tail) {
      const current = queue[head++];
      neighbours4(current, width, height, (next) => {
        if (!source[next] || visited[next]) return;
        visited[next] = 1;
        queue[tail++] = next;
      });
    }

    if (tail < minArea) {
      removedCount += 1;
      removedPixels += tail;
      for (let i = 0; i < tail; i += 1) output[queue[i]] = 0;
    }
  }

  return { mask: output, count: removedCount, pixels: removedPixels };
}

export function fillSmallHoles(
  source: Uint8Array,
  width: number,
  height: number,
  maxArea: number,
): { mask: Uint8Array; count: number; pixels: number } {
  if (maxArea <= 0) return { mask: source.slice(), count: 0, pixels: 0 };

  const output = source.slice();
  const visited = new Uint8Array(source.length);
  const queue = new Int32Array(source.length);
  let filledCount = 0;
  let filledPixels = 0;

  for (let start = 0; start < source.length; start += 1) {
    if (source[start] || visited[start]) continue;

    let head = 0;
    let tail = 0;
    let touchesBorder = false;
    queue[tail++] = start;
    visited[start] = 1;

    while (head < tail) {
      const current = queue[head++];
      const x = current % width;
      const y = Math.floor(current / width);
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) touchesBorder = true;

      neighbours4(current, width, height, (next) => {
        if (source[next] || visited[next]) return;
        visited[next] = 1;
        queue[tail++] = next;
      });
    }

    if (!touchesBorder && tail <= maxArea) {
      filledCount += 1;
      filledPixels += tail;
      for (let i = 0; i < tail; i += 1) output[queue[i]] = 1;
    }
  }

  return { mask: output, count: filledCount, pixels: filledPixels };
}

export function smoothMask(
  source: Uint8Array,
  width: number,
  height: number,
  mode: SmoothingMode,
): { mask: Uint8Array; stats: MorphologyStats } {
  if (mode === 'off') {
    return {
      mask: source.slice(),
      stats: { removedIslandCount: 0, removedIslandPixels: 0, filledHoleCount: 0, filledHolePixels: 0 },
    };
  }

  const imageArea = width * height;
  const closeRadius = mode === 'strong' ? 3 : 2;
  const openRadius = mode === 'strong' ? 2 : 1;
  const minIslandArea = Math.max(12, Math.round(imageArea * (mode === 'strong' ? 0.000006 : 0.000003)));
  const maxHoleArea = Math.max(24, Math.round(imageArea * (mode === 'strong' ? 0.00002 : 0.00001)));

  const closed = closeMask(source, width, height, closeRadius);
  const opened = openMask(closed, width, height, openRadius);
  const islands = removeSmallIslands(opened, width, height, minIslandArea);
  const holes = fillSmallHoles(islands.mask, width, height, maxHoleArea);

  return {
    mask: holes.mask,
    stats: {
      removedIslandCount: islands.count,
      removedIslandPixels: islands.pixels,
      filledHoleCount: holes.count,
      filledHolePixels: holes.pixels,
    },
  };
}
