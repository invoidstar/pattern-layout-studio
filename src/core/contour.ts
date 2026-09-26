import type { SmoothingMode } from './morphology';

export interface Point {
  x: number;
  y: number;
}

const DIRECTIONS = [
  [-1, 0],
  [-1, -1],
  [0, -1],
  [1, -1],
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
] as const;

function isOn(mask: Uint8Array, width: number, height: number, x: number, y: number) {
  return x >= 0 && y >= 0 && x < width && y < height && Boolean(mask[y * width + x]);
}

function directionIndex(dx: number, dy: number) {
  return DIRECTIONS.findIndex(([x, y]) => x === dx && y === dy);
}

/**
 * Moore-neighbour boundary tracing for one connected foreground component.
 * The result follows the outer raster boundary in order.
 */
export function traceOuterContour(
  mask: Uint8Array,
  width: number,
  height: number,
): Point[] {
  let startIndex = -1;
  for (let i = 0; i < mask.length; i += 1) {
    if (mask[i]) {
      startIndex = i;
      break;
    }
  }
  if (startIndex < 0) return [];

  const start: Point = { x: startIndex % width, y: Math.floor(startIndex / width) };
  let current = start;
  let backtrack: Point = { x: start.x - 1, y: start.y };
  let firstNext: Point | null = null;
  const points: Point[] = [{ ...start }];
  const maxSteps = Math.max(32, width * height * 2);

  for (let step = 0; step < maxSteps; step += 1) {
    let backIndex = directionIndex(backtrack.x - current.x, backtrack.y - current.y);
    if (backIndex < 0) backIndex = 0;

    let next: Point | null = null;
    let nextBacktrack: Point | null = null;

    for (let offset = 1; offset <= 8; offset += 1) {
      const index = (backIndex + offset) % 8;
      const [dx, dy] = DIRECTIONS[index];
      const nx = current.x + dx;
      const ny = current.y + dy;
      if (!isOn(mask, width, height, nx, ny)) continue;

      const beforeIndex = (index + 7) % 8;
      const [bdx, bdy] = DIRECTIONS[beforeIndex];
      next = { x: nx, y: ny };
      nextBacktrack = { x: current.x + bdx, y: current.y + bdy };
      break;
    }

    if (!next || !nextBacktrack) break;
    if (!firstNext) firstNext = { ...next };

    if (
      points.length > 2 &&
      current.x === start.x &&
      current.y === start.y &&
      next.x === firstNext.x &&
      next.y === firstNext.y
    ) {
      break;
    }

    points.push(next);
    backtrack = nextBacktrack;
    current = next;
  }

  return points;
}

export function simplifyContour(points: Point[], minDistance = 1.5): Point[] {
  if (points.length < 4) return points;
  const result: Point[] = [points[0]];
  let last = points[0];

  for (let i = 1; i < points.length; i += 1) {
    const point = points[i];
    const distance = Math.hypot(point.x - last.x, point.y - last.y);
    if (distance >= minDistance) {
      result.push(point);
      last = point;
    }
  }
  return result.length >= 3 ? result : points;
}

export function chaikinSmooth(points: Point[], iterations: number): Point[] {
  if (points.length < 3 || iterations <= 0) return points.map((point) => ({ ...point }));
  let current = points.map((point) => ({ ...point }));

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const next: Point[] = [];
    for (let i = 0; i < current.length; i += 1) {
      const a = current[i];
      const b = current[(i + 1) % current.length];
      next.push({
        x: a.x * 0.75 + b.x * 0.25,
        y: a.y * 0.75 + b.y * 0.25,
      });
      next.push({
        x: a.x * 0.25 + b.x * 0.75,
        y: a.y * 0.25 + b.y * 0.75,
      });
    }
    current = next;
  }

  return current;
}

export function contourForMode(
  mask: Uint8Array,
  width: number,
  height: number,
  mode: SmoothingMode,
): Point[] {
  const raw = traceOuterContour(mask, width, height);
  if (raw.length < 3 || mode === 'off') return raw;
  const simplified = simplifyContour(raw, mode === 'strong' ? 1.25 : 1.75);
  return chaikinSmooth(simplified, mode === 'strong' ? 2 : 1);
}


/**
 * Trace every disconnected foreground island inside one logical part. This is
 * required after decorative-component grouping: a garment emblem may be
 * intentionally disconnected in the mask but still belong to the same part.
 */
export function outerContoursForMode(
  mask: Uint8Array,
  width: number,
  height: number,
  mode: SmoothingMode,
): Point[][] {
  const visited = new Uint8Array(mask.length);
  const queue = new Int32Array(mask.length);
  const componentMask = new Uint8Array(mask.length);
  const contours: Point[][] = [];

  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || visited[start]) continue;

    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    visited[start] = 1;

    while (head < tail) {
      const current = queue[head++];
      const x = current % width;
      const y = Math.floor(current / width);

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

    if (tail < 3) continue;
    for (let i = 0; i < tail; i += 1) componentMask[queue[i]] = 1;
    const contour = contourForMode(componentMask, width, height, mode);
    if (contour.length >= 3) contours.push(contour);
    for (let i = 0; i < tail; i += 1) componentMask[queue[i]] = 0;
  }

  return contours;
}


/**
 * Trace enclosed background holes so contour smoothing does not accidentally
 * fill legitimate cut-outs inside a part.
 */
export function holeContoursForMode(
  mask: Uint8Array,
  width: number,
  height: number,
  mode: SmoothingMode,
): Point[][] {
  const visited = new Uint8Array(mask.length);
  const queue = new Int32Array(mask.length);
  const holeMask = new Uint8Array(mask.length);
  const contours: Point[][] = [];

  for (let start = 0; start < mask.length; start += 1) {
    if (mask[start] || visited[start]) continue;

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

      const neighbours = [
        [x - 1, y],
        [x + 1, y],
        [x, y - 1],
        [x, y + 1],
      ];
      for (const [nx, ny] of neighbours) {
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const next = ny * width + nx;
        if (mask[next] || visited[next]) continue;
        visited[next] = 1;
        queue[tail++] = next;
      }
    }

    if (touchesBorder || tail < 4) continue;
    for (let i = 0; i < tail; i += 1) holeMask[queue[i]] = 1;
    const contour = contourForMode(holeMask, width, height, mode);
    if (contour.length >= 3) contours.push(contour);
    for (let i = 0; i < tail; i += 1) holeMask[queue[i]] = 0;
  }

  return contours;
}
