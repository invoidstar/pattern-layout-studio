import { useEffect, useMemo, useRef, useState } from 'react';
import { estimateBackgroundModel } from './core/background';
import {
  buildForegroundMask,
  extractComponents,
  groupLabeledComponents,
  labelComponents,
  localMaskFromLabels,
  type ComponentBox,
  type SplitStrength,
} from './core/segmentation';
import { smoothMask, type SmoothingMode, type MorphologyStats } from './core/morphology';
import {
  filterGeometryText,
  removeTextRegions,
  type TextFilterStrength,
  type TextRegion,
} from './core/text-filter';
import { detectOcrTextRegions } from './core/ocr';
import { renderPartFromLocalMask } from './core/alpha';
import { outerContoursForMode } from './core/contour';
import {
  packIntoMultiplePages,
  packMaxRectsWithoutScaling,
  type PackingDiagnostics,
} from './core/packing';
import { centerLayout, validateNoScaleFit } from './core/converter';
import { buildPagesZip, downloadBlob, renderLayoutPage } from './core/export';
import type {
  CanvasSize,
  PatternPart,
  SourceBox,
  SourcePoint,
  SourceRegion,
} from './types';

const TARGETS: Record<'square' | 'a4', CanvasSize> = {
  square: { width: 3500, height: 3500, label: '3500 × 3500' },
  a4: { width: 2970, height: 2100, label: '2970 × 2100' },
};

const GAP = 24;
const HISTORY_LIMIT = 12;

type ToolMode = 'select' | 'brush' | 'eraser';

interface QualityReport {
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

interface DebugImages {
  raw: string;
  afterText: string;
  smooth: string;
  textOverlay: string;
}

interface PaintSession {
  partId: string;
  canvas: HTMLCanvasElement;
  source: HTMLImageElement;
  mode: 'brush' | 'eraser';
  pointerId: number;
  lastX: number;
  lastY: number;
}

interface SourceReference {
  id: string;
  imageUrl: string;
  width: number;
  height: number;
  name: string;
  backgroundCss: string;
  debugImages: DebugImages;
}

interface SourceProcessingMetrics {
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

interface ProcessedSourceResult {
  source: SourceReference;
  parts: PatternPart[];
  metrics: SourceProcessingMetrics;
}

function rgbCss(r: number, g: number, b: number) {
  return `rgb(${r}, ${g}, ${b})`;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Image decode failed'));
    image.src = url;
  });
}

function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('File read failed'));
    reader.readAsDataURL(file);
  });
}

function cloneParts(parts: PatternPart[]): PatternPart[] {
  return parts.map((part) => ({
    ...part,
    stats: part.stats
      ? {
          ...part.stats,
          sourceBox: part.stats.sourceBox ? { ...part.stats.sourceBox } : undefined,
          sourceBoxes: part.stats.sourceBoxes
            ? part.stats.sourceBoxes.map((box) => ({ ...box }))
            : undefined,
          sourceContours: part.stats.sourceContours
            ? part.stats.sourceContours.map((contour) =>
                contour.map((point) => ({ ...point })),
              )
            : undefined,
          sourceRegions: part.stats.sourceRegions
            ? part.stats.sourceRegions.map((region) => ({
                ...region,
                box: region.box ? { ...region.box } : undefined,
                contours: region.contours
                  ? region.contours.map((contour) =>
                      contour.map((point) => ({ ...point })),
                    )
                  : undefined,
              }))
            : undefined,
        }
      : undefined,
  }));
}

function sourceRegionsFor(part: PatternPart): SourceRegion[] {
  if (part.stats?.sourceRegions?.length) {
    return part.stats.sourceRegions.map((region) => ({
      ...region,
      box: region.box ? { ...region.box } : undefined,
      contours: region.contours
        ? region.contours.map((contour) =>
            contour.map((point) => ({ ...point })),
          )
        : undefined,
    }));
  }

  if (!part.sourceId) return [];
  const boxes = part.stats?.sourceBoxes?.length
    ? part.stats.sourceBoxes
    : part.stats?.sourceBox
      ? [part.stats.sourceBox]
      : [];

  if (boxes.length) {
    return boxes.map((box, index) => ({
      sourceId: part.sourceId!,
      box: { ...box },
      contours:
        index === 0 && part.stats?.sourceContours?.length
          ? part.stats.sourceContours.map((contour) =>
              contour.map((point) => ({ ...point })),
            )
          : undefined,
    }));
  }

  return part.stats?.sourceContours?.length
    ? [{
        sourceId: part.sourceId,
        contours: part.stats.sourceContours.map((contour) =>
          contour.map((point) => ({ ...point })),
        ),
      }]
    : [];
}

function sourceBoxesFor(part: PatternPart, sourceId?: string): SourceBox[] {
  const regions = sourceRegionsFor(part).filter(
    (region) => !sourceId || region.sourceId === sourceId,
  );
  const boxes = regions
    .map((region) => region.box)
    .filter((box): box is SourceBox => Boolean(box));
  if (boxes.length) return boxes;

  if (sourceId && part.sourceId !== sourceId) return [];
  if (part.stats?.sourceBoxes?.length) {
    return part.stats.sourceBoxes.map((box) => ({ ...box }));
  }
  return part.stats?.sourceBox ? [{ ...part.stats.sourceBox }] : [];
}

function unionSourceBoxes(boxes: SourceBox[]): SourceBox | undefined {
  if (!boxes.length) return undefined;
  const left = Math.min(...boxes.map((box) => box.x));
  const top = Math.min(...boxes.map((box) => box.y));
  const right = Math.max(...boxes.map((box) => box.x + box.width));
  const bottom = Math.max(...boxes.map((box) => box.y + box.height));
  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  };
}

function padBox(box: ComponentBox, width: number, height: number, padding = 10): ComponentBox {
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
  for (let i = 0; i < mask.length; i += 1) foreground += mask[i] ? 1 : 0;
  return mask.length ? foreground / mask.length : 0;
}

function arrangePartsAcrossPages(
  parts: PatternPart[],
  target: CanvasSize,
  gap = GAP,
) {
  const multi = packIntoMultiplePages(
    parts.map((part) => ({ id: part.id, width: part.width, height: part.height })),
    target,
    gap,
  );

  const positions = new Map<
    string,
    { x: number; y: number; pageIndex: number }
  >();

  for (const page of multi.pages) {
    const placements = page.items
      .filter((item) => item.x !== undefined && item.y !== undefined)
      .map((item) => ({
        id: item.id,
        x: item.x!,
        y: item.y!,
        width: item.width,
        height: item.height,
      }));
    const centered = centerLayout(placements, target);
    for (const item of centered) {
      positions.set(item.id, {
        x: item.x,
        y: item.y,
        pageIndex: page.pageIndex,
      });
    }
  }

  const arranged = parts.map((part) => {
    const position = positions.get(part.id);
    if (!position) {
      return {
        ...part,
        x: -part.width - GAP,
        y: 0,
        pageIndex: -1,
        overflow: true,
      };
    }
    return {
      ...part,
      x: position.x,
      y: position.y,
      pageIndex: position.pageIndex,
      overflow: false,
    };
  });

  const firstPacking: PackingDiagnostics =
    multi.pages[0]?.diagnostics ?? {
      strategy: 'empty',
      placedCount: 0,
      overflowCount: 0,
      placedArea: 0,
      canvasArea: target.width * target.height,
      utilization: 0,
      boundsWidth: 0,
      boundsHeight: 0,
    };

  return {
    arranged,
    pageCount: multi.totalPages,
    unplaceableCount: multi.unplaceable.length,
    packing: firstPacking,
  };
}

function isInside(part: PatternPart, target: CanvasSize) {
  return (
    !part.overflow &&
    part.x >= 0 &&
    part.y >= 0 &&
    part.x + part.width <= target.width &&
    part.y + part.height <= target.height
  );
}

function makeMaskPreview(
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

function makeTextOverlay(
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

function cropCanvas(
  image: HTMLImageElement,
  box: ComponentBox,
): string {
  const canvas = document.createElement('canvas');
  canvas.width = box.width;
  canvas.height = box.height;
  const context = canvas.getContext('2d')!;
  context.drawImage(
    image,
    box.x,
    box.y,
    box.width,
    box.height,
    0,
    0,
    box.width,
    box.height,
  );
  return canvas.toDataURL('image/png');
}

export default function App() {
  const [parts, setParts] = useState<PatternPart[]>([]);
  const [targetKey, setTargetKey] = useState<'square' | 'a4'>('a4');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [backgroundCss, setBackgroundCss] = useState('#aaaaaa');
  const [sourceInfo, setSourceInfo] = useState('尚未上传图片');
  const [status, setStatus] = useState('V1.6：跨页移动、全局分页优化、精确形状裁切与来源追踪已启用。');
  const [dpi, setDpi] = useState(300);
  const [busy, setBusy] = useState(false);
  const [renderTick, setRenderTick] = useState(0);
  const [quality, setQuality] = useState<QualityReport | null>(null);
  const [textExclude, setTextExclude] = useState(true);
  const [textStrength, setTextStrength] = useState<TextFilterStrength>('medium');
  const [ocrEnhanced, setOcrEnhanced] = useState(false);
  const [smoothing, setSmoothing] = useState<SmoothingMode>('standard');
  const [splitStrength, setSplitStrength] = useState<SplitStrength>('conservative');
  const [debugOpen, setDebugOpen] = useState(false);
  const [debugImages, setDebugImages] = useState<DebugImages | null>(null);
  const [tool, setTool] = useState<ToolMode>('select');
  const [brushSize, setBrushSize] = useState(28);
  const [historyTick, setHistoryTick] = useState(0);
  const [currentPageIndex, setCurrentPageIndex] = useState(0);
  const [sourceReferences, setSourceReferences] = useState<SourceReference[]>([]);
  const [activeSourceId, setActiveSourceId] = useState<string | null>(null);
  const [packingGap, setPackingGap] = useState(16);
  const [moveTargetPage, setMoveTargetPage] = useState(0);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imageCacheRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const dragRef = useRef<{ id: string; offsetX: number; offsetY: number } | null>(null);
  const paintRef = useRef<PaintSession | null>(null);
  const undoRef = useRef<PatternPart[][]>([]);
  const redoRef = useRef<PatternPart[][]>([]);

  const target = TARGETS[targetKey];
  const selectedPart = parts.find((part) => part.id === selectedIds[0]) ?? null;
  const pageCount = useMemo(() => {
    const placed = parts.filter((part) => !part.overflow && (part.pageIndex ?? 0) >= 0);
    if (!placed.length) return 0;
    return Math.max(...placed.map((part) => part.pageIndex ?? 0)) + 1;
  }, [parts]);
  const currentPageParts = useMemo(
    () =>
      parts.filter(
        (part) =>
          !part.overflow &&
          (part.pageIndex ?? 0) === currentPageIndex,
      ),
    [parts, currentPageIndex],
  );
  const unplaceableCount = parts.filter((part) => part.overflow).length;
  const activeSource = useMemo(
    () =>
      sourceReferences.find((source) => source.id === activeSourceId) ??
      sourceReferences[0] ??
      null,
    [sourceReferences, activeSourceId],
  );
  const pageStats = useMemo(
    () =>
      Array.from({ length: pageCount }, (_, pageIndex) => {
        const pageParts = parts.filter(
          (part) =>
            !part.overflow &&
            (part.pageIndex ?? 0) === pageIndex,
        );
        const usedArea = pageParts.reduce(
          (total, part) => total + part.width * part.height,
          0,
        );
        return {
          pageIndex,
          count: pageParts.length,
          usedArea,
          utilization:
            usedArea / Math.max(1, target.width * target.height),
        };
      }),
    [parts, pageCount, target],
  );
  const currentPageStats = pageStats[currentPageIndex];
  const overallUtilization = pageCount
    ? pageStats.reduce((total, page) => total + page.usedArea, 0) /
      Math.max(1, pageCount * target.width * target.height)
    : 0;
  const sourceTraceItems = useMemo(
    () => {
      if (!activeSource) return [];
      return currentPageParts.flatMap((part) =>
        sourceRegionsFor(part)
          .filter((region) => region.sourceId === activeSource.id)
          .flatMap((region, regionIndex) => {
            if (region.contours?.length) {
              return region.contours.map((contour, contourIndex) => ({
                part,
                contour,
                box: region.box,
                index: regionIndex * 1000 + contourIndex,
              }));
            }
            return region.box
              ? [{
                  part,
                  contour: undefined as SourcePoint[] | undefined,
                  box: region.box,
                  index: regionIndex,
                }]
              : [];
          }),
      );
    },
    [currentPageParts, activeSource],
  );
  const selectedSourceBoxes = useMemo(
    () => {
      if (!activeSource) return [];
      return parts
        .filter((part) => selectedIds.includes(part.id))
        .flatMap((part) => sourceBoxesFor(part, activeSource.id));
    },
    [parts, selectedIds, activeSource],
  );
  const selectedSourceRegionCount = useMemo(
    () =>
      parts
        .filter((part) => selectedIds.includes(part.id))
        .reduce(
          (total, part) => total + sourceRegionsFor(part).length,
          0,
        ),
    [parts, selectedIds],
  );

  const preview = useMemo(() => {
    const maxWidth = 820;
    const maxHeight = 600;
    const scale = Math.min(maxWidth / target.width, maxHeight / target.height);
    return {
      width: Math.round(target.width * scale),
      height: Math.round(target.height * scale),
    };
  }, [target]);

  useEffect(() => {
    setDebugImages(activeSource?.debugImages ?? null);
  }, [activeSource]);

  useEffect(() => {
    const firstSelected = parts.find((part) => selectedIds.includes(part.id));
    if (!firstSelected) return;
    const sourceId =
      sourceRegionsFor(firstSelected)[0]?.sourceId ??
      firstSelected.sourceId;
    if (sourceId && sourceId !== activeSourceId) {
      setActiveSourceId(sourceId);
    }
  }, [selectedIds, parts, activeSourceId]);

  useEffect(() => {
    if (pageCount > 0 && currentPageIndex >= pageCount) {
      setCurrentPageIndex(pageCount - 1);
      setSelectedIds([]);
    }
    if (pageCount > 0 && moveTargetPage > pageCount) {
      setMoveTargetPage(pageCount - 1);
    }
  }, [pageCount, currentPageIndex, moveTargetPage]);

  function goToPage(index: number) {
    if (!pageCount) return;
    const next = Math.max(0, Math.min(pageCount - 1, index));
    setCurrentPageIndex(next);
    setMoveTargetPage(next);
    setSelectedIds([]);
    paintRef.current = null;
    dragRef.current = null;
  }

  function sourceLabelFor(part: PatternPart) {
    const ids = [...new Set(
      sourceRegionsFor(part).map((region) => region.sourceId),
    )];
    if (!ids.length && part.sourceId) ids.push(part.sourceId);
    return ids
      .map((id) => {
        const index = sourceReferences.findIndex((source) => source.id === id);
        return index >= 0 ? `S${index + 1}` : 'Source';
      })
      .join('+');
  }

  function pushHistory(snapshot = parts) {
    undoRef.current.push(cloneParts(snapshot));
    if (undoRef.current.length > HISTORY_LIMIT) undoRef.current.shift();
    redoRef.current = [];
    setHistoryTick((value) => value + 1);
  }

  function undo() {
    const previous = undoRef.current.pop();
    if (!previous) return;
    redoRef.current.push(cloneParts(parts));
    setParts(previous);
    setSelectedIds([]);
    imageCacheRef.current.clear();
    setHistoryTick((value) => value + 1);
    setStatus('已撤销上一步编辑。');
  }

  function redo() {
    const next = redoRef.current.pop();
    if (!next) return;
    undoRef.current.push(cloneParts(parts));
    setParts(next);
    setSelectedIds([]);
    imageCacheRef.current.clear();
    setHistoryTick((value) => value + 1);
    setStatus('已恢复上一步编辑。');
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(preview.width * dpr);
    canvas.height = Math.round(preview.height * dpr);
    canvas.style.width = `${preview.width}px`;
    canvas.style.height = `${preview.height}px`;

    const context = canvas.getContext('2d');
    if (!context) return;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, preview.width, preview.height);
    context.fillStyle = backgroundCss;
    context.fillRect(0, 0, preview.width, preview.height);

    const sx = preview.width / target.width;
    const sy = preview.height / target.height;
    const paint = paintRef.current;

    for (const part of currentPageParts) {
      if (!part.visible || part.overflow) continue;

      let drawable: CanvasImageSource | null = null;
      if (paint?.partId === part.id) {
        drawable = paint.canvas;
      } else {
        let image = imageCacheRef.current.get(part.imageUrl);
        if (!image) {
          image = new Image();
          image.onload = () => setRenderTick((value) => value + 1);
          image.src = part.imageUrl;
          imageCacheRef.current.set(part.imageUrl, image);
        }
        if (image.complete && image.naturalWidth > 0) drawable = image;
      }

      if (drawable) {
        context.drawImage(
          drawable,
          part.x * sx,
          part.y * sy,
          part.width * sx,
          part.height * sy,
        );
      }

      if (selectedIds.includes(part.id)) {
        context.save();
        context.strokeStyle = part.locked ? '#f59e0b' : selectedIds.length > 1 ? '#7c3aed' : '#2563eb';
        context.lineWidth = 2;
        context.setLineDash(part.locked ? [7, 5] : []);
        context.strokeRect(
          part.x * sx + 1,
          part.y * sy + 1,
          Math.max(0, part.width * sx - 2),
          Math.max(0, part.height * sy - 2),
        );
        context.restore();
      }
    }
  }, [currentPageParts, target, backgroundCss, selectedIds, preview, renderTick]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const element = event.target as HTMLElement | null;
      if (element && ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName)) return;

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }

      if ((event.key === 'Delete' || event.key === 'Backspace') && selectedIds.length) {
        event.preventDefault();
        deleteSelected();
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedIds, parts]);

  async function processSourceFile(
    file: File,
    sourceIndex: number,
    totalSources: number,
    batchId: string,
  ): Promise<ProcessedSourceResult> {
    const sourceId = `${batchId}-source-${sourceIndex}`;
    const dataUrl = await readFile(file);
    const image = await loadImage(dataUrl);
    const sourceCanvas = document.createElement('canvas');
    sourceCanvas.width = image.naturalWidth;
    sourceCanvas.height = image.naturalHeight;
    const sourceContext = sourceCanvas.getContext('2d', { willReadFrequently: true });
    if (!sourceContext) throw new Error('Canvas unavailable');

    setStatus(
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
    const sourceBackgroundCss = rgbCss(
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
        setStatus(
          `正在处理 ${sourceIndex + 1}/${totalSources}：${file.name} · OCR…`,
        );
        try {
          ocrRegions = await detectOcrTextRegions(sourceCanvas, (progress) => {
            setStatus(
              `图片 ${sourceIndex + 1}/${totalSources} · OCR：${progress.status} ${Math.round(progress.progress * 100)}%`,
            );
          });
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

    setStatus(
      `正在处理 ${sourceIndex + 1}/${totalSources}：${file.name} · 生成 ${grouping.groups.length} 个零件…`,
    );

    const extracted: PatternPart[] = grouping.groups.map((group, partIndex) => {
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
          fillRatio: rawBox.area / Math.max(1, rawBox.width * rawBox.height),
          textExcluded: textExclude,
          smoothingApplied: smoothing !== 'off',
          sourceBox: { ...sourceRegion.box! },
          sourceBoxes: [{ ...sourceRegion.box! }],
          sourceContours: rendered.sourceContours,
          sourceRegions: [sourceRegion],
        },
      };
    });

    const debugImages: DebugImages = {
      raw: makeMaskPreview(rawMask, sourceCanvas.width, sourceCanvas.height),
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

    return {
      source: {
        id: sourceId,
        imageUrl: dataUrl,
        width: sourceCanvas.width,
        height: sourceCanvas.height,
        name: file.name,
        backgroundCss: sourceBackgroundCss,
        debugImages,
      },
      parts: extracted,
      metrics: {
        threshold: background.threshold,
        spread: background.spread,
        foregroundRatio: maskRatio(smoothed.mask),
        componentCount: extracted.length,
        textRegions: allTextRegions.length,
        geometryTextRegions: geometryRegions.length,
        ocrTextRegions: ocrRegions.length,
        morphology: smoothed.stats,
        rawComponentCount,
        mergedDecorationCount: grouping.mergedDecorationCount,
      },
    };
  }

  async function processFiles(files: File[]) {
    if (!files.length) return;

    setBusy(true);
    setSelectedIds([]);
    setQuality(null);
    setDebugImages(null);
    setSourceReferences([]);
    setActiveSourceId(null);
    undoRef.current = [];
    redoRef.current = [];
    setHistoryTick((value) => value + 1);
    setCurrentPageIndex(0);
    setStatus(`准备处理 ${files.length} 张图片并统一排版…`);

    try {
      const batchId = `batch-${Date.now()}`;
      const results: ProcessedSourceResult[] = [];
      const failed: string[] = [];

      for (let index = 0; index < files.length; index += 1) {
        try {
          const result = await processSourceFile(
            files[index],
            index,
            files.length,
            batchId,
          );
          results.push(result);
        } catch (error) {
          console.error(`Failed to process ${files[index].name}`, error);
          failed.push(files[index].name);
        }
      }

      if (!results.length) {
        throw new Error('所有图片均处理失败');
      }

      const allParts = results.flatMap((result) => result.parts);
      let nextTargetKey: 'square' | 'a4' = targetKey;

      // Keep the old single-image convenience rule. Multi-image projects keep
      // the currently selected output canvas because the sources can differ.
      if (results.length === 1) {
        const source = results[0].source;
        if (source.width === 3500 && source.height === 3500) nextTargetKey = 'a4';
        if (source.width === 2970 && source.height === 2100) nextTargetKey = 'square';
      }

      const nextTarget = TARGETS[nextTargetKey];
      setStatus(
        `已完成 ${results.length} 张图片拆件，正在统一优化 ${allParts.length} 个零件的分页…`,
      );
      const arrangedResult = arrangePartsAcrossPages(
        allParts,
        nextTarget,
        packingGap,
      );

      const average = (
        pick: (metrics: SourceProcessingMetrics) => number,
      ) =>
        results.reduce((total, result) => total + pick(result.metrics), 0) /
        Math.max(1, results.length);
      const sum = (
        pick: (metrics: SourceProcessingMetrics) => number,
      ) =>
        results.reduce((total, result) => total + pick(result.metrics), 0);

      const morphology = results.reduce<MorphologyStats>(
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

      const sources = results.map((result) => result.source);
      imageCacheRef.current.clear();
      setTargetKey(nextTargetKey);
      setParts(arrangedResult.arranged);
      setSourceReferences(sources);
      setActiveSourceId(sources[0].id);
      setDebugImages(sources[0].debugImages);
      setBackgroundCss(sources[0].backgroundCss);
      setSourceInfo(
        `${results.length} 张图片 · ${allParts.length} 个零件${failed.length ? ` · ${failed.length} 张失败` : ''}`,
      );
      setQuality({
        threshold: average((metrics) => metrics.threshold),
        spread: average((metrics) => metrics.spread),
        foregroundRatio: average((metrics) => metrics.foregroundRatio),
        componentCount: allParts.length,
        packing: arrangedResult.packing,
        textRegions: sum((metrics) => metrics.textRegions),
        geometryTextRegions: sum((metrics) => metrics.geometryTextRegions),
        ocrTextRegions: sum((metrics) => metrics.ocrTextRegions),
        morphology,
        smoothing,
        splitStrength,
        rawComponentCount: sum((metrics) => metrics.rawComponentCount),
        mergedDecorationCount: sum(
          (metrics) => metrics.mergedDecorationCount,
        ),
        pageCount: arrangedResult.pageCount,
        unplaceableCount: arrangedResult.unplaceableCount,
      });

      setStatus(
        arrangedResult.unplaceableCount
          ? `V1.7 完成：${results.length} 张图片的 ${allParts.length} 个零件已统一排成 ${arrangedResult.pageCount} 页；${arrangedResult.unplaceableCount} 个零件尺寸超过目标画布。`
          : `V1.7 完成：${results.length} 张图片、${allParts.length} 个零件已统一全局优化为 ${arrangedResult.pageCount} 页。${failed.length ? ` 另有 ${failed.length} 张图片处理失败。` : ''}`,
      );
    } catch (error) {
      console.error(error);
      setStatus(
        `批量处理失败：${error instanceof Error ? error.message : '未知错误'}`,
      );
    } finally {
      setBusy(false);
    }
  }

  function relayout(nextKey = targetKey) {
    if (!parts.length) return;
    pushHistory();
    const nextTarget = TARGETS[nextKey];
    const arrangedResult = arrangePartsAcrossPages(
      parts,
      nextTarget,
      packingGap,
    );
    setTargetKey(nextKey);
    setParts(arrangedResult.arranged);
    setCurrentPageIndex(0);
    setSelectedIds([]);
    setQuality((current) =>
      current
        ? {
            ...current,
            packing: arrangedResult.packing,
            pageCount: arrangedResult.pageCount,
            unplaceableCount: arrangedResult.unplaceableCount,
          }
        : current,
    );
    setStatus(
      arrangedResult.unplaceableCount
        ? `已重新分页：共 ${arrangedResult.pageCount} 页，另有 ${arrangedResult.unplaceableCount} 个超大零件无法放入。`
        : `已按 ${nextTarget.label} 重新自动分页：共 ${arrangedResult.pageCount} 页，所有零件保持 1:1。`,
    );
  }

  function packPageParts(pageParts: PatternPart[]) {
    const result = packMaxRectsWithoutScaling(
      pageParts.map((part) => ({
        id: part.id,
        width: part.width,
        height: part.height,
      })),
      target,
      packingGap,
    );
    if (result.diagnostics.placedCount !== pageParts.length) return null;

    const centered = centerLayout(
      result.items
        .filter(
          (item) =>
            item.placed &&
            item.x !== undefined &&
            item.y !== undefined,
        )
        .map((item) => ({
          id: item.id,
          x: item.x!,
          y: item.y!,
          width: item.width,
          height: item.height,
        })),
      target,
    );
    return new Map(centered.map((item) => [item.id, item]));
  }

  function normalizeManualPages(
    workingParts: PatternPart[],
  ): {
    parts: PatternPart[];
    oldToNew: Map<number, number>;
  } {
    const usedPages = [...new Set(
      workingParts
        .filter((part) => !part.overflow && (part.pageIndex ?? -1) >= 0)
        .map((part) => part.pageIndex ?? 0),
    )].sort((a, b) => a - b);

    const oldToNew = new Map(
      usedPages.map((oldPage, newPage) => [oldPage, newPage]),
    );

    return {
      oldToNew,
      parts: workingParts.map((part) => {
        if (part.overflow || (part.pageIndex ?? -1) < 0) return part;
        return {
          ...part,
          pageIndex: oldToNew.get(part.pageIndex ?? 0) ?? 0,
        };
      }),
    };
  }

  function moveSelectedToPage(targetPageIndex: number) {
    const selected = parts.filter(
      (part) => selectedIds.includes(part.id) && !part.overflow,
    );
    if (!selected.length) {
      setStatus('请先选择需要跨页移动的零件。');
      return;
    }

    const requestedPage = Math.max(0, Math.min(pageCount, targetPageIndex));
    const sourcePages = new Set(
      selected.map((part) => part.pageIndex ?? 0),
    );

    if (
      requestedPage < pageCount &&
      selected.every((part) => (part.pageIndex ?? 0) === requestedPage)
    ) {
      setStatus(`所选零件已经位于 Page ${requestedPage + 1}。`);
      return;
    }

    const selectedIdsSet = new Set(selected.map((part) => part.id));
    const targetExisting =
      requestedPage < pageCount
        ? parts.filter(
            (part) =>
              !part.overflow &&
              !selectedIdsSet.has(part.id) &&
              (part.pageIndex ?? 0) === requestedPage,
          )
        : [];

    const targetPack = packPageParts([...targetExisting, ...selected]);
    if (!targetPack) {
      setStatus(
        `Page ${requestedPage + 1} 无法完整容纳所选 ${selected.length} 个零件；布局未改变。`,
      );
      return;
    }

    pushHistory();

    let nextParts = parts.map((part) => {
      const targetPosition = targetPack.get(part.id);
      if (targetPosition) {
        return {
          ...part,
          x: targetPosition.x,
          y: targetPosition.y,
          pageIndex: requestedPage,
          overflow: false,
        };
      }
      return part;
    });

    // Repack every source page after removing the moved parts.
    for (const sourcePage of sourcePages) {
      if (sourcePage === requestedPage) continue;
      const remaining = nextParts.filter(
        (part) =>
          !part.overflow &&
          !selectedIdsSet.has(part.id) &&
          (part.pageIndex ?? 0) === sourcePage,
      );
      if (!remaining.length) continue;
      const sourcePack = packPageParts(remaining);
      if (!sourcePack) continue;
      nextParts = nextParts.map((part) => {
        const position = sourcePack.get(part.id);
        return position
          ? { ...part, x: position.x, y: position.y }
          : part;
      });
    }

    const normalized = normalizeManualPages(nextParts);
    const normalizedTarget =
      normalized.oldToNew.get(requestedPage) ??
      Math.max(0, normalized.oldToNew.size - 1);

    setParts(normalized.parts);
    setCurrentPageIndex(normalizedTarget);
    setMoveTargetPage(normalizedTarget);
    setSelectedIds(selected.map((part) => part.id));
    setStatus(
      `已将 ${selected.length} 个零件移动到 Page ${normalizedTarget + 1}，并自动整理目标页与源页。`,
    );
  }

  function pointerPosition(event: React.PointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * target.width,
      y: ((event.clientY - rect.top) / rect.height) * target.height,
    };
  }

  function hitPart(point: { x: number; y: number }) {
    return [...currentPageParts]
      .reverse()
      .find(
        (part) =>
          part.visible &&
          !part.overflow &&
          point.x >= part.x &&
          point.y >= part.y &&
          point.x <= part.x + part.width &&
          point.y <= part.y + part.height,
      );
  }

  async function startPaint(
    part: PatternPart,
    point: { x: number; y: number },
    mode: 'brush' | 'eraser',
    pointerId: number,
    canvasElement: HTMLCanvasElement,
  ) {
    pushHistory();
    const currentImage = await loadImage(part.imageUrl);
    const sourceImage = await loadImage(
      part.rawSourceImageUrl ?? part.sourceImageUrl ?? part.imageUrl,
    );
    const editCanvas = document.createElement('canvas');
    editCanvas.width = part.width;
    editCanvas.height = part.height;
    editCanvas.getContext('2d')!.drawImage(currentImage, 0, 0, part.width, part.height);

    const localX = point.x - part.x;
    const localY = point.y - part.y;
    paintRef.current = {
      partId: part.id,
      canvas: editCanvas,
      source: sourceImage,
      mode,
      pointerId,
      lastX: localX,
      lastY: localY,
    };
    if (!canvasElement.hasPointerCapture(pointerId)) {
      canvasElement.setPointerCapture(pointerId);
    }
    applyPaintAt(localX, localY);
    setRenderTick((value) => value + 1);
  }

  function applyPaintAt(localX: number, localY: number) {
    const session = paintRef.current;
    if (!session) return;
    const context = session.canvas.getContext('2d')!;
    const radius = Math.max(2, brushSize / 2);

    context.save();
    context.beginPath();
    context.arc(localX, localY, radius, 0, Math.PI * 2);
    context.clip();

    if (session.mode === 'eraser') {
      context.globalCompositeOperation = 'destination-out';
      context.fillStyle = '#000';
      context.fillRect(localX - radius, localY - radius, radius * 2, radius * 2);
    } else {
      context.globalCompositeOperation = 'source-over';
      context.drawImage(
        session.source,
        0,
        0,
        session.canvas.width,
        session.canvas.height,
      );
    }
    context.restore();
  }

  function applyPaintLine(localX: number, localY: number) {
    const session = paintRef.current;
    if (!session) return;

    const dx = localX - session.lastX;
    const dy = localY - session.lastY;
    const distance = Math.hypot(dx, dy);
    const spacing = Math.max(1, brushSize * 0.18);
    const steps = Math.max(1, Math.ceil(distance / spacing));

    for (let step = 1; step <= steps; step += 1) {
      const ratio = step / steps;
      applyPaintAt(
        session.lastX + dx * ratio,
        session.lastY + dy * ratio,
      );
    }

    session.lastX = localX;
    session.lastY = localY;
    setRenderTick((value) => value + 1);
  }

  async function handlePointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    const point = pointerPosition(event);
    const hit = hitPart(point);

    if (tool !== 'select') {
      const editTarget =
        (selectedPart && !selectedPart.locked && !selectedPart.overflow ? selectedPart : hit);
      if (!editTarget || editTarget.locked) return;
      if (!selectedIds.includes(editTarget.id)) setSelectedIds([editTarget.id]);
      await startPaint(
        editTarget,
        point,
        tool,
        event.pointerId,
        event.currentTarget,
      );
      return;
    }

    if (!hit) {
      setSelectedIds([]);
      dragRef.current = null;
      return;
    }

    if (event.ctrlKey || event.metaKey || event.shiftKey) {
      setSelectedIds((current) =>
        current.includes(hit.id)
          ? current.filter((id) => id !== hit.id)
          : [...current, hit.id],
      );
      return;
    }

    setSelectedIds([hit.id]);
    if (!hit.locked) {
      pushHistory();
      dragRef.current = {
        id: hit.id,
        offsetX: point.x - hit.x,
        offsetY: point.y - hit.y,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
    }
  }

  function handlePointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    const point = pointerPosition(event);
    const paint = paintRef.current;
    if (paint && paint.pointerId === event.pointerId) {
      const part = parts.find((item) => item.id === paint.partId);
      if (part) applyPaintLine(point.x - part.x, point.y - part.y);
      return;
    }

    const drag = dragRef.current;
    if (!drag) return;
    setParts((current) =>
      current.map((part) => {
        if (part.id !== drag.id || part.locked) return part;
        const maxX = Math.max(0, target.width - part.width);
        const maxY = Math.max(0, target.height - part.height);
        return {
          ...part,
          x: Math.round(Math.min(maxX, Math.max(0, point.x - drag.offsetX))),
          y: Math.round(Math.min(maxY, Math.max(0, point.y - drag.offsetY))),
          pageIndex: part.pageIndex ?? currentPageIndex,
          overflow: false,
        };
      }),
    );
  }

  function stopInteraction(event: React.PointerEvent<HTMLCanvasElement>) {
    const paint = paintRef.current;
    if (paint && paint.pointerId === event.pointerId) {
      const imageUrl = paint.canvas.toDataURL('image/png');
      imageCacheRef.current.clear();
      setParts((current) =>
        current.map((part) =>
          part.id === paint.partId ? { ...part, imageUrl } : part,
        ),
      );
      paintRef.current = null;
    }

    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function toggleSelectedLock() {
    if (!selectedIds.length) return;
    pushHistory();
    setParts((current) =>
      current.map((part) =>
        selectedIds.includes(part.id) ? { ...part, locked: !part.locked } : part,
      ),
    );
  }

  function deleteSelected() {
    if (!selectedIds.length) return;
    pushHistory();
    setParts((current) => current.filter((part) => !selectedIds.includes(part.id)));
    setSelectedIds([]);
    setStatus(`已删除 ${selectedIds.length} 个零件。`);
  }

  async function mergeSelected() {
    const selected = parts.filter((part) => selectedIds.includes(part.id) && !part.overflow);
    if (selected.length < 2) {
      setStatus('合并至少需要选择两个零件。按 Ctrl / Shift 点击可多选。');
      return;
    }

    pushHistory();
    setBusy(true);
    try {
      const minX = Math.min(...selected.map((part) => part.x));
      const minY = Math.min(...selected.map((part) => part.y));
      const maxX = Math.max(...selected.map((part) => part.x + part.width));
      const maxY = Math.max(...selected.map((part) => part.y + part.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(maxX - minX);
      canvas.height = Math.ceil(maxY - minY);
      const context = canvas.getContext('2d')!;

      for (const part of selected) {
        const image = await loadImage(part.imageUrl);
        context.drawImage(image, part.x - minX, part.y - minY, part.width, part.height);
      }

      const mergedUrl = canvas.toDataURL('image/png');
      const mergedSourceRegions = selected.flatMap((part) =>
        sourceRegionsFor(part),
      );
      const mergedSourceIds = [...new Set(
        mergedSourceRegions.map((region) => region.sourceId),
      )];
      const singleSourceId =
        mergedSourceIds.length === 1 ? mergedSourceIds[0] : undefined;
      const sameSourceRegions = singleSourceId
        ? mergedSourceRegions.filter(
            (region) => region.sourceId === singleSourceId,
          )
        : [];
      const mergedSourceBoxes = sameSourceRegions
        .map((region) => region.box)
        .filter((box): box is SourceBox => Boolean(box));
      const mergedSourceBox = unionSourceBoxes(mergedSourceBoxes);
      const mergedSourceContours = sameSourceRegions.flatMap(
        (region) => region.contours ?? [],
      );

      const merged: PatternPart = {
        id: `merged-${Date.now()}`,
        name: `合并零件 ${selected.length}`,
        sourceId: singleSourceId,
        imageUrl: mergedUrl,
        sourceImageUrl: mergedUrl,
        rawSourceImageUrl: mergedUrl,
        width: canvas.width,
        height: canvas.height,
        x: minX,
        y: minY,
        locked: false,
        visible: true,
        pageIndex: currentPageIndex,
        overflow: false,
        stats: {
          smoothingApplied: true,
          sourceBox: mergedSourceBox,
          sourceBoxes: mergedSourceBoxes,
          sourceContours: mergedSourceContours,
          sourceRegions: mergedSourceRegions,
        },
      };

      setParts((current) => [
        ...current.filter((part) => !selectedIds.includes(part.id)),
        merged,
      ]);
      setSelectedIds([merged.id]);
      imageCacheRef.current.clear();
      setStatus(`已合并 ${selected.length} 个零件。`);
    } finally {
      setBusy(false);
    }
  }

  async function splitSelected() {
    if (!selectedPart) return;
    setBusy(true);
    try {
      const image = await loadImage(selectedPart.imageUrl);
      const canvas = document.createElement('canvas');
      canvas.width = selectedPart.width;
      canvas.height = selectedPart.height;
      const context = canvas.getContext('2d', { willReadFrequently: true })!;
      context.drawImage(image, 0, 0);
      const data = context.getImageData(0, 0, canvas.width, canvas.height);
      const mask = new Uint8Array(canvas.width * canvas.height);
      for (let i = 0; i < mask.length; i += 1) {
        mask[i] = data.data[i * 4 + 3] > 24 ? 1 : 0;
      }

      const boxes = extractComponents(
        mask,
        canvas.width,
        canvas.height,
        Math.max(12, Math.round(canvas.width * canvas.height * 0.00002)),
      );

      if (boxes.length <= 1) {
        setStatus('当前零件只有一个连通区域。可先用橡皮擦切开，再执行“拆分”。');
        return;
      }

      pushHistory();
      const parentSourceRegions = sourceRegionsFor(selectedPart);
      const exactParentRegion =
        parentSourceRegions.length === 1 &&
        parentSourceRegions[0].box
          ? parentSourceRegions[0]
          : undefined;
      const rawParent = await loadImage(
        selectedPart.rawSourceImageUrl ??
          selectedPart.sourceImageUrl ??
          selectedPart.imageUrl,
      );
      const pieces: PatternPart[] = boxes.map((box, index) => {
        const pieceUrl = cropCanvas(image, box);
        const rawPieceUrl = cropCanvas(rawParent, box);
        const mappedSourceBox =
          exactParentRegion?.box
            ? {
                x: exactParentRegion.box.x + box.x,
                y: exactParentRegion.box.y + box.y,
                width: box.width,
                height: box.height,
              }
            : undefined;
        const mappedSourceId =
          exactParentRegion?.sourceId ?? selectedPart.sourceId;

        const childMask = new Uint8Array(box.width * box.height);
        for (let y = 0; y < box.height; y += 1) {
          for (let x = 0; x < box.width; x += 1) {
            childMask[y * box.width + x] =
              mask[(box.y + y) * canvas.width + box.x + x];
          }
        }

        const mappedContours =
          mappedSourceBox
            ? outerContoursForMode(
                childMask,
                box.width,
                box.height,
                'off',
              ).map((contour) =>
                contour.map((point) => ({
                  x: mappedSourceBox.x + point.x,
                  y: mappedSourceBox.y + point.y,
                })),
              )
            : undefined;
        const childSourceRegions: SourceRegion[] =
          mappedSourceBox && mappedSourceId
            ? [{
                sourceId: mappedSourceId,
                box: mappedSourceBox,
                contours: mappedContours,
              }]
            : parentSourceRegions;

        return {
          id: `split-${Date.now()}-${index}`,
          name: `${selectedPart.name} · ${index + 1}`,
          sourceId: mappedSourceId,
          imageUrl: pieceUrl,
          sourceImageUrl: pieceUrl,
          rawSourceImageUrl: rawPieceUrl,
          width: box.width,
          height: box.height,
          x: selectedPart.x + box.x,
          y: selectedPart.y + box.y,
          locked: false,
          visible: true,
          pageIndex: selectedPart.pageIndex ?? currentPageIndex,
          overflow: false,
          stats: {
            ...(selectedPart.stats ?? {}),
            sourceBox:
              mappedSourceBox ??
              (childSourceRegions.length === 1
                ? childSourceRegions[0].box
                : undefined),
            sourceBoxes: childSourceRegions
              .map((region) => region.box)
              .filter((sourceBox): sourceBox is SourceBox => Boolean(sourceBox)),
            sourceContours:
              mappedContours ??
              (childSourceRegions.length === 1
                ? childSourceRegions[0].contours
                : undefined),
            sourceRegions: childSourceRegions,
          },
        };
      });

      setParts((current) =>
        current.flatMap((part) =>
          part.id === selectedPart.id ? pieces : [part],
        ),
      );
      setSelectedIds(pieces.map((part) => part.id));
      imageCacheRef.current.delete(selectedPart.imageUrl);
      setStatus(
        `已将原零件原子替换为 ${pieces.length} 个子零件，父零件不会残留。`,
      );
    } finally {
      setBusy(false);
    }
  }

  async function exportCurrent() {
    if (!currentPageParts.length) return;
    const visible = currentPageParts.filter((part) => part.visible);

    const placements = visible.map(({ id, x, y, width, height }) => ({
      id,
      x,
      y,
      width,
      height,
    }));
    if (!validateNoScaleFit(placements, target)) {
      setStatus('当前页导出已阻止：仍有零件超出画布边界。');
      return;
    }

    setBusy(true);
    setStatus(`正在生成第 ${currentPageIndex + 1} 页 PNG…`);
    try {
      const blob = await renderLayoutPage(visible, target, backgroundCss, dpi);
      const digits = Math.max(2, String(Math.max(1, pageCount)).length);
      const pageNumber = String(currentPageIndex + 1).padStart(digits, '0');
      downloadBlob(
        blob,
        `pattern-layout-p${pageNumber}-${target.width}x${target.height}-${dpi}dpi.png`,
      );
      setStatus(
        `第 ${currentPageIndex + 1}/${pageCount} 页 PNG 已生成 · ${dpi} DPI · 1:1 零件尺寸。`,
      );
    } catch (error) {
      console.error(error);
      setStatus(`导出失败：${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      setBusy(false);
    }
  }

  async function exportAllPages() {
    if (!pageCount) return;
    setBusy(true);
    setStatus(`正在生成 ${pageCount} 页 PNG 并打包 ZIP…`);

    try {
      const pages = Array.from({ length: pageCount }, (_, pageIndex) => ({
        pageIndex,
        parts: parts.filter(
          (part) =>
            part.visible &&
            !part.overflow &&
            (part.pageIndex ?? 0) === pageIndex,
        ),
      }));
      const blob = await buildPagesZip(
        pages,
        target,
        backgroundCss,
        dpi,
      );
      downloadBlob(
        blob,
        `pattern-layout-${pageCount}pages-${target.width}x${target.height}-${dpi}dpi.zip`,
      );
      setStatus(
        unplaceableCount
          ? `已导出 ${pageCount} 页 ZIP；仍有 ${unplaceableCount} 个超大零件无法放入任何页面。`
          : `全部 ${pageCount} 页已导出为 ZIP，每页均保留 ${dpi} DPI 与 1:1 零件尺寸。`,
      );
    } catch (error) {
      console.error(error);
      setStatus(`全部页导出失败：${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="app-shell v14-shell v16-shell">
      <section className="hero">
        <div>
          <span className="eyebrow">PATTERN LAYOUT STUDIO · V1.7</span>
          <h1>多图项目 · Unified Page Layout</h1>
          <p>
            一次选择多张原图，系统会逐张完成精确拆件，再把所有零件汇入同一个项目统一分页优化；
            每个零件仍保留自己的原图来源、精确轮廓与跨页编辑能力。
          </p>
        </div>
        <div className="hero-badge">Multi Source</div>
      </section>

      <section className="control-grid v12-grid v16-commandbar">
        <label className="upload-card">
          <span className="control-label">1 · 上传图片</span>
          <strong>{busy ? '批量处理中…' : '选择一张或多张图片'}</strong>
          <small>{sourceInfo}</small>
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            multiple
            disabled={busy}
            onChange={(event) => {
              const files = Array.from(event.target.files ?? []);
              if (files.length) void processFiles(files);
              event.currentTarget.value = '';
            }}
          />
        </label>

        <div className="control-card">
          <span className="control-label">2 · 文字排除</span>
          <label className="switch-row">
            <input
              type="checkbox"
              checked={textExclude}
              onChange={(event) => setTextExclude(event.target.checked)}
            />
            <span>排除文字（默认开启）</span>
          </label>
          <select
            value={textStrength}
            onChange={(event) => setTextStrength(event.target.value as TextFilterStrength)}
            disabled={!textExclude}
          >
            <option value="weak">过滤强度：弱</option>
            <option value="medium">过滤强度：中</option>
            <option value="strong">过滤强度：强</option>
          </select>
          <label className="switch-row compact">
            <input
              type="checkbox"
              checked={ocrEnhanced}
              onChange={(event) => setOcrEnhanced(event.target.checked)}
              disabled={!textExclude}
            />
            <span>中英 OCR 增强（较慢）</span>
          </label>
        </div>

        <div className="control-card">
          <span className="control-label">3 · 边缘与拆分</span>
          <select
            value={smoothing}
            onChange={(event) => setSmoothing(event.target.value as SmoothingMode)}
          >
            <option value="off">边缘平滑：关闭</option>
            <option value="standard">边缘平滑：标准（推荐）</option>
            <option value="strong">边缘平滑：强</option>
          </select>
          <select
            value={splitStrength}
            onChange={(event) => setSplitStrength(event.target.value as SplitStrength)}
          >
            <option value="conservative">拆分力度：保守（推荐）</option>
            <option value="standard">拆分力度：标准</option>
            <option value="fine">拆分力度：精细</option>
          </select>
          <small>保守模式会把内部装饰并回主体。页面间距可在右侧 Inspector 中调整。</small>
        </div>

        <div className="control-card">
          <span className="control-label">4 · 目标与导出</span>
          <div className="segmented">
            <button
              className={targetKey === 'square' ? 'active' : ''}
              onClick={() => relayout('square')}
              disabled={!parts.length || busy}
            >
              3500²
            </button>
            <button
              className={targetKey === 'a4' ? 'active' : ''}
              onClick={() => relayout('a4')}
              disabled={!parts.length || busy}
            >
              2970×2100
            </button>
          </div>
          <div className="export-inline">
            <input
              type="number"
              min="72"
              max="1200"
              value={dpi}
              onChange={(event) => setDpi(Math.max(72, Number(event.target.value) || 300))}
            />
            <span>DPI</span>
            <button
              className="primary"
              onClick={() => void exportCurrent()}
              disabled={!currentPageParts.length || busy}
            >
              当前页
            </button>
          </div>
          <button
            className="secondary-export"
            onClick={() => void exportAllPages()}
            disabled={!pageCount || busy}
          >
            导出全部页 ZIP
          </button>
        </div>
      </section>

      <section className="status-row">
        <div className="status-dot" />
        <span>{status}</span>
        <span className="spacer" />
        <span className="background-chip">
          <i style={{ background: backgroundCss }} />
          背景
        </span>
        {quality && <span className="metric-chip">文字 {quality.textRegions}</span>}
        {sourceReferences.length > 0 && (
          <span className="metric-chip">{sourceReferences.length} 张原图</span>
        )}
        {pageCount > 0 && <span className="metric-chip">共 {pageCount} 页</span>}
        {selectedSourceRegionCount > 0 && (
          <span className="metric-chip">来源 {selectedSourceRegionCount} 区域</span>
        )}
        {unplaceableCount > 0 && <span className="warning-chip">{unplaceableCount} 个超大零件</span>}
      </section>

      <section className="workspace v14-workspace">
        <aside className="source-panel">
          <div className="panel-heading source-heading">
            <div>
              <span className="control-label">SOURCE TRACE</span>
              <strong>原图定位</strong>
            </div>
            <span className="panel-page-badge">
              {sourceReferences.length} sources
            </span>
            <button
              className="debug-toggle"
              onClick={() => setDebugOpen((value) => !value)}
              disabled={!debugImages}
            >
              {debugOpen ? '收起调试' : '调试'}
            </button>
          </div>

          {activeSource ? (
            <>
              {sourceReferences.length > 1 && (
                <div className="source-tabs">
                  {sourceReferences.map((source, index) => (
                    <button
                      key={source.id}
                      className={source.id === activeSource.id ? 'active' : ''}
                      onClick={() => setActiveSourceId(source.id)}
                      title={source.name}
                    >
                      <img src={source.imageUrl} alt="" />
                      <span>S{index + 1}</span>
                    </button>
                  ))}
                </div>
              )}
              <div className="source-preview-wrap">
                <div
                  className="source-image-wrap"
                  style={{ aspectRatio: `${activeSource.width} / ${activeSource.height}` }}
                >
                  <img src={activeSource.imageUrl} alt={activeSource.name} />
                  <svg
                    className="source-shape-layer"
                    viewBox={`0 0 ${activeSource.width} ${activeSource.height}`}
                    preserveAspectRatio="none"
                    aria-label="原图精确来源轮廓"
                  >
                    {sourceTraceItems.map(({ part, contour, box, index }) => {
                      const active = selectedIds.includes(part.id);
                      if (contour?.length) {
                        return (
                          <polygon
                            key={`${part.id}-contour-${index}`}
                            points={contour.map((point) => `${point.x},${point.y}`).join(' ')}
                            className={`source-shape ${active ? 'active' : ''}`}
                            onClick={() => setSelectedIds([part.id])}
                          />
                        );
                      }
                      if (!box) return null;
                      return (
                        <rect
                          key={`${part.id}-box-${index}`}
                          x={box.x}
                          y={box.y}
                          width={box.width}
                          height={box.height}
                          className={`source-shape source-shape-fallback ${active ? 'active' : ''}`}
                          onClick={() => setSelectedIds([part.id])}
                        />
                      );
                    })}
                  </svg>
                </div>
              </div>

              <div className="source-meta">
                <div>
                  <span>原图</span>
                  <strong>{activeSource.width} × {activeSource.height}</strong>
                </div>
                <div>
                  <span>{activeSource.name}</span>
                  <strong>{sourceTraceItems.length} 个当前页映射</strong>
                </div>
              </div>

              <div className="source-selection">
                {selectedIds.length ? (
                  <>
                    <div className="source-selection-title">
                      <strong>已选 {selectedIds.length} 个零件</strong>
                      <span>
                        当前原图 {selectedSourceBoxes.length} 区域 · 总计 {selectedSourceRegionCount}
                      </span>
                    </div>
                    <div className="source-region-list">
                      {selectedSourceBoxes.map((box, index) => (
                        <div key={`selected-source-${index}`}>
                          <b>{index + 1}</b>
                          <span>x {box.x} · y {box.y}</span>
                          <em>{box.width} × {box.height}px</em>
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <p>点击右侧零件或原图上的精确轮廓，即可查看转换后的零件来自原图哪个位置。</p>
                )}
              </div>
            </>
          ) : (
            <div className="source-empty">
              <strong>等待图片项目</strong>
              <span>可一次选择多张图片，处理后在这里切换查看来源。</span>
            </div>
          )}

          {debugOpen && debugImages && (
            <div className="debug-grid source-debug-grid">
              <figure><img src={debugImages.raw} alt="" /><figcaption>Raw mask</figcaption></figure>
              <figure><img src={debugImages.afterText} alt="" /><figcaption>文字过滤后</figcaption></figure>
              <figure><img src={debugImages.smooth} alt="" /><figcaption>平滑 mask</figcaption></figure>
              <figure><img src={debugImages.textOverlay} alt="" /><figcaption>文字检测框</figcaption></figure>
            </div>
          )}
        </aside>
        <div className="canvas-panel">
          <div className="panel-heading editor-heading">
            <div>
              <span className="control-label">CANVAS EDITOR</span>
              <strong>{target.label}</strong>
              <span className="canvas-subtitle">
                Page {pageCount ? currentPageIndex + 1 : 0} / {pageCount}
                {currentPageStats
                  ? ` · 利用率 ${(currentPageStats.utilization * 100).toFixed(1)}%`
                  : ''}
              </span>
            </div>
            <div className="editor-tools">
              <div className="tool-group">
                <button className={tool === 'select' ? 'active' : ''} onClick={() => setTool('select')}>选择</button>
                <button className={tool === 'brush' ? 'active' : ''} onClick={() => setTool('brush')}>画笔</button>
                <button className={tool === 'eraser' ? 'active' : ''} onClick={() => setTool('eraser')}>橡皮擦</button>
              </div>
              {(tool === 'brush' || tool === 'eraser') && (
                <label className="brush-size">
                  <span>{tool === 'brush' ? '恢复' : '擦除'} · {brushSize}px</span>
                  <input
                    type="range"
                    min="4"
                    max="160"
                    value={brushSize}
                    onChange={(event) => setBrushSize(Number(event.target.value))}
                  />
                </label>
              )}
              <div className="toolbar">
                <button onClick={undo} disabled={!undoRef.current.length}>Undo</button>
                <button onClick={redo} disabled={!redoRef.current.length}>Redo</button>
                <button onClick={() => relayout()} disabled={!parts.length || busy}>重新自动分页</button>
                <button onClick={toggleSelectedLock} disabled={!selectedIds.length || busy}>锁定/解锁</button>
                <button onClick={() => void mergeSelected()} disabled={selectedIds.length < 2 || busy}>合并</button>
                <button onClick={() => void splitSelected()} disabled={!selectedPart || busy}>拆分</button>
                <button className="danger" onClick={deleteSelected} disabled={!selectedIds.length || busy}>删除</button>
              </div>
            </div>
          </div>

          {pageCount > 0 && (
            <div className="page-strip">
              {pageStats.map((page) => (
                <button
                  key={page.pageIndex}
                  className={`page-chip ${page.pageIndex === currentPageIndex ? 'active' : ''}`}
                  onClick={() => goToPage(page.pageIndex)}
                >
                  <b>P{page.pageIndex + 1}</b>
                  <span>{page.count} 件</span>
                  <em>{(page.utilization * 100).toFixed(0)}%</em>
                </button>
              ))}
            </div>
          )}

          <div className="canvas-stage">
            {currentPageParts.length ? (
              <canvas
                ref={canvasRef}
                className={`editor-canvas tool-${tool}`}
                onPointerDown={(event) => void handlePointerDown(event)}
                onPointerMove={handlePointerMove}
                onPointerUp={stopInteraction}
                onPointerCancel={stopInteraction}
              />
            ) : (
              <div className="empty-state">
                <div className="empty-icon">+</div>
                <strong>{parts.length ? '当前页暂无零件' : '上传图片开始 V1.7 项目处理'}</strong>
                <span>{parts.length ? '可切换其他页或重新自动分页。' : '多张图片会先逐张拆件，再统一生成全局 Page。'}</span>
              </div>
            )}
          </div>

          <div className="canvas-help">
            Ctrl / Shift 点击多选 · 恢复画笔连续从原始 RGB 补回像素 · 橡皮擦可切断后再“拆分” ·
            拆分会原子替换父零件 · Ctrl+Z / Ctrl+Shift+Z 撤销/恢复
          </div>
        </div>

        <aside className="parts-panel">
          <div className="panel-heading inspector-heading">
            <div>
              <span className="control-label">INSPECTOR</span>
              <strong>Page {pageCount ? currentPageIndex + 1 : 0}</strong>
            </div>
            <span className="panel-page-badge">
              {currentPageParts.length} parts
            </span>
          </div>

          <div className="page-manager">
            <div className="inspector-section-title">
              <span>跨页移动</span>
              <em>{selectedIds.length ? `已选 ${selectedIds.length}` : '未选择'}</em>
            </div>
            <div className="page-transfer">
              <select
                value={moveTargetPage}
                onChange={(event) => setMoveTargetPage(Number(event.target.value))}
                disabled={!pageCount}
              >
                {pageStats.map((page) => (
                  <option key={page.pageIndex} value={page.pageIndex}>
                    Page {page.pageIndex + 1} · {(page.utilization * 100).toFixed(0)}%
                  </option>
                ))}
                <option value={pageCount}>新建 Page {pageCount + 1}</option>
              </select>
              <button
                onClick={() => moveSelectedToPage(moveTargetPage)}
                disabled={!selectedIds.length || busy}
              >
                移动
              </button>
            </div>
            <div className="transfer-shortcuts">
              <button
                onClick={() => moveSelectedToPage(Math.max(0, currentPageIndex - 1))}
                disabled={!selectedIds.length || currentPageIndex <= 0 || busy}
              >
                ← 前一页
              </button>
              <button
                onClick={() => moveSelectedToPage(Math.min(pageCount, currentPageIndex + 1))}
                disabled={!selectedIds.length || busy}
              >
                后一页 →
              </button>
            </div>
          </div>

          <div className="packing-manager">
            <div className="inspector-section-title">
              <span>页面利用率</span>
              <em>全局回填已开启</em>
            </div>
            <label className="gap-control">
              <span>零件间距</span>
              <input
                type="range"
                min="4"
                max="32"
                step="2"
                value={packingGap}
                onChange={(event) => setPackingGap(Number(event.target.value))}
              />
              <b>{packingGap}px</b>
            </label>
            <button
              className="optimize-pages"
              onClick={() => relayout()}
              disabled={!parts.length || busy}
            >
              全局优化分页
            </button>
          </div>

          {quality && (
            <div className="quality-panel">
              <div><span>最终零件</span><strong>{quality.componentCount}</strong></div>
              <div><span>原始组件</span><strong>{quality.rawComponentCount}</strong></div>
              <div><span>内部归并</span><strong>{quality.mergedDecorationCount}</strong></div>
              <div><span>拆分力度</span><strong>{quality.splitStrength}</strong></div>
              <div><span>自动分页</span><strong>{pageCount || quality.pageCount} 页</strong></div>
              <div><span>文字排除</span><strong>{quality.textRegions}</strong></div>
              <div><span>几何 / OCR</span><strong>{quality.geometryTextRegions} / {quality.ocrTextRegions}</strong></div>
              <div><span>平滑</span><strong>{quality.smoothing}</strong></div>
              <div><span>填孔</span><strong>{quality.morphology.filledHoleCount}</strong></div>
              <div><span>MaxRects</span><strong>{quality.packing.strategy}</strong></div>
              <div><span>当前页零件</span><strong>{currentPageParts.length}</strong></div>
              <div><span>当前页利用率</span><strong>{((currentPageStats?.utilization ?? 0) * 100).toFixed(1)}%</strong></div>
              <div><span>整体利用率</span><strong>{(overallUtilization * 100).toFixed(1)}%</strong></div>
            </div>
          )}

          <div className="parts-list">
            {currentPageParts.map((part) => (
              <button
                key={part.id}
                className={`part-row ${selectedIds.includes(part.id) ? 'selected' : ''} ${part.overflow ? 'overflow' : ''}`}
                onClick={(event) => {
                  if (event.ctrlKey || event.metaKey || event.shiftKey) {
                    setSelectedIds((current) =>
                      current.includes(part.id)
                        ? current.filter((id) => id !== part.id)
                        : [...current, part.id],
                    );
                  } else {
                    setSelectedIds([part.id]);
                  }
                }}
              >
                <img src={part.imageUrl} alt="" />
                <span>
                  <strong>{part.name}</strong>
                  <small>
                    {part.width} × {part.height}px
                    {sourceRegionsFor(part).length
                      ? ` · ${sourceLabelFor(part)} · 来源 ${sourceRegionsFor(part).length} 区域`
                      : ''}
                  </small>
                </span>
                <em>{part.overflow ? 'OVERFLOW' : part.locked ? 'LOCK' : 'FREE'}</em>
              </button>
            ))}
            {!currentPageParts.length && <div className="parts-empty">当前页暂无零件</div>}
          </div>
        </aside>
      </section>

      <footer>
        <span>V1.7 · multi-image project · unified packing · exact source provenance</span>
        <span>Current-page PNG · all-pages ZIP · no-scale · PNG DPI · manual repair</span>
      </footer>
    </main>
  );
}
