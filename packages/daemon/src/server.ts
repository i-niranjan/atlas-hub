import type { RunAgentInput } from "@ag-ui/core";
import type { StatusReport } from "@atlas/core";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { runCanvas } from "./agent.ts";
import type { Bus } from "./bus.ts";
import { VERSION, type Config } from "./config.ts";
import { HookEvent, type Ingestor } from "./ingest/ingestor.ts";
import { handleMcp } from "./mcp.ts";
import type { Mirror } from "./mirror.ts";
import type { Store } from "./store.ts";

export interface ServerDeps {
  config: Config;
  store: Store;
  bus: Bus;
  ingestor: Ingestor;
  mirror: Mirror;
  token: string;
  apiKey: () => string | null;
  setApiKey: (key: string | null) => Promise<void>;
  integrationStatus: () => { hooksInstalled: boolean; mcpRegistered: boolean };
}

const ALLOWED_ORIGINS = new Set([
  "tauri://localhost",
  "http://tauri.localhost",
  "http://localhost:1420",
]);

function tokenMatches(given: string | undefined, expected: string): boolean {
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function createApp(deps: ServerDeps): Hono {
  const { store, bus, ingestor, config } = deps;
  const app = new Hono();

  app.use(
    "*",
    cors({
      origin: (origin) => (ALLOWED_ORIGINS.has(origin) ? origin : null),
      allowHeaders: [
        "Authorization",
        "Content-Type",
        "Accept",
        "Mcp-Session-Id",
        "Mcp-Protocol-Version",
      ],
      allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    }),
  );

  app.get("/health", (c) => c.json({ ok: true, version: VERSION }));

  // Everything else needs the local token, so other local processes and web pages can't read decisions.
  app.use("*", async (c, next) => {
    if (c.req.method === "OPTIONS") return next();
    const header = c.req.header("Authorization")?.replace(/^Bearer\s+/i, "");
    const query = c.req.query("token");
    if (!tokenMatches(header ?? query, deps.token)) return c.json({ error: "unauthorized" }, 401);
    return next();
  });

  const onSaved = (entryId: string) => {
    const entry = store.getEntry(entryId);
    if (!entry) return;
    const project = store.getProject(entry.projectId);
    if (project && entry.source !== "adr") deps.mirror.write(entry, project);
    bus.emit({ type: "entry.changed", projectId: entry.projectId, entryId });
  };

  app.post("/hook", async (c) => {
    const parsed = HookEvent.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "invalid hook payload" }, 400);
    ingestor.onHook(parsed.data);
    return c.json({ accepted: true }, 202);
  });

  app.get("/events", (c) =>
    streamSSE(c, async (stream) => {
      const unsubscribe = bus.subscribe((event) => {
        void stream.writeSSE({ event: event.type, data: JSON.stringify(event) });
      });
      stream.onAbort(unsubscribe);
      while (!stream.aborted) {
        await stream.writeSSE({ event: "ping", data: "{}" });
        await stream.sleep(25_000);
      }
    }),
  );

  app.get("/api/status", (c) => {
    const report: StatusReport = {
      version: VERSION,
      hasApiKey: deps.apiKey() !== null,
      ...deps.integrationStatus(),
      queue: store.queueCounts(),
    };
    return c.json(report);
  });

  app.get("/api/projects", (c) => c.json(store.listProjects()));

  app.get("/api/projects/:id", (c) => {
    const project = store.listProjects().find((p) => p.id === c.req.param("id"));
    if (!project) return c.json({ error: "not found" }, 404);
    return c.json({ ...project, lenses: store.listLenses(project.id) });
  });

  app.post("/api/projects", async (c) => {
    const body = z
      .object({ rootPath: z.string().min(1) })
      .safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "rootPath required" }, 400);
    return c.json(ingestor.addProject(body.data.rootPath));
  });

  app.get("/api/projects/:id/entries", (c) => {
    const status = c.req.query("status");
    const kind = c.req.query("kind");
    const review = c.req.query("review");
    const entries = store.listEntries({
      projectId: c.req.param("id"),
      ...(status ? { status: status as "active" } : {}),
      ...(kind ? { kind } : {}),
      ...(review ? { reviewState: review as "needs_review" } : {}),
    });
    return c.json(entries);
  });

  app.get("/api/entries/:id", (c) => {
    const detail = store.entryDetail(c.req.param("id"));
    return detail ? c.json(detail) : c.json({ error: "not found" }, 404);
  });

  app.post("/api/entries/:id/review", async (c) => {
    const body = z
      .object({ state: z.enum(["confirmed", "needs_review", "dismissed"]) })
      .safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "state required" }, 400);
    const id = c.req.param("id");
    if (!store.setReview(id, body.data.state)) return c.json({ error: "not found" }, 404);
    onSaved(id);
    return c.json(store.entryDetail(id));
  });

  app.get("/api/review", (c) => c.json(store.listEntries({ reviewState: "needs_review" })));

  app.get("/api/search", (c) => {
    const q = c.req.query("q") ?? "";
    const project = c.req.query("project");
    return c.json(store.search(q, project || undefined, 30));
  });

  app.put("/api/settings/api-key", async (c) => {
    const body = z
      .object({
        key: z
          .string()
          .regex(/^sk-ant-[A-Za-z0-9_-]{20,}$/, "That doesn't look like an Anthropic API key."),
      })
      .safeParse(await c.req.json().catch(() => null));
    if (!body.success)
      return c.json({ error: body.error.issues[0]?.message ?? "invalid key" }, 400);
    await deps.setApiKey(body.data.key);
    bus.emit({ type: "status.changed" });
    void ingestor.retryStalled();
    return c.json({ ok: true });
  });

  app.delete("/api/settings/api-key", async (c) => {
    await deps.setApiKey(null);
    bus.emit({ type: "status.changed" });
    return c.json({ ok: true });
  });

  app.post("/api/lenses", async (c) => {
    const body = z
      .object({
        projectId: z.string().nullable(),
        title: z.string().min(1).max(60),
        prompt: z.string().min(1),
      })
      .safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "invalid lens" }, 400);
    const id = store.saveLens(
      body.data.projectId,
      body.data.title,
      body.data.prompt,
      new Date().toISOString(),
    );
    if (body.data.projectId) bus.emit({ type: "project.changed", projectId: body.data.projectId });
    return c.json({ id });
  });

  app.delete("/api/lenses/:id", (c) => {
    store.deleteLens(c.req.param("id"));
    return c.json({ ok: true });
  });

  app.post("/agent", async (c) => {
    const input = (await c.req.json().catch(() => null)) as RunAgentInput | null;
    if (!input?.threadId || !input.runId || !Array.isArray(input.messages)) {
      return c.json({ error: "invalid RunAgentInput" }, 400);
    }
    const body = runCanvas(input, { store, apiKey: deps.apiKey(), model: config.models.canvas });
    return new Response(body, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  });

  app.all("/mcp", (c) => handleMcp(c.req.raw, { store, ingestor, onSaved }));

  return app;
}
