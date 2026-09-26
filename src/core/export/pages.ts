import type { CanvasSize, PatternPart } from '../../domain';
import { canvasToPngWithDpi } from './png';

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Image decode failed during export'));
    image.src = url;
  });
}

export async function renderLayoutPage(
  parts: PatternPart[],
  target: CanvasSize,
  backgroundCss: string,
  dpi: number,
): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = target.width;
  canvas.height = target.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Export canvas unavailable');

  context.fillStyle = backgroundCss;
  context.fillRect(0, 0, target.width, target.height);

  for (const part of parts) {
    if (!part.visible || part.overflow) continue;
    const image = await loadImage(part.imageUrl);
    context.drawImage(image, part.x, part.y, part.width, part.height);
  }

  return canvasToPngWithDpi(canvas, dpi);
}

export async function buildPagesZip(
  pages: Array<{ pageIndex: number; parts: PatternPart[] }>,
  target: CanvasSize,
  backgroundCss: string,
  dpi: number,
): Promise<Blob> {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  const digits = Math.max(2, String(pages.length).length);

  for (const page of pages) {
    const blob = await renderLayoutPage(page.parts, target, backgroundCss, dpi);
    const number = String(page.pageIndex + 1).padStart(digits, '0');
    zip.file(
      `pattern-layout-p${number}-${target.width}x${target.height}-${dpi}dpi.png`,
      blob,
    );
  }

  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1200);
}
