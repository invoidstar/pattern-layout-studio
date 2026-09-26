import type { ComponentBox } from './segmentation';
import { fillEnclosedInterior } from './segmentation';
import type { SmoothingMode } from './morphology';
import { holeContoursForMode, outerContoursForMode } from './contour';
import type { SourcePoint } from '../../domain';

export interface RenderedPart {
  imageUrl: string;
  sourceImageUrl: string;
  rawSourceImageUrl: string;
  width: number;
  height: number;
  sourceContours: SourcePoint[][];
}

function extractLocalMask(
  globalMask: Uint8Array,
  sourceWidth: number,
  box: ComponentBox,
): Uint8Array {
  const local = new Uint8Array(box.width * box.height);
  for (let y = 0; y < box.height; y += 1) {
    const sourceRow = (box.y + y) * sourceWidth + box.x;
    const targetRow = y * box.width;
    for (let x = 0; x < box.width; x += 1) {
      local[targetRow + x] = globalMask[sourceRow + x];
    }
  }
  return local;
}

function rasterBinaryMask(
  mask: Uint8Array,
  width: number,
  height: number,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d')!;
  const image = context.createImageData(width, height);

  for (let i = 0; i < mask.length; i += 1) {
    const alpha = mask[i] ? 255 : 0;
    const offset = i * 4;
    image.data[offset] = 255;
    image.data[offset + 1] = 255;
    image.data[offset + 2] = 255;
    image.data[offset + 3] = alpha;
  }
  context.putImageData(image, 0, 0);
  return canvas;
}

function rasterMask(
  mask: Uint8Array,
  width: number,
  height: number,
  mode: SmoothingMode,
  preserveHoles: boolean,
): HTMLCanvasElement {
  if (mode === 'off') return rasterBinaryMask(mask, width, height);

  const contours = outerContoursForMode(mask, width, height, mode);
  if (!contours.length) return rasterBinaryMask(mask, width, height);
  const holes = preserveHoles
    ? holeContoursForMode(mask, width, height, mode)
    : [];

  const scale = mode === 'strong' ? 4 : 3;
  const hi = document.createElement('canvas');
  hi.width = Math.max(1, width * scale);
  hi.height = Math.max(1, height * scale);
  const hiContext = hi.getContext('2d')!;
  hiContext.scale(scale, scale);
  hiContext.fillStyle = '#fff';
  hiContext.beginPath();

  for (const contour of contours) {
    hiContext.moveTo(contour[0].x + 0.5, contour[0].y + 0.5);
    for (let i = 1; i < contour.length; i += 1) {
      hiContext.lineTo(contour[i].x + 0.5, contour[i].y + 0.5);
    }
    hiContext.closePath();
  }

  for (const hole of holes) {
    hiContext.moveTo(hole[0].x + 0.5, hole[0].y + 0.5);
    for (let i = 1; i < hole.length; i += 1) {
      hiContext.lineTo(hole[i].x + 0.5, hole[i].y + 0.5);
    }
    hiContext.closePath();
  }

  hiContext.fill(preserveHoles ? 'evenodd' : 'nonzero');

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d')!;
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(hi, 0, 0, width, height);
  return canvas;
}

function rawSourceCrop(
  sourceCanvas: HTMLCanvasElement,
  box: ComponentBox,
): HTMLCanvasElement {
  const sourceCrop = document.createElement('canvas');
  sourceCrop.width = box.width;
  sourceCrop.height = box.height;
  const context = sourceCrop.getContext('2d')!;
  context.drawImage(
    sourceCanvas,
    box.x,
    box.y,
    box.width,
    box.height,
    0,
    0,
    box.width,
    box.height,
  );
  return sourceCrop;
}

function sourceContours(
  mask: Uint8Array,
  width: number,
  height: number,
  box: ComponentBox,
  mode: SmoothingMode,
): SourcePoint[][] {
  return outerContoursForMode(mask, width, height, mode).map((contour) =>
    contour.map((point) => ({
      x: point.x + box.x,
      y: point.y + box.y,
    })),
  );
}

/**
 * Render one logical part from an exact local membership mask.
 *
 * The local mask contains only pixels belonging to the selected component
 * labels, so unrelated foreground inside the same bounding rectangle is never
 * copied into this part.
 *
 * preserveInternalColors=true fills enclosed zero-regions before alpha
 * generation. This keeps original face/garment colours that were too close to
 * the global background colour instead of punching transparent holes through
 * the part.
 */
export function renderPartFromLocalMask(
  sourceCanvas: HTMLCanvasElement,
  localMask: Uint8Array,
  box: ComponentBox,
  mode: SmoothingMode,
  preserveInternalColors = true,
  preserveHoles = false,
): RenderedPart {
  const shapeMask =
    preserveInternalColors && !preserveHoles
      ? fillEnclosedInterior(localMask, box.width, box.height)
      : localMask.slice();

  const alpha = rasterMask(
    shapeMask,
    box.width,
    box.height,
    mode,
    preserveHoles,
  );
  const rawCrop = rawSourceCrop(sourceCanvas, box);

  const part = document.createElement('canvas');
  part.width = box.width;
  part.height = box.height;
  const partContext = part.getContext('2d')!;
  partContext.drawImage(rawCrop, 0, 0);
  partContext.globalCompositeOperation = 'destination-in';
  partContext.drawImage(alpha, 0, 0);
  partContext.globalCompositeOperation = 'source-over';

  return {
    imageUrl: part.toDataURL('image/png'),
    sourceImageUrl: part.toDataURL('image/png'),
    rawSourceImageUrl: rawCrop.toDataURL('image/png'),
    width: box.width,
    height: box.height,
    sourceContours: sourceContours(
      shapeMask,
      box.width,
      box.height,
      box,
      mode,
    ),
  };
}

/**
 * Backwards-compatible wrapper for callers that still provide a full global
 * mask. New extraction code should prefer renderPartFromLocalMask().
 */
export function renderPart(
  sourceCanvas: HTMLCanvasElement,
  globalMask: Uint8Array,
  _restoreMask: Uint8Array,
  sourceWidth: number,
  box: ComponentBox,
  mode: SmoothingMode,
): RenderedPart {
  const localMask = extractLocalMask(globalMask, sourceWidth, box);
  return renderPartFromLocalMask(sourceCanvas, localMask, box, mode, true, false);
}
