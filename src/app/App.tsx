import { useEffect, useMemo, useRef, useState } from 'react';
import {
  extractComponents,
  outerContoursForMode,
  type MorphologyStats,
  type SmoothingMode,
  type SplitStrength,
  type TextFilterStrength,
} from '../core/vision';
import { validateNoScaleFit } from '../core/layout/converter';
import {
  buildPagesZip,
  downloadBlob,
  renderLayoutPage,
} from '../core/export/pages';
import type {
  CanvasSize,
  PatternPart,
  SourceBox,
  SourceRegion,
} from '../domain';
import {
  cropCanvas,
  loadImage,
} from '../features/editor/image-utils';
import { arrangePartsAcrossPages } from '../features/layout/project-layout';
import {
  normalizeManualPages,
  packPageParts,
} from '../features/layout/page-editor';
import {
  cloneParts,
  sourceBoxesFor,
  sourceRegionsFor,
  unionSourceBoxes,
} from '../features/provenance/source-regions';
import {
  processSourceFile,
} from '../features/extraction/process-source';
import type {
  PaintSession,
  ProcessedSourceResult,
  QualityReport,
  SourceProcessingMetrics,
  SourceReference,
  ToolMode,
} from '../features/project/model';
import TrafficStats from '../components/TrafficStats';
import SourcePanel from '../components/SourcePanel';
import CommandBar from '../components/CommandBar';
import CanvasPanel from '../components/CanvasPanel';
import InspectorPanel from '../components/InspectorPanel';

const TARGETS: Record<'square' | 'a4', CanvasSize> = {
  square: { width: 3500, height: 3500, label: '3500 × 3500' },
  a4: { width: 2970, height: 2100, label: '2970 × 2100' },
};

const GAP = 24;
const HISTORY_LIMIT = 12;

export default function App() {
  const [parts, setParts] = useState<PatternPart[]>([]);
  const [targetKey, setTargetKey] = useState<'square' | 'a4'>('a4');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [backgroundCss, setBackgroundCss] = useState('#aaaaaa');
  const [sourceInfo, setSourceInfo] = useState('尚未上传图片');
  const [status, setStatus] = useState('V1.7：多图项目、统一分页、跨页移动与精确来源追踪已启用。');
  const [dpi, setDpi] = useState(300);
  const [busy, setBusy] = useState(false);
  const [renderTick, setRenderTick] = useState(0);
  const [quality, setQuality] = useState<QualityReport | null>(null);
  const [textExclude, setTextExclude] = useState(true);
  const [textStrength, setTextStrength] = useState<TextFilterStrength>('medium');
  const [ocrEnhanced, setOcrEnhanced] = useState(false);
  const [smoothing, setSmoothing] = useState<SmoothingMode>('standard');
  const [splitStrength, setSplitStrength] = useState<SplitStrength>('conservative');
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
    const firstSelected = parts.find((part) => selectedIds.includes(part.id));
    if (!firstSelected) return;

    const sourceIds = [...new Set(
      sourceRegionsFor(firstSelected).map((region) => region.sourceId),
    )];
    if (firstSelected.sourceId && !sourceIds.includes(firstSelected.sourceId)) {
      sourceIds.unshift(firstSelected.sourceId);
    }

    if (!sourceIds.length) return;
    if (activeSourceId && sourceIds.includes(activeSourceId)) return;
    setActiveSourceId(sourceIds[0]);
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

  async function processFiles(files: File[]) {
    if (!files.length) return;

    setBusy(true);
    setSelectedIds([]);
    setQuality(null);
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
          const result = await processSourceFile(files[index], {
            sourceIndex: index,
            totalSources: files.length,
            batchId,
            textExclude,
            textStrength,
            ocrEnhanced,
            smoothing,
            splitStrength,
            onStatus: setStatus,
          });
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

    const targetPack = packPageParts([...targetExisting, ...selected], target, packingGap);
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
      const sourcePack = packPageParts(remaining, target, packingGap);
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

      <CommandBar
        busy={busy}
        sourceInfo={sourceInfo}
        onFiles={(files) => void processFiles(files)}
        textExclude={textExclude}
        setTextExclude={setTextExclude}
        textStrength={textStrength}
        setTextStrength={setTextStrength}
        ocrEnhanced={ocrEnhanced}
        setOcrEnhanced={setOcrEnhanced}
        smoothing={smoothing}
        setSmoothing={setSmoothing}
        splitStrength={splitStrength}
        setSplitStrength={setSplitStrength}
        targetKey={targetKey}
        onTargetChange={relayout}
        hasParts={Boolean(parts.length)}
        dpi={dpi}
        setDpi={setDpi}
        canExportCurrent={Boolean(currentPageParts.length)}
        canExportAll={Boolean(pageCount)}
        onExportCurrent={() => void exportCurrent()}
        onExportAll={() => void exportAllPages()}
      />

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
        <SourcePanel
          sources={sourceReferences}
          activeSourceId={activeSourceId}
          onSourceChange={setActiveSourceId}
          currentPageParts={currentPageParts}
          selectedIds={selectedIds}
          onSelectionChange={setSelectedIds}
        />
        <CanvasPanel
          targetLabel={target.label}
          pageCount={pageCount}
          currentPageIndex={currentPageIndex}
          currentPageStats={currentPageStats}
          pageStats={pageStats}
          tool={tool}
          setTool={setTool}
          brushSize={brushSize}
          setBrushSize={setBrushSize}
          canUndo={Boolean(undoRef.current.length)}
          canRedo={Boolean(redoRef.current.length)}
          onUndo={undo}
          onRedo={redo}
          onRelayout={() => relayout()}
          hasParts={Boolean(parts.length)}
          busy={busy}
          selectedCount={selectedIds.length}
          canSplit={Boolean(selectedPart)}
          onToggleLock={toggleSelectedLock}
          onMerge={() => void mergeSelected()}
          onSplit={() => void splitSelected()}
          onDelete={deleteSelected}
          onPageChange={goToPage}
          currentPagePartsLength={currentPageParts.length}
          canvasRef={canvasRef}
          onPointerDown={(event) => void handlePointerDown(event)}
          onPointerMove={handlePointerMove}
          onPointerUp={stopInteraction}
          onPointerCancel={stopInteraction}
        />
        <InspectorPanel
          pageCount={pageCount}
          currentPageIndex={currentPageIndex}
          currentPageParts={currentPageParts}
          selectedIds={selectedIds}
          busy={busy}
          pageStats={pageStats}
          moveTargetPage={moveTargetPage}
          setMoveTargetPage={setMoveTargetPage}
          onMoveSelected={moveSelectedToPage}
          packingGap={packingGap}
          setPackingGap={setPackingGap}
          onOptimizePages={() => relayout()}
          hasParts={Boolean(parts.length)}
          quality={quality}
          sourceReferences={sourceReferences}
          currentPageStats={currentPageStats}
          overallUtilization={overallUtilization}
          setSelectedIds={setSelectedIds}
        />
      </section>

      <footer className="app-footer">
        <span>V1.8 · modular architecture · multi-image project · unified packing</span>
        <TrafficStats />
      </footer>
    </main>
  );
}
