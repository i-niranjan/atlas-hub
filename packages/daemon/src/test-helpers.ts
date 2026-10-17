import type { Project } from "@atlas/core";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "./db.ts";
import { Store } from "./store.ts";

export const NOW = "2026-10-17T15:00:00.000Z";

export function memoryStore(): Store {
  return new Store(openDb(":memory:"));
}

export function tempDir(prefix = "atlas-test-"): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

export function seedProject(store: Store, rootPath = "/tmp/demo", name = "demo"): Project {
  return store.upsertProject({ name, rootPath, gitRemote: null }, NOW);
}

let uuidCounter = 0;

/** Builders for transcript JSONL lines shaped like Claude Code's. */
export const line = {
  user(text: string, extra: Record<string, unknown> = {}) {
    return JSON.stringify({
      type: "user",
      uuid: `u-${++uuidCounter}`,
      timestamp: `2026-10-17T14:${String(uuidCounter % 60).padStart(2, "0")}:00.000Z`,
      sessionId: "sess-1",
      cwd: "/tmp/demo",
      message: { role: "user", content: text },
      ...extra,
    });
  },
  assistant(blocks: unknown[], extra: Record<string, unknown> = {}) {
    return JSON.stringify({
      type: "assistant",
      uuid: `a-${++uuidCounter}`,
      timestamp: `2026-10-17T14:${String(uuidCounter % 60).padStart(2, "0")}:30.000Z`,
      sessionId: "sess-1",
      message: { role: "assistant", content: blocks },
      ...extra,
    });
  },
  toolResult(toolUseId: string, content: string) {
    return JSON.stringify({
      type: "user",
      uuid: `t-${++uuidCounter}`,
      timestamp: "2026-10-17T14:59:00.000Z",
      sessionId: "sess-1",
      message: {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: toolUseId, content }],
      },
    });
  },
  title(text: string) {
    return JSON.stringify({ type: "ai-title", aiTitle: text, sessionId: "sess-1" });
  },
};
