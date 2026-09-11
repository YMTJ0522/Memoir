import { ClipboardPaste, Copy, Redo2, Scissors, Sparkles, SquareDashedMousePointer, Undo2, WandSparkles } from "lucide-react";
import { ContextMenu, ContextMenuItem, ContextMenuSeparator } from "../../components/ui";
import { useI18n } from "../../i18n/react";

export type EditorMenuTarget = {
  x: number;
  y: number;
  hasSelection: boolean;
  canUndo: boolean;
  canRedo: boolean;
};

export type EditorAiAction = "expand" | "polish" | "summarize" | "translate";

export function EditorContextMenu({
  target,
  onClose,
  onUndo,
  onRedo,
  onCut,
  onCopy,
  onPaste,
  onSelectAll,
  aiBusy = false,
  aiEnabled = true,
  onAiAction,
}: {
  target: EditorMenuTarget | null;
  onClose: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onCut: () => void;
  onCopy: () => void;
  onPaste: () => void;
  onSelectAll: () => void;
  /** An AI operation is in flight: disable the AI group. */
  aiBusy?: boolean;
  /** AI is configured; when false the group is hidden entirely. */
  aiEnabled?: boolean;
  onAiAction?: (kind: EditorAiAction) => void;
}) {
  const { t } = useI18n();
  if (!target) return null;

  const aiDisabled = !target.hasSelection || aiBusy;
  const showAiGroup = aiEnabled && onAiAction !== undefined;

  return (
    <ContextMenu
      autoFocus={false}
      label={t("editor.contextMenu")}
      onClose={onClose}
      open
      x={target.x}
      y={target.y}
    >
      <ContextMenuItem
        disabled={!target.canUndo}
        icon={<Undo2 />}
        label={t("editor.undo")}
        onSelect={onUndo}
      />
      <ContextMenuItem
        disabled={!target.canRedo}
        icon={<Redo2 />}
        label={t("editor.redo")}
        onSelect={onRedo}
      />
      <ContextMenuSeparator />
      <ContextMenuItem
        disabled={!target.hasSelection}
        icon={<Scissors />}
        label={t("editor.cut")}
        onSelect={onCut}
      />
      <ContextMenuItem
        disabled={!target.hasSelection}
        icon={<Copy />}
        label={t("editor.copy")}
        onSelect={onCopy}
      />
      <ContextMenuItem icon={<ClipboardPaste />} label={t("editor.paste")} onSelect={onPaste} />
      {showAiGroup && (
        <>
          <ContextMenuSeparator />
          <div className="memoir-context-menu-group" role="presentation">
            <Sparkles aria-hidden="true" className="memoir-context-menu-group-icon" />
            {aiBusy ? t("editor.aiBusy") : t("editor.aiGroup")}
          </div>
          <ContextMenuItem
            disabled={aiDisabled}
            icon={<WandSparkles />}
            label={t("editor.aiExpand")}
            onSelect={() => onAiAction?.("expand")}
          />
          <ContextMenuItem
            disabled={aiDisabled}
            icon={<WandSparkles />}
            label={t("editor.aiPolish")}
            onSelect={() => onAiAction?.("polish")}
          />
          <ContextMenuItem
            disabled={aiDisabled}
            icon={<WandSparkles />}
            label={t("editor.aiSummarize")}
            onSelect={() => onAiAction?.("summarize")}
          />
          <ContextMenuItem
            disabled={aiDisabled}
            icon={<WandSparkles />}
            label={t("editor.aiTranslate")}
            onSelect={() => onAiAction?.("translate")}
          />
        </>
      )}
      <ContextMenuSeparator />
      <ContextMenuItem
        icon={<SquareDashedMousePointer />}
        label={t("editor.selectAll")}
        onSelect={onSelectAll}
      />
    </ContextMenu>
  );
}
