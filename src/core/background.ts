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
  inlierCount: number;
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

function quantize(value: number, step: number) {
  return Math.max(0, Math.min(255, Math.round(value / step) * step));
}

/**
 * V1.2 robust border-mode estimator.
 *
 * Pattern sheets often contain a foreground strip touching one or more image
 * borders. A plain border median can still find the correct colour, but a
 * percentile computed over every border sample makes the tolerance explode
 * and erodes soft/anti-aliased part edges. We therefore:
 * 1) sample the complete border,
 * 2) find the densest quantised RGB cluster,
 * 3) estimate colour/spread only from samples close to that dominant cluster.
 */
export function estimateBackgroundModel(
  data: ImageData,
  baseTolerance = 18,
): BackgroundModel {
  const { width, height } = data;
  const step = Math.max(1, Math.floor(Math.min(width, height) / 512));
  const samples: RGB[] = [];

  const addSample = (x: number, y: number) => {
    const index = (y * width + x) * 4;
    if (data.data[index + 3] < 16) return;
    samples.push({
      r: data.data[index],
      g: data.data[index + 1],
      b: data.data[index + 2],
    });
  };

  for (let x = 0; x < width; x += step) {
    addSample(x, 0);
    if (height > 1) addSample(x, height - 1);
  }
  for (let y = step; y < height - step; y += step) {
    addSample(0, y);
    if (width > 1) addSample(width - 1, y);
  }

  if (!samples.length) {
    return {
      color: { r: 255, g: 255, b: 255 },
      spread: 0,
      threshold: baseTolerance,
      sampleCount: 0,
      inlierCount: 0,
    };
  }

  const quantStep = 12;
  const histogram = new Map<string, { count: number; color: RGB }>();

  for (const sample of samples) {
    const color = {
      r: quantize(sample.r, quantStep),
      g: quantize(sample.g, quantStep),
      b: quantize(sample.b, quantStep),
    };
    const key = `${color.r},${color.g},${color.b}`;
    const current = histogram.get(key);
    if (current) current.count += 1;
    else histogram.set(key, { count: 1, color });
  }

  const dominant = [...histogram.values()].sort((a, b) => b.count - a.count)[0];
  const seed = dominant.color;

  // Keep only the dominant background neighbourhood. 30 RGB-distance units
  // tolerates JPEG ringing/lighting variation while rejecting coloured strips.
  let inliers = samples.filter((sample) => colorDistance(sample, seed) <= 30);
  if (inliers.length < Math.max(12, samples.length * 0.12)) {
    inliers = [...samples]
      .sort((a, b) => colorDistance(a, seed) - colorDistance(b, seed))
      .slice(0, Math.max(12, Math.round(samples.length * 0.35)));
  }

  const color: RGB = {
    r: Math.round(median(inliers.map((sample) => sample.r))),
    g: Math.round(median(inliers.map((sample) => sample.g))),
    b: Math.round(median(inliers.map((sample) => sample.b))),
  };

  const distances = inliers.map((sample) => colorDistance(color, sample));
  const spread = percentile(distances, 0.90);

  // Keep the threshold tight enough to preserve anti-aliased/gradient edges.
  // JPEG backgrounds receive a little adaptive headroom, but foreground
  // contamination can no longer push the tolerance toward 70+.
  const threshold = Math.max(
    12,
    Math.min(44, baseTolerance + spread * 2.25),
  );

  return {
    color,
    spread,
    threshold,
    sampleCount: samples.length,
    inlierCount: inliers.length,
  };
}

export function estimateSolidBackground(data: ImageData): RGB {
  return estimateBackgroundModel(data).color;
}
