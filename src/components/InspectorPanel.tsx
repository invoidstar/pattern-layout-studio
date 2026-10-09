import { useMemo, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { PatternPart } from '../domain';
import type { PageStat, QualityReport, SourceReference } from '../features/project/model';
import { sourceRegionsFor } from '../features/provenance/source-regions';
import Icon from './ui/Icon';

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

function sourceLabelFor(part: PatternPart, sources: SourceReference[]) {
  const ids = [...new Set(sourceRegionsFor(part).map((region) => region.sourceId))];
  if (part.sourceId && !ids.includes(part.sourceId)) ids.unshift(part.sourceId);
  return ids
    .map((id) => {
      const index = sources.findIndex((s) => s.id === id);
      return index >= 0 ? `S${index + 1}` : 'Source';
    })
    .join(' + ');
}

export default function InspectorPanel({
  pageCount, currentPageIndex, currentPageParts, selectedIds, busy,
  pageStats, moveTargetPage, setMoveTargetPage, onMoveSelected,
  packingGap, setPackingGap, onOptimizePages, hasParts, quality,
  sourceReferences, currentPageStats, overallUtilization, setSelectedIds,
}: InspectorPanelProps) {
  const [search, setSearch] = useState('');
  const [sourceFilter, setSourceFilter] = useState('all');
  const selected = currentPageParts.find(p=>selectedIds.includes(p.id));
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return currentPageParts.filter((part) => {
      const matchesText = !q || part.name.toLowerCase().includes(q);
      const matchesSource = sourceFilter === 'all' ||
        sourceRegionsFor(part).some((region) => region.sourceId === sourceFilter) ||
        part.sourceId === sourceFilter;
      return matchesText && matchesSource;
    });
  }, [currentPageParts, search, sourceFilter]);

  return (
    <aside className="v2-inspector-panel" aria-label="零件和分页管理">
      <header className="v2-panel-header">
        <div><span className="v2-eyebrow">INSPECTOR</span><h2>零件与排版</h2><small>Page {pageCount ? currentPageIndex + 1 : 0} · {currentPageParts.length} 个零件</small></div>
        <span className="v2-count-badge">{currentPageParts.length}</span>
      </header>
      <div className="v2-inspector-scroll">
        {selected && (
          <section className="v2-selected-part">
            <span className="v2-eyebrow">已选零件{selectedIds.length > 1 ? ` · ${selectedIds.length} 个` : ''}</span>
            <div className="v2-selected-card">
              <img src={selected.imageUrl} alt={selected.name}/>
              <div>
                <strong>{selected.name}</strong>
                <span>{selected.width} × {selected.height} px</span>
                <small>{sourceLabelFor(selected, sourceReferences)} · {selected.locked ? '已锁定' : '可编辑'}</small>
              </div>
            </div>
          </section>
        )}

        <section className="v2-inspector-section">
          <div className="v2-inspector-title">
            <h3><Icon name="move" size={16}/> 跨页移动</h3>
            <span>{selectedIds.length ? `已选 ${selectedIds.length}` : '请先选择零件'}</span>
          </div>
          <div className="v2-move-row">
            <select
              aria-label="选择目标页面"
              value={moveTargetPage}
              onChange={event=>setMoveTargetPage(Number(event.target.value))}
              disabled={!pageCount}
            >
              {pageStats.map(page=>(
                <option value={page.pageIndex} key={page.pageIndex}>
                  Page {page.pageIndex+1} · {(page.utilization*100).toFixed(0)}%
                </option>
              ))}
              <option value={pageCount}>新建 Page {pageCount + 1}</option>
            </select>
            <button className="v2-button primary" onClick={()=>onMoveSelected(moveTargetPage)} disabled={!selectedIds.length || busy}>移动</button>
          </div>
          <div className="v2-move-shortcuts">
            <button disabled={!selectedIds.length || currentPageIndex <= 0 || busy} onClick={()=>onMoveSelected(Math.max(0,currentPageIndex-1))}>
              <Icon name="chevron-left" size={15}/> 前一页
            </button>
            <button disabled={!selectedIds.length || busy} onClick={()=>onMoveSelected(Math.min(pageCount,currentPageIndex+1))}>
              后一页 <Icon name="chevron-right" size={15}/>
            </button>
          </div>
        </section>

        <section className="v2-inspector-section">
          <div className="v2-inspector-title"><h3><Icon name="layers" size={16}/> 页面利用率</h3><span>全局回填</span></div>
          <div className="v2-utilization-block">
            <div className="v2-utilization-label"><span>当前页</span><b>{((currentPageStats?.utilization??0)*100).toFixed(1)}%</b></div>
            <div className="v2-progress"><i style={{width:`${Math.max(0,Math.min(100,(currentPageStats?.utilization??0)*100))}%`}}/></div>
            <div className="v2-utilization-label secondary"><span>全部页面</span><b>{(overallUtilization*100).toFixed(1)}%</b></div>
          </div>
          <label className="v2-gap-control">
            <span>零件间距</span>
            <input type="range" min="4" max="32" step="2" value={packingGap} onChange={event=>setPackingGap(Number(event.target.value))}/>
            <b>{packingGap}px</b>
          </label>
          <button className="v2-button soft v2-full-button" onClick={onOptimizePages} disabled={!hasParts||busy}>
            <Icon name="refresh" size={16}/> 全局优化分页
          </button>
        </section>

        <section className="v2-parts-section">
          <div className="v2-inspector-title"><h3><Icon name="list" size={16}/> 当前页零件</h3><span>{filtered.length} / {currentPageParts.length}</span></div>
          <label className="v2-part-search">
            <input value={search} onChange={event=>setSearch(event.target.value)} placeholder="搜索零件名称" aria-label="搜索零件"/>
          </label>
          {sourceReferences.length > 1 && (
            <div className="v2-source-filter" aria-label="来源筛选">
              <button className={sourceFilter==='all'?'active':''} onClick={()=>setSourceFilter('all')}>全部</button>
              {sourceReferences.map((source,index)=>(
                <button key={source.id} className={sourceFilter===source.id?'active':''} title={source.name} onClick={()=>setSourceFilter(source.id)}>S{index+1}</button>
              ))}
            </div>
          )}
          <div className="v2-part-list">
            {filtered.map(part=>(
              <button
                key={part.id}
                className={`v2-part-item ${selectedIds.includes(part.id)?'selected':''}`}
                onClick={event=>{
                  if(event.ctrlKey||event.metaKey||event.shiftKey){
                    setSelectedIds(current=>current.includes(part.id)?current.filter(id=>id!==part.id):[...current,part.id]);
                  }else{setSelectedIds([part.id]);}
                }}
                aria-pressed={selectedIds.includes(part.id)}
              >
                <img src={part.imageUrl} alt=""/>
                <span><strong>{part.name}</strong><small>{part.width} × {part.height}px · {sourceLabelFor(part,sourceReferences)}</small></span>
                {part.locked && <Icon name="lock" size={14}/>}
              </button>
            ))}
            {!filtered.length && (
              <div className="v2-list-empty">{currentPageParts.length ? '没有匹配的零件' : '当前页暂无零件'}</div>
            )}
          </div>
        </section>

        {quality && (
          <details className="v2-quality-details">
            <summary><Icon name="info" size={16}/> 查看处理诊断 <Icon name="chevron-down" size={15}/></summary>
            <div className="v2-quality-grid">
              <span>项目原图 <b>{sourceReferences.length}</b></span>
              <span>提取零件 <b>{quality.componentCount}</b></span>
              <span>原始组件 <b>{quality.rawComponentCount}</b></span>
              <span>归并装饰 <b>{quality.mergedDecorationCount}</b></span>
              <span>文字区域 <b>{quality.textRegions}</b></span>
              <span>几何 / OCR <b>{quality.geometryTextRegions} / {quality.ocrTextRegions}</b></span>
              <span>平滑强度 <b>{quality.smoothing}</b></span>
              <span>拆分力度 <b>{quality.splitStrength}</b></span>
              <span>自动分页 <b>{quality.pageCount}</b></span>
            </div>
          </details>
        )}
      </div>
    </aside>
  );
}
