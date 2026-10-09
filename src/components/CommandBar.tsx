import { useEffect, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { SmoothingMode } from '../core/vision/morphology';
import type { SplitStrength } from '../core/vision/segmentation';
import type { TextFilterStrength } from '../core/vision/text-filter';
import { ALLOWED_SOURCE_SIZE_LABEL } from '../features/extraction/source-validation';
import {
  EXPORT_BACKGROUND_PRESETS,
  resolveExportBackground,
  type ExportBackgroundMode,
} from '../features/export/background';
import Icon from './ui/Icon';

interface CommandBarProps {
  busy: boolean;
  sourceInfo: string;
  sourceCount: number;
  partCount: number;
  pageCount: number;
  onFiles: (files: File[]) => void;
  textExclude: boolean;
  setTextExclude: Dispatch<SetStateAction<boolean>>;
  textStrength: TextFilterStrength;
  setTextStrength: Dispatch<SetStateAction<TextFilterStrength>>;
  ocrEnhanced: boolean;
  setOcrEnhanced: Dispatch<SetStateAction<boolean>>;
  smoothing: SmoothingMode;
  setSmoothing: Dispatch<SetStateAction<SmoothingMode>>;
  splitStrength: SplitStrength;
  setSplitStrength: Dispatch<SetStateAction<SplitStrength>>;
  targetKey: 'square' | 'a4';
  onTargetChange: (target: 'square' | 'a4') => void;
  onRelayout: () => void;
  hasParts: boolean;
  dpi: number;
  setDpi: Dispatch<SetStateAction<number>>;
  detectedBackgroundCss: string;
  exportBackgroundMode: ExportBackgroundMode;
  setExportBackgroundMode: Dispatch<SetStateAction<ExportBackgroundMode>>;
  exportCustomColor: string;
  setExportCustomColor: Dispatch<SetStateAction<string>>;
  canExportCurrent: boolean;
  canExportAll: boolean;
  onExportCurrent: () => void;
  onExportAll: () => void;
}

export default function CommandBar({
  busy, sourceInfo, sourceCount, partCount, pageCount, onFiles,
  textExclude, setTextExclude, textStrength, setTextStrength,
  ocrEnhanced, setOcrEnhanced, smoothing, setSmoothing,
  splitStrength, setSplitStrength, targetKey, onTargetChange,
  onRelayout, hasParts, dpi, setDpi,
  detectedBackgroundCss,
  exportBackgroundMode, setExportBackgroundMode,
  exportCustomColor, setExportCustomColor,
  canExportCurrent, canExportAll, onExportCurrent, onExportAll,
}: CommandBarProps) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<File[] | null>(null);

  useEffect(() => {
    if (!settingsOpen && !exportOpen && !pendingFiles) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSettingsOpen(false);
        setExportOpen(false);
        setPendingFiles(null);
      }
    };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [settingsOpen, exportOpen, pendingFiles]);

  const modalOpen = settingsOpen || exportOpen || !!pendingFiles;
  return (
    <>
      <section className="v2-projectbar" aria-label="项目与操作">
        <div className="v2-project-info">
          <span className="v2-project-glyph"><Icon name="file-image" size={20}/></span>
          <div className="v2-project-name">
            <span className="v2-eyebrow">CURRENT PROJECT</span>
            <strong>我的图纸项目</strong>
            <small title={sourceInfo}>{sourceInfo}</small>
          </div>
          <div className="v2-project-metrics" aria-label="项目统计">
            <span><b>{sourceCount}</b> 张原图</span>
            <span><b>{partCount}</b> 个零件</span>
            <span><b>{pageCount}</b> 页</span>
          </div>
        </div>

        <div className="v2-project-actions">
          <label className={`v2-button upload-button ${busy ? 'disabled' : ''}`}>
            <Icon name="plus" size={17}/>
            <span>导入图纸</span>
            <input
              aria-label="选择要处理的图纸，可多选"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              multiple
              disabled={busy}
              onChange={(event) => {
                const files = Array.from(event.target.files ?? []);
                if (files.length) {
                  if (hasParts) setPendingFiles(files);
                  else onFiles(files);
                }
                event.currentTarget.value = '';
              }}
            />
          </label>
          <button className="v2-button soft" type="button" onClick={() => setSettingsOpen(true)}>
            <Icon name="settings" size={17}/><span>处理设置</span>
          </button>
          <button className="v2-button primary" type="button" onClick={() => setExportOpen(true)}>
            <Icon name="download" size={17}/><span>导出</span>
          </button>
        </div>
      </section>

      <div className="v2-project-secondary">
        <div className="v2-output-tabs" aria-label="输出画布规格">
          <span>输出画布</span>
          <button type="button" className={targetKey === 'a4' ? 'active' : ''} onClick={() => onTargetChange('a4')} disabled={busy}>
            A4 · 2970×2100
          </button>
          <button type="button" className={targetKey === 'square' ? 'active' : ''} onClick={() => onTargetChange('square')} disabled={busy}>
            方形 · 3500×3500
          </button>
        </div>
        <span className="v2-import-hint"><Icon name="info" size={14}/> 上传尺寸：{ALLOWED_SOURCE_SIZE_LABEL}</span>
      </div>

      {modalOpen && (
        <div className="v2-modal-backdrop" onPointerDown={(event) => {
          if (event.target === event.currentTarget) {
            setSettingsOpen(false);
            setExportOpen(false);
            setPendingFiles(null);
          }
        }}>
          {settingsOpen ? (
            <section className="v2-modal-card v2-settings-dialog" role="dialog" aria-modal="true" aria-labelledby="process-settings-title">
              <div className="v2-modal-header">
                <div><span className="v2-eyebrow">PROCESSING OPTIONS</span><h2 id="process-settings-title">处理设置</h2></div>
                <button className="v2-icon-button" onClick={() => setSettingsOpen(false)} aria-label="关闭设置"><Icon name="x"/></button>
              </div>
              <p className="v2-settings-note">以下参数会在下次上传图纸时生效；已完成拆件的零件不会被悄悄改变。</p>
              <div className="v2-settings-grid">
                <label className="v2-setting-field v2-setting-switch">
                  <span><strong>自动排除文字</strong><small>去除画面上的说明文字和编号</small></span>
                  <input type="checkbox" checked={textExclude} onChange={event=>setTextExclude(event.target.checked)}/>
                </label>
                <label className="v2-setting-field">
                  <span><strong>文字过滤强度</strong><small>如果装饰被误删，可以改为较弱模式</small></span>
                  <select value={textStrength} disabled={!textExclude} onChange={event=>setTextStrength(event.target.value as TextFilterStrength)}>
                    <option value="weak">弱</option><option value="medium">标准（推荐）</option><option value="strong">强</option>
                  </select>
                </label>
                <label className="v2-setting-field v2-setting-switch">
                  <span><strong>OCR 增强</strong><small>额外识别中英文，处理时间较长</small></span>
                  <input type="checkbox" checked={ocrEnhanced} disabled={!textExclude} onChange={event=>setOcrEnhanced(event.target.checked)}/>
                </label>
                <label className="v2-setting-field">
                  <span><strong>边缘平滑</strong><small>减少锯齿，避免过强平滑吞掉细节</small></span>
                  <select value={smoothing} onChange={event=>setSmoothing(event.target.value as SmoothingMode)}>
                    <option value="off">关闭</option><option value="standard">标准（推荐）</option><option value="strong">强</option>
                  </select>
                </label>
                <label className="v2-setting-field">
                  <span><strong>拆分力度</strong><small>保守模式优先把内部图案归回主体</small></span>
                  <select value={splitStrength} onChange={event=>setSplitStrength(event.target.value as SplitStrength)}>
                    <option value="conservative">保守（推荐）</option><option value="standard">标准</option><option value="fine">精细</option>
                  </select>
                </label>
              </div>
              <div className="v2-modal-footer">
                <button className="v2-button soft" onClick={() => { if (hasParts && !busy) onRelayout(); setSettingsOpen(false); }} disabled={!hasParts || busy}>重新优化现有分页</button>
                <button className="v2-button primary" onClick={() => setSettingsOpen(false)}>完成</button>
              </div>
            </section>
          ) : exportOpen ? (
            <section className="v2-modal-card v2-export-dialog" role="dialog" aria-modal="true" aria-labelledby="export-dialog-title">
              <div className="v2-modal-header">
                <div><span className="v2-eyebrow">OUTPUT</span><h2 id="export-dialog-title">导出图纸</h2></div>
                <button className="v2-icon-button" onClick={() => setExportOpen(false)} aria-label="关闭导出"><Icon name="x"/></button>
              </div>
              <div className="v2-export-overview">
                <Icon name="archive" size={24}/>
                <span>输出 {pageCount} 页 · {targetKey === 'a4' ? '2970 × 2100' : '3500 × 3500'} · 零件原尺寸</span>
              </div>
              <fieldset className="v2-export-background">
                <legend>导出背景</legend>
                <p>仅改变输出图片的背景，不会修改原图、零件颜色或排版。</p>
                <div className="v2-export-bg-options">
                  {([
                    { value: 'detected', label: '原图背景', note: '默认' },
                    { value: 'white', label: '纯白背景', note: '#FFFFFF' },
                    { value: 'custom', label: '自定义颜色', note: exportCustomColor.toUpperCase() },
                    { value: 'transparent', label: '透明背景', note: 'Alpha 通道' },
                  ] as const).map((option) => {
                    const selected = exportBackgroundMode === option.value;
                    const swatch = resolveExportBackground(
                      option.value,
                      detectedBackgroundCss,
                      exportCustomColor,
                    );
                    return (
                      <label
                        key={option.value}
                        className={`v2-export-bg-option ${selected ? 'active' : ''}`}
                      >
                        <input
                          type="radio"
                          name="export-background"
                          value={option.value}
                          checked={selected}
                          onChange={() => setExportBackgroundMode(option.value)}
                        />
                        <span
                          className={`v2-export-bg-swatch ${swatch === 'transparent' ? 'is-transparent' : ''}`}
                          style={swatch !== 'transparent' ? { backgroundColor: swatch } : undefined}
                          aria-hidden="true"
                        />
                        <span className="v2-export-bg-label">
                          <strong>{option.label}</strong>
                          <small>{option.note}</small>
                        </span>
                      </label>
                    );
                  })}
                </div>
                {exportBackgroundMode === 'custom' && (
                  <div className="v2-export-custom">
                    <div className="v2-export-custom-picker">
                      <label htmlFor="export-custom-color">背景颜色</label>
                      <input
                        id="export-custom-color"
                        type="color"
                        value={exportCustomColor}
                        onChange={(event) => setExportCustomColor(event.target.value)}
                        aria-label="自定义导出背景颜色"
                      />
                      <code>{exportCustomColor.toUpperCase()}</code>
                    </div>
                    <div className="v2-export-color-presets" aria-label="快速选择背景颜色">
                      {EXPORT_BACKGROUND_PRESETS.map((preset) => (
                        <button
                          key={preset.color}
                          type="button"
                          title={`${preset.label} ${preset.color}`}
                          aria-label={`使用${preset.label}背景`}
                          className={exportCustomColor === preset.color ? 'active' : ''}
                          style={{ backgroundColor: preset.color }}
                          onClick={() => setExportCustomColor(preset.color)}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </fieldset>
              <label className="v2-setting-field v2-export-dpi">
                <span><strong>输出 DPI</strong><small>写入 PNG pHYs 元数据</small></span>
                <input type="number" min="72" max="1200" value={dpi} onChange={event=>setDpi(Math.min(1200,Math.max(72,Number(event.target.value)||300)))}/>
              </label>
              <div className="v2-export-options">
                <button disabled={!canExportCurrent || busy} onClick={()=>{setExportOpen(false);onExportCurrent();}}>
                  <Icon name="file-image" size={22}/>
                  <span><strong>导出当前页 PNG</strong><small>导出当前正在查看的页面</small></span>
                  <Icon name="chevron-right" size={18}/>
                </button>
                <button disabled={!canExportAll || busy} onClick={()=>{setExportOpen(false);onExportAll();}}>
                  <Icon name="archive" size={22}/>
                  <span><strong>导出全部页面 ZIP</strong><small>每个 Page 对应一张 PNG</small></span>
                  <Icon name="chevron-right" size={18}/>
                </button>
              </div>
            </section>
          ) : (
            <section className="v2-modal-card" role="dialog" aria-modal="true" aria-labelledby="replace-project-title">
              <div className="v2-modal-header">
                <div><span className="v2-eyebrow">NEW PROJECT</span><h2 id="replace-project-title">重新导入图纸？</h2></div>
                <button className="v2-icon-button" onClick={() => setPendingFiles(null)} aria-label="取消导入"><Icon name="x"/></button>
              </div>
              <p className="v2-settings-note">
                当前已有 {partCount} 个零件。重新导入会替换当前项目，尚未导出的编辑内容会丢失。
                即将导入 {pendingFiles?.length ?? 0} 张新图纸。
              </p>
              <div className="v2-modal-footer">
                <button className="v2-button soft" onClick={() => setPendingFiles(null)}>保留当前项目</button>
                <button className="v2-button primary" onClick={() => {
                  if (pendingFiles?.length) onFiles(pendingFiles);
                  setPendingFiles(null);
                }}>替换并导入</button>
              </div>
            </section>
          )}
        </div>
      )}
    </>
  );
}
