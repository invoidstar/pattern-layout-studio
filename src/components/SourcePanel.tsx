import { useMemo, useState } from 'react';
import type { PatternPart, SourceBox, SourcePoint } from '../domain';
import type { SourceReference } from '../features/project/model';
import { sourceBoxesFor, sourceRegionsFor } from '../features/provenance/source-regions';
import Icon from './ui/Icon';

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
  sources, activeSourceId, onSourceChange, currentPageParts, selectedIds, onSelectionChange,
}: SourcePanelProps) {
  const [showAllContours, setShowAllContours] = useState(true);
  const activeSource = sources.find(s=>s.id===activeSourceId) ?? sources[0] ?? null;

  const traceItems = useMemo<SourceTraceItem[]>(() => {
    if (!activeSource) return [];
    return currentPageParts.flatMap(part=>
      sourceRegionsFor(part)
        .filter(region=>region.sourceId===activeSource.id)
        .flatMap<SourceTraceItem>((region, regionIndex)=>{
          if(region.contours?.length){
            return region.contours.map((contour,contourIndex)=>({
              part, contour, box:region.box, index:regionIndex*1000+contourIndex,
            }));
          }
          return region.box ? [{part, box:region.box, index:regionIndex}] : [];
        })
    );
  },[activeSource,currentPageParts]);

  const selectedBoxes = useMemo(() =>
    activeSource
      ? currentPageParts
          .filter(part=>selectedIds.includes(part.id))
          .flatMap(part=>sourceBoxesFor(part,activeSource.id))
      : [],
    [activeSource,currentPageParts,selectedIds]
  );

  const selectedCount = currentPageParts.filter(part=>selectedIds.includes(part.id)).length;

  return (
    <section className="v2-source-panel" aria-label="原图与精确来源追踪">
      <header className="v2-panel-header">
        <div>
          <span className="v2-eyebrow">SOURCE TRACE</span>
          <h2>原图来源</h2>
          <small>{sources.length ? `共 ${sources.length} 张原图 · 选择零件查看来源` : '上传图纸后显示来源位置'}</small>
        </div>
        <span className="v2-count-badge">{sources.length}</span>
      </header>

      {activeSource ? (
        <>
          <div className="v2-source-tabs" aria-label="原图切换">
            {sources.map((source,index)=>(
              <button
                key={source.id}
                className={`v2-source-tab ${source.id===activeSource.id?'active':''}`}
                title={source.name}
                aria-pressed={source.id===activeSource.id}
                onClick={()=>onSourceChange(source.id)}
              >
                <img src={source.imageUrl} alt=""/>
                <span>S{index+1}</span>
              </button>
            ))}
          </div>
          <div className="v2-source-stage">
            <div className="v2-source-image" style={{aspectRatio:`${activeSource.width} / ${activeSource.height}`}}>
              <img src={activeSource.imageUrl} alt={activeSource.name}/>
              <svg
                className="v2-source-shapes"
                viewBox={`0 0 ${activeSource.width} ${activeSource.height}`}
                preserveAspectRatio="none"
                aria-label="零件来源轮廓"
              >
                {traceItems.filter(item=>showAllContours||selectedIds.includes(item.part.id)).map(({part,contour,box,index})=>{
                  const active=selectedIds.includes(part.id);
                  if(contour?.length){
                    return (
                      <polygon
                        key={`${part.id}-contour-${index}`}
                        points={contour.map(p=>`${p.x},${p.y}`).join(' ')}
                        className={`v2-source-shape ${active?'selected':''}`}
                        role="button"
                        tabIndex={0}
                        aria-label={`查看零件 ${part.name}`}
                        onClick={()=>onSelectionChange([part.id])}
                        onKeyDown={event=>{
                          if(event.key==='Enter'||event.key===' '){
                            event.preventDefault();
                            onSelectionChange([part.id]);
                          }
                        }}
                      />
                    );
                  }
                  return box ? (
                    <rect
                      key={`${part.id}-box-${index}`}
                      x={box.x} y={box.y} width={box.width} height={box.height}
                      className={`v2-source-shape fallback ${active?'selected':''}`}
                      onClick={()=>onSelectionChange([part.id])}
                    />
                  ):null;
                })}
              </svg>
            </div>
          </div>
          <div className="v2-source-meta">
            <span title={activeSource.name}><strong>{activeSource.name}</strong><small>{activeSource.width} × {activeSource.height} px</small></span>
            <label className="v2-source-toggle">
              <input type="checkbox" checked={showAllContours} onChange={event=>setShowAllContours(event.target.checked)}/>
              <span>显示轮廓</span>
            </label>
          </div>
          {selectedCount>0 ? (
            <div className="v2-source-selection">
              <div className="v2-inspector-title">
                <h3><Icon name="cursor" size={15}/> 已选来源</h3>
                <span>{selectedCount} 件 · {selectedBoxes.length} 区域</span>
              </div>
              <div className="v2-source-region-list">
                {selectedBoxes.map((box,index)=>(
                  <div key={index}><b>{index+1}</b><span>X {box.x} · Y {box.y}</span><strong>{box.width}×{box.height}</strong></div>
                ))}
              </div>
            </div>
          ):(
            <p className="v2-source-guide">选择中间画布或零件列表中的部件，这里会高亮它在原图中的精确轮廓。</p>
          )}
          <details className="v2-source-debug">
            <summary><Icon name="info" size={16}/> 查看识别调试视图 <Icon name="chevron-down" size={15}/></summary>
            <div className="v2-debug-grid">
              {[
                {name:'原始 Mask',image:activeSource.debugImages.raw},
                {name:'文字过滤后',image:activeSource.debugImages.afterText},
                {name:'边缘平滑后',image:activeSource.debugImages.smooth},
                {name:'文字区域',image:activeSource.debugImages.textOverlay},
              ].map(item=>(
                <figure key={item.name}><img src={item.image} alt={item.name}/><figcaption>{item.name}</figcaption></figure>
              ))}
            </div>
          </details>
        </>
      ) : (
        <div className="v2-source-empty">
          <Icon name="image" size={37}/>
          <h3>等待导入图纸</h3>
          <p>支持一次选择多张图纸，拆件后可以查看每个零件来自哪张原图。</p>
        </div>
      )}
    </section>
  );
}
