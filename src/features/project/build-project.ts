import type { CanvasSize } from '../../domain';
import type { SmoothingMode } from '../../core/vision/morphology';
import type { SplitStrength } from '../../core/vision/segmentation';
import type { TextFilterStrength } from '../../core/vision/text-filter';
import { processSourceFile } from '../extraction/process-source';
import { arrangePartsAcrossPages } from '../layout/project-layout';
import type {
  ProcessedSourceResult,
  QualityReport,
  SourceProcessingMetrics,
  SourceReference,
} from './model';
import type { PatternPart } from '../../domain';
import type { MorphologyStats } from '../../core/vision/morphology';
import {
  InvalidSourceSizeError,
  type InvalidSourceSize,
} from '../extraction/source-validation';

export interface BuildProjectOptions {
  targetKey: 'square' | 'a4';
  targets: Record<'square' | 'a4', CanvasSize>;
  packingGap: number;
  textExclude: boolean;
  textStrength: TextFilterStrength;
  ocrEnhanced: boolean;
  smoothing: SmoothingMode;
  splitStrength: SplitStrength;
  onStatus?: (message: string) => void;
}

export interface BuiltProject {
  targetKey: 'square' | 'a4';
  parts: PatternPart[];
  sources: SourceReference[];
  quality: QualityReport;
  sourceInfo: string;
  backgroundCss: string;
  failedFiles: string[];
  invalidSources: InvalidSourceSize[];
}

export class NoValidSourceError extends Error {
  readonly invalidSources: InvalidSourceSize[];
  readonly failedFiles: string[];

  constructor(
    invalidSources: InvalidSourceSize[],
    failedFiles: string[],
  ) {
    super(
      invalidSources.length
        ? '没有符合尺寸要求的图纸可继续处理。'
        : '所有图片均处理失败。',
    );
    this.name = 'NoValidSourceError';
    this.invalidSources = invalidSources;
    this.failedFiles = failedFiles;
  }
}

function aggregateMorphology(
  results: ProcessedSourceResult[],
): MorphologyStats {
  return results.reduce<MorphologyStats>(
    (total, result) => ({
      removedIslandCount:
        total.removedIslandCount +
        result.metrics.morphology.removedIslandCount,
      removedIslandPixels:
        total.removedIslandPixels +
        result.metrics.morphology.removedIslandPixels,
      filledHoleCount:
        total.filledHoleCount +
        result.metrics.morphology.filledHoleCount,
      filledHolePixels:
        total.filledHolePixels +
        result.metrics.morphology.filledHolePixels,
    }),
    {
      removedIslandCount: 0,
      removedIslandPixels: 0,
      filledHoleCount: 0,
      filledHolePixels: 0,
    },
  );
}

export async function buildProjectFromFiles(
  files: File[],
  options: BuildProjectOptions,
): Promise<BuiltProject> {
  if (!files.length) throw new Error('没有可处理的图片');

  const batchId = `batch-${Date.now()}`;
  const results: ProcessedSourceResult[] = [];
  const failedFiles: string[] = [];
  const invalidSources: InvalidSourceSize[] = [];

  for (let index = 0; index < files.length; index += 1) {
    try {
      const result = await processSourceFile(files[index], {
        sourceIndex: index,
        totalSources: files.length,
        batchId,
        textExclude: options.textExclude,
        textStrength: options.textStrength,
        ocrEnhanced: options.ocrEnhanced,
        smoothing: options.smoothing,
        splitStrength: options.splitStrength,
        onStatus: options.onStatus,
      });
      results.push(result);
    } catch (error) {
      if (error instanceof InvalidSourceSizeError) {
        invalidSources.push(error.details);
        options.onStatus?.(
          `已过滤尺寸不合规图纸：${error.details.fileName} · ${error.details.width} × ${error.details.height}`,
        );
        continue;
      }

      console.error(`Failed to process ${files[index].name}`, error);
      failedFiles.push(files[index].name);
    }
  }

  if (!results.length) {
    throw new NoValidSourceError(invalidSources, failedFiles);
  }

  const allParts = results.flatMap((result) => result.parts);
  let targetKey = options.targetKey;

  if (results.length === 1) {
    const source = results[0].source;
    if (source.width === 3500 && source.height === 3500) {
      targetKey = 'a4';
    }
    if (source.width === 2970 && source.height === 2100) {
      targetKey = 'square';
    }
  }

  const target = options.targets[targetKey];
  options.onStatus?.(
    `已完成 ${results.length} 张图片拆件，正在统一优化 ${allParts.length} 个零件的分页…`,
  );
  const arranged = arrangePartsAcrossPages(
    allParts,
    target,
    options.packingGap,
  );

  const average = (
    pick: (metrics: SourceProcessingMetrics) => number,
  ) =>
    results.reduce(
      (total, result) => total + pick(result.metrics),
      0,
    ) / Math.max(1, results.length);

  const sum = (
    pick: (metrics: SourceProcessingMetrics) => number,
  ) =>
    results.reduce(
      (total, result) => total + pick(result.metrics),
      0,
    );

  const sources = results.map((result) => result.source);
  const quality: QualityReport = {
    threshold: average((metrics) => metrics.threshold),
    spread: average((metrics) => metrics.spread),
    foregroundRatio: average((metrics) => metrics.foregroundRatio),
    componentCount: allParts.length,
    packing: arranged.packing,
    textRegions: sum((metrics) => metrics.textRegions),
    geometryTextRegions: sum(
      (metrics) => metrics.geometryTextRegions,
    ),
    ocrTextRegions: sum((metrics) => metrics.ocrTextRegions),
    morphology: aggregateMorphology(results),
    smoothing: options.smoothing,
    splitStrength: options.splitStrength,
    rawComponentCount: sum((metrics) => metrics.rawComponentCount),
    mergedDecorationCount: sum(
      (metrics) => metrics.mergedDecorationCount,
    ),
    pageCount: arranged.pageCount,
    unplaceableCount: arranged.unplaceableCount,
  };

  return {
    targetKey,
    parts: arranged.arranged,
    sources,
    quality,
    sourceInfo:
      `${results.length} 张有效图纸 · ${allParts.length} 个零件${invalidSources.length ? ` · ${invalidSources.length} 张尺寸过滤` : ''}${failedFiles.length ? ` · ${failedFiles.length} 张失败` : ''}`,
    backgroundCss: sources[0].backgroundCss,
    failedFiles,
    invalidSources,
  };
}
