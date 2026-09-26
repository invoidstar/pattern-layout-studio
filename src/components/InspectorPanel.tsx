import type { Dispatch, SetStateAction } from 'react';
import type { PatternPart } from '../types';
import type {
  PageStat,
  QualityReport,
  SourceReference,
} from '../features/project/model';
import { sourceRegionsFor } from '../features/provenance/source-regions';

interface InspectorPanelProps {
  pageCount: number;
  currentPageIndex: number;
  currentPageParts: PatternPart[];
  selectedIds: string[];
  busy: boolean;
  pageStats: PageStat[];
  moveTargetPage: number;
  setMoveTargetPage: Dispatch<SetStateAction<number>>;
  onMoveSelected: (pageIndex: number) => void;
  packingGap: number;
  setPackingGap: Dispatch<SetStateAction<number>>;
  onOptimizePages: () => void;
  hasParts: boolean;
  quality: QualityReport | null;
  sourceReferences: SourceReference[];
  currentPageStats?: PageStat;
  overallUtilization: number;
  setSelectedIds: Dispatch<SetStateAction<string[]>>;
}

function sourceLabelFor(
  part: PatternPart,
  sourceReferences: SourceReference[],
) {
  const ids = [...new Set(
    sourceRegionsFor(part).map((region) => region.sourceId),
  )];
  if (part.sourceId && !ids.includes(part.sourceId)) {
    ids.unshift(part.sourceId);
  }
  return ids
    .map((id) => {
      const index = sourceReferences.findIndex(
        (source) => source.id === id,
      );
      return index >= 0 ? `S${index + 1}` : 'Source';
    })
    .join('+');
}

export default function InspectorPanel({
  pageCount,
  currentPageIndex,
  currentPageParts,
  selectedIds,
  busy,
  pageStats,
  moveTargetPage,
  setMoveTargetPage,
  onMoveSelected,
  packingGap,
  setPackingGap,
  onOptimizePages,
  hasParts,
  quality,
  sourceReferences,
  currentPageStats,
  overallUtilization,
  setSelectedIds,
}: InspectorPanelProps) {
  return (
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
          <em>
            {selectedIds.length
              ? `已选 ${selectedIds.length}`
              : '未选择'}
          </em>
        </div>

        <div className="page-transfer">
          <select
            value={moveTargetPage}
            onChange={(event) =>
              setMoveTargetPage(Number(event.target.value))
            }
            disabled={!pageCount}
          >
            {pageStats.map((page) => (
              <option key={page.pageIndex} value={page.pageIndex}>
                Page {page.pageIndex + 1} ·{' '}
                {(page.utilization * 100).toFixed(0)}%
              </option>
            ))}
            <option value={pageCount}>
              新建 Page {pageCount + 1}
            </option>
          </select>
          <button
            onClick={() => onMoveSelected(moveTargetPage)}
            disabled={!selectedIds.length || busy}
          >
            移动
          </button>
        </div>

        <div className="transfer-shortcuts">
          <button
            onClick={() =>
              onMoveSelected(Math.max(0, currentPageIndex - 1))
            }
            disabled={
              !selectedIds.length ||
              currentPageIndex <= 0 ||
              busy
            }
          >
            ← 前一页
          </button>
          <button
            onClick={() =>
              onMoveSelected(
                Math.min(pageCount, currentPageIndex + 1),
              )
            }
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
            onChange={(event) =>
              setPackingGap(Number(event.target.value))
            }
          />
          <b>{packingGap}px</b>
        </label>
        <button
          className="optimize-pages"
          onClick={onOptimizePages}
          disabled={!hasParts || busy}
        >
          全局优化分页
        </button>
      </div>

      {quality && (
        <div className="quality-panel">
          <div>
            <span>项目原图</span>
            <strong>{sourceReferences.length}</strong>
          </div>
          <div>
            <span>最终零件</span>
            <strong>{quality.componentCount}</strong>
          </div>
          <div>
            <span>原始组件</span>
            <strong>{quality.rawComponentCount}</strong>
          </div>
          <div>
            <span>内部归并</span>
            <strong>{quality.mergedDecorationCount}</strong>
          </div>
          <div>
            <span>拆分力度</span>
            <strong>{quality.splitStrength}</strong>
          </div>
          <div>
            <span>自动分页</span>
            <strong>{pageCount || quality.pageCount} 页</strong>
          </div>
          <div>
            <span>文字排除</span>
            <strong>{quality.textRegions}</strong>
          </div>
          <div>
            <span>几何 / OCR</span>
            <strong>
              {quality.geometryTextRegions} / {quality.ocrTextRegions}
            </strong>
          </div>
          <div>
            <span>平滑</span>
            <strong>{quality.smoothing}</strong>
          </div>
          <div>
            <span>填孔</span>
            <strong>{quality.morphology.filledHoleCount}</strong>
          </div>
          <div>
            <span>MaxRects</span>
            <strong>{quality.packing.strategy}</strong>
          </div>
          <div>
            <span>当前页零件</span>
            <strong>{currentPageParts.length}</strong>
          </div>
          <div>
            <span>当前页利用率</span>
            <strong>
              {((currentPageStats?.utilization ?? 0) * 100).toFixed(1)}%
            </strong>
          </div>
          <div>
            <span>整体利用率</span>
            <strong>{(overallUtilization * 100).toFixed(1)}%</strong>
          </div>
        </div>
      )}

      <div className="parts-list">
        {currentPageParts.map((part) => (
          <button
            key={part.id}
            className={`part-row ${selectedIds.includes(part.id) ? 'selected' : ''} ${part.overflow ? 'overflow' : ''}`}
            onClick={(event) => {
              if (
                event.ctrlKey ||
                event.metaKey ||
                event.shiftKey
              ) {
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
                  ? ` · ${sourceLabelFor(part, sourceReferences)} · 来源 ${sourceRegionsFor(part).length} 区域`
                  : ''}
              </small>
            </span>
            <em>
              {part.overflow
                ? 'OVERFLOW'
                : part.locked
                  ? 'LOCK'
                  : 'FREE'}
            </em>
          </button>
        ))}
        {!currentPageParts.length && (
          <div className="parts-empty">当前页暂无零件</div>
        )}
      </div>
    </aside>
  );
}
