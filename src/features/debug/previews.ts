import type { TextRegion } from '../../core/vision/text-filter';

export function makeMaskPreview(
  mask: Uint8Array,
  width: number,
  height: number,
): string {
  const maxSide = 440;
  const scale = Math.min(1, maxSide / Math.max(width, height));
  const previewWidth = Math.max(1, Math.round(width * scale));
  const previewHeight = Math.max(1, Math.round(height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = previewWidth;
  canvas.height = previewHeight;
  const context = canvas.getContext('2d')!;
  const output = context.createImageData(previewWidth, previewHeight);

  for (let y = 0; y < previewHeight; y += 1) {
    const sourceY = Math.min(height - 1, Math.floor(y / scale));
    for (let x = 0; x < previewWidth; x += 1) {
      const sourceX = Math.min(width - 1, Math.floor(x / scale));
      const on = mask[sourceY * width + sourceX] ? 255 : 0;
      const offset = (y * previewWidth + x) * 4;
      output.data[offset] = on;
      output.data[offset + 1] = on;
      output.data[offset + 2] = on;
      output.data[offset + 3] = 255;
    }
  }

  context.putImageData(output, 0, 0);
  return canvas.toDataURL('image/png');
}

export function makeTextOverlay(
  source: HTMLCanvasElement,
  regions: TextRegion[],
): string {
  const maxSide = 440;
  const scale = Math.min(1, maxSide / Math.max(source.width, source.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(source.width * scale));
  canvas.height = Math.max(1, Math.round(source.height * scale));
  const context = canvas.getContext('2d')!;
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  context.lineWidth = 2;
  context.font = '11px system-ui';

  for (const region of regions) {
    context.strokeStyle = region.source === 'ocr' ? '#e14d5a' : '#3157d7';
    context.fillStyle = region.source === 'ocr' ? '#e14d5a' : '#3157d7';
    context.strokeRect(
      region.x * scale,
      region.y * scale,
      region.width * scale,
      region.height * scale,
    );
    context.fillText(
      region.source === 'ocr' ? 'OCR' : 'GEO',
      region.x * scale,
      Math.max(11, region.y * scale - 3),
    );
  }

  return canvas.toDataURL('image/jpeg', 0.86);
}
