import { useMemo, useState } from 'react';
import type { PatternPart, SourceBox, SourcePoint } from '../types';
import type { SourceReference } from '../features/project/model';
import {
  sourceBoxesFor,
  sourceRegionsFor,
} from '../features/provenance/source-regions';

interface SourceTraceItem {
  part: PatternPart;
  contour?: SourcePoint[];
  box?: SourceBox;
  index: number;
}

interface SourcePanelProps {
  sources: SourceReference[];
  activeSourceId: string | null;
  onSourceChange: (sourceId: string) => void;
  currentPageParts: PatternPart[];
  selectedIds: string[];
  onSelectionChange: (ids: string[]) => void;
}

export default function SourcePanel({
  sources,
  activeSourceId,
  onSourceChange,
  currentPageParts,
  selectedIds,
  onSelectionChange,
}: SourcePanelProps) {
  const [debugOpen, setDebugOpen] = useState(false);
  const activeSource =
    sources.find((source) => source.id === activeSourceId) ??
    sources[0] ??
    null;

  const traceItems = useMemo<SourceTraceItem[]>(() => {
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
                box: region.box,
                index: regionIndex,
              }]
            : [];
        }),
    );
  }, [currentPageParts, activeSource]);

  const selectedBoxes = useMemo(() => {
    if (!activeSource) return [];
    return currentPageParts
      .filter((part) => selectedIds.includes(part.id))
      .flatMap((part) => sourceBoxesFor(part, activeSource.id));
  }, [activeSource, currentPageParts, selectedIds]);

  const selectedRegionCount = useMemo(
    () =>
      currentPageParts
        .filter((part) => selectedIds.includes(part.id))
        .reduce(
          (total, part) => total + sourceRegionsFor(part).length,
          0,
        ),
    [currentPageParts, selectedIds],
  );

  return (
    <aside className="source-panel">
      <div className="panel-heading source-heading">
        <div>
          <span className="control-label">SOURCE TRACE</span>
          <strong>原图定位</strong>
        </div>
        <span className="panel-page-badge">{sources.length} sources</span>
        <button
          className="debug-toggle"
          onClick={() => setDebugOpen((value) => !value)}
          disabled={!activeSource?.debugImages}
        >
          {debugOpen ? '收起调试' : '调试'}
        </button>
      </div>

      {activeSource ? (
        <>
          {sources.length > 1 && (
            <div className="source-tabs">
              {sources.map((source, index) => (
                <button
                  key={source.id}
                  className={source.id === activeSource.id ? 'active' : ''}
                  onClick={() => onSourceChange(source.id)}
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
              style={{
                aspectRatio: `${activeSource.width} / ${activeSource.height}`,
              }}
            >
              <img src={activeSource.imageUrl} alt={activeSource.name} />
              <svg
                className="source-shape-layer"
                viewBox={`0 0 ${activeSource.width} ${activeSource.height}`}
                preserveAspectRatio="none"
                aria-label="原图精确来源轮廓"
              >
                {traceItems.map(({ part, contour, box, index }) => {
                  const active = selectedIds.includes(part.id);
                  if (contour?.length) {
                    return (
                      <polygon
                        key={`${part.id}-contour-${index}`}
                        points={contour
                          .map((point) => `${point.x},${point.y}`)
                          .join(' ')}
                        className={`source-shape ${active ? 'active' : ''}`}
                        onClick={() => onSelectionChange([part.id])}
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
                      onClick={() => onSelectionChange([part.id])}
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
              <strong>{traceItems.length} 个当前页映射</strong>
            </div>
          </div>

          <div className="source-selection">
            {selectedIds.length ? (
              <>
                <div className="source-selection-title">
                  <strong>已选 {selectedIds.length} 个零件</strong>
                  <span>
                    当前原图 {selectedBoxes.length} 区域 · 总计 {selectedRegionCount}
                  </span>
                </div>
                <div className="source-region-list">
                  {selectedBoxes.map((box, index) => (
                    <div key={`selected-source-${index}`}>
                      <b>{index + 1}</b>
                      <span>x {box.x} · y {box.y}</span>
                      <em>{box.width} × {box.height}px</em>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <p>
                点击右侧零件或原图上的精确轮廓，即可查看转换后的零件来自原图哪个位置。
              </p>
            )}
          </div>

          {debugOpen && activeSource.debugImages && (
            <div className="debug-grid source-debug-grid">
              <figure>
                <img src={activeSource.debugImages.raw} alt="" />
                <figcaption>Raw mask</figcaption>
              </figure>
              <figure>
                <img src={activeSource.debugImages.afterText} alt="" />
                <figcaption>文字过滤后</figcaption>
              </figure>
              <figure>
                <img src={activeSource.debugImages.smooth} alt="" />
                <figcaption>平滑 mask</figcaption>
              </figure>
              <figure>
                <img src={activeSource.debugImages.textOverlay} alt="" />
                <figcaption>文字检测框</figcaption>
              </figure>
            </div>
          )}
        </>
      ) : (
        <div className="source-empty">
          <strong>等待图片项目</strong>
          <span>可一次选择多张图片，处理后在这里切换查看来源。</span>
        </div>
      )}
    </aside>
  );
}
