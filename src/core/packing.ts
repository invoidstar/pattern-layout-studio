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

/**
 * Simple no-scale packing.
 * It never changes width/height. If an item cannot fit, placed=false.
 */
export function packWithoutScaling(
  items: Rectangle[],
  canvas: Canvas,
  gap = 20,
): Rectangle[] {
  let cursorX = gap;
  let cursorY = gap;
  let rowHeight = 0;

  return [...items]
    .sort((a, b) => b.width * b.height - a.width * a.height)
    .map((item) => {
      if (item.width + gap * 2 > canvas.width || item.height + gap * 2 > canvas.height) {
        return { ...item, placed: false };
      }

      if (cursorX + item.width + gap > canvas.width) {
        cursorX = gap;
        cursorY += rowHeight + gap;
        rowHeight = 0;
      }

      if (cursorY + item.height + gap > canvas.height) {
        return { ...item, placed: false };
      }

      const placed = {
        ...item,
        x: cursorX,
        y: cursorY,
        placed: true,
      };

      cursorX += item.width + gap;
      rowHeight = Math.max(rowHeight, item.height);
      return placed;
    });
}
