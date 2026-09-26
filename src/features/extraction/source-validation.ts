export const ALLOWED_SOURCE_SIZES = [
  { width: 3500, height: 3500, label: '3500 × 3500' },
  { width: 2970, height: 2100, label: 'A4 横版 · 2970 × 2100' },
  { width: 2100, height: 2970, label: 'A4 竖版 · 2100 × 2970' },
] as const;

export interface InvalidSourceSize {
  fileName: string;
  width: number;
  height: number;
}

export class InvalidSourceSizeError extends Error {
  readonly details: InvalidSourceSize;

  constructor(fileName: string, width: number, height: number) {
    super(
      `${fileName} 的尺寸为 ${width} × ${height}，不符合允许的图纸尺寸。`,
    );
    this.name = 'InvalidSourceSizeError';
    this.details = { fileName, width, height };
  }
}

export function isAllowedSourceSize(width: number, height: number) {
  return ALLOWED_SOURCE_SIZES.some(
    (size) => size.width === width && size.height === height,
  );
}

export function assertAllowedSourceSize(
  fileName: string,
  width: number,
  height: number,
) {
  if (!isAllowedSourceSize(width, height)) {
    throw new InvalidSourceSizeError(fileName, width, height);
  }
}

export const ALLOWED_SOURCE_SIZE_LABEL =
  '3500 × 3500，或 A4：2970 × 2100 / 2100 × 2970';

async function readSourceDimensions(file: File): Promise<{
  width: number;
  height: number;
}> {
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error('Image decode failed'));
      element.src = url;
    });
    return {
      width: image.naturalWidth,
      height: image.naturalHeight,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function preflightSourceFiles(files: File[]): Promise<{
  validFiles: File[];
  invalidSources: InvalidSourceSize[];
}> {
  const validFiles: File[] = [];
  const invalidSources: InvalidSourceSize[] = [];

  for (const file of files) {
    try {
      const { width, height } = await readSourceDimensions(file);
      if (isAllowedSourceSize(width, height)) {
        validFiles.push(file);
      } else {
        invalidSources.push({
          fileName: file.name,
          width,
          height,
        });
      }
    } catch {
      // Dimension preflight intentionally leaves unreadable files to the
      // normal source-processing error path, which already reports failures.
      validFiles.push(file);
    }
  }

  return { validFiles, invalidSources };
}
