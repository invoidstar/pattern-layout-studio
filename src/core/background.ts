export interface RGB {
  r: number;
  g: number;
  b: number;
}

export function estimateSolidBackground(data: ImageData): RGB {
  const points = [
    [0, 0],
    [data.width - 1, 0],
    [0, data.height - 1],
    [data.width - 1, data.height - 1],
  ];

  let r = 0;
  let g = 0;
  let b = 0;

  for (const [x, y] of points) {
    const i = (y * data.width + x) * 4;
    r += data.data[i];
    g += data.data[i + 1];
    b += data.data[i + 2];
  }

  return {
    r: Math.round(r / points.length),
    g: Math.round(g / points.length),
    b: Math.round(b / points.length),
  };
}

export function colorDistance(a: RGB, b: RGB): number {
  return Math.sqrt(
    (a.r - b.r) ** 2 +
    (a.g - b.g) ** 2 +
    (a.b - b.b) ** 2,
  );
}
