import { useState, lazy, Suspense, useMemo } from "react";
import { Network, Waypoints, GitBranch } from "lucide-react";
import { useI18n } from "../../i18n/react";
import { useAppStore } from "../../store/app-store";
import { IconButton } from "../../components/ui";

const NoteGraphView = lazy(() => import("../graph/NoteGraphView"));
const MindMapView = lazy(() => import("../mindmap/MindMapView"));
const FlowchartView = lazy(() => import("../flowchart/FlowchartView"));

type VizMode = "graph" | "mindmap" | "flowchart";

export default function VisualizationView() {
  const { t } = useI18n();
  const activePath = useAppStore((state) => state.activePath);
  const content = useAppStore((state) => state.content);
  const notes = useAppStore((state) => state.notes);
  const [mode, setMode] = useState<VizMode>("graph");

  const hasMermaid = useMemo(() => /```mermaid/i.test(content ?? ""), [content]);
  const activeNote = notes.find((n) => n.relativePath === activePath) || null;

  const tabs = [
    { key: "graph" as const, label: t("nav.graph"), icon: <Network className="h-3.5 w-3.5" /> },
    { key: "mindmap" as const, label: t("nav.mindmap"), icon: <Waypoints className="h-3.5 w-3.5" /> },
    { key: "flowchart" as const, label: t("nav.flowchart"), icon: <GitBranch className="h-3.5 w-3.5" />, disabled: !hasMermaid },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Top toolbar: view switcher + current note name */}
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="view-switcher library-mode-switcher flex items-center rounded-lg p-0.5">
          {tabs.map((tab) => (
            <IconButton
              key={tab.key}
              active={mode === tab.key}
              disabled={tab.disabled}
              label={tab.label}
              onClick={() => !tab.disabled && setMode(tab.key)}
            >
              {tab.icon}
              <span>{tab.label}</span>
            </IconButton>
          ))}
        </div>
        {mode !== "graph" && (
          <span className="truncate text-[11px] text-muted">
            {activeNote?.title || activeNote?.fileName || t("viz.selectNote")}
          </span>
        )}
      </div>

      {/* View area */}
      <div className="min-h-0 flex-1">
        <Suspense
          fallback={
            <div className="grid h-full place-items-center text-sm text-muted">
              {t("app.loadingWorkspace")}
            </div>
          }
        >
          {mode === "graph" && <NoteGraphView />}
          {mode === "mindmap" && (
            activePath ? (
              <MindMapView />
            ) : (
              <div className="grid h-full place-items-center text-center text-sm text-muted">
                {t("viz.selectNoteForMindmap")}
              </div>
            )
          )}
          {mode === "flowchart" && (
            activePath && hasMermaid ? (
              <FlowchartView />
            ) : (
              <div className="grid h-full place-items-center text-center text-sm text-muted">
                {!activePath ? t("viz.selectNote") : t("viz.flowchartHint")}
              </div>
            )
          )}
        </Suspense>
      </div>
    </div>
  );
}
