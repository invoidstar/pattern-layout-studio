import type { BackgroundModel } from './background';

export interface ComponentBox {
  x: number;
  y: number;
  width: number;
  height: number;
  area: number;
}

export interface SegmentationDiagnostics {
  rawForegroundRatio: number;
  cleanedForegroundRatio: number;
  componentCount: number;
  minArea: number;
  threshold: number;
}

export interface SegmentationResult {
  rawMask: Uint8Array;
  cleanMask: Uint8Array;
  boxes: ComponentBox[];
  diagnostics: SegmentationDiagnostics;
}

function foregroundRatio(mask: Uint8Array): number {
  if (!mask.length) return 0;
  let count = 0;
  for (let i = 0; i < mask.length; i += 1) count += mask[i] ? 1 : 0;
  return count / mask.length;
}

/**
 * Fast 3x3 majority cleanup. Uses a separable horizontal sum buffer to avoid
 * nine random reads for every pixel on large 3500x3500 inputs.
 */
export function majorityCleanup(mask: Uint8Array, width: number, height: number): Uint8Array {
  if (width < 3 || height < 3) return mask.slice();

  const horizontal = new Uint8Array(mask.length);
  const output = mask.slice();

  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    for (let x = 1; x < width - 1; x += 1) {
      const index = row + x;
      horizontal[index] = mask[index - 1] + mask[index] + mask[index + 1];
    }
  }

  for (let y = 1; y < height - 1; y += 1) {
    const row = y * width;
    const prev = row - width;
    const next = row + width;
    for (let x = 1; x < width - 1; x += 1) {
      const index = row + x;
      const neighbours =
        horizontal[prev + x] +
        horizontal[index] +
        horizontal[next + x];

      // Preserve real edges while removing isolated speckles and filling only
      // very small one-pixel gaps.
      output[index] = mask[index]
        ? (neighbours >= 3 ? 1 : 0)
        : (neighbours >= 7 ? 1 : 0);
    }
  }

  return output;
}

export function buildForegroundMask(
  data: ImageData,
  background: BackgroundModel,
): Uint8Array {
  const mask = new Uint8Array(data.width * data.height);
  const thresholdSquared = background.threshold * background.threshold;
  const { r, g, b } = background.color;

  for (let pixel = 0; pixel < mask.length; pixel += 1) {
    const offset = pixel * 4;
    if (data.data[offset + 3] < 16) continue;

    const dr = data.data[offset] - r;
    const dg = data.data[offset + 1] - g;
    const db = data.data[offset + 2] - b;

    if (dr * dr + dg * dg + db * db > thresholdSquared) {
      mask[pixel] = 1;
    }
  }

  return mask;
}

/**
 * 8-connected component extraction. Boxes are sorted by component area.
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

      for (let dy = -1; dy <= 1; dy += 1) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;

        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;

          const next = ny * width + nx;
          if (!mask[next] || visited[next]) continue;
          visited[next] = 1;
          queue[tail++] = next;
        }
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

export function segmentForeground(
  data: ImageData,
  background: BackgroundModel,
  minArea?: number,
): SegmentationResult {
  const rawMask = buildForegroundMask(data, background);
  const cleanMask = majorityCleanup(rawMask, data.width, data.height);
  const resolvedMinArea =
    minArea ?? Math.max(96, Math.round(data.width * data.height * 0.00005));
  const boxes = extractComponents(cleanMask, data.width, data.height, resolvedMinArea);

  return {
    rawMask,
    cleanMask,
    boxes,
    diagnostics: {
      rawForegroundRatio: foregroundRatio(rawMask),
      cleanedForegroundRatio: foregroundRatio(cleanMask),
      componentCount: boxes.length,
      minArea: resolvedMinArea,
      threshold: background.threshold,
    },
  };
}
