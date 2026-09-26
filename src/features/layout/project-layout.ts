import type { CanvasSize, PatternPart } from '../../types';
import {
  packIntoMultiplePages,
  type PackingDiagnostics,
} from '../../core/layout/packing';
import { centerLayout } from '../../core/layout/converter';

export function arrangePartsAcrossPages(
  parts: PatternPart[],
  target: CanvasSize,
  gap: number,
) {
  const multi = packIntoMultiplePages(
    parts.map((part) => ({
      id: part.id,
      width: part.width,
      height: part.height,
    })),
    target,
    gap,
  );

  const positions = new Map<
    string,
    { x: number; y: number; pageIndex: number }
  >();

  for (const page of multi.pages) {
    const placements = page.items
      .filter((item) => item.x !== undefined && item.y !== undefined)
      .map((item) => ({
        id: item.id,
        x: item.x!,
        y: item.y!,
        width: item.width,
        height: item.height,
      }));
    const centered = centerLayout(placements, target);
    for (const item of centered) {
      positions.set(item.id, {
        x: item.x,
        y: item.y,
        pageIndex: page.pageIndex,
      });
    }
  }

  const arranged = parts.map((part) => {
    const position = positions.get(part.id);
    if (!position) {
      return {
        ...part,
        x: -part.width - gap,
        y: 0,
        pageIndex: -1,
        overflow: true,
      };
    }
    return {
      ...part,
      x: position.x,
      y: position.y,
      pageIndex: position.pageIndex,
      overflow: false,
    };
  });

  const firstPacking: PackingDiagnostics =
    multi.pages[0]?.diagnostics ?? {
      strategy: 'empty',
      placedCount: 0,
      overflowCount: 0,
      placedArea: 0,
      canvasArea: target.width * target.height,
      utilization: 0,
      boundsWidth: 0,
      boundsHeight: 0,
    };

  return {
    arranged,
    pageCount: multi.totalPages,
    unplaceableCount: multi.unplaceable.length,
    packing: firstPacking,
  };
}

export function isInside(part: PatternPart, target: CanvasSize) {
  return (
    !part.overflow &&
    part.x >= 0 &&
    part.y >= 0 &&
    part.x + part.width <= target.width &&
    part.y + part.height <= target.height
  );
}
