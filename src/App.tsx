import { useEffect, useMemo, useRef, useState } from 'react';
import { estimateBackgroundModel } from './core/background';
import { buildForegroundMask, extractComponents, type ComponentBox } from './core/segmentation';
import { smoothMask, type SmoothingMode, type MorphologyStats } from './core/morphology';
import {
  filterGeometryText,
  removeTextRegions,
  type TextFilterStrength,
  type TextRegion,
} from './core/text-filter';
import { detectOcrTextRegions } from './core/ocr';
import { renderPart } from './core/alpha';
import {
  packIntoMultiplePages,
  type PackingDiagnostics,
} from './core/packing';
import { centerLayout, validateNoScaleFit } from './core/converter';
import { buildPagesZip, downloadBlob, renderLayoutPage } from './core/export';
import type { CanvasSize, PatternPart } from './types';

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
        }
      : undefined,
  }));
}

function padBox(box: ComponentBox, width: number, height: number, padding = 3): ComponentBox {
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

function arrangePartsAcrossPages(parts: PatternPart[], target: CanvasSize) {
  const multi = packIntoMultiplePages(
    parts.map((part) => ({ id: part.id, width: part.width, height: part.height })),
    target,
    GAP,
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
  const [status, setStatus] = useState('V1.2：文字排除、平滑边缘、OCR 增强与人工修正已启用。');
  const [dpi, setDpi] = useState(300);
  const [busy, setBusy] = useState(false);
  const [renderTick, setRenderTick] = useState(0);
  const [quality, setQuality] = useState<QualityReport | null>(null);
  const [textExclude, setTextExclude] = useState(true);
  const [textStrength, setTextStrength] = useState<TextFilterStrength>('medium');
  const [ocrEnhanced, setOcrEnhanced] = useState(false);
  const [smoothing, setSmoothing] = useState<SmoothingMode>('standard');
  const [debugOpen, setDebugOpen] = useState(false);
  const [debugImages, setDebugImages] = useState<DebugImages | null>(null);
  const [tool, setTool] = useState<ToolMode>('select');
  const [brushSize, setBrushSize] = useState(28);
  const [historyTick, setHistoryTick] = useState(0);
  const [currentPageIndex, setCurrentPageIndex] = useState(0);

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
    if (pageCount > 0 && currentPageIndex >= pageCount) {
      setCurrentPageIndex(pageCount - 1);
      setSelectedIds([]);
    }
  }, [pageCount, currentPageIndex]);

  function goToPage(index: number) {
    if (!pageCount) return;
    const next = Math.max(0, Math.min(pageCount - 1, index));
    setCurrentPageIndex(next);
    setSelectedIds([]);
    paintRef.current = null;
    dragRef.current = null;
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

  async function processFile(file: File) {
    setBusy(true);
    setSelectedIds([]);
    setQuality(null);
    setDebugImages(null);
    undoRef.current = [];
    redoRef.current = [];
    setHistoryTick((value) => value + 1);
    setStatus('正在执行 V1.3 分割与自动分页…');
    setCurrentPageIndex(0);

    try {
      const dataUrl = await readFile(file);
      const image = await loadImage(dataUrl);
      const sourceCanvas = document.createElement('canvas');
      sourceCanvas.width = image.naturalWidth;
      sourceCanvas.height = image.naturalHeight;
      const sourceContext = sourceCanvas.getContext('2d', { willReadFrequently: true });
      if (!sourceContext) throw new Error('Canvas unavailable');

      sourceContext.drawImage(image, 0, 0);
      const imageData = sourceContext.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);
      const background = estimateBackgroundModel(imageData);
      setBackgroundCss(rgbCss(background.color.r, background.color.g, background.color.b));

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
          setStatus('正在执行中英 OCR 增强文字检测…');
          try {
            ocrRegions = await detectOcrTextRegions(sourceCanvas, (progress) => {
              setStatus(`OCR：${progress.status} ${Math.round(progress.progress * 100)}%`);
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
            console.warn('OCR enhancement failed; geometry filtering remains active.', error);
            setStatus('OCR 增强不可用，已自动回退到几何文字过滤。');
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
      let boxes = extractComponents(
        smoothed.mask,
        sourceCanvas.width,
        sourceCanvas.height,
        minArea,
      );

      if (!boxes.length) {
        boxes = [{
          x: 0,
          y: 0,
          width: sourceCanvas.width,
          height: sourceCanvas.height,
          area: sourceCanvas.width * sourceCanvas.height,
        }];
        smoothed.mask.fill(1);
      }

      const stamp = Date.now();
      const extracted: PatternPart[] = boxes.map((rawBox, index) => {
        const box = padBox(rawBox, sourceCanvas.width, sourceCanvas.height);
        const rendered = renderPart(
          sourceCanvas,
          smoothed.mask,
          afterTextMask,
          sourceCanvas.width,
          box,
          smoothing,
        );

        return {
          id: `part-${stamp}-${index}`,
          name: `零件 ${index + 1}`,
          imageUrl: rendered.imageUrl,
          sourceImageUrl: rendered.sourceImageUrl,
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
            sourceBox: {
              x: box.x,
              y: box.y,
              width: box.width,
              height: box.height,
            },
          },
        };
      });

      let nextTargetKey: 'square' | 'a4' = targetKey;
      if (sourceCanvas.width === 3500 && sourceCanvas.height === 3500) nextTargetKey = 'a4';
      if (sourceCanvas.width === 2970 && sourceCanvas.height === 2100) nextTargetKey = 'square';

      const nextTarget = TARGETS[nextTargetKey];
      const arrangedResult = arrangePartsAcrossPages(extracted, nextTarget);
      const allTextRegions = [...geometryRegions, ...ocrRegions];

      imageCacheRef.current.clear();
      setTargetKey(nextTargetKey);
      setParts(arrangedResult.arranged);
      setSourceInfo(
        `${file.name} · ${sourceCanvas.width} × ${sourceCanvas.height} · ${boxes.length} 个零件`,
      );
      setQuality({
        threshold: background.threshold,
        spread: background.spread,
        foregroundRatio: maskRatio(smoothed.mask),
        componentCount: boxes.length,
        packing: arrangedResult.packing,
        textRegions: allTextRegions.length,
        geometryTextRegions: geometryRegions.length,
        ocrTextRegions: ocrRegions.length,
        morphology: smoothed.stats,
        smoothing,
        pageCount: arrangedResult.pageCount,
        unplaceableCount: arrangedResult.unplaceableCount,
      });
      setDebugImages({
        raw: makeMaskPreview(rawMask, sourceCanvas.width, sourceCanvas.height),
        afterText: makeMaskPreview(afterTextMask, sourceCanvas.width, sourceCanvas.height),
        smooth: makeMaskPreview(smoothed.mask, sourceCanvas.width, sourceCanvas.height),
        textOverlay: makeTextOverlay(sourceCanvas, allTextRegions),
      });

      setStatus(
        arrangedResult.unplaceableCount
          ? `V1.3 自动分页完成：共 ${arrangedResult.pageCount} 页；另有 ${arrangedResult.unplaceableCount} 个零件自身大于目标画布，无法放入。`
          : `V1.3 自动分页完成：共 ${arrangedResult.pageCount} 页，${boxes.length} 个零件全部无缩放排版成功。`,
      );
    } catch (error) {
      console.error(error);
      setStatus(`处理失败：${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      setBusy(false);
    }
  }

  function relayout(nextKey = targetKey) {
    if (!parts.length) return;
    pushHistory();
    const nextTarget = TARGETS[nextKey];
    const arrangedResult = arrangePartsAcrossPages(parts, nextTarget);
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
    const sourceImage = await loadImage(part.sourceImageUrl ?? part.imageUrl);
    const editCanvas = document.createElement('canvas');
    editCanvas.width = part.width;
    editCanvas.height = part.height;
    editCanvas.getContext('2d')!.drawImage(currentImage, 0, 0, part.width, part.height);

    paintRef.current = {
      partId: part.id,
      canvas: editCanvas,
      source: sourceImage,
      mode,
      pointerId,
    };
    if (!canvasElement.hasPointerCapture(pointerId)) canvasElement.setPointerCapture(pointerId);
    applyPaintDab(point.x - part.x, point.y - part.y);
  }

  function applyPaintDab(localX: number, localY: number) {
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
      context.drawImage(session.source, 0, 0, session.canvas.width, session.canvas.height);
    }
    context.restore();
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
      if (part) applyPaintDab(point.x - part.x, point.y - part.y);
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
          pageIndex: selectedPart.pageIndex ?? currentPageIndex,
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
      const merged: PatternPart = {
        id: `merged-${Date.now()}`,
        name: `合并零件 ${selected.length}`,
        imageUrl: mergedUrl,
        sourceImageUrl: mergedUrl,
        width: canvas.width,
        height: canvas.height,
        x: minX,
        y: minY,
        locked: false,
        visible: true,
        pageIndex: currentPageIndex,
        overflow: false,
        stats: { smoothingApplied: true },
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
      const pieces: PatternPart[] = boxes.map((box, index) => {
        const pieceUrl = cropCanvas(image, box);
        return {
          id: `split-${Date.now()}-${index}`,
          name: `${selectedPart.name} · ${index + 1}`,
          imageUrl: pieceUrl,
          sourceImageUrl: pieceUrl,
          width: box.width,
          height: box.height,
          x: selectedPart.x + box.x,
          y: selectedPart.y + box.y,
          locked: false,
          visible: true,
          overflow: false,
        };
      });

      setParts((current) => [
        ...current.filter((part) => part.id !== selectedPart.id),
        ...pieces,
      ]);
      setSelectedIds(pieces.map((part) => part.id));
      imageCacheRef.current.clear();
      setStatus(`已拆分为 ${pieces.length} 个独立零件。`);
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
    <main className="app-shell">
      <section className="hero">
        <div>
          <span className="eyebrow">PATTERN LAYOUT STUDIO · V1.3</span>
          <h1>自动分页 · 多页排版与导出</h1>
          <p>
            V1.3 保留文字排除、平滑边缘和人工修正，并将单页 overflow 升级为自动分页：
            一页放不下就继续生成下一页，最终可导出当前页 PNG 或全部页面 ZIP。
          </p>
        </div>
        <div className="hero-badge">Multi Page</div>
      </section>

      <section className="control-grid v12-grid">
        <label className="upload-card">
          <span className="control-label">1 · 上传图片</span>
          <strong>{busy ? '处理中…' : '选择 PNG / JPG'}</strong>
          <small>{sourceInfo}</small>
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            disabled={busy}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void processFile(file);
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
          <span className="control-label">3 · 边缘平滑</span>
          <select
            value={smoothing}
            onChange={(event) => setSmoothing(event.target.value as SmoothingMode)}
          >
            <option value="off">关闭</option>
            <option value="standard">标准（推荐）</option>
            <option value="strong">强</option>
          </select>
          <small>closing → opening → 去碎片 → 填小孔 → Chaikin → 抗锯齿。</small>
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
        {pageCount > 0 && <span className="metric-chip">共 {pageCount} 页</span>}
        {unplaceableCount > 0 && <span className="warning-chip">{unplaceableCount} 个超大零件</span>}
      </section>

      <section className="workspace">
        <div className="canvas-panel">
          <div className="panel-heading editor-heading">
            <div>
              <span className="control-label">CANVAS EDITOR</span>
              <strong>{target.label} · 第 {pageCount ? currentPageIndex + 1 : 0} / {pageCount} 页</strong>
              {pageCount > 0 && (
                <div className="page-nav">
                  <button onClick={() => goToPage(currentPageIndex - 1)} disabled={currentPageIndex <= 0}>‹</button>
                  <span>Page {currentPageIndex + 1}</span>
                  <button onClick={() => goToPage(currentPageIndex + 1)} disabled={currentPageIndex >= pageCount - 1}>›</button>
                </div>
              )}
            </div>
            <div className="editor-tools">
              <div className="tool-group">
                <button className={tool === 'select' ? 'active' : ''} onClick={() => setTool('select')}>选择</button>
                <button className={tool === 'brush' ? 'active' : ''} onClick={() => setTool('brush')}>画笔</button>
                <button className={tool === 'eraser' ? 'active' : ''} onClick={() => setTool('eraser')}>橡皮擦</button>
              </div>
              {(tool === 'brush' || tool === 'eraser') && (
                <label className="brush-size">
                  <span>{brushSize}px</span>
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
                <strong>{parts.length ? '当前页暂无零件' : '上传图片开始 V1.3 处理'}</strong>
                <span>{parts.length ? '可切换其他页或重新自动分页。' : '自动分割后会按需要生成一页或多页。'}</span>
              </div>
            )}
          </div>

          <div className="canvas-help">
            Ctrl / Shift 点击多选 · 画笔可恢复原图像素 · 橡皮擦可切断零件后再“拆分” ·
            Ctrl+Z / Ctrl+Shift+Z 撤销/恢复
          </div>
        </div>

        <aside className="parts-panel">
          <div className="panel-heading">
            <div>
              <span className="control-label">QUALITY / PARTS</span>
              <strong>第 {pageCount ? currentPageIndex + 1 : 0} 页 · {currentPageParts.length} 个零件</strong>
            </div>
            <button className="debug-toggle" onClick={() => setDebugOpen((value) => !value)}>
              {debugOpen ? '收起调试' : '调试视图'}
            </button>
          </div>

          {quality && (
            <div className="quality-panel">
              <div><span>最终零件</span><strong>{quality.componentCount}</strong></div>
              <div><span>自动分页</span><strong>{pageCount || quality.pageCount} 页</strong></div>
              <div><span>文字排除</span><strong>{quality.textRegions}</strong></div>
              <div><span>几何 / OCR</span><strong>{quality.geometryTextRegions} / {quality.ocrTextRegions}</strong></div>
              <div><span>平滑</span><strong>{quality.smoothing}</strong></div>
              <div><span>填孔</span><strong>{quality.morphology.filledHoleCount}</strong></div>
              <div><span>MaxRects</span><strong>{quality.packing.strategy}</strong></div>
              <div><span>当前页零件</span><strong>{currentPageParts.length}</strong></div>
              <div><span>画布利用率</span><strong>{(quality.packing.utilization * 100).toFixed(1)}%</strong></div>
            </div>
          )}

          {debugOpen && debugImages && (
            <div className="debug-grid">
              <figure><img src={debugImages.raw} alt="" /><figcaption>Raw mask</figcaption></figure>
              <figure><img src={debugImages.afterText} alt="" /><figcaption>文字过滤后</figcaption></figure>
              <figure><img src={debugImages.smooth} alt="" /><figcaption>平滑 mask</figcaption></figure>
              <figure><img src={debugImages.textOverlay} alt="" /><figcaption>文字检测框</figcaption></figure>
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
                  <small>{part.width} × {part.height}px</small>
                </span>
                <em>{part.overflow ? 'OVERFLOW' : part.locked ? 'LOCK' : 'FREE'}</em>
              </button>
            ))}
            {!currentPageParts.length && <div className="parts-empty">当前页暂无零件</div>}
          </div>
        </aside>
      </section>

      <footer>
        <span>V1.3 · text filter · smooth contour · MaxRects V3 · automatic pagination</span>
        <span>Current-page PNG · all-pages ZIP · no-scale · PNG DPI · manual repair</span>
      </footer>
    </main>
  );
}
