import type { CanvasSize } from '../types';

export interface PartPlacement {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export function centerLayout(
  parts: PartPlacement[],
  target: CanvasSize,
): PartPlacement[] {
  if (!parts.length) return parts;

  const minX = Math.min(...parts.map((p) => p.x));
  const minY = Math.min(...parts.map((p) => p.y));
  const maxX = Math.max(...parts.map((p) => p.x + p.width));
  const maxY = Math.max(...parts.map((p) => p.y + p.height));

  const offsetX = Math.round((target.width - (maxX - minX)) / 2 - minX);
  const offsetY = Math.round((target.height - (maxY - minY)) / 2 - minY);

  return parts.map((part) => ({
    ...part,
    x: part.x + offsetX,
    y: part.y + offsetY,
  }));
}

export function validateNoScaleFit(
  parts: PartPlacement[],
  target: CanvasSize,
): boolean {
  return parts.every(
    (part) =>
      part.x >= 0 &&
      part.y >= 0 &&
      part.x + part.width <= target.width &&
      part.y + part.height <= target.height,
  );
}
