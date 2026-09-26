import { useEffect, useMemo, useRef, useState } from 'react';
import { estimateBackgroundModel } from './core/background';
import { segmentForeground, type ComponentBox } from './core/segmentation';
import {
  packMaxRectsWithoutScaling,
  type PackingDiagnostics,
} from './core/packing';
import { centerLayout, validateNoScaleFit } from './core/converter';
import { canvasToPngWithDpi } from './core/png';
import type { CanvasSize, PatternPart } from './types';

const TARGETS: Record<'square' | 'a4', CanvasSize> = {
  square: { width: 3500, height: 3500, label: '3500 × 3500' },
  a4: { width: 2970, height: 2100, label: '2970 × 2100' },
};

const GAP = 24;

interface QualityReport {
  threshold: number;
  spread: number;
  foregroundRatio: number;
  componentCount: number;
  packing: PackingDiagnostics;
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

function padBox(box: ComponentBox, width: number, height: number, padding = 2): ComponentBox {
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

function arrangeParts(parts: PatternPart[], target: CanvasSize) {
  const packing = packMaxRectsWithoutScaling(
    parts.map((part) => ({ id: part.id, width: part.width, height: part.height })),
    target,
    GAP,
  );

  const placed = packing.items
    .filter((item) => item.placed && item.x !== undefined && item.y !== undefined)
    .map((item) => ({
      id: item.id,
      x: item.x!,
      y: item.y!,
      width: item.width,
      height: item.height,
    }));

  const centered = centerLayout(placed, target);
  const positions = new Map(centered.map((item) => [item.id, item]));

  const arranged = parts.map((part) => {
    const position = positions.get(part.id);
    if (!position) {
      return {
        ...part,
        x: -part.width - GAP,
        y: 0,
        overflow: true,
      };
    }

    return {
      ...part,
      x: position.x,
      y: position.y,
      overflow: false,
    };
  });

  return {
    arranged,
    overflow: packing.diagnostics.overflowCount,
    packing: packing.diagnostics,
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

export default function App() {
  const [parts, setParts] = useState<PatternPart[]>([]);
  const [targetKey, setTargetKey] = useState<'square' | 'a4'>('a4');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [backgroundCss, setBackgroundCss] = useState('#aaaaaa');
  const [sourceInfo, setSourceInfo] = useState('尚未上传图片');
  const [status, setStatus] = useState('上传 PNG/JPG 后会自动执行 Segmentation V2 与 MaxRects Packing V2。');
  const [dpi, setDpi] = useState(300);
  const [busy, setBusy] = useState(false);
  const [renderTick, setRenderTick] = useState(0);
  const [quality, setQuality] = useState<QualityReport | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imageCacheRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const dragRef = useRef<{ id: string; offsetX: number; offsetY: number } | null>(null);

  const target = TARGETS[targetKey];
  const selectedPart = parts.find((part) => part.id === selectedId) ?? null;
  const overflowCount = parts.filter((part) => part.visible && !isInside(part, target)).length;

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

    for (const part of parts) {
      if (!part.visible || part.overflow) continue;

      let image = imageCacheRef.current.get(part.imageUrl);
      if (!image) {
        image = new Image();
        image.onload = () => setRenderTick((value) => value + 1);
        image.src = part.imageUrl;
        imageCacheRef.current.set(part.imageUrl, image);
      }

      if (image.complete && image.naturalWidth > 0) {
        context.drawImage(
          image,
          part.x * sx,
          part.y * sy,
          part.width * sx,
          part.height * sy,
        );
      }

      if (part.id === selectedId) {
        context.save();
        context.strokeStyle = part.locked ? '#f59e0b' : '#2563eb';
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
  }, [parts, target, backgroundCss, selectedId, preview, renderTick]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const element = event.target as HTMLElement | null;
      if (element && ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName)) return;
      if ((event.key === 'Delete' || event.key === 'Backspace') && selectedId) {
        setParts((current) => current.filter((part) => part.id !== selectedId));
        setSelectedId(null);
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedId]);

  async function processFile(file: File) {
    setBusy(true);
    setSelectedId(null);
    setQuality(null);
    setStatus('正在读取图片并执行 Segmentation V2…');

    try {
      const dataUrl = await readFile(file);
      const image = await loadImage(dataUrl);
      const sourceCanvas = document.createElement('canvas');
      sourceCanvas.width = image.naturalWidth;
      sourceCanvas.height = image.naturalHeight;
      const sourceContext = sourceCanvas.getContext('2d', { willReadFrequently: true });
      if (!sourceContext) throw new Error('Canvas unavailable');

      sourceContext.drawImage(image, 0, 0);
      const imageData = sourceContext.getImageData(
        0,
        0,
        sourceCanvas.width,
        sourceCanvas.height,
      );

      const background = estimateBackgroundModel(imageData);
      const backgroundColor = rgbCss(
        background.color.r,
        background.color.g,
        background.color.b,
      );
      setBackgroundCss(backgroundColor);

      const segmentation = segmentForeground(imageData, background);
      let boxes = segmentation.boxes.map((box) =>
        padBox(box, sourceCanvas.width, sourceCanvas.height),
      );
      let extractionMask = segmentation.rawMask;

      if (!boxes.length) {
        boxes = [{
          x: 0,
          y: 0,
          width: sourceCanvas.width,
          height: sourceCanvas.height,
          area: sourceCanvas.width * sourceCanvas.height,
        }];
        extractionMask = new Uint8Array(sourceCanvas.width * sourceCanvas.height);
        extractionMask.fill(1);
      }

      const stamp = Date.now();
      const extracted: PatternPart[] = boxes.map((box, index) => {
        const partCanvas = document.createElement('canvas');
        partCanvas.width = box.width;
        partCanvas.height = box.height;
        const partContext = partCanvas.getContext('2d');
        if (!partContext) throw new Error('Part canvas unavailable');

        const output = partContext.createImageData(box.width, box.height);

        for (let y = 0; y < box.height; y += 1) {
          for (let x = 0; x < box.width; x += 1) {
            const sourceX = box.x + x;
            const sourceY = box.y + y;
            const sourcePixel = sourceY * sourceCanvas.width + sourceX;
            if (!extractionMask[sourcePixel] && !segmentation.cleanMask[sourcePixel]) continue;

            const sourceOffset = sourcePixel * 4;
            const targetOffset = (y * box.width + x) * 4;
            output.data[targetOffset] = imageData.data[sourceOffset];
            output.data[targetOffset + 1] = imageData.data[sourceOffset + 1];
            output.data[targetOffset + 2] = imageData.data[sourceOffset + 2];
            output.data[targetOffset + 3] = imageData.data[sourceOffset + 3];
          }
        }

        partContext.putImageData(output, 0, 0);

        return {
          id: `part-${stamp}-${index}`,
          name: `零件 ${index + 1}`,
          imageUrl: partCanvas.toDataURL('image/png'),
          width: box.width,
          height: box.height,
          x: 0,
          y: 0,
          locked: false,
          visible: true,
          overflow: false,
        };
      });

      let nextTargetKey: 'square' | 'a4' = targetKey;
      if (sourceCanvas.width === 3500 && sourceCanvas.height === 3500) {
        nextTargetKey = 'a4';
      }
      if (sourceCanvas.width === 2970 && sourceCanvas.height === 2100) {
        nextTargetKey = 'square';
      }

      const nextTarget = TARGETS[nextTargetKey];
      const arrangedResult = arrangeParts(extracted, nextTarget);

      imageCacheRef.current.clear();
      setTargetKey(nextTargetKey);
      setParts(arrangedResult.arranged);
      setSourceInfo(
        `${file.name} · ${sourceCanvas.width} × ${sourceCanvas.height} · ${boxes.length} 个零件`,
      );
      setQuality({
        threshold: background.threshold,
        spread: background.spread,
        foregroundRatio: segmentation.diagnostics.cleanedForegroundRatio,
        componentCount: boxes.length,
        packing: arrangedResult.packing,
      });

      setStatus(
        arrangedResult.overflow
          ? `V2 处理完成，但有 ${arrangedResult.overflow} 个零件无法无缩放放入当前画布；建议切换目标尺寸。`
          : `V2 验收通过：自适应背景 → 形态学清理 → 8 邻域分割 → MaxRects 无缩放排版。`,
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

    const nextTarget = TARGETS[nextKey];
    const arrangedResult = arrangeParts(parts, nextTarget);
    setTargetKey(nextKey);
    setParts(arrangedResult.arranged);
    setSelectedId(null);
    setQuality((current) =>
      current
        ? {
            ...current,
            packing: arrangedResult.packing,
          }
        : current,
    );

    setStatus(
      arrangedResult.overflow
        ? `已切换到 ${nextTarget.label}，其中 ${arrangedResult.overflow} 个零件无法无缩放自动放入。`
        : `已按 ${nextTarget.label} 使用 MaxRects V2 重新排版，零件像素尺寸未改变。`,
    );
  }

  function pointerPosition(event: React.PointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * target.width,
      y: ((event.clientY - rect.top) / rect.height) * target.height,
    };
  }

  function handlePointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    const point = pointerPosition(event);
    const hit = [...parts]
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

    if (!hit) {
      setSelectedId(null);
      dragRef.current = null;
      return;
    }

    setSelectedId(hit.id);
    if (!hit.locked) {
      dragRef.current = {
        id: hit.id,
        offsetX: point.x - hit.x,
        offsetY: point.y - hit.y,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
    }
  }

  function handlePointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    const drag = dragRef.current;
    if (!drag) return;

    const point = pointerPosition(event);
    setParts((current) =>
      current.map((part) => {
        if (part.id !== drag.id || part.locked) return part;

        const maxX = Math.max(0, target.width - part.width);
        const maxY = Math.max(0, target.height - part.height);
        return {
          ...part,
          x: Math.round(Math.min(maxX, Math.max(0, point.x - drag.offsetX))),
          y: Math.round(Math.min(maxY, Math.max(0, point.y - drag.offsetY))),
          overflow: false,
        };
      }),
    );
  }

  function stopDragging(event: React.PointerEvent<HTMLCanvasElement>) {
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function toggleSelectedLock() {
    if (!selectedId) return;
    setParts((current) =>
      current.map((part) =>
        part.id === selectedId ? { ...part, locked: !part.locked } : part,
      ),
    );
  }

  function deleteSelected() {
    if (!selectedId) return;
    setParts((current) => current.filter((part) => part.id !== selectedId));
    setSelectedId(null);
  }

  async function exportCurrent() {
    if (!parts.length) return;

    const visible = parts.filter((part) => part.visible);
    if (visible.some((part) => part.overflow)) {
      setStatus('导出已阻止：仍有零件处于 overflow 状态，请切换画布尺寸或删除对应零件。');
      return;
    }

    const placements = visible.map(({ id, x, y, width, height }) => ({
      id,
      x,
      y,
      width,
      height,
    }));

    if (!validateNoScaleFit(placements, target)) {
      setStatus('导出已阻止：仍有零件超出画布边界。请先重新排版或拖拽到画布内。');
      return;
    }

    setBusy(true);
    setStatus('正在生成高分辨率 PNG 并写入 DPI metadata…');

    try {
      const exportCanvas = document.createElement('canvas');
      exportCanvas.width = target.width;
      exportCanvas.height = target.height;
      const context = exportCanvas.getContext('2d');
      if (!context) throw new Error('Export canvas unavailable');

      context.fillStyle = backgroundCss;
      context.fillRect(0, 0, target.width, target.height);

      for (const part of visible) {
        const image = await loadImage(part.imageUrl);
        context.drawImage(image, part.x, part.y, part.width, part.height);
      }

      const blob = await canvasToPngWithDpi(exportCanvas, dpi);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `pattern-layout-${target.width}x${target.height}-${dpi}dpi.png`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);

      setStatus(
        `PNG 已生成：${target.label}，${dpi} DPI；导出尺寸与编辑器中零件尺寸保持 1:1。`,
      );
    } catch (error) {
      console.error(error);
      setStatus(`导出失败：${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="app-shell">
      <section className="hero">
        <div>
          <span className="eyebrow">PATTERN LAYOUT STUDIO · V1.1</span>
          <h1>图案拆件与无缩放排版</h1>
          <p>
            Segmentation V2 使用鲁棒边界背景估计、自适应容差、形态学清理与 8 邻域连通域；
            Packing V2 使用多策略 MaxRects，在不改变零件像素尺寸的前提下提高排版成功率。
          </p>
        </div>
        <div className="hero-badge">1:1 Pixels</div>
      </section>

      <section className="control-grid">
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
          <span className="control-label">2 · 目标画布</span>
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
          <small>切换尺寸会重新执行 MaxRects V2，不缩放零件。</small>
        </div>

        <div className="control-card">
          <span className="control-label">3 · 导出设置</span>
          <div className="dpi-row">
            <input
              type="number"
              min="72"
              max="1200"
              step="1"
              value={dpi}
              onChange={(event) =>
                setDpi(Math.max(72, Number(event.target.value) || 300))
              }
            />
            <span>DPI</span>
          </div>
          <button
            className="primary"
            onClick={() => void exportCurrent()}
            disabled={!parts.length || busy}
          >
            导出 PNG
          </button>
        </div>
      </section>

      <section className="status-row">
        <div className="status-dot" />
        <span>{status}</span>
        <span className="spacer" />
        <span className="background-chip">
          <i style={{ background: backgroundCss }} />
          背景色
        </span>
        {quality && (
          <span className="metric-chip">
            阈值 {quality.threshold.toFixed(1)}
          </span>
        )}
        {overflowCount > 0 && (
          <span className="warning-chip">{overflowCount} 个 overflow</span>
        )}
      </section>

      <section className="workspace">
        <div className="canvas-panel">
          <div className="panel-heading">
            <div>
              <span className="control-label">CANVAS EDITOR</span>
              <strong>{target.label}</strong>
            </div>
            <div className="toolbar">
              <button
                onClick={() => relayout()}
                disabled={!parts.length || busy}
              >
                MaxRects 自动排版
              </button>
              <button
                onClick={toggleSelectedLock}
                disabled={!selectedPart || busy}
              >
                {selectedPart?.locked ? '解锁' : '锁定'}
              </button>
              <button
                className="danger"
                onClick={deleteSelected}
                disabled={!selectedPart || busy}
              >
                删除
              </button>
            </div>
          </div>

          <div className="canvas-stage">
            {parts.length ? (
              <canvas
                ref={canvasRef}
                className="editor-canvas"
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={stopDragging}
                onPointerCancel={stopDragging}
              />
            ) : (
              <div className="empty-state">
                <div className="empty-icon">+</div>
                <strong>上传图片开始 V2 处理</strong>
                <span>背景识别、分割和 MaxRects packing 会自动执行。</span>
              </div>
            )}
          </div>

          <div className="canvas-help">
            拖拽零件调整位置 · 点击选中 · 锁定后不可拖动 · Delete / Backspace 可删除 ·
            编辑过程不会 resize
          </div>
        </div>

        <aside className="parts-panel">
          <div className="panel-heading">
            <div>
              <span className="control-label">ACCEPTANCE / PARTS</span>
              <strong>{parts.length} 个零件</strong>
            </div>
          </div>

          {quality && (
            <div className="quality-panel">
              <div>
                <span>分割零件</span>
                <strong>{quality.componentCount}</strong>
              </div>
              <div>
                <span>前景占比</span>
                <strong>{(quality.foregroundRatio * 100).toFixed(1)}%</strong>
              </div>
              <div>
                <span>背景波动</span>
                <strong>{quality.spread.toFixed(1)}</strong>
              </div>
              <div>
                <span>MaxRects</span>
                <strong>{quality.packing.strategy}</strong>
              </div>
              <div>
                <span>成功放置</span>
                <strong>
                  {quality.packing.placedCount}/{quality.componentCount}
                </strong>
              </div>
              <div>
                <span>画布利用率</span>
                <strong>{(quality.packing.utilization * 100).toFixed(1)}%</strong>
              </div>
            </div>
          )}

          <div className="parts-list">
            {parts.map((part) => (
              <button
                key={part.id}
                className={`part-row ${selectedId === part.id ? 'selected' : ''} ${part.overflow ? 'overflow' : ''}`}
                onClick={() => setSelectedId(part.id)}
              >
                <img src={part.imageUrl} alt="" />
                <span>
                  <strong>{part.name}</strong>
                  <small>
                    {part.width} × {part.height}px
                  </small>
                </span>
                <em>
                  {part.overflow ? 'OVERFLOW' : part.locked ? 'LOCK' : 'FREE'}
                </em>
              </button>
            ))}
            {!parts.length && <div className="parts-empty">暂无零件</div>}
          </div>
        </aside>
      </section>

      <footer>
        <span>
          Segmentation V2 · robust border median · adaptive threshold · 3×3 cleanup ·
          8-connectivity
        </span>
        <span>MaxRects V2 · no scale · PNG pHYs DPI metadata</span>
      </footer>
    </main>
  );
}
