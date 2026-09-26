import { estimateBackgroundModel } from '../../core/vision/background';
import {
  buildForegroundMask,
  groupLabeledComponents,
  labelComponents,
  localMaskFromLabels,
  type ComponentBox,
  type SplitStrength,
} from '../../core/vision/segmentation';
import {
  smoothMask,
  type SmoothingMode,
} from '../../core/vision/morphology';
import {
  filterGeometryText,
  removeTextRegions,
  type TextFilterStrength,
  type TextRegion,
} from '../../core/vision/text-filter';
import { detectOcrTextRegions } from '../../core/vision/ocr';
import { renderPartFromLocalMask } from '../../core/vision/alpha';
import type { PatternPart, SourceRegion } from '../../domain';
import { loadImage, readFile, rgbCss } from '../editor/image-utils';
import { makeMaskPreview, makeTextOverlay } from '../debug/previews';
import type {
  ProcessedSourceResult,
  SourceProcessingMetrics,
} from '../project/model';

export interface ProcessSourceOptions {
  sourceIndex: number;
  totalSources: number;
  batchId: string;
  textExclude: boolean;
  textStrength: TextFilterStrength;
  ocrEnhanced: boolean;
  smoothing: SmoothingMode;
  splitStrength: SplitStrength;
  onStatus?: (message: string) => void;
}

function padBox(
  box: ComponentBox,
  width: number,
  height: number,
  padding = 10,
): ComponentBox {
  const x = Math.max(0, box.x - padding);
  const y = Math.max(0, box.y - padding);
  const right = Math.min(width, box.x + box.width + padding);
  const bottom = Math.min(height, box.y + box.height + padding);
  return {
    ...box,
    x,
    y,
    width: right - x,
    height: bottom - y,
  };
}

function maskRatio(mask: Uint8Array) {
  let foreground = 0;
  for (let i = 0; i < mask.length; i += 1) {
    foreground += mask[i] ? 1 : 0;
  }
  return mask.length ? foreground / mask.length : 0;
}

export async function processSourceFile(
  file: File,
  options: ProcessSourceOptions,
): Promise<ProcessedSourceResult> {
  const {
    sourceIndex,
    totalSources,
    batchId,
    textExclude,
    textStrength,
    ocrEnhanced,
    smoothing,
    splitStrength,
    onStatus,
  } = options;

  const sourceId = `${batchId}-source-${sourceIndex}`;
  const dataUrl = await readFile(file);
  const image = await loadImage(dataUrl);
  const sourceCanvas = document.createElement('canvas');
  sourceCanvas.width = image.naturalWidth;
  sourceCanvas.height = image.naturalHeight;
  const sourceContext = sourceCanvas.getContext('2d', {
    willReadFrequently: true,
  });
  if (!sourceContext) throw new Error('Canvas unavailable');

  onStatus?.(
    `正在处理 ${sourceIndex + 1}/${totalSources}：${file.name} · 背景与分割…`,
  );

  sourceContext.drawImage(image, 0, 0);
  const imageData = sourceContext.getImageData(
    0,
    0,
    sourceCanvas.width,
    sourceCanvas.height,
  );
  const background = estimateBackgroundModel(imageData);
  const backgroundCss = rgbCss(
    background.color.r,
    background.color.g,
    background.color.b,
  );

  const rawMask = buildForegroundMask(imageData, background);
  let workingMask = rawMask.slice();
  let geometryRegions: TextRegion[] = [];
  let ocrRegions: TextRegion[] = [];

  if (textExclude) {
    const geometry = filterGeometryText(
      workingMask,
      sourceCanvas.width,
      sourceCanvas.height,
      textStrength,
    );
    workingMask = geometry.mask;
    geometryRegions = geometry.regions;

    if (ocrEnhanced) {
      onStatus?.(
        `正在处理 ${sourceIndex + 1}/${totalSources}：${file.name} · OCR…`,
      );
      try {
        ocrRegions = await detectOcrTextRegions(
          sourceCanvas,
          (progress) => {
            onStatus?.(
              `图片 ${sourceIndex + 1}/${totalSources} · OCR：${progress.status} ${Math.round(progress.progress * 100)}%`,
            );
          },
        );
        const ocrFiltered = removeTextRegions(
          workingMask,
          sourceCanvas.width,
          sourceCanvas.height,
          ocrRegions,
          4,
        );
        workingMask = ocrFiltered.mask;
      } catch (error) {
        console.warn(
          `OCR enhancement failed for ${file.name}; geometry filtering remains active.`,
          error,
        );
        ocrRegions = [];
      }
    }
  }

  const afterTextMask = workingMask.slice();
  const smoothed = smoothMask(
    workingMask,
    sourceCanvas.width,
    sourceCanvas.height,
    smoothing,
  );
  const minArea = Math.max(
    96,
    Math.round(sourceCanvas.width * sourceCanvas.height * 0.00005),
  );
  const labeled = labelComponents(
    smoothed.mask,
    sourceCanvas.width,
    sourceCanvas.height,
    minArea,
  );

  if (!labeled.components.length) {
    labeled.labels.fill(1);
    labeled.components.push({
      label: 1,
      x: 0,
      y: 0,
      width: sourceCanvas.width,
      height: sourceCanvas.height,
      area: sourceCanvas.width * sourceCanvas.height,
    });
  }

  const rawComponentCount = labeled.components.length;
  const grouping = groupLabeledComponents(
    labeled.components,
    sourceCanvas.width,
    sourceCanvas.height,
    splitStrength,
  );
  const allTextRegions = [...geometryRegions, ...ocrRegions];
  const baseName = file.name.replace(/\.[^.]+$/, '');

  onStatus?.(
    `正在处理 ${sourceIndex + 1}/${totalSources}：${file.name} · 生成 ${grouping.groups.length} 个零件…`,
  );

  const parts: PatternPart[] = grouping.groups.map((group, partIndex) => {
    const rawBox = group.box;
    const box = padBox(rawBox, sourceCanvas.width, sourceCanvas.height);
    const exactLocalMask = localMaskFromLabels(
      labeled.labels,
      sourceCanvas.width,
      box,
      group.labels,
    );
    const rendered = renderPartFromLocalMask(
      sourceCanvas,
      exactLocalMask,
      box,
      smoothing,
      true,
      false,
    );
    const sourceRegion: SourceRegion = {
      sourceId,
      box: {
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
      },
      contours: rendered.sourceContours,
    };

    return {
      id: `part-${sourceId}-${partIndex}`,
      name: `${baseName} · ${partIndex + 1}`,
      sourceId,
      imageUrl: rendered.imageUrl,
      sourceImageUrl: rendered.sourceImageUrl,
      rawSourceImageUrl: rendered.rawSourceImageUrl,
      width: rendered.width,
      height: rendered.height,
      x: 0,
      y: 0,
      locked: false,
      visible: true,
      overflow: false,
      stats: {
        area: rawBox.area,
        fillRatio:
          rawBox.area / Math.max(1, rawBox.width * rawBox.height),
        textExcluded: textExclude,
        smoothingApplied: smoothing !== 'off',
        sourceBox: { ...sourceRegion.box! },
        sourceBoxes: [{ ...sourceRegion.box! }],
        sourceContours: rendered.sourceContours,
        sourceRegions: [sourceRegion],
      },
    };
  });

  const debugImages = {
    raw: makeMaskPreview(
      rawMask,
      sourceCanvas.width,
      sourceCanvas.height,
    ),
    afterText: makeMaskPreview(
      afterTextMask,
      sourceCanvas.width,
      sourceCanvas.height,
    ),
    smooth: makeMaskPreview(
      smoothed.mask,
      sourceCanvas.width,
      sourceCanvas.height,
    ),
    textOverlay: makeTextOverlay(sourceCanvas, allTextRegions),
  };

  const metrics: SourceProcessingMetrics = {
    threshold: background.threshold,
    spread: background.spread,
    foregroundRatio: maskRatio(smoothed.mask),
    componentCount: parts.length,
    textRegions: allTextRegions.length,
    geometryTextRegions: geometryRegions.length,
    ocrTextRegions: ocrRegions.length,
    morphology: smoothed.stats,
    rawComponentCount,
    mergedDecorationCount: grouping.mergedDecorationCount,
  };

  return {
    source: {
      id: sourceId,
      imageUrl: dataUrl,
      width: sourceCanvas.width,
      height: sourceCanvas.height,
      name: file.name,
      backgroundCss,
      debugImages,
    },
    parts,
    metrics,
  };
}
