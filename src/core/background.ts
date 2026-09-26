export interface RGB {
  r: number;
  g: number;
  b: number;
}

export interface BackgroundModel {
  color: RGB;
  spread: number;
  threshold: number;
  sampleCount: number;
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function percentile(values: number[], q: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.min(sorted.length - 1, Math.round((sorted.length - 1) * q)));
  return sorted[index];
}

export function colorDistance(a: RGB, b: RGB): number {
  return Math.sqrt(
    (a.r - b.r) ** 2 +
    (a.g - b.g) ** 2 +
    (a.b - b.b) ** 2,
  );
}

/**
 * Robust V2 background estimator.
 *
 * Instead of trusting only four corners, sample the complete outer border and
 * use per-channel medians. This tolerates a part touching one edge and JPEG
 * ringing/compression on the background.
 */
export function estimateBackgroundModel(
  data: ImageData,
  baseTolerance = 22,
): BackgroundModel {
  const { width, height } = data;
  const step = Math.max(1, Math.floor(Math.min(width, height) / 512));
  const rs: number[] = [];
  const gs: number[] = [];
  const bs: number[] = [];

  const addSample = (x: number, y: number) => {
    const index = (y * width + x) * 4;
    if (data.data[index + 3] < 16) return;
    rs.push(data.data[index]);
    gs.push(data.data[index + 1]);
    bs.push(data.data[index + 2]);
  };

  for (let x = 0; x < width; x += step) {
    addSample(x, 0);
    if (height > 1) addSample(x, height - 1);
  }
  for (let y = step; y < height - step; y += step) {
    addSample(0, y);
    if (width > 1) addSample(width - 1, y);
  }

  if (!rs.length) {
    return {
      color: { r: 255, g: 255, b: 255 },
      spread: 0,
      threshold: baseTolerance,
      sampleCount: 0,
    };
  }

  const color: RGB = {
    r: Math.round(median(rs)),
    g: Math.round(median(gs)),
    b: Math.round(median(bs)),
  };

  const distances = rs.map((r, index) =>
    colorDistance(color, { r, g: gs[index], b: bs[index] }),
  );

  // 60th percentile is intentionally conservative: even when a foreground
  // object occupies part of an edge, it should not inflate the tolerance.
  const spread = percentile(distances, 0.60);
  const threshold = Math.max(14, Math.min(72, baseTolerance + spread * 3));

  return {
    color,
    spread,
    threshold,
    sampleCount: rs.length,
  };
}

// Backwards-compatible helper used by older callers.
export function estimateSolidBackground(data: ImageData): RGB {
  return estimateBackgroundModel(data).color;
}
