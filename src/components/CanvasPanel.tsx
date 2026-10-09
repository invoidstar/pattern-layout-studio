import { useEffect } from 'react';
import type {
  Dispatch, PointerEventHandler, RefObject, SetStateAction,
} from 'react';
import type { PageStat, ToolMode } from '../features/project/model';
import { useCanvasViewport } from '../hooks/useCanvasViewport';
import Icon from './ui/Icon';

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
  targetLabel, pageCount, currentPageIndex, currentPageStats, pageStats,
  tool, setTool, brushSize, setBrushSize, canUndo, canRedo, onUndo, onRedo,
  onRelayout, hasParts, busy, selectedCount, canSplit, onToggleLock,
  onMerge, onSplit, onDelete, onPageChange, currentPagePartsLength,
  canvasRef, onPointerDown, onPointerMove, onPointerUp, onPointerCancel,
}: CanvasPanelProps) {
  const { view, reset, zoomBy, beginPan, movePan, endPan } = useCanvasViewport();

  useEffect(() => reset(), [currentPageIndex, targetLabel, reset]);

  const changeTool = (next: ToolMode) => setTool(next);
  const tools = [
    { id: 'select' as const, icon: 'cursor' as const, label: '选择' },
    { id: 'pan' as const, icon: 'hand' as const, label: '移动画布' },
    { id: 'brush' as const, icon: 'brush' as const, label: '恢复画笔' },
    { id: 'eraser' as const, icon: 'eraser' as const, label: '橡皮擦' },
  ];

  return (
    <section className="v2-canvas-panel" aria-label="图纸排版画布">
      <header className="v2-panel-header">
        <div>
          <span className="v2-eyebrow">LAYOUT WORKSPACE</span>
          <h2>排版画布</h2>
          <small>{targetLabel} · 第 {pageCount ? currentPageIndex + 1 : 0} / {pageCount} 页</small>
        </div>
        <div className="v2-canvas-head-right">
          {currentPageStats && <span className="v2-utilization">利用率 <b>{(currentPageStats.utilization * 100).toFixed(1)}%</b></span>}
          <button className="v2-icon-button" aria-label="上一页" title="上一页" disabled={currentPageIndex <= 0} onClick={()=>onPageChange(currentPageIndex - 1)}>
            <Icon name="chevron-left"/>
          </button>
          <button className="v2-icon-button" aria-label="下一页" title="下一页" disabled={!pageCount || currentPageIndex >= pageCount - 1} onClick={()=>onPageChange(currentPageIndex + 1)}>
            <Icon name="chevron-right"/>
          </button>
        </div>
      </header>

      <div className="v2-canvas-toolbar">
        <div className="v2-mode-tools" role="toolbar" aria-label="画布工具">
          {tools.map((item) => (
            <button
              key={item.id}
              type="button"
              className={tool === item.id ? 'active' : ''}
              aria-pressed={tool === item.id}
              title={item.label}
              onClick={() => changeTool(item.id)}
            >
              <Icon name={item.icon} size={18}/>
              <span>{item.label}</span>
            </button>
          ))}
        </div>
        <div className="v2-toolbar-separator"/>
        <div className="v2-quick-actions">
          <button className="v2-icon-button" title="撤销 (Ctrl+Z)" aria-label="撤销" onClick={onUndo} disabled={!canUndo}><Icon name="undo"/></button>
          <button className="v2-icon-button" title="恢复 (Ctrl+Shift+Z)" aria-label="恢复" onClick={onRedo} disabled={!canRedo}><Icon name="redo"/></button>
          <details className="v2-actions-menu">
            <summary className="v2-button soft"><Icon name="more"/> <span>更多操作</span></summary>
            <div className="v2-actions-popover">
              <button disabled={busy || !hasParts} onClick={onRelayout}><Icon name="refresh"/> 重新自动分页</button>
              <button disabled={busy || !selectedCount} onClick={onToggleLock}><Icon name="lock"/> 锁定 / 解锁</button>
              <button disabled={busy || selectedCount < 2} onClick={onMerge}><Icon name="merge"/> 合并所选</button>
              <button disabled={busy || !canSplit} onClick={onSplit}><Icon name="scissors"/> 拆分零件</button>
              <button className="danger" disabled={busy || !selectedCount} onClick={onDelete}><Icon name="trash"/> 删除所选</button>
            </div>
          </details>
        </div>
      </div>

      {(tool === 'brush' || tool === 'eraser') && (
        <div className="v2-brushbar">
          <label>
            <Icon name={tool === 'brush' ? 'brush' : 'eraser'} size={16}/>
            <span>笔刷直径</span>
            <input type="range" min="4" max="160" value={brushSize} onChange={event=>setBrushSize(Number(event.target.value))}/>
            <b>{brushSize}px</b>
          </label>
        </div>
      )}

      {pageCount > 0 && (
        <div className="v2-page-strip" aria-label="页面切换">
          {pageStats.map((page) => (
            <button
              key={page.pageIndex}
              type="button"
              className={`v2-page-chip ${page.pageIndex === currentPageIndex ? 'active' : ''}`}
              aria-current={page.pageIndex === currentPageIndex ? 'page' : undefined}
              onClick={()=>onPageChange(page.pageIndex)}
            >
              <strong>P{page.pageIndex + 1}</strong>
              <span>{page.count} 件</span>
              <em>{(page.utilization * 100).toFixed(0)}%</em>
            </button>
          ))}
        </div>
      )}

      <div className="v2-canvas-stage" aria-label="画布交互区域">
        {currentPagePartsLength ? (
          <>
            <canvas
              ref={canvasRef}
              className={`v2-editor-canvas editor-canvas tool-${tool}`}
              style={{
                transformOrigin: 'center center',
                transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
                touchAction: 'none',
                cursor: tool === 'pan' ? 'grab' : tool === 'brush' || tool === 'eraser' ? 'crosshair' : 'default',
              }}
              onPointerDown={tool === 'pan' ? beginPan : onPointerDown}
              onPointerMove={tool === 'pan' ? movePan : onPointerMove}
              onPointerUp={tool === 'pan' ? endPan : onPointerUp}
              onPointerCancel={tool === 'pan' ? endPan : onPointerCancel}
              onWheel={event => {
                if (event.ctrlKey || tool === 'pan') {
                  event.preventDefault();
                  zoomBy(event.deltaY < 0 ? 1.12 : 1 / 1.12);
                }
              }}
              onDoubleClick={reset}
            />
            <div className="v2-zoom-tools" role="group" aria-label="画布缩放">
              <button title="缩小" aria-label="缩小" onClick={()=>zoomBy(1/1.25)}><Icon name="zoom-out"/></button>
              <span>{Math.round(view.scale * 100)}%</span>
              <button title="放大" aria-label="放大" onClick={()=>zoomBy(1.25)}><Icon name="zoom-in"/></button>
              <button title="适应画布" aria-label="适应画布" onClick={reset}><Icon name="maximize"/></button>
            </div>
          </>
        ) : (
          <div className="v2-canvas-empty">
            <span><Icon name="canvas" size={37}/></span>
            <h3>{hasParts ? '当前页暂无零件' : '从图纸开始你的项目'}</h3>
            <p>{hasParts ? '切换其他页面，或点击“重新自动分页”。' : '一次添加一张或多张图纸，自动拆件并统一排版。'}</p>
          </div>
        )}
      </div>

      <footer className="v2-canvas-hint">
        <Icon name="info" size={14}/>
        <span>{tool === 'pan'
          ? '移动模式：拖动画布；触屏支持双指缩放，适应按钮可恢复视图。'
          : '选择零件后可移动和编辑。缩放仅改变预览，不影响实际输出尺寸。'}</span>
      </footer>
    </section>
  );
}
