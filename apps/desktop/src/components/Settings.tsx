import type { StatusReport } from "@atlas/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleCheck, CircleDashed, X } from "lucide-react";
import { Dialog } from "radix-ui";
import { useState, type FormEvent, type ReactNode } from "react";
import { api, ApiError } from "../lib/api.ts";
import { tildify } from "../lib/format.ts";
import { keys, type LiveState } from "../lib/queries.ts";
import { Button } from "./ui.tsx";

const INSTALL_CMD = "node ~/WORK/atlas/packages/daemon/src/cli.ts install";

export function Settings({
  open,
  onOpenChange,
  status,
  live,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  status: StatusReport | undefined;
  live: LiveState;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay
          className="fixed inset-0 z-40"
          style={{ background: "rgb(0 0 0 / 0.18)" }}
        />
        <Dialog.Content
          className="fixed top-1/2 left-1/2 z-50 w-[520px] max-w-[calc(100vw-48px)] -translate-x-1/2 -translate-y-1/2 rounded-[14px] p-6"
          style={{ background: "var(--elevated)", boxShadow: "var(--shadow-pop)" }}
        >
          <div className="flex items-start justify-between">
            <Dialog.Title className="t-title2">Settings</Dialog.Title>
            <Dialog.Close
              className="-mt-1 -mr-2 flex h-7 w-7 items-center justify-center rounded-[6px] hover:bg-[var(--fill)]"
              aria-label="Close"
              style={{ color: "var(--label-2)" }}
            >
              <X size={15} />
            </Dialog.Close>
          </div>
          <Dialog.Description className="t-callout mt-1" style={{ color: "var(--label-2)" }}>
            Atlas runs locally. Only transcript excerpts are sent to Anthropic, with secrets
            redacted.
          </Dialog.Description>

          <ApiKeySection
            hasKey={status?.hasApiKey ?? false}
            waiting={status?.queue.waitingForKey ?? 0}
          />

          <section className="mt-6">
            <h3 className="t-section mb-2">Capture</h3>
            <ul className="rounded-[10px]" style={{ background: "var(--fill)" }}>
              <Check
                ok={live === "live"}
                label="Background service"
                detail={live === "live" ? `atlasd ${status?.version ?? ""}` : "Not running"}
              />
              <Check
                ok={status?.hooksInstalled ?? false}
                label="Claude Code hooks"
                detail="Sessions are captured when they end"
              />
              <Check
                ok={status?.mcpRegistered ?? false}
                label="MCP tools in Claude Code"
                detail="Ask and log from any session"
                last
              />
            </ul>
            {(live !== "live" || !status?.hooksInstalled || !status.mcpRegistered) && (
              <div className="mt-3">
                <p className="t-callout" style={{ color: "var(--label-2)" }}>
                  To install everything, run this in Terminal:
                </p>
                <code
                  className="selectable t-callout mt-1.5 block rounded-[6px] px-2.5 py-2 font-mono"
                  style={{ background: "var(--fill)" }}
                >
                  {INSTALL_CMD}
                </code>
              </div>
            )}
          </section>

          <IgnoredFolders />

          {status && status.queue.errors > 0 && (
            <p className="t-callout mt-4" style={{ color: "var(--orange)" }}>
              {status.queue.errors} session{status.queue.errors === 1 ? "" : "s"} failed to process.
              Atlas retries them when the key changes or the service restarts.
            </p>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Check({
  ok,
  label,
  detail,
  last = false,
}: {
  ok: boolean;
  label: string;
  detail: ReactNode;
  last?: boolean;
}) {
  return (
    <li
      className="flex items-center gap-3 px-3.5 py-2.5"
      style={{ borderBottom: last ? undefined : "0.5px solid var(--separator)" }}
    >
      {ok ? (
        <CircleCheck size={16} style={{ color: "var(--green)" }} aria-label="OK" />
      ) : (
        <CircleDashed size={16} style={{ color: "var(--orange)" }} aria-label="Not set up" />
      )}
      <span className="t-body flex-1 whitespace-nowrap">{label}</span>
      <span className="t-callout truncate" style={{ color: "var(--label-3)" }}>
        {detail}
      </span>
    </li>
  );
}

function ApiKeySection({ hasKey, waiting }: { hasKey: boolean; waiting: number }) {
  const client = useQueryClient();
  const [key, setKey] = useState("");
  const [editing, setEditing] = useState(false);
  const save = useMutation({
    mutationFn: (k: string) => api.setApiKey(k),
    onSuccess: () => {
      setKey("");
      setEditing(false);
      void client.invalidateQueries({ queryKey: keys.status });
    },
  });
  const remove = useMutation({
    mutationFn: api.removeApiKey,
    onSuccess: () => void client.invalidateQueries({ queryKey: keys.status }),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (key.trim()) save.mutate(key.trim());
  };

  return (
    <section className="mt-6">
      <h3 className="t-section mb-2">Anthropic API key</h3>
      {hasKey && !editing ? (
        <div
          className="flex items-center gap-3 rounded-[10px] px-3.5 py-2.5"
          style={{ background: "var(--fill)" }}
        >
          <CircleCheck size={16} style={{ color: "var(--green)" }} aria-hidden />
          <span className="t-body flex-1">Stored in your Keychain</span>
          <Button size="small" onClick={() => setEditing(true)}>
            Replace…
          </Button>
          <Button
            size="small"
            variant="destructive"
            onClick={() => remove.mutate()}
            disabled={remove.isPending}
          >
            Remove
          </Button>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-2">
          <div className="flex gap-2">
            <input
              type="password"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="sk-ant-…"
              autoFocus
              aria-label="Anthropic API key"
              className="field t-body h-[28px] min-w-0 flex-1 px-2.5 font-mono outline-none"
            />
            {hasKey && (
              <Button
                size="large"
                style={{ height: 28 }}
                onClick={() => {
                  setKey("");
                  setEditing(false);
                }}
              >
                Cancel
              </Button>
            )}
            <Button
              type="submit"
              variant="primary"
              size="large"
              disabled={!key.trim() || save.isPending}
              style={{ height: 28 }}
            >
              Save
            </Button>
          </div>
          {save.error && (
            <p className="t-callout" style={{ color: "var(--red)" }} role="alert">
              {save.error instanceof ApiError ? save.error.message : "Couldn't save the key."}
            </p>
          )}
          <p className="t-callout" style={{ color: "var(--label-3)" }}>
            {waiting > 0
              ? `${waiting} session${waiting === 1 ? " is" : "s are"} waiting to be read. `
              : ""}
            Saved to the macOS Keychain, never to disk.
          </p>
        </form>
      )}
    </section>
  );
}

/** Folders Atlas stopped tracking; restoring brings the project (and any kept data) back. */
function IgnoredFolders() {
  const client = useQueryClient();
  const { data = [] } = useQuery({ queryKey: keys.ignored, queryFn: api.ignored });
  const restore = useMutation({
    mutationFn: api.restoreIgnored,
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: keys.ignored });
      void client.invalidateQueries({ queryKey: keys.projects });
    },
  });
  if (!data.length) return null;
  return (
    <section className="mt-6">
      <h3 className="t-section mb-2">Not tracked</h3>
      <ul className="rounded-[10px]" style={{ background: "var(--fill)" }}>
        {data.map((f, i) => (
          <li
            key={f.path}
            className="flex items-center gap-3 px-3.5 py-2"
            style={{
              borderBottom: i === data.length - 1 ? undefined : "0.5px solid var(--separator)",
            }}
          >
            <div className="min-w-0 flex-1">
              <div className="t-body truncate">{f.projectName ?? f.path.split("/").at(-1)}</div>
              <div className="t-caption truncate font-mono" style={{ color: "var(--label-3)" }}>
                {tildify(f.path)}
              </div>
            </div>
            <Button
              size="small"
              onClick={() => restore.mutate(f.path)}
              disabled={restore.isPending}
            >
              Track Again
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
