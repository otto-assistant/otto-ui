import React from "react";
import { useI18n } from "@/lib/i18n";
import { Icon } from "@/components/icon/Icon";
import { Button } from "@/components/ui/button";
import { useRuntimeAPIs } from "@/hooks/useRuntimeAPIs";
import { useEffectiveDirectory } from "@/hooks/useEffectiveDirectory";

const MEMORY_FILE_NAME = "MEMORY.md";

const MEMORY_FILE_TEMPLATE = `# ${MEMORY_FILE_NAME}

`;

function buildMemoryFilePath(directory: string): string {
  return `${directory.replace(/\/+$/, "")}/${MEMORY_FILE_NAME}`;
}

type LoadState = "loading" | "ready" | "missing" | "error";

/**
 * Viewer/editor for the per-project MEMORY.md file. The Otto bridge reads this
 * file at session start and the agent appends learnings to it across sessions.
 */
export const MemoryFileView: React.FC = () => {
  const { t } = useI18n();
  const { files } = useRuntimeAPIs();
  const directory = useEffectiveDirectory();

  const filePath = directory ? buildMemoryFilePath(directory) : null;

  const [loadState, setLoadState] = React.useState<LoadState>("loading");
  const [content, setContent] = React.useState("");
  const [savedContent, setSavedContent] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);

  const isDirty = content !== savedContent;
  const canWrite = Boolean(files.writeFile);

  const loadFile = React.useCallback(async () => {
    if (!filePath || !files.readFile) {
      setLoadState("error");
      setErrorMessage(null);
      return;
    }

    setLoadState("loading");
    setErrorMessage(null);

    try {
      const result = await files.readFile(filePath);
      setContent(result.content);
      setSavedContent(result.content);
      setLoadState("ready");
    } catch {
      setContent("");
      setSavedContent("");
      setLoadState("missing");
    }
  }, [filePath, files]);

  React.useEffect(() => {
    void loadFile();
  }, [loadFile]);

  const saveFile = React.useCallback(
    async (nextContent: string) => {
      if (!filePath || !files.writeFile) return;

      setSaving(true);
      setErrorMessage(null);

      try {
        const result = await files.writeFile(filePath, nextContent);
        if (!result?.success) {
          throw new Error(t("memoryView.file.saveFailed"));
        }
        setContent(nextContent);
        setSavedContent(nextContent);
        setLoadState("ready");
      } catch (error) {
        setErrorMessage(
          error instanceof Error ? error.message : t("memoryView.file.saveFailed"),
        );
      } finally {
        setSaving(false);
      }
    },
    [filePath, files, t],
  );

  if (!directory) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-muted-foreground">{t("memoryView.file.noProject")}</p>
      </div>
    );
  }

  if (loadState === "loading") {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-muted-foreground">{t("memoryView.file.loading")}</p>
      </div>
    );
  }

  if (loadState === "missing") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
        <Icon name="file-list-2" className="size-8 text-muted-foreground" />
        <div className="space-y-1">
          <p className="text-sm font-medium text-foreground">{t("memoryView.file.missingTitle")}</p>
          <p className="max-w-md text-xs text-muted-foreground">{t("memoryView.file.missingDescription")}</p>
          <p className="font-mono text-[10px] text-muted-foreground">{filePath}</p>
        </div>
        {errorMessage && (
          <p className="text-xs text-[color:var(--status-error)]">{errorMessage}</p>
        )}
        {canWrite && (
          <Button size="sm" disabled={saving} onClick={() => void saveFile(MEMORY_FILE_TEMPLATE)}>
            {saving ? t("memoryView.file.creating") : t("memoryView.file.createAction")}
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground" title={filePath ?? undefined}>
          {filePath}
        </span>
        {isDirty && (
          <span className="text-[10px] text-[color:var(--status-warning)]">
            {t("memoryView.file.unsaved")}
          </span>
        )}
        <Button
          variant="ghost"
          size="xs"
          disabled={saving}
          onClick={() => void loadFile()}
          aria-label={t("memoryView.file.reloadAria")}
        >
          <Icon name="refresh" className="h-3.5 w-3.5" />
        </Button>
        {canWrite && (
          <Button
            size="xs"
            disabled={saving || !isDirty}
            onClick={() => void saveFile(content)}
          >
            {saving ? t("memoryView.file.saving") : t("memoryView.file.saveAction")}
          </Button>
        )}
      </div>

      {errorMessage && (
        <p className="text-xs text-[color:var(--status-error)]">{errorMessage}</p>
      )}

      <textarea
        value={content}
        onChange={(event) => setContent(event.target.value)}
        readOnly={!canWrite}
        spellCheck={false}
        className="min-h-0 flex-1 resize-none rounded-md border border-border bg-input p-3 font-mono text-xs leading-relaxed text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        placeholder={t("memoryView.file.placeholder")}
        aria-label={t("memoryView.file.editorAria")}
      />
    </div>
  );
};
