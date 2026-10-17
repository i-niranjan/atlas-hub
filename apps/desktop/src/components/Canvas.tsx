import { ArrowLeft, Check, KeyRound, Pin, RotateCcw, Sparkles } from "lucide-react";
import { motion } from "motion/react";
import { useState } from "react";
import type { CanvasRun } from "../lib/canvas.ts";
import { Markdown, ViewRenderer } from "./Blocks.tsx";
import { Button, Spinner } from "./ui.tsx";

export function Canvas({
  run,
  onBack,
  onRetry,
  onPin,
  onOpenSettings,
  lensTitle,
}: {
  run: CanvasRun;
  onBack: () => void;
  onRetry: () => void;
  onPin: ((title: string) => void) | null;
  onOpenSettings: () => void;
  lensTitle: string | null;
}) {
  const [pinned, setPinned] = useState(false);
  const running = run.status === "running";
  const needsKey = run.status === "error" && /API key/i.test(run.error ?? "");

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[820px] px-8 pt-5 pb-16">
        <div className="mb-5 flex items-center gap-2">
          <Button variant="plain" size="small" onClick={onBack} aria-label="Back to timeline">
            <ArrowLeft size={14} /> Timeline
          </Button>
          <div className="flex-1" />
          {run.status === "done" && (
            <Button
              variant="plain"
              size="small"
              onClick={onRetry}
              title="Run again with the latest data"
            >
              <RotateCcw size={13} /> Refresh
            </Button>
          )}
          {onPin && run.status === "done" && run.state?.view && !lensTitle && (
            <Button
              size="small"
              onClick={() => {
                onPin(run.state!.view!.title);
                setPinned(true);
              }}
              disabled={pinned}
              title="Keep this view in the sidebar; it re-runs on fresh data"
            >
              {pinned ? <Check size={13} /> : <Pin size={13} />} {pinned ? "Pinned" : "Pin as Lens"}
            </Button>
          )}
        </div>

        <header className="mb-5">
          <div
            className="t-callout mb-1 flex items-center gap-1.5 font-medium"
            style={{ color: "var(--accent)" }}
          >
            <Sparkles size={13} aria-hidden /> {lensTitle ? "Lens" : "Ask Atlas"}
          </div>
          <h1 className="t-title1 selectable">
            {run.state?.view?.title ?? lensTitle ?? run.question}
          </h1>
          {run.state?.view && run.state.view.title !== run.question && !lensTitle && (
            <p className="t-callout mt-1" style={{ color: "var(--label-3)" }}>
              {run.question}
            </p>
          )}
        </header>

        {(running || run.steps.length > 0) && !run.state?.view && (
          <ol className="mb-5 space-y-1.5" aria-live="polite">
            {run.steps.length === 0 && (
              <li className="t-callout flex items-center gap-2" style={{ color: "var(--label-2)" }}>
                <Spinner size={13} /> Thinking
              </li>
            )}
            {run.steps.map((s, i) => (
              <motion.li
                key={i}
                initial={{ opacity: 0, x: -4 }}
                animate={{ opacity: 1, x: 0 }}
                className="t-callout flex items-center gap-2"
                style={{ color: s.done ? "var(--label-3)" : "var(--label-2)" }}
              >
                {s.done ? (
                  <Check size={13} style={{ color: "var(--green)" }} />
                ) : (
                  <Spinner size={13} />
                )}
                {s.label}
              </motion.li>
            ))}
          </ol>
        )}

        {run.answer && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="mb-6 text-[15px] leading-[22px] [&_.t-body]:text-[15px] [&_.t-body]:leading-[22px]"
            aria-live="polite"
          >
            <Markdown text={run.answer} />
          </motion.div>
        )}

        {run.state && <ViewRenderer state={run.state} />}

        {run.status === "error" && (
          <div
            className="rounded-[10px] px-4 py-3.5"
            style={{ background: "color-mix(in srgb, var(--red) 8%, transparent)" }}
            role="alert"
          >
            <p className="t-body">{run.error}</p>
            <div className="mt-3 flex gap-2">
              {needsKey ? (
                <Button size="small" variant="primary" onClick={onOpenSettings}>
                  <KeyRound size={13} /> Add API key
                </Button>
              ) : (
                <Button size="small" onClick={onRetry}>
                  Try again
                </Button>
              )}
            </div>
          </div>
        )}

        {run.status === "done" && !run.state?.view && !run.answer && (
          <p className="t-body" style={{ color: "var(--label-2)" }}>
            Atlas didn't find anything recorded for this.
          </p>
        )}
      </div>
    </div>
  );
}
