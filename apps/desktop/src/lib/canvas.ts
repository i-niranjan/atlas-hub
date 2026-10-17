import { HttpAgent } from "@ag-ui/client";
import type { CanvasState } from "@atlas/core";
import { useCallback, useRef, useState } from "react";
import { getConnection } from "./api.ts";

export interface Step {
  label: string;
  done: boolean;
}

export interface CanvasRun {
  question: string;
  status: "idle" | "running" | "done" | "error";
  steps: Step[];
  answer: string;
  state: CanvasState | null;
  error: string | null;
}

const IDLE: CanvasRun = {
  question: "",
  status: "idle",
  steps: [],
  answer: "",
  state: null,
  error: null,
};

/** Runs the canvas agent over AG-UI and folds its event stream into view state. */
export function useCanvas() {
  const [run, setRun] = useState<CanvasRun>(IDLE);
  const agentRef = useRef<HttpAgent | null>(null);

  const ask = useCallback(async (question: string, projectId: string | null) => {
    agentRef.current?.abortRun();
    setRun({ ...IDLE, question, status: "running" });
    const { base, token } = await getConnection();
    const agent = new HttpAgent({
      url: `${base}/agent`,
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    agentRef.current = agent;
    agent.setMessages([{ id: crypto.randomUUID(), role: "user", content: question }]);

    const isCurrent = () => agentRef.current === agent;
    try {
      await agent.runAgent(
        { forwardedProps: { projectId } },
        {
          onStepStartedEvent: ({ event }) => {
            if (!isCurrent()) return;
            setRun((r) => ({ ...r, steps: [...r.steps, { label: event.stepName, done: false }] }));
          },
          onStepFinishedEvent: ({ event }) => {
            if (!isCurrent()) return;
            setRun((r) => {
              const steps = [...r.steps];
              const i = steps.findLastIndex((s) => s.label === event.stepName && !s.done);
              if (i >= 0) steps[i] = { ...steps[i]!, done: true };
              return { ...r, steps };
            });
          },
          // Only the latest message is the answer; earlier ones are narration between tool calls.
          onTextMessageStartEvent: () => {
            if (!isCurrent()) return;
            setRun((r) => ({ ...r, answer: "" }));
          },
          onTextMessageContentEvent: ({ event }) => {
            if (!isCurrent()) return;
            setRun((r) => ({ ...r, answer: r.answer + event.delta }));
          },
          onStateSnapshotEvent: ({ event }) => {
            if (!isCurrent()) return;
            setRun((r) => ({ ...r, state: event.snapshot as CanvasState }));
          },
          onRunErrorEvent: ({ event }) => {
            if (!isCurrent()) return;
            setRun((r) => ({ ...r, status: "error", error: event.message }));
          },
        },
      );
      if (isCurrent()) setRun((r) => (r.status === "running" ? { ...r, status: "done" } : r));
    } catch (err) {
      if (!isCurrent()) return;
      setRun((r) => ({
        ...r,
        status: "error",
        error:
          r.error ??
          (err instanceof Error && err.message !== "Failed to fetch"
            ? err.message
            : "Couldn't reach Atlas's background service."),
      }));
    }
  }, []);

  const reset = useCallback(() => {
    agentRef.current?.abortRun();
    agentRef.current = null;
    setRun(IDLE);
  }, []);

  return { run, ask, reset };
}
