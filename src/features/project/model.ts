import type { MorphologyStats, SmoothingMode } from '../../core/vision/morphology';
import type { SplitStrength } from '../../core/vision/segmentation';
import type { PackingDiagnostics } from '../../core/layout/packing';

export type ToolMode = 'select' | 'brush' | 'eraser';

export interface QualityReport {
  threshold: number;
  spread: number;
  foregroundRatio: number;
  componentCount: number;
  packing: PackingDiagnostics;
  textRegions: number;
  geometryTextRegions: number;
  ocrTextRegions: number;
  morphology: MorphologyStats;
  smoothing: SmoothingMode;
  splitStrength: SplitStrength;
  rawComponentCount: number;
  mergedDecorationCount: number;
  pageCount: number;
  unplaceableCount: number;
}

export interface DebugImages {
  raw: string;
  afterText: string;
  smooth: string;
  textOverlay: string;
}

export interface PaintSession {
  partId: string;
  canvas: HTMLCanvasElement;
  source: HTMLImageElement;
  mode: 'brush' | 'eraser';
  pointerId: number;
  lastX: number;
  lastY: number;
}

export interface SourceReference {
  id: string;
  imageUrl: string;
  width: number;
  height: number;
  name: string;
  backgroundCss: string;
  debugImages: DebugImages;
}

export interface SourceProcessingMetrics {
  threshold: number;
  spread: number;
  foregroundRatio: number;
  componentCount: number;
  textRegions: number;
  geometryTextRegions: number;
  ocrTextRegions: number;
  morphology: MorphologyStats;
  rawComponentCount: number;
  mergedDecorationCount: number;
}

export interface PageStat {
  pageIndex: number;
  count: number;
  usedArea: number;
  utilization: number;
}

export interface ProcessedSourceResult {
  source: SourceReference;
  parts: import('../../types').PatternPart[];
  metrics: SourceProcessingMetrics;
}
