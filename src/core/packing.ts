export interface Rectangle {
  id: string;
  width: number;
  height: number;
  x?: number;
  y?: number;
  placed?: boolean;
}

export interface Canvas {
  width: number;
  height: number;
}

interface FreeRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PackingDiagnostics {
  strategy: string;
  placedCount: number;
  overflowCount: number;
  placedArea: number;
  canvasArea: number;
  utilization: number;
  boundsWidth: number;
  boundsHeight: number;
}

export interface PackingResult {
  items: Rectangle[];
  diagnostics: PackingDiagnostics;
}

function intersects(a: FreeRect, b: FreeRect): boolean {
  return !(
    b.x >= a.x + a.width ||
    b.x + b.width <= a.x ||
    b.y >= a.y + a.height ||
    b.y + b.height <= a.y
  );
}

function contains(outer: FreeRect, inner: FreeRect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

function splitFreeRects(freeRects: FreeRect[], used: FreeRect): FreeRect[] {
  const next: FreeRect[] = [];

  for (const free of freeRects) {
    if (!intersects(free, used)) {
      next.push(free);
      continue;
    }

    if (used.x > free.x) {
      next.push({
        x: free.x,
        y: free.y,
        width: used.x - free.x,
        height: free.height,
      });
    }

    const freeRight = free.x + free.width;
    const usedRight = used.x + used.width;
    if (usedRight < freeRight) {
      next.push({
        x: usedRight,
        y: free.y,
        width: freeRight - usedRight,
        height: free.height,
      });
    }

    if (used.y > free.y) {
      next.push({
        x: free.x,
        y: free.y,
        width: free.width,
        height: used.y - free.y,
      });
    }

    const freeBottom = free.y + free.height;
    const usedBottom = used.y + used.height;
    if (usedBottom < freeBottom) {
      next.push({
        x: free.x,
        y: usedBottom,
        width: free.width,
        height: freeBottom - usedBottom,
      });
    }
  }

  const valid = next.filter((rect) => rect.width > 0 && rect.height > 0);
  return valid.filter(
    (rect, index) =>
      !valid.some(
        (other, otherIndex) =>
          index !== otherIndex && contains(other, rect),
      ),
  );
}

type Strategy = {
  name: string;
  sort: (a: Rectangle, b: Rectangle) => number;
};

const STRATEGIES: Strategy[] = [
  {
    name: 'area',
    sort: (a, b) => b.width * b.height - a.width * a.height,
  },
  {
    name: 'max-side',
    sort: (a, b) =>
      Math.max(b.width, b.height) - Math.max(a.width, a.height),
  },
  {
    name: 'height',
    sort: (a, b) => b.height - a.height || b.width - a.width,
  },
  {
    name: 'width',
    sort: (a, b) => b.width - a.width || b.height - a.height,
  },
];

function runStrategy(
  source: Rectangle[],
  canvas: Canvas,
  gap: number,
  strategy: Strategy,
): PackingResult {
  const inner: FreeRect = {
    x: gap,
    y: gap,
    width: Math.max(0, canvas.width - gap * 2),
    height: Math.max(0, canvas.height - gap * 2),
  };

  let freeRects: FreeRect[] = inner.width && inner.height ? [inner] : [];
  const placements = new Map<string, Rectangle>();
  const sorted = [...source].sort(strategy.sort);

  for (const item of sorted) {
    const paddedWidth = item.width + gap;
    const paddedHeight = item.height + gap;

    let best:
      | {
          free: FreeRect;
          shortSide: number;
          longSide: number;
        }
      | undefined;

    for (const free of freeRects) {
      if (paddedWidth > free.width || paddedHeight > free.height) continue;

      const remainingWidth = free.width - paddedWidth;
      const remainingHeight = free.height - paddedHeight;
      const shortSide = Math.min(remainingWidth, remainingHeight);
      const longSide = Math.max(remainingWidth, remainingHeight);

      if (
        !best ||
        shortSide < best.shortSide ||
        (shortSide === best.shortSide && longSide < best.longSide) ||
        (shortSide === best.shortSide &&
          longSide === best.longSide &&
          (free.y < best.free.y ||
            (free.y === best.free.y && free.x < best.free.x)))
      ) {
        best = { free, shortSide, longSide };
      }
    }

    if (!best) continue;

    const placement: Rectangle = {
      ...item,
      x: best.free.x,
      y: best.free.y,
      placed: true,
    };
    placements.set(item.id, placement);

    freeRects = splitFreeRects(freeRects, {
      x: best.free.x,
      y: best.free.y,
      width: paddedWidth,
      height: paddedHeight,
    });
  }

  const items = source.map((item) => placements.get(item.id) ?? { ...item, placed: false });
  const placed = items.filter(
    (item): item is Rectangle & { x: number; y: number } =>
      Boolean(item.placed) && item.x !== undefined && item.y !== undefined,
  );
  const placedArea = placed.reduce((total, item) => total + item.width * item.height, 0);
  const minX = placed.length ? Math.min(...placed.map((item) => item.x)) : 0;
  const minY = placed.length ? Math.min(...placed.map((item) => item.y)) : 0;
  const maxX = placed.length
    ? Math.max(...placed.map((item) => item.x + item.width))
    : 0;
  const maxY = placed.length
    ? Math.max(...placed.map((item) => item.y + item.height))
    : 0;

  return {
    items,
    diagnostics: {
      strategy: strategy.name,
      placedCount: placed.length,
      overflowCount: source.length - placed.length,
      placedArea,
      canvasArea: canvas.width * canvas.height,
      utilization:
        canvas.width && canvas.height
          ? placedArea / (canvas.width * canvas.height)
          : 0,
      boundsWidth: Math.max(0, maxX - minX),
      boundsHeight: Math.max(0, maxY - minY),
    },
  };
}

function isBetter(candidate: PackingResult, current: PackingResult): boolean {
  const a = candidate.diagnostics;
  const b = current.diagnostics;

  if (a.placedCount !== b.placedCount) return a.placedCount > b.placedCount;
  if (a.placedArea !== b.placedArea) return a.placedArea > b.placedArea;

  const aBounds = a.boundsWidth * a.boundsHeight;
  const bBounds = b.boundsWidth * b.boundsHeight;
  if (aBounds !== bBounds) return aBounds < bBounds;

  return a.boundsHeight < b.boundsHeight;
}

/**
 * Packing V2: multi-strategy MaxRects Best-Short-Side-Fit.
 *
 * Width and height are never modified. The gap is represented by packing
 * padded rectangles, so placed pixel dimensions remain exactly 1:1.
 */
export function packMaxRectsWithoutScaling(
  items: Rectangle[],
  canvas: Canvas,
  gap = 20,
): PackingResult {
  if (!items.length) {
    return {
      items: [],
      diagnostics: {
        strategy: 'empty',
        placedCount: 0,
        overflowCount: 0,
        placedArea: 0,
        canvasArea: canvas.width * canvas.height,
        utilization: 0,
        boundsWidth: 0,
        boundsHeight: 0,
      },
    };
  }

  let best = runStrategy(items, canvas, gap, STRATEGIES[0]);
  for (let index = 1; index < STRATEGIES.length; index += 1) {
    const candidate = runStrategy(items, canvas, gap, STRATEGIES[index]);
    if (isBetter(candidate, best)) best = candidate;
  }
  return best;
}

// Backwards-compatible API.
export function packWithoutScaling(
  items: Rectangle[],
  canvas: Canvas,
  gap = 20,
): Rectangle[] {
  return packMaxRectsWithoutScaling(items, canvas, gap).items;
}

export interface PackedPage {
  pageIndex: number;
  items: Rectangle[];
  diagnostics: PackingDiagnostics;
}

export interface MultiPagePackingResult {
  pages: PackedPage[];
  unplaceable: Rectangle[];
  totalPages: number;
  placedCount: number;
}

/**
 * Packing V3: repeatedly run the existing no-scale MaxRects solver until all
 * placeable rectangles have been assigned to pages.
 *
 * A rectangle is only returned as unplaceable when a fresh empty page cannot
 * accept it. No width/height is ever changed.
 */
export function packIntoMultiplePages(
  items: Rectangle[],
  canvas: Canvas,
  gap = 20,
): MultiPagePackingResult {
  let remaining = items.map((item) => ({ ...item, x: undefined, y: undefined, placed: undefined }));
  const pages: PackedPage[] = [];
  let safety = 0;

  while (remaining.length && safety < items.length + 4) {
    safety += 1;
    const result = packMaxRectsWithoutScaling(remaining, canvas, gap);
    const placed = result.items.filter(
      (item) => item.placed && item.x !== undefined && item.y !== undefined,
    );

    if (!placed.length) break;

    pages.push({
      pageIndex: pages.length,
      items: placed.map((item) => ({ ...item })),
      diagnostics: {
        ...result.diagnostics,
        placedCount: placed.length,
        overflowCount: 0,
      },
    });

    const placedIds = new Set(placed.map((item) => item.id));
    remaining = remaining
      .filter((item) => !placedIds.has(item.id))
      .map((item) => ({ ...item, x: undefined, y: undefined, placed: undefined }));
  }

  // Verify unresolved items individually. This distinguishes a true
  // over-size part from an unlucky multi-item heuristic outcome.
  const unplaceable: Rectangle[] = [];
  for (const item of remaining) {
    const single = packMaxRectsWithoutScaling([item], canvas, gap);
    const candidate = single.items[0];
    if (candidate?.placed && candidate.x !== undefined && candidate.y !== undefined) {
      pages.push({
        pageIndex: pages.length,
        items: [{ ...candidate }],
        diagnostics: {
          ...single.diagnostics,
          placedCount: 1,
          overflowCount: 0,
        },
      });
    } else if (item.width <= canvas.width && item.height <= canvas.height) {
      // The part itself fits, but the normal packing margin/gap does not.
      // Give it a dedicated page with no artificial edge gap.
      const dedicated = {
        ...item,
        x: Math.round((canvas.width - item.width) / 2),
        y: Math.round((canvas.height - item.height) / 2),
        placed: true,
      };
      pages.push({
        pageIndex: pages.length,
        items: [dedicated],
        diagnostics: {
          strategy: 'dedicated-fit',
          placedCount: 1,
          overflowCount: 0,
          placedArea: item.width * item.height,
          canvasArea: canvas.width * canvas.height,
          utilization:
            (item.width * item.height) / Math.max(1, canvas.width * canvas.height),
          boundsWidth: item.width,
          boundsHeight: item.height,
        },
      });
    } else {
      unplaceable.push({ ...item, placed: false });
    }
  }

  const placedCount = pages.reduce((total, page) => total + page.items.length, 0);
  return {
    pages,
    unplaceable,
    totalPages: pages.length,
    placedCount,
  };
}
