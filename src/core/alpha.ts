import type { ComponentBox } from './segmentation';
import type { SmoothingMode } from './morphology';
import { holeContoursForMode, outerContoursForMode } from './contour';

export interface RenderedPart {
  imageUrl: string;
  sourceImageUrl: string;
  width: number;
  height: number;
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
): HTMLCanvasElement {
  if (mode === 'off') return rasterBinaryMask(mask, width, height);

  const contours = outerContoursForMode(mask, width, height, mode);
  if (!contours.length) return rasterBinaryMask(mask, width, height);
  const holes = holeContoursForMode(mask, width, height, mode);

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
  hiContext.fill('evenodd');

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d')!;
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(hi, 0, 0, width, height);
  return canvas;
}

function maskedSourceCrop(
  sourceCanvas: HTMLCanvasElement,
  sourceWidth: number,
  box: ComponentBox,
  restoreMask: Uint8Array,
): HTMLCanvasElement {
  const sourceCrop = document.createElement('canvas');
  sourceCrop.width = box.width;
  sourceCrop.height = box.height;
  const sourceContext = sourceCrop.getContext('2d')!;
  sourceContext.drawImage(
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

  const localRestore = extractLocalMask(restoreMask, sourceWidth, box);
  sourceContext.globalCompositeOperation = 'destination-in';
  sourceContext.drawImage(
    rasterBinaryMask(localRestore, box.width, box.height),
    0,
    0,
  );
  sourceContext.globalCompositeOperation = 'source-over';
  return sourceCrop;
}

export function renderPart(
  sourceCanvas: HTMLCanvasElement,
  globalMask: Uint8Array,
  restoreMask: Uint8Array,
  sourceWidth: number,
  box: ComponentBox,
  mode: SmoothingMode,
): RenderedPart {
  const localMask = extractLocalMask(globalMask, sourceWidth, box);
  const alpha = rasterMask(localMask, box.width, box.height, mode);
  const sourceCrop = maskedSourceCrop(
    sourceCanvas,
    sourceWidth,
    box,
    restoreMask,
  );

  const part = document.createElement('canvas');
  part.width = box.width;
  part.height = box.height;
  const partContext = part.getContext('2d')!;
  partContext.drawImage(sourceCrop, 0, 0);
  partContext.globalCompositeOperation = 'destination-in';
  partContext.drawImage(alpha, 0, 0);
  partContext.globalCompositeOperation = 'source-over';

  return {
    imageUrl: part.toDataURL('image/png'),
    sourceImageUrl: sourceCrop.toDataURL('image/png'),
    width: box.width,
    height: box.height,
  };
}
