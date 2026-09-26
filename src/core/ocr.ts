import type { TextRegion } from './text-filter';

export interface OcrProgress {
  status: string;
  progress: number;
}

export async function detectOcrTextRegions(
  image: HTMLCanvasElement,
  onProgress?: (progress: OcrProgress) => void,
): Promise<TextRegion[]> {
  const { createWorker, PSM } = await import('tesseract.js');
  const worker = await createWorker(['eng', 'chi_sim'], 1, {
    logger: (message: { status?: string; progress?: number }) => {
      onProgress?.({
        status: message.status ?? 'OCR',
        progress: message.progress ?? 0,
      });
    },
  });

  try {
    await worker.setParameters({
      tessedit_pageseg_mode: PSM.SPARSE_TEXT,
      user_defined_dpi: '300',
    });

    const result = await worker.recognize(image, {}, { blocks: true, text: true });
    const blocks = (result.data as any).blocks ?? [];
    const regions: TextRegion[] = [];

    for (const block of blocks) {
      for (const paragraph of block.paragraphs ?? []) {
        for (const line of paragraph.lines ?? []) {
          for (const word of line.words ?? []) {
            const bbox = word.bbox;
            const text = String(word.text ?? '').trim();
            const confidence = Number(word.confidence ?? 0);
            if (!bbox || !text || confidence < 48) continue;

            const width = Math.max(1, bbox.x1 - bbox.x0);
            const height = Math.max(1, bbox.y1 - bbox.y0);
            if (height > image.height * 0.14 || width > image.width * 0.75) continue;

            regions.push({
              x: bbox.x0,
              y: bbox.y0,
              width,
              height,
              score: 10,
              source: 'ocr',
              confidence,
              text,
            });
          }
        }
      }
    }

    return regions;
  } finally {
    await worker.terminate();
  }
}
