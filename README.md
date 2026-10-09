<div align="center">

# Pattern Layout Studio

### 图纸拆件 · 原图追踪 · 多页智能排版

让一张或多张图纸，从自动拆件到打印导出，都在浏览器工作台中完成。

[![Version](https://img.shields.io/badge/Version-2.0-5567c7?style=flat-square)](https://github.com/invoidstar/pattern-layout-studio)
[![React](https://img.shields.io/badge/React-19-149eca?style=flat-square&logo=react)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-Checked-3178c6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-App-646cff?style=flat-square&logo=vite)](https://vite.dev/)
[![Pages](https://img.shields.io/badge/Deploy-GitHub%20Pages-232a36?style=flat-square&logo=github)](https://invoidstar.github.io/pattern-layout-studio/)

**[在线体验 →](https://invoidstar.github.io/pattern-layout-studio/)** · [功能介绍](#功能亮点) · [本地运行](#快速开始) · [项目架构](docs/ARCHITECTURE.md)

</div>

---

## 项目介绍

**Pattern Layout Studio** 是一个面向图纸处理与打印排版的浏览器工具。从带背景、文字标注和复杂零件的原图中提取可编辑部件，再将不同图纸的零件统一放置到有限尺寸的目标页面。

核心流程：

```mermaid
flowchart LR
  A["上传一张或多张图纸"] --> B["尺寸预检"]
  B --> C["形状级拆件"]
  C --> D["来源轮廓追踪"]
  D --> E["全局多页排版"]
  E --> F["人工编辑"]
  F --> G["PNG / ZIP 导出"]
```

**核心约束：Packing 不会缩放零件。** 布局系统只改变零件在 Page 上的位置，不会偷偷改变部件的实际像素尺寸。

## V2.0 · 全新工作台

V2.0 重点提升操作体验，保留现有的 Vision 和 Packing 处理主链路。

| 更新 | 内容 |
| --- | --- |
| **桌面工作台** | 顶部项目操作栏，左侧 Source Trace、中间画布、右侧零件检查器 |
| **手机端** | 原生思路的「画布 / 原图 / 零件」底部导航，不再把三栏生硬叠成长页面 |
| **画布交互** | 选择、移动画布、恢复画笔、橡皮擦四个独立模式；缩放、适应、平移和双指手势 |
| **处理设置** | OCR、文字过滤、边缘平滑、拆分力度集中在设置抽屉中 |
| **更新公告** | 最新公告提示、历史版本列表、已读状态记录，用户可随时重新打开 |
| **样式整理** | 统一设计变量和移动端规则，删除历史 v1.x CSS 叠加覆盖 |
| **流量统计** | 不再使用不蒜子；Cloudflare Workers + D1 预留接口但 **暂未启用** |

### 桌面端

工作台以 **Canvas Editor** 为核心。源图、当前页零件和分页工具都在同一操作视野内，高级设置和导出使用独立抽屉，避免干扰画布。

### 手机端

屏幕底部可在 **画布 / 原图 / 零件** 之间快速切换。画布编辑时可选择「移动画布」模式进行单指平移、双指缩放；需要修改实际零件时切回「选择 / 画笔 / 橡皮擦」模式。

**画布缩放只影响预览，不影响导出尺寸。**

## 功能亮点

| 功能 | 说明 |
| --- | --- |
| 🖼️ 多图项目 | 一次导入多张图片，所有有效图片的零件统一参与分页 |
| 📐 尺寸过滤 | 仅接受 `3500×3500`、`2970×2100`、`2100×2970` |
| ✂️ 精确 Mask | 连通域标签 + 形状级裁切，避免外接矩形混入邻近零件 |
| 🎨 颜色保留 | 保留主体内部原始 RGB，减少脸部/衣服浅色区域误透明 |
| 🔎 来源追踪 | 在原图上高亮精确轮廓，跨原图合并仍保留各自来源 |
| 🧩 装饰归并 | 保守模式下优先保留衣服图案等属于主体的内部小块 |
| 📄 自动分页 | MaxRects + 全局整页合并 + 后页零件回填 |
| ↔️ 跨页调整 | 零件可从 Page 2 移到 Page 1，也可新建页面 |
| 🖌️ 手动修正 | 连续恢复画笔、橡皮擦、合并、拆分、锁定、撤销和重做 |
| 📦 导出 | 当前页 PNG，或所有页面打包 ZIP；附带 DPI 元数据 |

## 如何使用

1. **添加图纸**：在工作台点击「添加图纸」，可一次选多张 PNG、JPEG 或 WebP。尺寸不符合要求的图片会在拆件前被过滤并提示。
2. **检查拆件**：自动处理完成后，点击任意零件，在「原图」中查看对应来源轮廓；需要修边时切换画笔或橡皮擦。
3. **优化排版**：查看 Page 利用率，使用全局自动优化，或者手动把零件移动到其它 Page。
4. **导出页面**：点击「导出」，选择当前页 PNG 或全部页面 ZIP，按需设置 DPI。

当前目标页面规格为：

- **方形**：3500 × 3500
- **A4 横版**：2970 × 2100

对于较大的复杂图纸，浏览器端运算可能需要一些时间；可选择关闭 OCR 增强加快处理。

## 技术结构

V2.0 在已有模块化基础上将 UI、项目流程、算法和数据类型分开维护。

```text
src/
├─ app/                 应用状态与整体流程
├─ components/          桌面/手机 UI、公告、面板
├─ content/             更新公告内容
├─ core/
│  ├─ vision/           图像分割、Mask、OCR、轮廓
│  ├─ layout/           MaxRects、页面合并、回填
│  └─ export/           PNG DPI、ZIP 输出
├─ domain/              零件、来源和页面数据模型
├─ features/
│  ├─ extraction/       单图处理
│  ├─ project/          多图统一项目
│  ├─ provenance/       来源追踪
│  └─ layout/           排版与跨页移动
├─ hooks/               画布平移与缩放
├─ services/analytics/  统计接口（默认禁用）
└─ styles/              Design Tokens、工作台、手机端样式
```

[查看完整架构说明](docs/ARCHITECTURE.md)

## 快速开始

**要求**：Node.js 20+、npm。

```bash
git clone https://github.com/invoidstar/pattern-layout-studio.git
cd pattern-layout-studio
npm install
npm run dev
```

质量检查与生产构建：

```bash
npm run typecheck
npm run build
npm run preview
```

GitHub Pages 使用 `.github/workflows/pages.yml` 自动发布 `main` 分支。

## 数据与隐私

- 上传图纸在浏览器本地处理，不需要将原始图片上传到应用服务器。
- OCR 增强在启用时按需加载 OCR 运行时/语言模型。
- **当前不会收集 PV 或 UV**：不蒜子脚本已移除；分析接口保留在 `src/services/analytics/`，但禁用状态下不会发送访问记录请求。
- Cloudflare Workers + D1 是未来可选扩展，尚未部署，不显示模拟统计数据。
- 刷新页面前请导出所需结果；当前版本不承诺云端项目持久保存。

## 版本记录

| 版本 | 主要内容 |
| --- | --- |
| **V2.0** | 工作台与移动端重构、画布缩放平移、公告、统计预留接口、CSS 清理 |
| V1.8.1 | 输入图纸尺寸预检 |
| V1.8 | 工程模块化、README 展示与基础流量统计 |
| V1.7 | 多图项目统一拆件和排版 |
| V1.6 | 跨页移动、全局页面压缩 |
| V1.5 | 精确 Mask、颜色保留、画笔/拆分修复 |
| V1.4 | Source Trace |
| V1.3 | 自动多页与 ZIP |

历史实现与验收记录保存在 [`docs/`](docs/)。

---

<div align="center">

**Pattern Layout Studio · Edit with confidence. Pack without scaling.**

[在线使用](https://invoidstar.github.io/pattern-layout-studio/) · [架构说明](docs/ARCHITECTURE.md) · [问题反馈](https://github.com/invoidstar/pattern-layout-studio/issues)

</div>
