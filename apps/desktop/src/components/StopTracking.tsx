import type { ProjectSummary } from "@atlas/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { EyeOff } from "lucide-react";
import { Dialog } from "radix-ui";
import { useState } from "react";
import { api } from "../lib/api.ts";
import { keys } from "../lib/queries.ts";
import { tildify } from "../lib/format.ts";
import { Button } from "./ui.tsx";

/** Confirm before Atlas stops tracking a project's folders. Data is kept unless asked. */
export function StopTracking({
  project,
  onClose,
  onDone,
}: {
  project: ProjectSummary | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const client = useQueryClient();
  const [deleteData, setDeleteData] = useState(false);
  const stop = useMutation({
    mutationFn: () => api.ignoreProject(project!.id, deleteData),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: keys.projects });
      void client.invalidateQueries({ queryKey: keys.ignored });
      setDeleteData(false);
      onDone();
    },
  });

  return (
    <Dialog.Root open={!!project} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay
          className="fixed inset-0 z-40"
          style={{ background: "rgb(0 0 0 / 0.18)" }}
        />
        <Dialog.Content
          className="fixed top-1/2 left-1/2 z-50 w-[440px] max-w-[calc(100vw-48px)] -translate-x-1/2 -translate-y-1/2 rounded-[14px] p-6"
          style={{ background: "var(--elevated)", boxShadow: "var(--shadow-pop)" }}
        >
          <div className="flex gap-3">
            <EyeOff
              size={22}
              className="mt-0.5 shrink-0"
              style={{ color: "var(--label-2)" }}
              aria-hidden
            />
            <div className="min-w-0">
              <Dialog.Title className="t-headline">Stop tracking “{project?.name}”?</Dialog.Title>
              <Dialog.Description className="t-callout mt-1.5" style={{ color: "var(--label-2)" }}>
                Atlas will skip Claude sessions in{" "}
                <span className="font-mono">{project ? tildify(project.rootPath) : ""}</span> from
                now on, so they cost no tokens, and the project leaves the sidebar. You can track it
                again from Settings.
              </Dialog.Description>
              <label className="t-callout mt-4 flex cursor-default items-center gap-2">
                <input
                  type="checkbox"
                  checked={deleteData}
                  onChange={(e) => setDeleteData(e.target.checked)}
                  style={{ accentColor: "var(--red)" }}
                />
                Also delete its decisions and roadmap
              </label>
            </div>
          </div>
          <div className="mt-6 flex justify-end gap-2">
            <Button onClick={onClose}>Cancel</Button>
            <Button
              variant={deleteData ? "destructive" : "primary"}
              onClick={() => stop.mutate()}
              disabled={stop.isPending}
            >
              {deleteData ? "Stop Tracking and Delete" : "Stop Tracking"}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
