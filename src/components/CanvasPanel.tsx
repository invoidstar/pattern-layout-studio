import type {
  Dispatch,
  PointerEventHandler,
  RefObject,
  SetStateAction,
} from 'react';
import type { PageStat, ToolMode } from '../features/project/model';

interface CanvasPanelProps {
  targetLabel: string;
  pageCount: number;
  currentPageIndex: number;
  currentPageStats?: PageStat;
  pageStats: PageStat[];
  tool: ToolMode;
  setTool: Dispatch<SetStateAction<ToolMode>>;
  brushSize: number;
  setBrushSize: Dispatch<SetStateAction<number>>;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onRelayout: () => void;
  hasParts: boolean;
  busy: boolean;
  selectedCount: number;
  canSplit: boolean;
  onToggleLock: () => void;
  onMerge: () => void;
  onSplit: () => void;
  onDelete: () => void;
  onPageChange: (pageIndex: number) => void;
  currentPagePartsLength: number;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  onPointerDown: PointerEventHandler<HTMLCanvasElement>;
  onPointerMove: PointerEventHandler<HTMLCanvasElement>;
  onPointerUp: PointerEventHandler<HTMLCanvasElement>;
  onPointerCancel: PointerEventHandler<HTMLCanvasElement>;
}

export default function CanvasPanel({
  targetLabel,
  pageCount,
  currentPageIndex,
  currentPageStats,
  pageStats,
  tool,
  setTool,
  brushSize,
  setBrushSize,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onRelayout,
  hasParts,
  busy,
  selectedCount,
  canSplit,
  onToggleLock,
  onMerge,
  onSplit,
  onDelete,
  onPageChange,
  currentPagePartsLength,
  canvasRef,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
}: CanvasPanelProps) {
  return (
    <div className="canvas-panel">
      <div className="panel-heading editor-heading">
        <div>
          <span className="control-label">CANVAS EDITOR</span>
          <strong>{targetLabel}</strong>
          <span className="canvas-subtitle">
            Page {pageCount ? currentPageIndex + 1 : 0} / {pageCount}
            {currentPageStats
              ? ` · 利用率 ${(currentPageStats.utilization * 100).toFixed(1)}%`
              : ''}
          </span>
        </div>

        <div className="editor-tools">
          <div className="tool-group">
            <button
              className={tool === 'select' ? 'active' : ''}
              onClick={() => setTool('select')}
            >
              选择
            </button>
            <button
              className={tool === 'brush' ? 'active' : ''}
              onClick={() => setTool('brush')}
            >
              画笔
            </button>
            <button
              className={tool === 'eraser' ? 'active' : ''}
              onClick={() => setTool('eraser')}
            >
              橡皮擦
            </button>
          </div>

          {(tool === 'brush' || tool === 'eraser') && (
            <label className="brush-size">
              <span>
                {tool === 'brush' ? '恢复' : '擦除'} · {brushSize}px
              </span>
              <input
                type="range"
                min="4"
                max="160"
                value={brushSize}
                onChange={(event) =>
                  setBrushSize(Number(event.target.value))
                }
              />
            </label>
          )}

          <div className="toolbar">
            <button onClick={onUndo} disabled={!canUndo}>
              Undo
            </button>
            <button onClick={onRedo} disabled={!canRedo}>
              Redo
            </button>
            <button onClick={onRelayout} disabled={!hasParts || busy}>
              重新自动分页
            </button>
            <button
              onClick={onToggleLock}
              disabled={!selectedCount || busy}
            >
              锁定/解锁
            </button>
            <button
              onClick={onMerge}
              disabled={selectedCount < 2 || busy}
            >
              合并
            </button>
            <button onClick={onSplit} disabled={!canSplit || busy}>
              拆分
            </button>
            <button
              className="danger"
              onClick={onDelete}
              disabled={!selectedCount || busy}
            >
              删除
            </button>
          </div>
        </div>
      </div>

      {pageCount > 0 && (
        <div className="page-strip">
          {pageStats.map((page) => (
            <button
              key={page.pageIndex}
              className={`page-chip ${page.pageIndex === currentPageIndex ? 'active' : ''}`}
              onClick={() => onPageChange(page.pageIndex)}
            >
              <b>P{page.pageIndex + 1}</b>
              <span>{page.count} 件</span>
              <em>{(page.utilization * 100).toFixed(0)}%</em>
            </button>
          ))}
        </div>
      )}

      <div className="canvas-stage">
        {currentPagePartsLength ? (
          <canvas
            ref={canvasRef}
            className={`editor-canvas tool-${tool}`}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerCancel}
          />
        ) : (
          <div className="empty-state">
            <div className="empty-icon">+</div>
            <strong>
              {hasParts
                ? '当前页暂无零件'
                : '上传图片开始项目处理'}
            </strong>
            <span>
              {hasParts
                ? '可切换其他页或重新自动分页。'
                : '多张图片会先逐张拆件，再统一生成全局 Page。'}
            </span>
          </div>
        )}
      </div>

      <div className="canvas-help">
        Ctrl / Shift 点击多选 · 恢复画笔连续从原始 RGB 补回像素 ·
        橡皮擦可切断后再“拆分” · 拆分会原子替换父零件 ·
        Ctrl+Z / Ctrl+Shift+Z 撤销/恢复
      </div>
    </div>
  );
}
