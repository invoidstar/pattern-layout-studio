export interface Rectangle {
  id: string;
  width: number;
  height: number;
  x?: number;
  y?: number;
}

export interface Canvas {
  width: number;
  height: number;
}

// Initial deterministic packing implementation.
// It intentionally never scales rectangles.
export function packWithoutScaling(
  items: Rectangle[],
  canvas: Canvas,
  gap = 20,
): Rectangle[] {
  let x = gap;
  let y = gap;
  let rowHeight = 0;

  return items.map((item) => {
    if (x + item.width + gap > canvas.width) {
      x = gap;
      y += rowHeight + gap;
      rowHeight = 0;
    }

    const placed = { ...item, x, y };
    x += item.width + gap;
    rowHeight = Math.max(rowHeight, item.height);
    return placed;
  });
}
