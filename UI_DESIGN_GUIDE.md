# Memoir UI 设计系统规范

> 本文档完整描述 Memoir 笔记应用的 UI 风格，用于在其他项目中复刻相同的视觉效果。
> 技术栈：React + TypeScript + Tailwind CSS v4 + CSS 变量主题系统

---

## 一、设计理念

- **暖色调纸张感**：不是纯白纯黑，而是带暖黄的米白和深棕黑，像纸质笔记本
- **低饱和强调色**：默认强调色是深灰墨色（#343532），不是蓝色，整体克制不刺眼
- **圆润但不夸张**：圆角 8-16px，按钮 10px，卡片 8-12px，窗口 16px
- **细腻边框**：边框用暖灰色，不是纯黑纯白，有层次感
- **微动效**：过渡 140-200ms，缓动函数 cubic-bezier(0.22, 1, 0.36, 1)
- **自定义标题栏**：无边框窗口，自己绘制窗口控制按钮

---

## 二、颜色系统

所有颜色通过 CSS 变量定义，支持浅色/深色主题切换，通过 `data-theme="dark"` 切换。

### 浅色主题（默认）

| 变量名 | 色值 | 用途 |
|--------|------|------|
| `--memoir-canvas` | `#fbfaf6` | 最底层背景（窗口背景） |
| `--memoir-panel` | `#f5f3ee` | 面板背景（侧边栏） |
| `--memoir-elevated` | `#fffefb` | 悬浮元素背景（卡片、弹窗） |
| `--memoir-border` | `#e7e3db` | 边框颜色 |
| `--memoir-text` | `#292a27` | 主文字 |
| `--memoir-muted` | `#8c8982` | 次要文字、占位符 |
| `--memoir-accent` | `#343532` | 强调色（按钮、选中态、链接） |
| `--memoir-accent-soft` | `#e7e5df` | 强调色浅色背景（悬停、选中背景） |
| `--memoir-accent-contrast` | `#ffffff` | 强调色上的文字颜色 |
| `--memoir-danger` | `#c94c41` | 危险/删除 |

### 深色主题

| 变量名 | 色值 | 用途 |
|--------|------|------|
| `--memoir-canvas` | `#171714` | 最底层背景 |
| `--memoir-panel` | `#1d1d1a` | 面板背景 |
| `--memoir-elevated` | `#24241f` | 悬浮元素背景 |
| `--memoir-border` | `#37362f` | 边框 |
| `--memoir-text` | `#f0eee8` | 主文字 |
| `--memoir-muted` | `#a5a198` | 次要文字 |
| `--memoir-accent` | `#efede7` | 强调色（浅色，深色模式下反色） |
| `--memoir-accent-soft` | `#393832` | 强调色浅色背景 |
| `--memoir-accent-contrast` | `#171715` | 强调色上的文字 |
| `--memoir-danger` | `#ef766b` | 危险/删除 |

### 可选强调色主题（通过 `data-accent` 切换）

| 主题 | accent | accent-soft |
|------|--------|-------------|
| ink（默认墨色） | `#343532` | `#e7e5df` |
| coral（珊瑚） | `#d65f4d` | `#f6e3de` |
| blue（蓝色） | `#3f7edb` | `#e7effb` |
| green（绿色） | `#3e9b73` | `#e5f3ed` |
| gold（金色） | `#b98b09` | `#f8f0d6` |
| violet（紫色） | `#8a65d1` | `#eee8f9` |
| slate（石板灰） | `#607287` | `#e9edf1` |

### 代码高亮颜色

| 类型 | 浅色 | 深色 |
|------|------|------|
| keyword | `#8a4e30` | `#e0a57a` |
| string | `#2d7a56` | `#86c4a4` |
| number | `#b56a16` | `#e0b36a` |
| function | `#3d5f8f` | `#8fb0dd` |
| type | `#6a548f` | `#b7a3dd` |
| property | `#5c6848` | `#b3c49a` |

---

## 三、字体

### 主字体

```css
font-family: "Nanxi Round", Inter, "SF Pro Text", "PingFang SC", "Microsoft YaHei", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
```

- 首选 **南西新圆体**（免费商用，打包内置），圆润可爱
- 英文回退 Inter / SF Pro
- 中文回退 PingFang SC / 微软雅黑

### 等宽字体

```css
font-family: "SFMono-Regular", "Cascadia Code", "Roboto Mono", Menlo, Monaco, Consolas, "PingFang SC", "Microsoft YaHei", ui-monospace, monospace;
```

### 字号与行高

- 正文：`15px`，行高 `1.8`
- 小字/辅助：`11-13px`
- 标题：根据层级 16-24px
- 字间距：`-0.006em`（轻微收紧）

### 字体渲染

```css
font-synthesis: none;
text-rendering: optimizeLegibility;
-webkit-font-smoothing: antialiased;
```

---

## 四、间距与圆角

### 间距系统（4px 基准）

| 类名 | 值 | 用途 |
|------|-----|------|
| 1 | 4px | 极小间距 |
| 1.5 | 6px | |
| 2 | 8px | 按钮内边距、小间距 |
| 2.5 | 10px | |
| 3 | 12px | 卡片内边距、标准间距 |
| 3.5 | 14px | |
| 4 | 16px | 大间距 |
| 5 | 20px | |
| 6 | 24px | 区块间距 |
| 8 | 32px | 大区块间距 |

### 圆角

| 元素 | 圆角 |
|------|------|
| 窗口 | 16px |
| 卡片/面板 | 8-12px |
| 按钮 | 10px |
| 输入框 | 10px |
| 标签/tag | 6-8px |
| 小圆点/头像 | 999px（全圆） |

### 阴影

浅色模式：
```css
box-shadow:
  0 1px 2px rgb(48 42 34 / 5%),
  0 3px 8px -2px rgb(48 42 34 / 6%),
  inset 0 1px rgb(255 255 255 / 50%);
```

深色模式：
```css
box-shadow:
  0 1px 2px rgb(0 0 0 / 16%),
  0 4px 10px -2px rgb(0 0 0 / 14%),
  inset 0 1px rgb(255 255 255 / 5%);
```

---

## 五、组件规范

### 按钮

**主按钮（primary）**
- 背景：`var(--memoir-accent)`
- 文字：`var(--memoir-accent-contrast)`
- 悬停：轻微变暗/变亮
- 圆角：10px
- 内边距：8px 16px
- 字号：13px

**次按钮（secondary/ghost）**
- 背景：透明
- 文字：`var(--memoir-text)`
- 悬停背景：`var(--memoir-accent-soft)`
- 圆角：10px

**图标按钮（IconButton）**
- 正方形，尺寸 32×32 或 28×28
- 纯图标，无文字（文字放 title/tooltip）
- 悬停背景：`var(--memoir-accent-soft)`
- 选中态：背景 `var(--memoir-accent-soft)`

**视图切换按钮组（view-switcher）**
- 容器：圆角 8px，背景 `var(--memoir-panel)`，内边距 2px
- 按钮：ghost 风格，选中时背景 `var(--memoir-elevated)`，有轻微阴影
- 图标+文字横排

### 输入框

- 高度：32px
- 圆角：10px
- 边框：1px solid `var(--memoir-border)`
- 背景：`var(--memoir-elevated)`
- 聚焦：边框 `var(--memoir-accent)`，无外发光
- 占位符文字：`var(--memoir-muted)`
- 搜索框：左侧带搜索图标，内边距 left 32px

### 卡片

- 背景：透明或 `var(--memoir-elevated)`
- 边框：1px solid transparent（悬停时变 `var(--memoir-border)`）
- 圆角：8-12px
- 内边距：12px
- 选中态：边框 `var(--memoir-accent)` 或背景 `var(--memoir-accent-soft)`

### 侧边栏

- 宽度：200px（可拖拽调整，范围 180-360px）
- 收缩态：52px（只显示图标）
- 背景：`var(--memoir-panel)`
- 导航项：高度 36px，圆角 8px，图标+文字，选中态背景 `var(--memoir-accent-soft)`
- 分组标题：11px，`var(--memoir-muted)`，大写/正常

### 笔记列表

- 宽度：280px（AI 模式 360px）
- 搜索框在顶部
- 笔记卡片：标题 13px 加粗，摘要 11px `var(--memoir-muted)`，标签 + 时间在底部
- 选中笔记：背景 `var(--memoir-accent-soft)`，左侧或边框高亮

### 标签（Tag）

- 圆角：6px
- 内边距：2px 8px
- 字号：11px
- 背景：`var(--memoir-accent-soft)`
- 文字：`var(--memoir-accent)`

### 滚动条

- 宽度：8px
- 滑块：`color-mix(in srgb, var(--memoir-muted) 25%, transparent)`，圆角 999px
- 悬停滑块：透明度 42%
- 轨道：透明

---

## 六、布局规范

### 三栏布局

```
┌─────────┬──────────┬──────────────────────┐
│ 导航侧栏  │ 笔记列表  │     编辑/预览区域     │
│  200px   │  280px   │    自适应（min 280）  │
└─────────┴──────────┴──────────────────────┘
```

- 使用 CSS Grid：`grid-template-columns: 200px 280px minmax(0, 1fr)`
- 栏之间有拖拽调整宽度的手柄（LayoutResizeHandle）
- 侧边栏可收缩到 52px（只显示图标）
- 窗口有 8px inset（非最大化时）

### 自定义标题栏

- 高度：40-48px
- 左侧：应用图标 + 名称 / 工作区切换
- 中间：可拖拽区域（`data-tauri-drag-region`）
- 右侧：窗口控制按钮（最小化/最大化/关闭）
- Windows 平台：flush 模式（无边框，自绘按钮）
- macOS 平台：native 模式（系统红绿灯按钮）

### 编辑器区域

- 顶部工具栏：56px，笔记标题 + 操作按钮
- 模式切换：42px，编辑/预览/分屏
- 内容区：CodeMirror 6 编辑器 + 预览面板
- 分屏比例：默认 50%，可拖拽调整（28%-72%）

---

## 七、动画与过渡

### 过渡时间

- 标准：`160ms`（`--memoir-motion`）
- 快速：`140ms`（`--memoir-motion-fast`）
- 侧边栏宽度：`180ms cubic-bezier(0.4, 0, 0.2, 1)`

### 缓动函数

```css
--memoir-ease: cubic-bezier(0.22, 1, 0.36, 1);
```

### 常见动画

- 面板切换：淡入 + 轻微上移（`memoir-fade-in`）
- 列表项入场：交错动画（`memoir-stagger`）
- 悬停：背景色过渡 140ms
- 弹窗：缩放 + 淡入
- 侧边栏收缩：grid 列宽过渡 180ms

---

## 八、图标规范

- 图标库：Lucide React
- 尺寸：14-16px（标准），3.5（14px）或 4（16px）
- 描边宽度：1.8（比默认 2 稍细）
- 颜色：继承文字颜色，或 `var(--memoir-muted)`
- 按钮内图标：居中，无文字时用 title 属性做 tooltip

---

## 九、交互细节

### 选中态

- 导航/列表项选中：背景 `var(--memoir-accent-soft)`，文字 `var(--memoir-text)`
- 按钮选中：背景 `var(--memoir-accent)`，文字 `var(--memoir-accent-contrast)`
- 无蓝色高亮，无发光外框

### 悬停态

- 可点击元素：背景 `var(--memoir-accent-soft)` 或轻微变暗
- 过渡 140ms
- 鼠标指针：pointer

### 焦点态

```css
outline: 2px solid color-mix(in srgb, var(--memoir-accent) 58%, transparent);
outline-offset: 1px;
```

### 文本选中

```css
::selection {
  background: var(--memoir-accent-soft);
}
```

### 用户选择

- 全局：`user-select: none`（防止误选）
- 编辑器/预览区：`user-select: text`

---

## 十、Tailwind v4 配置要点

### 主题变量映射

在 CSS 中用 `@theme inline` 把 CSS 变量映射到 Tailwind 颜色：

```css
@theme inline {
  --color-canvas: var(--memoir-canvas);
  --color-panel: var(--memoir-panel);
  --color-elevated: var(--memoir-elevated);
  --color-border: var(--memoir-border);
  --color-text: var(--memoir-text);
  --color-muted: var(--memoir-muted);
  --color-accent: var(--memoir-accent);
  --color-accent-soft: var(--memoir-accent-soft);
  --color-accent-contrast: var(--memoir-accent-contrast);
  --color-danger: var(--memoir-danger);
}
```

这样就可以用 `bg-canvas`、`text-muted`、`border-border`、`bg-accent` 等类名。

### 深色模式

```css
@custom-variant dark (&:where([data-theme="dark"], [data-theme="dark"] *));
```

用 `dark:bg-panel` 等类名写深色样式。

### color-mix 技巧

大量使用 `color-mix(in srgb, ...)` 做半透明效果：
- `color-mix(in srgb, var(--memoir-accent) 10%, transparent)` — 强调色 10% 透明背景
- `color-mix(in srgb, var(--memoir-muted) 25%, transparent)` — 滚动条滑块
- `color-mix(in srgb, var(--memoir-border) 60%, transparent)` — 淡边框

---

## 十一、快速复刻清单

做新项目时，按以下步骤复刻此 UI 风格：

1. **复制 `tokens.css`** — 所有颜色变量、字体、动画参数
2. **复制 `base.css`** — 全局重置、滚动条、选中态、焦点态
3. **安装字体** — 南西新圆体（或用系统圆体替代）
4. **配置 Tailwind** — `@theme inline` 映射颜色变量，`@custom-variant dark` 深色模式
5. **实现基础组件** — Button（primary/ghost/icon）、Input、Card、Tag、Tooltip
6. **实现布局** — 三栏 Grid + 自定义标题栏 + 拖拽调整手柄
7. **统一交互** — 悬停用 accent-soft，选中用 accent，无蓝色无发光
8. **细节打磨** — 8px 滚动条、10px 按钮圆角、1.8 描边图标、-0.006em 字间距

---

## 十二、禁忌（不要做）

- ❌ 不要用蓝色作为默认强调色（默认是墨色）
- ❌ 不要用纯白 `#ffffff` 做背景（用 `#fbfaf6` 暖白）
- ❌ 不要用纯黑 `#000000` 做深色背景（用 `#171714` 暖黑）
- ❌ 不要给按钮加发光/外阴影（用细腻的内阴影）
- ❌ 不要用大圆角（>16px）或小圆角（<6px）
- ❌ 不要用蓝色选中高亮（用 accent-soft 灰暖色）
- ❌ 不要在图标按钮里放文字（用 tooltip）
- ❌ 不要用系统默认滚动条（自定义 8px 细滚动条）
- ❌ 不要忘记 `user-select: none`（除了编辑区）
