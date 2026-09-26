import type { ComponentBox } from './segmentation';
import type { SmoothingMode } from './morphology';
import { contourForMode } from './contour';

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

function rasterMask(
  mask: Uint8Array,
  width: number,
  height: number,
  mode: SmoothingMode,
): HTMLCanvasElement {
  if (mode === 'off') {
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

  const contour = contourForMode(mask, width, height, mode);
  if (contour.length < 3) return rasterMask(mask, width, height, 'off');

  // Supersampling gives a clean 1px anti-aliased boundary while the logical
  // width/height stay exactly unchanged.
  const scale = mode === 'strong' ? 4 : 3;
  const hi = document.createElement('canvas');
  hi.width = Math.max(1, width * scale);
  hi.height = Math.max(1, height * scale);
  const hiContext = hi.getContext('2d')!;
  hiContext.scale(scale, scale);
  hiContext.fillStyle = '#fff';
  hiContext.beginPath();
  hiContext.moveTo(contour[0].x + 0.5, contour[0].y + 0.5);
  for (let i = 1; i < contour.length; i += 1) {
    hiContext.lineTo(contour[i].x + 0.5, contour[i].y + 0.5);
  }
  hiContext.closePath();
  hiContext.fill();

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d')!;
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(hi, 0, 0, width, height);
  return canvas;
}

export function renderPart(
  sourceCanvas: HTMLCanvasElement,
  globalMask: Uint8Array,
  sourceWidth: number,
  box: ComponentBox,
  mode: SmoothingMode,
): RenderedPart {
  const localMask = extractLocalMask(globalMask, sourceWidth, box);
  const alpha = rasterMask(localMask, box.width, box.height, mode);

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
