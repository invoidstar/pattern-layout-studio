export interface Announcement {
  id: string;
  version: string;
  date: string;
  category: 'major' | 'feature' | 'fix';
  title: string;
  summary: string;
  changes: string[];
}

export const ANNOUNCEMENTS: Announcement[] = [
  {
    id: 'v2.0-workspace-redesign',
    version: 'V2.0',
    date: '2026-10-09',
    category: 'major',
    title: '全新工作台与手机端体验',
    summary: '工作区布局重新设计，提升画布操作与分页管理体验，并加入更新公告。',
    changes: [
      '桌面端重构为简洁的项目栏、主画布、原图来源和零件检查器。',
      '手机端新增「画布 / 原图 / 零件」底部导航及适合触控的编辑工具。',
      '支持画布适应、放大、缩小、平移，移动模式下可双指缩放。',
      '高级识别设置收纳到设置面板，减少工作台长期显示的控件。',
      '上线更新公告与历史版本入口，首次访问仅提示，不强制弹窗。',
      '移除不蒜子；统计服务留有扩展接口，Cloudflare Workers + D1 暂未启用。'
    ]
  },
  {
    id: 'v1.8.1-input-size-gate',
    version: 'V1.8.1',
    date: '2026-09-27',
    category: 'fix',
    title: '图纸尺寸过滤',
    summary: '上传前校验图纸尺寸，自动跳过不符合要求的图片。',
    changes: [
      '支持 3500 × 3500、A4 横版 2970 × 2100 和 A4 竖版 2100 × 2970。',
      '多张图片中只有合法图纸进入拆件流程，非法文件会列出原因。'
    ]
  },
  {
    id: 'v1.7-multi-source',
    version: 'V1.7',
    date: '2026-09-27',
    category: 'feature',
    title: '多图统一分页',
    summary: '可一次选择多张图纸，统一拆件和全局排版。',
    changes: [
      '所有有效来源零件汇入同一布局项目。',
      '来源追踪仍按原图分别保存，支持跨原图的零件合并。'
    ]
  },
  {
    id: 'v1.6-global-pages',
    version: 'V1.6',
    date: '2026-09-27',
    category: 'feature',
    title: '跨页移动与利用率优化',
    summary: '支持跨 Page 移动零件，并在自动布局后跨页回填。',
    changes: [
      '目标页重排校验后才接受移动。',
      '自动尝试整页合并与后页小零件回填。'
    ]
  }
];

export const LATEST_ANNOUNCEMENT = ANNOUNCEMENTS[0];
export const ANNOUNCEMENT_STORAGE_PREFIX = 'pattern-layout-announcement-seen:';
