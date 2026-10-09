import {
  ALLOWED_SOURCE_SIZE_LABEL,
  type InvalidSourceSize,
} from '../features/extraction/source-validation';

interface InputSizeNoticeProps {
  items: InvalidSourceSize[];
  blocked: boolean;
  onClose: () => void;
}

export default function InputSizeNotice({
  items,
  blocked,
  onClose,
}: InputSizeNoticeProps) {
  if (!items.length) return null;

  return (
    <div className="input-gate-backdrop" role="presentation">
      <section
        className="input-gate-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="input-gate-title"
      >
        <div className="input-gate-icon">!</div>
        <div className="input-gate-copy">
          <span className="v2-eyebrow">INPUT SIZE GATE</span>
          <h2 id="input-gate-title">
            {blocked
              ? '没有可继续处理的有效图纸'
              : `已过滤 ${items.length} 张尺寸不符合要求的图纸`}
          </h2>
          <p>
            仅接受 <strong>{ALLOWED_SOURCE_SIZE_LABEL}</strong>。
            {blocked
              ? ' 当前上传内容不会进入后续分割、OCR、拆件和分页流程。'
              : ' 下列图纸已在进入分割/OCR之前跳过，其余有效图纸会继续完成项目排版。'}
          </p>
        </div>

        <div className="input-gate-list">
          {items.map((item, index) => (
            <div
              key={`${item.fileName}-${item.width}x${item.height}-${index}`}
              className="input-gate-item"
            >
              <span>{item.fileName}</span>
              <strong>
                {item.width} × {item.height}
              </strong>
              <em>已过滤</em>
            </div>
          ))}
        </div>

        <div className="input-gate-actions">
          <button autoFocus onClick={onClose}>
            知道了
          </button>
        </div>
      </section>
    </div>
  );
}
