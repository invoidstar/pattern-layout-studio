import type { Dispatch, SetStateAction } from 'react';
import type { SmoothingMode } from '../core/vision/morphology';
import type { SplitStrength } from '../core/vision/segmentation';
import type { TextFilterStrength } from '../core/vision/text-filter';

interface CommandBarProps {
  busy: boolean;
  sourceInfo: string;
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
  hasParts: boolean;
  dpi: number;
  setDpi: Dispatch<SetStateAction<number>>;
  canExportCurrent: boolean;
  canExportAll: boolean;
  onExportCurrent: () => void;
  onExportAll: () => void;
}

export default function CommandBar({
  busy,
  sourceInfo,
  onFiles,
  textExclude,
  setTextExclude,
  textStrength,
  setTextStrength,
  ocrEnhanced,
  setOcrEnhanced,
  smoothing,
  setSmoothing,
  splitStrength,
  setSplitStrength,
  targetKey,
  onTargetChange,
  hasParts,
  dpi,
  setDpi,
  canExportCurrent,
  canExportAll,
  onExportCurrent,
  onExportAll,
}: CommandBarProps) {
  return (
    <section className="control-grid v12-grid v16-commandbar">
      <label className="upload-card">
        <span className="control-label">1 · 上传图片</span>
        <strong>{busy ? '批量处理中…' : '选择一张或多张图片'}</strong>
        <small>{sourceInfo}</small>
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          multiple
          disabled={busy}
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            if (files.length) onFiles(files);
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
          onChange={(event) =>
            setTextStrength(event.target.value as TextFilterStrength)
          }
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
        <span className="control-label">3 · 边缘与拆分</span>
        <select
          value={smoothing}
          onChange={(event) =>
            setSmoothing(event.target.value as SmoothingMode)
          }
        >
          <option value="off">边缘平滑：关闭</option>
          <option value="standard">边缘平滑：标准（推荐）</option>
          <option value="strong">边缘平滑：强</option>
        </select>
        <select
          value={splitStrength}
          onChange={(event) =>
            setSplitStrength(event.target.value as SplitStrength)
          }
        >
          <option value="conservative">拆分力度：保守（推荐）</option>
          <option value="standard">拆分力度：标准</option>
          <option value="fine">拆分力度：精细</option>
        </select>
        <small>
          保守模式会把内部装饰并回主体。页面间距可在右侧 Inspector 中调整。
        </small>
      </div>

      <div className="control-card">
        <span className="control-label">4 · 目标与导出</span>
        <div className="segmented">
          <button
            className={targetKey === 'square' ? 'active' : ''}
            onClick={() => onTargetChange('square')}
            disabled={!hasParts || busy}
          >
            3500²
          </button>
          <button
            className={targetKey === 'a4' ? 'active' : ''}
            onClick={() => onTargetChange('a4')}
            disabled={!hasParts || busy}
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
            onChange={(event) =>
              setDpi(Math.max(72, Number(event.target.value) || 300))
            }
          />
          <span>DPI</span>
          <button
            className="primary"
            onClick={onExportCurrent}
            disabled={!canExportCurrent || busy}
          >
            当前页
          </button>
        </div>
        <button
          className="secondary-export"
          onClick={onExportAll}
          disabled={!canExportAll || busy}
        >
          导出全部页 ZIP
        </button>
      </div>
    </section>
  );
}
