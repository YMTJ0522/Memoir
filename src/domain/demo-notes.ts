export const DEMO_NOTE_CONTENT = `---
title: Memoir 功能演示
tags: [演示, 指南, memoir]
---

# 欢迎使用 Memoir

这是一份功能演示笔记，带你快速了解 Memoir 的所有核心功能。

## 基础排版

### 文本格式

支持 **粗体**、*斜体*、~~删除线~~、\`行内代码\`。

> 这是一段引用文字。引用可以用来强调重要内容。

### 列表

无序列表：
- 第一项
- 第二项
  - 嵌套项
- 第三项

有序列表：
1. 第一步
2. 第二步
3. 第三步

### 表格

| 功能 | 支持 | 说明 |
| :--- | :---: | --- |
| Markdown | ✅ | 完整支持 |
| 实时预览 | ✅ | 分屏显示 |
| 导出 Word | ✅ | 排版精美 |
| 导出 PDF | ✅ | 矢量文字 |

### 代码块

\`\`\`typescript
function greet(name: string): string {
  return \`Hello, \${name}!\`;
}

console.log(greet("Memoir"));
\`\`\`

## 高级功能

### 数学公式

行内公式：$E = mc^2$

块级公式：

$$
\\int_{-\\infty}^{\\infty} e^{-x^2} dx = \\sqrt{\\pi}
$$

### Mermaid 流程图

\`\`\`mermaid
flowchart LR
    A[开始] --> B{是否登录?}
    B -->|是| C[进入主页]
    B -->|否| D[登录页面]
    D --> C
    C --> E[结束]
\`\`\`

### 双向链接

可以链接到其他笔记：[[随手记]]、[[今日记录]]

反向链接会自动显示在笔记底部。

### 标签

在开头 frontmatter 中添加标签：\`tags: [演示, 指南]\`

侧边栏的标签面板可以按标签筛选笔记。

## 导出功能

- **Word**：三套模板（简约/学术/技术文档），WPS 完美兼容
- **PDF**：矢量导出，文字可选中复制
- **HTML**：独立网页，可直接分享

## 快捷键

- \`Ctrl + N\`：新建笔记
- \`Ctrl + K\`：命令面板
- \`Ctrl + P\`：快速打开
- \`Ctrl + S\`：保存（自动保存已开启）

## 云同步

支持 WebDAV 和 S3 协议，在设置中配置后可多设备同步。

---

开始你的写作之旅吧！
`;

export const DEMO_NOTE_PATH = "Memoir 功能演示.md";
