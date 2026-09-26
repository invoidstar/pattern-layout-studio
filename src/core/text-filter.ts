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
    });
  }

  return result;
}

function boxDistance(a: Component, b: Component): number {
  const ax1 = a.x + a.width;
  const ay1 = a.y + a.height;
  const bx1 = b.x + b.width;
  const by1 = b.y + b.height;
  const dx = Math.max(0, b.x - ax1, a.x - bx1);
  const dy = Math.max(0, b.y - ay1, a.y - by1);
  return Math.hypot(dx, dy);
}

function sameTextLine(a: Component, b: Component, width: number): boolean {
  const centerAY = a.y + a.height / 2;
  const centerBY = b.y + b.height / 2;
  const heightRatio =
    Math.max(a.height, b.height) / Math.max(1, Math.min(a.height, b.height));
  const gap = Math.max(
    0,
    Math.max(a.x, b.x) - Math.min(a.x + a.width, b.x + b.width),
  );
  const verticalTolerance = Math.max(a.height, b.height) * 0.55;
  const horizontalTolerance = Math.max(
    width * 0.025,
    Math.max(a.height, b.height) * 3.5,
  );

  return (
    Math.abs(centerAY - centerBY) <= verticalTolerance &&
    heightRatio <= 2.2 &&
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

function mergeRegionBoxes(regions: TextRegion[]): TextRegion[] {
  const merged = regions.map((region) => ({ ...region }));
  let changed = true;

  while (changed) {
    changed = false;
    outer:
    for (let i = 0; i < merged.length; i += 1) {
      for (let j = i + 1; j < merged.length; j += 1) {
        const a = merged[i];
        const b = merged[j];
        const ax1 = a.x + a.width;
        const ay1 = a.y + a.height;
        const bx1 = b.x + b.width;
        const by1 = b.y + b.height;
        const yOverlap = Math.min(ay1, by1) - Math.max(a.y, b.y);
        const xGap = Math.max(0, Math.max(a.x, b.x) - Math.min(ax1, bx1));

        if (
          yOverlap >= -Math.max(a.height, b.height) * 0.25 &&
          xGap <= Math.max(a.height, b.height) * 2
        ) {
          const x = Math.min(a.x, b.x);
          const y = Math.min(a.y, b.y);
          const right = Math.max(ax1, bx1);
          const bottom = Math.max(ay1, by1);
          merged[i] = {
            x,
            y,
            width: right - x,
            height: bottom - y,
            score: Math.max(a.score, b.score),
            source: 'geometry',
          };
          merged.splice(j, 1);
          changed = true;
          break outer;
        }
      }
    }
  }

  return merged;
}

/**
 * Conservative geometry filter.
 *
 * V1.1 edge anti-aliasing can create many tiny foreground islands. Therefore
 * V1.2 never removes a small component merely because it is small. Candidates
 * must be far from protected large parts AND belong to a horizontal text-like
 * cluster. Single ambiguous components are intentionally left for optional OCR.
 */
export function filterGeometryText(
  mask: Uint8Array,
  width: number,
  height: number,
  strength: TextFilterStrength = 'medium',
): TextFilterResult {
  const components = collectComponents(mask, width, height);
  const imageArea = width * height;
  const minDim = Math.min(width, height);
  const config = {
    weak: {
      maxHeight: height * 0.03,
      maxWidth: width * 0.06,
      maxArea: imageArea * 0.0006,
      minGroup: 4,
    },
    medium: {
      maxHeight: height * 0.055,
      maxWidth: width * 0.09,
      maxArea: imageArea * 0.0015,
      minGroup: 3,
    },
    strong: {
      maxHeight: height * 0.08,
      maxWidth: width * 0.12,
      maxArea: imageArea * 0.003,
      minGroup: 2,
    },
  }[strength];

  const protectedParts = components.filter(
    (component) =>
      component.area >= imageArea * 0.002 ||
      component.height >= height * 0.10 ||
      component.width >= width * 0.10,
  );
  const protectDistance = Math.max(4, minDim * 0.008);

  const candidates = components.filter((component) => {
    if (component.area < 8 || component.area > config.maxArea) return false;
    if (component.height > config.maxHeight || component.width > config.maxWidth) return false;
    if (component.fillRatio > 0.80) return false;
    return !protectedParts.some(
      (largePart) =>
        largePart.seed !== component.seed &&
        boxDistance(component, largePart) <= protectDistance,
    );
  });

  const parent = candidates.map((_, index) => index);
  const find = (value: number): number => {
    let current = value;
    while (parent[current] !== current) {
      parent[current] = parent[parent[current]];
      current = parent[current];
    }
    return current;
  };
  const union = (a: number, b: number) => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent[rootB] = rootA;
  };

  for (let i = 0; i < candidates.length; i += 1) {
    for (let j = i + 1; j < candidates.length; j += 1) {
      if (sameTextLine(candidates[i], candidates[j], width)) union(i, j);
    }
  }

  const groups = new Map<number, Component[]>();
  candidates.forEach((component, index) => {
    const root = find(index);
    const group = groups.get(root) ?? [];
    group.push(component);
    groups.set(root, group);
  });

  const selectedGroups = [...groups.values()].filter((group) => {
    if (group.length < config.minGroup) return false;
    const left = Math.min(...group.map((component) => component.x));
    const top = Math.min(...group.map((component) => component.y));
    const right = Math.max(...group.map((component) => component.x + component.width));
    const bottom = Math.max(...group.map((component) => component.y + component.height));
    const aspect = (right - left) / Math.max(1, bottom - top);
    return aspect >= 1.3 || group.length >= 4;
  });

  const selected = selectedGroups.flat();
  const output = mask.slice();
  let removedPixels = 0;
  for (const component of selected) {
    removedPixels += floodClear(output, component.seed, width, height);
  }

  const regions = mergeRegionBoxes(
    selectedGroups.map((group) => {
      const left = Math.min(...group.map((component) => component.x));
      const top = Math.min(...group.map((component) => component.y));
      const right = Math.max(...group.map((component) => component.x + component.width));
      const bottom = Math.max(...group.map((component) => component.y + component.height));
      return {
        x: left,
        y: top,
        width: right - left,
        height: bottom - top,
        score: group.length,
        source: 'geometry' as const,
      };
    }),
  );

  return {
    mask: output,
    regions,
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
