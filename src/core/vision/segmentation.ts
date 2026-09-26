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


export type SplitStrength = 'conservative' | 'standard' | 'fine';

export interface ComponentGroupingResult {
  boxes: ComponentBox[];
  rawCount: number;
  mergedDecorationCount: number;
}

function unionBoxes(group: ComponentBox[]): ComponentBox {
  const left = Math.min(...group.map((box) => box.x));
  const top = Math.min(...group.map((box) => box.y));
  const right = Math.max(...group.map((box) => box.x + box.width));
  const bottom = Math.max(...group.map((box) => box.y + box.height));
  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
    area: group.reduce((total, box) => total + box.area, 0),
  };
}

/**
 * Merge small disconnected decorative islands back into a clearly larger host
 * part when their centre lies inside (or just at the edge of) the host bbox.
 *
 * This specifically prevents garment prints, facial details, bow highlights,
 * emblems and similar internal artwork from becoming independent layout parts.
 * Genuine neighbouring parts remain separate because proximity alone is not
 * sufficient: the small component must be spatially contained by the host.
 */
export function groupDecorativeComponents(
  boxes: ComponentBox[],
  imageWidth: number,
  imageHeight: number,
  strength: SplitStrength = 'conservative',
): ComponentGroupingResult {
  if (boxes.length < 2) {
    return {
      boxes: boxes.map((box) => ({ ...box })),
      rawCount: boxes.length,
      mergedDecorationCount: 0,
    };
  }

  const config = {
    conservative: {
      maxChildRatio: 0.22,
      minHostAreaRatio: 0.0012,
      marginRatio: 0.012,
    },
    standard: {
      maxChildRatio: 0.12,
      minHostAreaRatio: 0.0018,
      marginRatio: 0.008,
    },
    fine: {
      maxChildRatio: 0.05,
      minHostAreaRatio: 0.0025,
      marginRatio: 0.004,
    },
  }[strength];

  const imageArea = imageWidth * imageHeight;
  const indexed = boxes
    .map((box, index) => ({ ...box, __index: index }))
    .sort((a, b) => b.area - a.area);

  const parent = new Map<number, number>();

  for (let reverse = indexed.length - 1; reverse >= 0; reverse -= 1) {
    const child = indexed[reverse];
    const centerX = child.x + child.width / 2;
    const centerY = child.y + child.height / 2;
    const candidates: typeof indexed = [];

    for (const host of indexed) {
      if (host.__index === child.__index || host.area <= child.area) continue;
      if (host.area < imageArea * config.minHostAreaRatio) continue;
      if (child.area / host.area > config.maxChildRatio) continue;

      const marginX = Math.max(3, host.width * config.marginRatio);
      const marginY = Math.max(3, host.height * config.marginRatio);
      const contained =
        centerX >= host.x - marginX &&
        centerX <= host.x + host.width + marginX &&
        centerY >= host.y - marginY &&
        centerY <= host.y + host.height + marginY;

      if (contained) candidates.push(host);
    }

    if (candidates.length) {
      // Attach to the smallest valid enclosing host rather than a very large
      // ancestor bbox. This keeps grouping local to the intended part.
      const host = candidates.reduce((best, candidate) =>
        candidate.area < best.area ? candidate : best,
      );
      parent.set(child.__index, host.__index);
    }
  }

  const rootOf = (index: number) => {
    let current = index;
    const seen = new Set<number>();
    while (parent.has(current) && !seen.has(current)) {
      seen.add(current);
      current = parent.get(current)!;
    }
    return current;
  };

  const groups = new Map<number, ComponentBox[]>();
  for (const box of indexed) {
    const root = rootOf(box.__index);
    const group = groups.get(root) ?? [];
    group.push({
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
      area: box.area,
    });
    groups.set(root, group);
  }

  const grouped = [...groups.values()]
    .map(unionBoxes)
    .sort((a, b) => b.area - a.area);

  return {
    boxes: grouped,
    rawCount: boxes.length,
    mergedDecorationCount: boxes.length - grouped.length,
  };
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

export interface LabeledComponent extends ComponentBox {
  label: number;
}

export interface LabeledComponentsResult {
  components: LabeledComponent[];
  labels: Uint16Array | Uint32Array;
}

export interface LogicalComponentGroup {
  box: ComponentBox;
  area: number;
  labels: number[];
}

export interface LogicalGroupingResult {
  groups: LogicalComponentGroup[];
  rawCount: number;
  mergedDecorationCount: number;
}

/**
 * Label significant 8-connected foreground components. The label map gives
 * later stages exact pixel membership, so a union bounding box can never pull
 * unrelated neighbouring artwork into a logical part.
 */
export function labelComponents(
  mask: Uint8Array,
  width: number,
  height: number,
  minArea = 64,
): LabeledComponentsResult {
  const visited = new Uint8Array(mask.length);
  const queue = new Int32Array(mask.length);
  const provisional: Array<{ box: ComponentBox; pixels: Int32Array }> = [];

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

    if (tail < minArea) continue;
    provisional.push({
      box: {
        x: minX,
        y: minY,
        width: maxX - minX + 1,
        height: maxY - minY + 1,
        area: tail,
      },
      pixels: queue.slice(0, tail),
    });
  }

  const LabelArray = provisional.length < 65535 ? Uint16Array : Uint32Array;
  const labels = new LabelArray(mask.length);
  const components: LabeledComponent[] = provisional.map((item, index) => {
    const label = index + 1;
    for (let i = 0; i < item.pixels.length; i += 1) {
      labels[item.pixels[i]] = label;
    }
    return { ...item.box, label };
  });

  return { components, labels };
}

/**
 * Host-aware grouping with exact member labels.
 *
 * This mirrors groupDecorativeComponents() but preserves the exact component
 * labels that make up every logical part.
 */
export function groupLabeledComponents(
  components: LabeledComponent[],
  imageWidth: number,
  imageHeight: number,
  strength: SplitStrength = 'conservative',
): LogicalGroupingResult {
  if (components.length < 2) {
    return {
      groups: components.map((component) => ({
        box: {
          x: component.x,
          y: component.y,
          width: component.width,
          height: component.height,
          area: component.area,
        },
        area: component.area,
        labels: [component.label],
      })),
      rawCount: components.length,
      mergedDecorationCount: 0,
    };
  }

  const config = {
    conservative: {
      maxChildRatio: 0.22,
      minHostAreaRatio: 0.0012,
      marginRatio: 0.012,
    },
    standard: {
      maxChildRatio: 0.12,
      minHostAreaRatio: 0.0018,
      marginRatio: 0.008,
    },
    fine: {
      maxChildRatio: 0.05,
      minHostAreaRatio: 0.0025,
      marginRatio: 0.004,
    },
  }[strength];

  const imageArea = imageWidth * imageHeight;
  const indexed = components
    .map((component, index) => ({ ...component, __index: index }))
    .sort((a, b) => b.area - a.area);

  const parent = new Map<number, number>();

  for (let reverse = indexed.length - 1; reverse >= 0; reverse -= 1) {
    const child = indexed[reverse];
    const centerX = child.x + child.width / 2;
    const centerY = child.y + child.height / 2;
    const candidates: typeof indexed = [];

    for (const host of indexed) {
      if (host.__index === child.__index || host.area <= child.area) continue;
      if (host.area < imageArea * config.minHostAreaRatio) continue;
      if (child.area / host.area > config.maxChildRatio) continue;

      const marginX = Math.max(3, host.width * config.marginRatio);
      const marginY = Math.max(3, host.height * config.marginRatio);
      const contained =
        centerX >= host.x - marginX &&
        centerX <= host.x + host.width + marginX &&
        centerY >= host.y - marginY &&
        centerY <= host.y + host.height + marginY;
      if (contained) candidates.push(host);
    }

    if (candidates.length) {
      const host = candidates.reduce((best, candidate) =>
        candidate.area < best.area ? candidate : best,
      );
      parent.set(child.__index, host.__index);
    }
  }

  const rootOf = (index: number) => {
    let current = index;
    const seen = new Set<number>();
    while (parent.has(current) && !seen.has(current)) {
      seen.add(current);
      current = parent.get(current)!;
    }
    return current;
  };

  const groups = new Map<number, LabeledComponent[]>();
  for (const component of indexed) {
    const root = rootOf(component.__index);
    const group = groups.get(root) ?? [];
    group.push(component);
    groups.set(root, group);
  }

  const logicalGroups: LogicalComponentGroup[] = [...groups.values()]
    .map((members) => {
      const left = Math.min(...members.map((member) => member.x));
      const top = Math.min(...members.map((member) => member.y));
      const right = Math.max(...members.map((member) => member.x + member.width));
      const bottom = Math.max(...members.map((member) => member.y + member.height));
      const area = members.reduce((total, member) => total + member.area, 0);
      return {
        box: {
          x: left,
          y: top,
          width: right - left,
          height: bottom - top,
          area,
        },
        area,
        labels: members.map((member) => member.label),
      };
    })
    .sort((a, b) => b.area - a.area);

  return {
    groups: logicalGroups,
    rawCount: components.length,
    mergedDecorationCount: components.length - logicalGroups.length,
  };
}

/**
 * Build an exact local part mask from a component-label map. Pixels from other
 * components inside the same bounding rectangle remain zero.
 */
export function localMaskFromLabels(
  labels: Uint16Array | Uint32Array,
  sourceWidth: number,
  box: ComponentBox,
  allowedLabels: number[],
): Uint8Array {
  const allowed = new Set(allowedLabels);
  const local = new Uint8Array(box.width * box.height);

  for (let y = 0; y < box.height; y += 1) {
    const sourceY = box.y + y;
    const sourceRow = sourceY * sourceWidth + box.x;
    const targetRow = y * box.width;
    for (let x = 0; x < box.width; x += 1) {
      if (allowed.has(labels[sourceRow + x])) {
        local[targetRow + x] = 1;
      }
    }
  }
  return local;
}

/**
 * Fill all enclosed background cavities of one local logical part. Background
 * connected to the local crop border remains transparent. This preserves
 * original face/garment colours that were too close to the global background
 * colour instead of turning those internal regions into alpha holes.
 */
export function fillEnclosedInterior(
  mask: Uint8Array,
  width: number,
  height: number,
): Uint8Array {
  const output = mask.slice();
  if (!mask.length || width <= 0 || height <= 0) return output;

  const outside = new Uint8Array(mask.length);
  const queue = new Int32Array(mask.length);
  let head = 0;
  let tail = 0;

  const enqueue = (index: number) => {
    if (index < 0 || index >= mask.length || mask[index] || outside[index]) return;
    outside[index] = 1;
    queue[tail++] = index;
  };

  for (let x = 0; x < width; x += 1) {
    enqueue(x);
    if (height > 1) enqueue((height - 1) * width + x);
  }
  for (let y = 1; y < height - 1; y += 1) {
    enqueue(y * width);
    if (width > 1) enqueue(y * width + width - 1);
  }

  while (head < tail) {
    const current = queue[head++];
    const x = current % width;
    const y = Math.floor(current / width);
    if (x > 0) enqueue(current - 1);
    if (x + 1 < width) enqueue(current + 1);
    if (y > 0) enqueue(current - width);
    if (y + 1 < height) enqueue(current + width);
  }

  for (let i = 0; i < mask.length; i += 1) {
    if (!mask[i] && !outside[i]) output[i] = 1;
  }
  return output;
}
