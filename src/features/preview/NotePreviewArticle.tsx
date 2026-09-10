import {
  Fragment,
  createElement,
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type ComponentType,
  type ReactNode,
  type Ref,
} from "react";
import ReactMarkdown, { type Components as MarkdownComponents } from "react-markdown";
import { MDXProvider, useMDXComponents } from "@mdx-js/react";
import type { MDXComponents } from "mdx/types.js";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import rehypeSlug from "rehype-slug";
import remarkGfm from "remark-gfm";
import remarkDirective from "remark-directive";
import remarkMath from "remark-math";
import * as runtime from "react/jsx-runtime";
import { getGateways } from "../../gateways";
import { Tag } from "../../components/ui";
import type { NoteMeta } from "../../domain/notes";
import {
  isNoteMarkdownHref,
  resolveNoteRef,
  splitHash,
  type NoteGraphNode,
} from "../../domain/note-links";
import { isAudioPath, isVideoPath } from "../../domain/attachments";
import { decodeMediaHref, noteDirectory, resolveWorkspaceFilePath } from "../../domain/paths";
import { useNoteGraph } from "../graph/useNoteGraph";
import { LinkCard } from "./LinkCard";
import { readLinkCardProp, remarkLinkCards } from "./remark-link-cards";
import { remarkHighlights } from "./remark-highlights";
import { remarkWikiLinks, wikiInnerFromHref, readWikiEmbedProp } from "./remark-wiki-links";
import { remarkContainers } from "./remark-containers";
import { remarkBlockIds } from "./remark-block-ids";
import { remarkTags } from "./remark-tags";
import { remarkCodeBlocks, rehypeMemoirCodeBlocks } from "./remark-code-blocks";
import { WikiEmbed } from "./WikiEmbed";
import { useAppStore } from "../../store/app-store";
import { useI18n } from "../../i18n/react";
import { parseNote } from "../library/note-utils";
import { rehypeSourceLines } from "./source-line";
import { rehypeTaskOffsets, toggleTaskAtOffset } from "./task-list";
import { PreviewTabs } from "./PreviewTabs";
import { rehypeCodeLines } from "./rehype-code-lines";
import { writeClipboardText } from "../editor/clipboard";

const MDX_IMPORT_EXPORT_DISABLED = "MDX_IMPORT_EXPORT_DISABLED";
export const MARKDOWN_PREVIEW_DELAY_MS = 200;

/** Renders one frontmatter value: arrays as chips, objects as JSON, scalars as text. */
function FrontMatterValue({ value }: { value: unknown }) {
  if (value == null) return <span className="memoir-frontmatter-empty">—</span>;
  if (Array.isArray(value)) {
    return (
      <span className="memoir-frontmatter-values">
        {value.map((item, index) => (
          <span key={index} className="memoir-frontmatter-chip">
            {formatFrontMatterScalar(item)}
          </span>
        ))}
      </span>
    );
  }
  if (typeof value === "object") {
    return <code>{JSON.stringify(value)}</code>;
  }
  return <>{formatFrontMatterScalar(value)}</>;
}

function formatFrontMatterScalar(value: unknown) {
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

/** Standard frontmatter keys with localized labels; unknown keys stay as-is. */
const FRONTMATTER_KEY_LABELS: Record<string, { zh: string; en: string }> = {
  title: { zh: "标题", en: "Title" },
  tags: { zh: "标签", en: "Tags" },
  author: { zh: "作者", en: "Author" },
  date: { zh: "日期", en: "Date" },
  updated: { zh: "更新时间", en: "Updated" },
  category: { zh: "分类", en: "Category" },
  categories: { zh: "分类", en: "Categories" },
  description: { zh: "描述", en: "Description" },
  summary: { zh: "摘要", en: "Summary" },
};

function frontmatterKeyLabel(key: string, locale: string): string {
  const label = FRONTMATTER_KEY_LABELS[key.toLowerCase()];
  if (!label) return key;
  return locale === "en" ? label.en : label.zh;
}

/** Inkstone `.frontmatter-properties` parity: a collapsible metadata card
 * above the body so the `---` block the toolbar inserts is visible in preview. */
function FrontMatterProperties({
  data,
  label,
  locale,
}: {
  data: Record<string, unknown>;
  label: string;
  locale: string;
}) {
  return (
    <details className="memoir-frontmatter-properties" data-line="0">
      <summary>{label}</summary>
      <dl>
        {Object.entries(data).map(([key, value]) => (
          <div key={key} className="memoir-frontmatter-row">
            <dt>{frontmatterKeyLabel(key, locale)}</dt>
            <dd>
              <FrontMatterValue value={value} />
            </dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

const MermaidBlock = lazy(() => import("./MermaidBlock"));
const remarkPlugins = [
  remarkGfm,
  remarkMath,
  remarkDirective,
  // Space-syntax containers re-parse raw source, so they must run before the
  // inline plugins below for the rebuilt content to be processed by them.
  remarkContainers,
  remarkWikiLinks,
  remarkLinkCards,
  remarkHighlights,
  remarkTags,
  remarkCodeBlocks,
  remarkBlockIds,
];
const highlightCode: [typeof rehypeHighlight, { detect: boolean; plainText: string[] }] = [
  rehypeHighlight,
  { detect: false, plainText: ["mermaid"] },
];
const rehypePlugins = [
  rehypeSlug,
  rehypeKatex,
  rehypeTaskOffsets,
  rehypeSourceLines,
  // Moves fence meta onto the outer pre (inkstone .code-block attrs) and must
  // run before rehype-highlight, which reads the code language from classes.
  rehypeMemoirCodeBlocks,
  highlightCode,
  // Must run after rehype-highlight so token spans survive the line split.
  rehypeCodeLines,
];
const markdownRehypePlugins = [rehypeRaw, ...rehypePlugins];
const mdxCache = new Map<string, ComponentType<{ components?: MDXComponents }>>();

function Callout({
  type = "note",
  title,
  children,
}: {
  type?: "note" | "tip" | "warning" | "danger";
  title?: string;
  children: ReactNode;
}) {
  return (
    <aside
      className="my-5 rounded-lg border border-border border-l-[3px] border-l-accent bg-panel/70 px-4 py-3"
      data-callout={type}
    >
      {title && <strong className="mb-1 block text-sm">{title}</strong>}
      <div className="text-sm leading-7 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">{children}</div>
    </aside>
  );
}

function Badge({ children }: { children: ReactNode }) {
  return <Tag>{children}</Tag>;
}

/** Reads `data-tag` (or its hast property form) from remark-tags output. */
function readInlineTagProp(props: Record<string, unknown>): string {
  const node = props.node;
  const nodeProperties =
    node && typeof node === "object" && "properties" in node
      ? ((node as { properties?: Record<string, unknown> }).properties ?? {})
      : {};
  const value =
    props["data-tag"] ?? props.dataTag ?? nodeProperties["data-tag"] ?? nodeProperties.dataTag;
  return typeof value === "string" ? value : "";
}

/** Reads `data-block-ref` from remark-tags block-reference anchors. */
function readBlockRefProp(props: Record<string, unknown>): string {
  const node = props.node;
  const nodeProperties =
    node && typeof node === "object" && "properties" in node
      ? ((node as { properties?: Record<string, unknown> }).properties ?? {})
      : {};
  const value =
    props["data-block-ref"] ??
    props.dataBlockRef ??
    nodeProperties["data-block-ref"] ??
    nodeProperties.dataBlockRef;
  return typeof value === "string" ? value : "";
}

/** True when the div hosts a remark-containers tab group. */
function readTabsProp(props: Record<string, unknown>): boolean {
  const node = props.node;
  const nodeProperties =
    node && typeof node === "object" && "properties" in node
      ? ((node as { properties?: Record<string, unknown> }).properties ?? {})
      : {};
  const value =
    props["data-tabs"] ?? props.dataTabs ?? nodeProperties["data-tabs"] ?? nodeProperties.dataTabs;
  return value === "true" || value === true;
}

/** Code-block metadata attached by remarkCodeBlocks (pre override). */
function readCodeBlockMeta(props: Record<string, unknown>): {
  lang: string;
  title: string;
  start: string;
  lineNumbers: boolean;
  highlightLines: string;
} | null {
  const node = props.node;
  const nodeProperties =
    node && typeof node === "object" && "properties" in node
      ? ((node as { properties?: Record<string, unknown> }).properties ?? {})
      : {};
  const read = (kebab: string, camel: string): string => {
    const value = props[kebab] ?? props[camel] ?? nodeProperties[kebab] ?? nodeProperties[camel];
    return typeof value === "string" ? value : "";
  };
  const lang = read("data-lang", "dataLang");
  if (!lang && !read("data-code-start", "dataCodeStart")) return null;
  return {
    lang,
    title: read("data-code-title", "dataCodeTitle"),
    start: read("data-code-start", "dataCodeStart") || "1",
    lineNumbers: read("data-line-numbers", "dataLineNumbers") === "true",
    highlightLines: read("data-highlight-lines", "dataHighlightLines"),
  };
}

/**
 * Inkstone `.code-block-head` parity: title (falls back to language, then a
 * generic label), language badge when both exist, and a copy button that
 * flashes "已复制" for 900ms (inkstone timing).
 */
function CodeBlockHeader({
  title,
  lang,
  copyLabel,
  copiedLabel,
}: {
  title: string;
  lang: string;
  copyLabel: string;
  copiedLabel: string;
}) {
  const copy = async (button: HTMLButtonElement, pre: HTMLElement | null | undefined) => {
    // inkstone parity (Preview.tsx): copy the code text only — the header
    // lives outside `pre` in the `.code-block` wrapper, so it's never copied.
    const code = pre?.querySelector("code")?.textContent ?? "";
    try {
      await writeClipboardText(code);
      button.textContent = copiedLabel;
      button.classList.add("copied");
      window.setTimeout(() => {
        button.textContent = copyLabel;
        button.classList.remove("copied");
      }, 900);
    } catch {
      // Clipboard unavailable — leave the button as-is.
    }
  };
  const heading = title || lang;
  return (
    <div className="memoir-code-block-head">
      <span className="memoir-code-title">{heading}</span>
      {title && lang ? <span className="memoir-code-lang">{lang}</span> : null}
      <button
        type="button"
        className="memoir-code-copy"
        aria-label={copyLabel}
        onClick={(event) => {
          const button = event.currentTarget;
          const pre = button.closest(".memoir-code-block")?.querySelector("pre");
          void copy(button, pre);
        }}
      >
        {copyLabel}
      </button>
    </div>
  );
}

function Card({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-panel p-4">
      {title && <h3 className="mb-2 text-sm font-bold">{title}</h3>}
      <div className="text-sm text-muted [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">{children}</div>
    </section>
  );
}

function Columns({ children }: { children: ReactNode }) {
  return <div className="my-4 grid gap-3 sm:grid-cols-2">{children}</div>;
}

function Steps({ children }: { children: ReactNode }) {
  return (
    <div className="my-4 grid gap-3 [counter-reset:step] [&>*]:relative [&>*]:pl-9 [&>*]:[counter-increment:step] [&>*]:before:absolute [&>*]:before:left-0 [&>*]:before:top-0.5 [&>*]:before:grid [&>*]:before:h-6 [&>*]:before:w-6 [&>*]:before:place-items-center [&>*]:before:rounded-full [&>*]:before:bg-accent [&>*]:before:text-xs [&>*]:before:font-extrabold [&>*]:before:text-accent-contrast [&>*]:before:content-[counter(step)]">
      {children}
    </div>
  );
}

function previewComponents(
  root: string | null,
  relativePath: string | null,
  onToggleTask: ((offset: number, checked: boolean) => void) | undefined,
  labels: {
    toggleTask: string;
    loadingMermaid: string;
    missingWikiLink: (name: string) => string;
    copyCode: string;
    copied: string;
  },
  catalog: NoteGraphNode[],
  onOpenNote?: (path: string) => void,
  onSelectTag?: (tag: string) => void,
): MDXComponents {
  const gateway = getGateways().workspace;
  const directory = relativePath ? noteDirectory(relativePath) : "";
  return {
    Callout,
    Badge,
    Card,
    Columns,
    Steps,
    span: ({
      className,
      children,
      node: _node,
      ...props
    }: ComponentPropsWithoutRef<"span"> & { node?: unknown }) => {
      const embed = readWikiEmbedProp({ ...props, node: _node });
      if (embed !== null) {
        return <WikiEmbed inner={embed} sourcePath={relativePath} />;
      }
      const tag = readInlineTagProp({ ...props, node: _node });
      if (tag) {
        return (
          <span
            {...props}
            className={[className, "inline-tag"].filter(Boolean).join(" ")}
            role="link"
            tabIndex={0}
            onClick={() => onSelectTag?.(tag)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onSelectTag?.(tag);
              }
            }}
          >
            {children}
          </span>
        );
      }
      return (
        <span {...props} className={className}>
          {children}
        </span>
      );
    },
    div: ({
      className,
      children,
      node: _node,
      ...props
    }: ComponentPropsWithoutRef<"div"> & { node?: unknown }) => {
      const url = readLinkCardProp({ ...props, node: _node }, "url");
      if (url) {
        return (
          <div {...props} className={className}>
            <LinkCard
              label={readLinkCardProp({ ...props, node: _node }, "label")}
              onOpen={(href) => void gateway.openExternal(href)}
              url={url}
            />
          </div>
        );
      }
      if (readTabsProp({ ...props, node: _node })) {
        return <PreviewTabs className={className}>{children}</PreviewTabs>;
      }
      return (
        <div {...props} className={className}>
          {children}
        </div>
      );
    },
    a: ({ href, children, className, node: _node, ...props }: ComponentPropsWithoutRef<"a"> & { node?: unknown }) => {
      const blockRef = readBlockRefProp({ ...props, node: _node });
      if (blockRef) {
        return (
          <a
            {...props}
            className={[className, "block-reference"].filter(Boolean).join(" ")}
            href={href}
            onClick={(event) => {
              event.preventDefault();
              const target = event.currentTarget.ownerDocument?.getElementById(`^${blockRef}`);
              target?.scrollIntoView({ block: "center", behavior: "smooth" });
            }}
          >
            {children}
          </a>
        );
      }
      const wikiInner = href ? wikiInnerFromHref(href) : null;
      const targetRef = wikiInner
        ? splitHash(wikiInner.split("|")[0] || "").path
        : href && isNoteMarkdownHref(href)
          ? splitHash(decodeMediaHref(href)).path
          : "";
      const resolved =
        targetRef && relativePath ? resolveNoteRef(targetRef, relativePath, catalog) : undefined;
      const missingWiki = Boolean(wikiInner && !resolved);
      return (
        <a
          {...props}
          className={[className, missingWiki && "is-missing"].filter(Boolean).join(" ")}
          href={href}
          title={missingWiki ? labels.missingWikiLink(targetRef) : props.title}
          onClick={(event) => {
            if (!href) return;
            event.preventDefault();
            if (/^https?:/i.test(href)) {
              void gateway.openExternal(href);
              return;
            }
            if (resolved) {
              onOpenNote?.(resolved);
              return;
            }
            if (wikiInner) return;
            if (root) {
              void gateway.openPath(resolveWorkspaceFilePath(root, directory, decodeMediaHref(href)));
            }
          }}
        >
          {children}
        </a>
      );
    },
    img: ({ src, alt, ...props }: ComponentPropsWithoutRef<"img">) => {
      if (!src) {
        return <img {...props} alt={alt || ""} src={src} />;
      }
      if (/^(https?:|data:|blob:)/i.test(src) || !root) {
        return <img {...props} alt={alt || ""} src={src} />;
      }
      const resolved = resolveWorkspaceFilePath(root, directory, decodeMediaHref(src));
      if (isVideoPath(resolved)) {
        return <video className="memoir-preview-video" controls preload="metadata" src={gateway.resolveMediaPath(resolved)} />;
      }
      if (isAudioPath(resolved)) {
        return <audio className="memoir-preview-audio" controls preload="metadata" src={gateway.resolveMediaPath(resolved)} />;
      }
      return (
        <img
          {...props}
          alt={alt || ""}
          src={gateway.resolveMediaPath(resolved)}
        />
      );
    },
    input: ({ type, ...props }: ComponentPropsWithoutRef<"input">) => {
      if (type !== "checkbox") return <input {...props} type={type} />;
      return (
        <input
          {...props}
          aria-label={labels.toggleTask}
          disabled={!onToggleTask}
          onChange={(event) => {
            const taskItem = event.currentTarget.closest("[data-task-offset]");
            const offset = Number(taskItem?.getAttribute("data-task-offset"));
            if (Number.isFinite(offset)) onToggleTask?.(offset, event.currentTarget.checked);
          }}
          type="checkbox"
        />
      );
    },
    pre: ({
      className,
      children,
      node: _node,
      ...props
    }: ComponentPropsWithoutRef<"pre"> & { node?: unknown }) => {
      const meta = readCodeBlockMeta({ ...props, node: _node });
      if (!meta) {
        return (
          <pre {...props} className={className}>
            {children}
          </pre>
        );
      }
      // Inkstone `.code-block` parity: an outer wrapper div holds the header
      // (title / lang badge / copy button) plus an inner `pre` with the code,
      // so the copy button never picks up header text.
      return (
        <div
          {...(props as ComponentPropsWithoutRef<"div">)}
          className={[className, "memoir-code-block"].filter(Boolean).join(" ")}
          data-lang={meta.lang}
          data-code-start={meta.start}
          {...(meta.lineNumbers ? { "data-line-numbers": "true" } : {})}
          {...(meta.highlightLines ? { "data-highlight-lines": meta.highlightLines } : {})}
        >
          <CodeBlockHeader
            title={meta.title}
            lang={meta.lang}
            copyLabel={labels.copyCode}
            copiedLabel={labels.copied}
          />
          <pre className="memoir-code-pre">{children}</pre>
        </div>
      );
    },
    code: ({ className, children, ...props }: ComponentPropsWithoutRef<"code">) => {
      if (/language-mermaid/.test(className || "")) {
        return (
          <Suspense fallback={<p className="text-sm text-muted" data-mermaid-pending="">{labels.loadingMermaid}</p>}>
            <MermaidBlock code={String(children).trim()} />
          </Suspense>
        );
      }
      return (
        <code {...props} className={className}>
          {children}
        </code>
      );
    },
  };
}

async function compileMdx(source: string) {
  if (/^\s*(import|export)\s/m.test(source)) {
    throw new Error(MDX_IMPORT_EXPORT_DISABLED);
  }
  const cached = mdxCache.get(source);
  if (cached) return cached;
  const { compile } = await import("@mdx-js/mdx");
  const compiled = await compile(source, {
    outputFormat: "function-body",
    providerImportSource: "@mdx-js/react",
    remarkPlugins,
    rehypePlugins,
    development: false,
  });
  const moduleFactory = new Function(String(compiled));
  const module = moduleFactory({ ...runtime, Fragment, useMDXComponents }) as {
    default: ComponentType<{ components?: MDXComponents }>;
  };
  const Content = module.default;
  if (mdxCache.size > 40) mdxCache.delete(mdxCache.keys().next().value || "");
  mdxCache.set(source, Content);
  return Content;
}

export function NotePreviewArticle({
  root,
  relativePath,
  note,
  content,
  articleRef,
  className = "memoir-preview prose prose-neutral dark:prose-invert",
  compileDelay = 350,
  onContentChange,
}: {
  root: string | null;
  relativePath: string | null;
  note: NoteMeta | null;
  content: string;
  articleRef?: Ref<HTMLElement | null>;
  className?: string;
  compileDelay?: number;
  onContentChange?: (content: string) => void;
}) {
  const { t, locale } = useI18n();
  const untitled = t("editor.untitledFallback");
  const { graph } = useNoteGraph();
  const selectNote = useAppStore((state) => state.selectNote);
  const parsed = useMemo(
    () => parseNote(content, note?.fileName || untitled),
    [content, note?.fileName, untitled],
  );
  const bodyOffset = content.endsWith(parsed.body) ? content.length - parsed.body.length : 0;
  const toggleTaskLabel = t("preview.toggleTask");
  const loadingMermaidLabel = t("preview.loadingMermaid");
  const contentRef = useRef(content);
  const bodyOffsetRef = useRef(bodyOffset);
  const skipPreviewDelayRef = useRef(false);
  contentRef.current = content;
  bodyOffsetRef.current = bodyOffset;
  const onToggleTask = useMemo(
    () =>
      onContentChange
        ? (taskOffset: number, checked: boolean) => {
            skipPreviewDelayRef.current = true;
            onContentChange(
              toggleTaskAtOffset(contentRef.current, bodyOffsetRef.current + taskOffset, checked),
            );
          }
        : undefined,
    [onContentChange],
  );
  const selectNoteRef = useRef(selectNote);
  selectNoteRef.current = selectNote;
  const setScopedFilter = useAppStore((state) => state.setScopedFilter);
  const setScopedFilterRef = useRef(setScopedFilter);
  setScopedFilterRef.current = setScopedFilter;
  const components = useMemo(
    () =>
      previewComponents(
        root,
        relativePath,
        onToggleTask,
        {
          toggleTask: toggleTaskLabel,
          loadingMermaid: loadingMermaidLabel,
          missingWikiLink: (name) => t("preview.missingWikiLink", { name }),
          copyCode: t("preview.copyCode"),
          copied: t("preview.copied"),
        },
        graph.nodes,
        (path) => void selectNoteRef.current(path),
        (tag) => setScopedFilterRef.current({ type: "tag", value: tag }),
      ),
    [graph.nodes, loadingMermaidLabel, onToggleTask, relativePath, root, t, toggleTaskLabel],
  );
  const [mdxComponent, setMdxComponent] = useState<ComponentType<{
    components?: MDXComponents;
  }> | null>(null);
  const [error, setError] = useState("");
  const shouldCompileMdx =
    note?.extension === "mdx" && (/<[A-Z][\w.:-]*(\s|>|\/>)/.test(parsed.body) || /\{[^}\n]+\}/.test(parsed.body));
  const mdxPending = shouldCompileMdx && !mdxComponent && !error;
  const markdownDelay = compileDelay === 0 ? 0 : MARKDOWN_PREVIEW_DELAY_MS;
  const [previewBody, setPreviewBody] = useState(parsed.body);

  useEffect(() => {
    if (shouldCompileMdx) return;
    if (parsed.body === previewBody) return;
    if (skipPreviewDelayRef.current || markdownDelay === 0) {
      skipPreviewDelayRef.current = false;
      setPreviewBody(parsed.body);
      return;
    }
    const timer = window.setTimeout(() => setPreviewBody(parsed.body), markdownDelay);
    return () => window.clearTimeout(timer);
  }, [markdownDelay, parsed.body, previewBody, shouldCompileMdx]);

  useEffect(() => {
    let cancelled = false;
    if (!shouldCompileMdx) {
      setMdxComponent(null);
      setError("");
      return;
    }
    const timer = window.setTimeout(() => {
      compileMdx(parsed.body)
        .then((component) => {
          if (!cancelled) {
            setMdxComponent(() => component);
            setError("");
          }
        })
        .catch((compileError: unknown) => {
          if (!cancelled) {
            const raw =
              compileError instanceof Error ? compileError.message : String(compileError);
            setError(raw === MDX_IMPORT_EXPORT_DISABLED ? t("preview.mdxImportDisabled") : raw);
          }
        });
    }, compileDelay);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [compileDelay, parsed.body, shouldCompileMdx, t]);

  return (
    <article
      ref={articleRef}
      className={className}
      data-mdx-pending={mdxPending ? "" : undefined}
    >
      {parsed.frontmatter ? (
        <FrontMatterProperties
          data={parsed.frontmatter}
          label={t("preview.properties")}
          locale={locale}
        />
      ) : null}
      {error ? (
        <pre className="whitespace-pre-wrap border-danger/30 bg-danger/5 text-danger">{error}</pre>
      ) : shouldCompileMdx && mdxComponent ? (
        <MDXProvider components={components}>
          {createElement(mdxComponent, { components })}
        </MDXProvider>
      ) : (
        <ReactMarkdown
          components={components as MarkdownComponents}
          rehypePlugins={markdownRehypePlugins}
          remarkPlugins={remarkPlugins}
        >
          {shouldCompileMdx ? parsed.body : previewBody}
        </ReactMarkdown>
      )}
    </article>
  );
}
