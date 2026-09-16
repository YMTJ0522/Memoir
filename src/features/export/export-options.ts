/**
 * Export options and template presets shared by the HTML/PDF/Word renderers
 * and the ExportDialog UI.
 */

export type ExportTemplateId = "minimal" | "academic" | "tech";

export type ExportPageMargin = "narrow" | "normal" | "wide";

export interface ExportOptions {
  format: "pdf" | "word" | "html" | "markdown";
  template: ExportTemplateId;
  includeToc: boolean;
  includePageNumbers: boolean;
  pageMargin: ExportPageMargin;
}

export interface ExportTemplate {
  id: ExportTemplateId;
  label: string;
  description: string;
  /** CSS variables injected into the HTML/PDF export stylesheet. */
  cssVars: Record<string, string>;
  /** Docx token overrides (hex colors without #, sizes in half-points). */
  docx: {
    headingColor: string;
    tableHeaderBg: string;
    tableHeaderText: string;
    tableStripeBg: string;
    tableBorderColor: string;
    codeBg: string;
    codeBorder: string;
    codeTextColor: string;
    calloutBorder: string;
    calloutBg: string;
    blockquoteBorder: string;
    bodyFont: string;
    monoFont: string;
    lineSpacing: number;
  };
}

export const EXPORT_TEMPLATES: Record<ExportTemplateId, ExportTemplate> = {
  minimal: {
    id: "minimal",
    label: "简约",
    description: "黑白经典，无衬线字体，适合日常笔记",
    cssVars: {
      "--export-font": '"Microsoft YaHei", "PingFang SC", sans-serif',
      "--export-mono": "Consolas, monospace",
      "--export-text": "#1f2937",
      "--export-heading": "#000000",
      "--export-muted": "#4b5563",
      "--export-border": "#e5e7eb",
      "--export-border-strong": "#9ca3af",
      "--export-code-bg": "#f5f5f5",
      "--export-code-text": "#1f2937",
      "--export-table-head-bg": "#f3f4f6",
      "--export-table-head-text": "#000000",
      "--export-table-stripe": "#fafafa",
      "--export-callout-bg": "#f9fafb",
      "--export-callout-border": "#6b7280",
      "--export-blockquote-bg": "#f9fafb",
      "--export-blockquote-border": "#9ca3af",
      "--export-line-height": "1.8",
      "--export-body-size": "16px",
    },
    docx: {
      headingColor: "000000",
      tableHeaderBg: "F3F4F6",
      tableHeaderText: "000000",
      tableStripeBg: "FAFAFA",
      tableBorderColor: "9CA3AF",
      codeBg: "F5F5F5",
      codeBorder: "D1D5DB",
      codeTextColor: "1F2937",
      calloutBorder: "6B7280",
      calloutBg: "F9FAFB",
      blockquoteBorder: "9CA3AF",
      bodyFont: "Microsoft YaHei",
      monoFont: "Consolas",
      lineSpacing: 360,
    },
  },
  academic: {
    id: "academic",
    label: "学术",
    description: "衬线字体，标题居中，适合论文/报告",
    cssVars: {
      "--export-font": '"SimSun", "Songti SC", "Times New Roman", serif',
      "--export-mono": "Consolas, monospace",
      "--export-text": "#1a1a1a",
      "--export-heading": "#000000",
      "--export-muted": "#555555",
      "--export-border": "#dddddd",
      "--export-border-strong": "#888888",
      "--export-code-bg": "#f8f8f8",
      "--export-code-text": "#1a1a1a",
      "--export-table-head-bg": "#eeeeee",
      "--export-table-head-text": "#000000",
      "--export-table-stripe": "#fafafa",
      "--export-callout-bg": "#f7f7f7",
      "--export-callout-border": "#888888",
      "--export-blockquote-bg": "#f7f7f7",
      "--export-blockquote-border": "#888888",
      "--export-line-height": "2.0",
      "--export-body-size": "14px",
    },
    docx: {
      headingColor: "000000",
      tableHeaderBg: "EEEEEE",
      tableHeaderText: "000000",
      tableStripeBg: "FAFAFA",
      tableBorderColor: "888888",
      codeBg: "F8F8F8",
      codeBorder: "DDDDDD",
      codeTextColor: "1A1A1A",
      calloutBorder: "888888",
      calloutBg: "F7F7F7",
      blockquoteBorder: "888888",
      bodyFont: "SimSun",
      monoFont: "Consolas",
      lineSpacing: 480,
    },
  },
  tech: {
    id: "tech",
    label: "技术文档",
    description: "紧凑排版，代码块突出，适合技术手册",
    cssVars: {
      "--export-font": '"Microsoft YaHei", "PingFang SC", sans-serif',
      "--export-mono": '"JetBrains Mono", Consolas, monospace',
      "--export-text": "#24292f",
      "--export-heading": "#0969da",
      "--export-muted": "#57606a",
      "--export-border": "#d0d7de",
      "--export-border-strong": "#8c959f",
      "--export-code-bg": "#f6f8fa",
      "--export-code-text": "#24292f",
      "--export-table-head-bg": "#f6f8fa",
      "--export-table-head-text": "#24292f",
      "--export-table-stripe": "#f6f8fa",
      "--export-callout-bg": "#f6f8fa",
      "--export-callout-border": "#0969da",
      "--export-blockquote-bg": "#f6f8fa",
      "--export-blockquote-border": "#8c959f",
      "--export-line-height": "1.6",
      "--export-body-size": "14px",
    },
    docx: {
      headingColor: "0969DA",
      tableHeaderBg: "F6F8FA",
      tableHeaderText: "24292F",
      tableStripeBg: "F6F8FA",
      tableBorderColor: "D0D7DE",
      codeBg: "F6F8FA",
      codeBorder: "D0D7DE",
      codeTextColor: "24292F",
      calloutBorder: "0969DA",
      calloutBg: "F6F8FA",
      blockquoteBorder: "8C959F",
      bodyFont: "Microsoft YaHei",
      monoFont: "Consolas",
      lineSpacing: 320,
    },
  },
};

export const DEFAULT_EXPORT_OPTIONS: ExportOptions = {
  format: "pdf",
  template: "minimal",
  includeToc: false,
  includePageNumbers: true,
  pageMargin: "normal",
};

export const PAGE_MARGIN_CSS: Record<ExportPageMargin, string> = {
  narrow: "1.2cm",
  normal: "2cm",
  wide: "2.8cm",
};
