import { useEffect, useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Dialog } from "../../components/ui/Dialog";
import { Toggle } from "../../components/ui/Toggle";
import { Button } from "../../components/ui/Button";
import { cn } from "../../components/ui/cn";
import type { NoteMeta } from "../../domain/notes";
import type { AppLocale, BodyFont } from "../../domain/settings";
import { useI18n } from "../../i18n/react";
import { parseNote } from "../library/note-utils";
import {
  DEFAULT_EXPORT_OPTIONS,
  EXPORT_TEMPLATES,
  PAGE_MARGIN_CSS,
  type ExportOptions,
} from "./export-options";
import { htmlDocument } from "./export-document";
import { renderNoteHtmlBody } from "./render-note-html";

interface ExportDialogProps {
  open: boolean;
  onClose: () => void;
  onExport: (options: ExportOptions) => void;
  note: NoteMeta | null;
  content: string;
  bodyFont: BodyFont;
  locale: AppLocale;
  root: string | null;
  relativePath: string;
  isExporting: boolean;
}

const FORMAT_OPTIONS = [
  { value: "pdf" as const, label: "PDF" },
  { value: "word" as const, label: "Word" },
  { value: "html" as const, label: "HTML" },
  { value: "markdown" as const, label: "Markdown" },
];

const TEMPLATE_OPTIONS = [
  { value: "minimal" as const, label: "简约" },
  { value: "academic" as const, label: "学术" },
  { value: "tech" as const, label: "技术文档" },
];

const MARGIN_OPTIONS = [
  { value: "narrow" as const, label: "窄" },
  { value: "normal" as const, label: "标准" },
  { value: "wide" as const, label: "宽" },
];

export function ExportDialog({
  open,
  onClose,
  onExport,
  note,
  content,
  bodyFont,
  locale,
  root,
  relativePath,
  isExporting,
}: ExportDialogProps) {
  const { t } = useI18n();
  const [options, setOptions] = useState<ExportOptions>(DEFAULT_EXPORT_OPTIONS);
  const [previewHtml, setPreviewHtml] = useState<string>("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const title = useMemo(() => (note ? parseNote(content, note.fileName).title : ""), [content, note]);

  // Generate preview HTML whenever format/template/margin changes (for HTML/PDF).
  useEffect(() => {
    if (!open || !note) return;
    if (options.format === "markdown") {
      setPreviewHtml("");
      return;
    }
    let cancelled = false;
    setPreviewLoading(true);
    renderNoteHtmlBody({ bodyFont, content, locale, note, relativePath, root })
      .then((bodyHtml) => {
        if (cancelled) return;
        const languageTag = locale === "zh" ? "zh-CN" : "en";
        const html = htmlDocument(title, bodyHtml, languageTag, options.template, options.pageMargin);
        setPreviewHtml(html);
      })
      .finally(() => {
        if (!cancelled) setPreviewLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, note, content, bodyFont, locale, relativePath, root, title, options.template, options.pageMargin, options.format]);

  const update = <K extends keyof ExportOptions>(key: K, value: ExportOptions[K]) => {
    setOptions((prev) => ({ ...prev, [key]: value }));
  };

  const handleExport = () => {
    onExport(options);
  };

  const currentTemplate = EXPORT_TEMPLATES[options.template];

  return (
    <Dialog
      open={open}
      title={t("editor.export")}
      description={currentTemplate.description}
      onClose={onClose}
      className="w-[720px] max-w-[92vw]"
      footer={
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted">
            {options.format === "markdown" ? "Markdown 为纯文本，无排版预览" : "预览基于 HTML 渲染，PDF/Word 效果近似"}
          </span>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button onClick={handleExport} disabled={isExporting || !note}>
              {isExporting ? t("editor.exporting") : t("editor.export")}
            </Button>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        {/* Format selection */}
        <div className="flex items-center gap-3">
          <span className="w-16 shrink-0 text-xs font-medium text-muted">格式</span>
          <div className="view-switcher library-mode-switcher flex items-center">
            {FORMAT_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                aria-pressed={options.format === opt.value}
                className={cn(
                  "whitespace-nowrap transition-[color,background-color,box-shadow] duration-150",
                  options.format === opt.value
                    ? "bg-elevated font-semibold text-text shadow-sm"
                    : "text-muted hover:text-text",
                )}
                onClick={() => update("format", opt.value)}
                type="button"
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Template selection */}
        <div className="flex items-center gap-3">
          <span className="w-16 shrink-0 text-xs font-medium text-muted">模板</span>
          <div className="view-switcher library-mode-switcher flex items-center">
            {TEMPLATE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                aria-pressed={options.template === opt.value}
                className={cn(
                  "whitespace-nowrap transition-[color,background-color,box-shadow] duration-150",
                  options.template === opt.value
                    ? "bg-elevated font-semibold text-text shadow-sm"
                    : "text-muted hover:text-text",
                )}
                onClick={() => update("template", opt.value)}
                type="button"
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Advanced settings toggle */}
        <button
          className="flex w-full items-center justify-between rounded-md px-1 py-1.5 text-xs font-medium text-muted transition-colors hover:text-text"
          onClick={() => setShowAdvanced((v) => !v)}
          type="button"
        >
          <span>高级设置</span>
          <ChevronDown
            className={`h-3.5 w-3.5 transition-transform duration-200 ${showAdvanced ? "rotate-180" : ""}`}
          />
        </button>

        {/* Advanced options */}
        {showAdvanced && (
          <div className="space-y-3 rounded-lg border border-border bg-panel/50 p-3">
            {/* Page margin */}
            <div className="flex items-center gap-3">
              <span className="w-16 shrink-0 text-xs font-medium text-muted">页边距</span>
              <div className="view-switcher library-mode-switcher flex items-center">
                {MARGIN_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    aria-pressed={options.pageMargin === opt.value}
                    className={cn(
                      "whitespace-nowrap transition-[color,background-color,box-shadow] duration-150",
                      options.pageMargin === opt.value
                        ? "bg-elevated font-semibold text-text shadow-sm"
                        : "text-muted hover:text-text",
                    )}
                    onClick={() => update("pageMargin", opt.value)}
                    type="button"
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <span className="text-xs text-muted">{PAGE_MARGIN_CSS[options.pageMargin]}</span>
            </div>

            {/* Toggles */}
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-2">
                <Toggle
                  checked={options.includePageNumbers}
                  label="页码"
                  onChange={(v) => update("includePageNumbers", v)}
                />
                <span className="text-xs text-text">页码</span>
              </div>
              <div className="flex items-center gap-2">
                <Toggle
                  checked={options.includeToc}
                  label="目录"
                  onChange={(v) => update("includeToc", v)}
                />
                <span className="text-xs text-text">目录</span>
              </div>
            </div>
          </div>
        )}

        {/* Preview area */}
        {options.format !== "markdown" && (
          <div className="mt-1">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-xs font-medium text-muted">预览</span>
              {previewLoading && <span className="text-xs text-muted">渲染中…</span>}
            </div>
            <div className="h-[320px] overflow-hidden rounded-lg border border-border bg-white">
              {previewHtml ? (
                <iframe
                  title="export-preview"
                  srcDoc={previewHtml}
                  className="h-full w-full"
                  sandbox="allow-same-origin"
                />
              ) : (
                <div className="flex h-full items-center justify-center text-xs text-muted">
                  预览加载中…
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </Dialog>
  );
}
