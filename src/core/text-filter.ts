export type TextFilterStrength = 'weak' | 'medium' | 'strong';

export interface TextRegion {
  x: number;
  y: number;
  width: number;
  height: number;
  score: number;
  source: 'geometry' | 'ocr';
  confidence?: number;
  text?: string;
}

interface Component {
  seed: number;
  x: number;
  y: number;
  width: number;
  height: number;
  area: number;
  fillRatio: number;
  score: number;
}

export interface TextFilterResult {
  mask: Uint8Array;
  regions: TextRegion[];
  removedComponentCount: number;
  removedPixels: number;
}

function collectComponents(
  mask: Uint8Array,
  width: number,
  height: number,
): Component[] {
  const visited = new Uint8Array(mask.length);
  const queue = new Int32Array(mask.length);
  const result: Component[] = [];

  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || visited[start]) continue;

    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    visited[start] = 1;
    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;

    while (head < tail) {
      const current = queue[head++];
      const x = current % width;
      const y = Math.floor(current / width);
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

    const boxWidth = maxX - minX + 1;
    const boxHeight = maxY - minY + 1;
    result.push({
      seed: start,
      x: minX,
      y: minY,
      width: boxWidth,
      height: boxHeight,
      area: tail,
      fillRatio: tail / Math.max(1, boxWidth * boxHeight),
      score: 0,
    });
  }

  return result;
}

function scoreComponent(
  component: Component,
  width: number,
  height: number,
  strength: TextFilterStrength,
): number {
  const imageArea = width * height;
  const minDim = Math.min(width, height);
  const maxHeightRatio = strength === 'weak' ? 0.035 : strength === 'strong' ? 0.085 : 0.055;
  const maxAreaRatio = strength === 'weak' ? 0.0012 : strength === 'strong' ? 0.007 : 0.0035;
  const heightRatio = component.height / Math.max(1, height);
  const areaRatio = component.area / Math.max(1, imageArea);
  const aspect = component.width / Math.max(1, component.height);
  const thinSide = Math.min(component.width, component.height);

  let score = 0;
  if (heightRatio <= maxHeightRatio) score += 2;
  if (areaRatio <= maxAreaRatio) score += 2;
  if (component.fillRatio < 0.55) score += 2;
  else if (component.fillRatio < 0.74) score += 1;
  if (aspect >= 1.8 || aspect <= 0.55) score += 1;
  if (thinSide <= Math.max(8, minDim * 0.025)) score += 1;
  if (component.area < 8 || component.width < 2 || component.height < 2) score -= 2;

  return score;
}

function sameTextLine(a: Component, b: Component, width: number): boolean {
  const centerAY = a.y + a.height / 2;
  const centerBY = b.y + b.height / 2;
  const heightRatio = Math.max(a.height, b.height) / Math.max(1, Math.min(a.height, b.height));
  const gap = Math.max(
    0,
    Math.max(a.x, b.x) - Math.min(a.x + a.width, b.x + b.width),
  );
  const verticalTolerance = Math.max(a.height, b.height) * 0.65;
  const horizontalTolerance = Math.max(width * 0.045, Math.max(a.height, b.height) * 4.5);

  return (
    Math.abs(centerAY - centerBY) <= verticalTolerance &&
    heightRatio <= 2.6 &&
    gap <= horizontalTolerance
  );
}

function floodClear(
  output: Uint8Array,
  seed: number,
  width: number,
  height: number,
): number {
  if (!output[seed]) return 0;
  const queue = new Int32Array(output.length);
  let head = 0;
  let tail = 0;
  queue[tail++] = seed;
  output[seed] = 0;

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
        if (!output[next]) continue;
        output[next] = 0;
        queue[tail++] = next;
      }
    }
  }

  return tail;
}

export function filterGeometryText(
  mask: Uint8Array,
  width: number,
  height: number,
  strength: TextFilterStrength = 'medium',
): TextFilterResult {
  const components = collectComponents(mask, width, height);
  const candidates = components
    .map((component) => ({
      ...component,
      score: scoreComponent(component, width, height, strength),
    }))
    .filter((component) => component.score >= 3);

  const groupSize = new Map<number, number>();
  candidates.forEach((component, index) => {
    let neighbours = 1;
    candidates.forEach((other, otherIndex) => {
      if (index === otherIndex) return;
      if (sameTextLine(component, other, width)) neighbours += 1;
    });
    groupSize.set(index, neighbours);
  });

  const scoreThreshold = strength === 'weak' ? 6 : strength === 'strong' ? 4 : 5;
  const selected = candidates.filter((component, index) => {
    const group = groupSize.get(index) ?? 1;
    return component.score >= scoreThreshold || (group >= 2 && component.score >= 3);
  });

  const output = mask.slice();
  let removedPixels = 0;
  for (const component of selected) {
    removedPixels += floodClear(output, component.seed, width, height);
  }

  return {
    mask: output,
    regions: selected.map((component) => ({
      x: component.x,
      y: component.y,
      width: component.width,
      height: component.height,
      score: component.score,
      source: 'geometry' as const,
    })),
    removedComponentCount: selected.length,
    removedPixels,
  };
}

export function removeTextRegions(
  mask: Uint8Array,
  width: number,
  height: number,
  regions: TextRegion[],
  padding = 3,
): { mask: Uint8Array; removedPixels: number } {
  const output = mask.slice();
  let removedPixels = 0;

  for (const region of regions) {
    const left = Math.max(0, Math.floor(region.x - padding));
    const top = Math.max(0, Math.floor(region.y - padding));
    const right = Math.min(width, Math.ceil(region.x + region.width + padding));
    const bottom = Math.min(height, Math.ceil(region.y + region.height + padding));

    for (let y = top; y < bottom; y += 1) {
      const row = y * width;
      for (let x = left; x < right; x += 1) {
        const index = row + x;
        if (output[index]) {
          output[index] = 0;
          removedPixels += 1;
        }
      }
    }
  }

  return { mask: output, removedPixels };
}
