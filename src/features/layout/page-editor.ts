import type { CanvasSize, PatternPart } from '../../types';
import { packMaxRectsWithoutScaling } from '../../core/layout/packing';
import { centerLayout } from '../../core/layout/converter';

export function packPageParts(
  pageParts: PatternPart[],
  target: CanvasSize,
  gap: number,
) {
  const result = packMaxRectsWithoutScaling(
    pageParts.map((part) => ({
      id: part.id,
      width: part.width,
      height: part.height,
    })),
    target,
    gap,
  );
  if (result.diagnostics.placedCount !== pageParts.length) return null;

  const centered = centerLayout(
    result.items
      .filter(
        (item) =>
          item.placed &&
          item.x !== undefined &&
          item.y !== undefined,
      )
      .map((item) => ({
        id: item.id,
        x: item.x!,
        y: item.y!,
        width: item.width,
        height: item.height,
      })),
    target,
  );

  return new Map(centered.map((item) => [item.id, item]));
}

export function normalizeManualPages(
  workingParts: PatternPart[],
): {
  parts: PatternPart[];
  oldToNew: Map<number, number>;
} {
  const usedPages = [...new Set(
    workingParts
      .filter(
        (part) =>
          !part.overflow &&
          (part.pageIndex ?? -1) >= 0,
      )
      .map((part) => part.pageIndex ?? 0),
  )].sort((a, b) => a - b);

  const oldToNew = new Map(
    usedPages.map((oldPage, newPage) => [oldPage, newPage]),
  );

  return {
    oldToNew,
    parts: workingParts.map((part) => {
      if (part.overflow || (part.pageIndex ?? -1) < 0) return part;
      return {
        ...part,
        pageIndex: oldToNew.get(part.pageIndex ?? 0) ?? 0,
      };
    }),
  };
}
