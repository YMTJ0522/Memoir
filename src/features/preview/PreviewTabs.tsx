import { cloneElement, isValidElement, useState, type ComponentPropsWithoutRef, type ReactNode } from "react";

type TabMeta = {
  label: string;
  panelIndex: string;
  selected: boolean;
};

function readTabMeta(props: Record<string, unknown>): TabMeta | null {
  const node = props.node;
  const nodeProperties =
    node && typeof node === "object" && "properties" in node
      ? ((node as { properties?: Record<string, unknown> }).properties ?? {})
      : {};
  const read = (name: string): string => {
    const camel = name.replace(/-([a-z])/g, (_, char: string) => char.toUpperCase());
    const value = props[name] ?? props[camel] ?? nodeProperties[name] ?? nodeProperties[camel];
    return typeof value === "string" ? value : "";
  };
  const panelIndex = read("data-tab-panel");
  if (!panelIndex) return null;
  return {
    label: read("data-tab-label"),
    panelIndex,
    selected: read("data-tab-selected") === "true",
  };
}

/**
 * Interactive tab group for the preview (inkstone `.markdown-tabs` parity):
 * a `div[data-tabs]` override that rebuilds the tab strip from its
 * `section[data-tab-panel]` children and toggles panel visibility with
 * React state instead of the static `<details>`-less markup the remark
 * transform emits.
 */
export function PreviewTabs({
  className,
  children,
  ...props
}: ComponentPropsWithoutRef<"div"> & { node?: unknown }) {
  const sections = Array.isArray(children) ? children : [children];
  const metas: TabMeta[] = [];
  for (const section of sections) {
    if (!section || typeof section !== "object") continue;
    const element = section as { props?: Record<string, unknown> };
    const meta = readTabMeta(element.props ?? {});
    if (meta) metas.push(meta);
  }
  const initial = Math.max(
    0,
    metas.findIndex((meta) => meta.selected),
  );
  const [active, setActive] = useState(initial);
  const tabsClass = ["memoir-tabs", "memoir-tabs-interactive", className].filter(Boolean).join(" ");
  return (
    <div {...props} className={tabsClass}>
      <div className="memoir-tab-list" role="tablist">
        {metas.map((meta, index) => (
          <button
            key={`${meta.panelIndex}-${index}`}
            type="button"
            role="tab"
            className="memoir-tab-button"
            aria-selected={index === active}
            tabIndex={index === active ? 0 : -1}
            onClick={() => setActive(index)}
          >
            {meta.label}
          </button>
        ))}
      </div>
      {sections.map((section, index) => {
        if (!section || typeof section !== "object") return section as ReactNode;
        const hidden = index !== active;
        return (
          <TabPanelWrapper key={index} hidden={hidden}>
            {section as ReactNode}
          </TabPanelWrapper>
        );
      })}
    </div>
  );
}

/**
 * `hidden` must be applied to the section itself; cloning keeps the remark
 * section props intact (className/data attributes already on the child).
 */
function TabPanelWrapper({
  hidden,
  children,
}: {
  hidden: boolean;
  children: ReactNode;
}) {
  const child = Array.isArray(children) ? children[0] : children;
  if (!isValidElement(child)) return <>{children}</>;
  const props = { ...(child.props as Record<string, unknown>) };
  if (hidden) props.hidden = true;
  const className = props.className;
  props.className = Array.isArray(className) ? className.join(" ") : className;
  return cloneElement(child as React.ReactElement<Record<string, unknown>>, props);
}
