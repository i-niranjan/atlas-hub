import type { RunAgentInput } from "@ag-ui/core";
import type { LinkSuggestion, NodeDetail, StatusReport } from "@atlas/core";
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
import type { PlanEngine } from "./plan/engine.ts";
import type { TrajectoryStore } from "./plan/store.ts";
import type { UsageLog } from "./usage.ts";
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
  trajectory: TrajectoryStore;
  engine: PlanEngine;
  usage: UsageLog;
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

  // ── module 2: trajectory ───────────────────────────────

  app.get("/api/projects/:id/trajectory", (c) => c.json(deps.trajectory.data(c.req.param("id"))));

  app.post("/api/projects/:id/trajectory/refresh", async (c) => {
    await deps.engine.sync(c.req.param("id"), { force: true });
    return c.json({ ok: true });
  });

  app.post("/api/projects/:id/trajectory/rebuild", async (c) => {
    await deps.engine.rebuild(c.req.param("id"));
    return c.json({ ok: true });
  });

  app.get("/api/nodes/:id", (c) => {
    const t = deps.trajectory;
    const node = t.node(c.req.param("id"));
    if (!node) return c.json({ error: "not found" }, 404);
    const detail: NodeDetail = {
      node,
      status: t.currentStatus(node.id),
      track: t.track(node.trackId),
      history: t.history(node.id),
      evidence: t.evidence(node.id),
    };
    return c.json(detail);
  });

  app.post("/api/nodes/:id/review", async (c) => {
    const body = z
      .object({ state: z.enum(["confirmed", "dismissed"]) })
      .safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "state required" }, 400);
    const t = deps.trajectory;
    const node = t.node(c.req.param("id"));
    if (!node) return c.json({ error: "not found" }, 404);
    const now = new Date().toISOString();
    store.db.transaction(() => {
      t.setNodeReview(node.id, body.data.state);
      if (body.data.state === "dismissed") {
        // Undo what the unconfirmed change did: restore the previous status, or drop an added item.
        const statuses = t
          .history(node.id)
          .filter((e) => e.type === "node_created" || e.type === "node_status");
        const previous = statuses.length > 1 ? statuses.at(-2)!.value : "dropped";
        t.setNodeStatus(node.id, previous as "planned", now, "manual");
      }
    })();
    bus.emit({ type: "trajectory.changed", projectId: node.projectId });
    return c.json({ ok: true });
  });

  // ── stop / restore tracking ─────────────────────────────

  app.post("/api/projects/:id/ignore", async (c) => {
    const body = z
      .object({ deleteData: z.boolean().default(false) })
      .safeParse(await c.req.json().catch(() => ({})));
    const id = c.req.param("id");
    if (!store.getProject(id)) return c.json({ error: "not found" }, 404);
    const deleteData = body.success ? body.data.deleteData : false;
    store.ignoreProject(id, deleteData, new Date().toISOString());
    if (deleteData) deps.trajectory.discardTrajectory(id);
    bus.emit({ type: "project.changed", projectId: id });
    bus.emit({ type: "status.changed" });
    return c.json({ ok: true });
  });

  app.get("/api/ignored", (c) => c.json(store.listIgnored()));

  app.get("/api/usage", (c) => {
    const days = Math.min(365, Math.max(1, Number(c.req.query("days") ?? 30) || 30));
    return c.json(deps.usage.report(days));
  });

  app.post("/api/ignored/restore", async (c) => {
    const body = z
      .object({ path: z.string().min(1) })
      .safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "path required" }, 400);
    const projectId = store.restoreIgnored(body.data.path);
    if (projectId) bus.emit({ type: "project.changed", projectId });
    bus.emit({ type: "status.changed" });
    return c.json({ ok: true, projectId });
  });

  app.get("/api/link-suggestions", (c) => {
    const out: LinkSuggestion[] = [];
    for (const s of deps.trajectory.suggestions()) {
      const code = store.getProject(s.codeProjectId);
      const docs = store.getProject(s.docsProjectId);
      if (code && docs)
        out.push({
          code: { id: code.id, name: code.name },
          docs: { id: docs.id, name: docs.name },
          sample: s.sample,
        });
    }
    return c.json(out);
  });

  app.post("/api/link-suggestions/dismiss", async (c) => {
    const body = z
      .object({ codeId: z.string(), docsId: z.string() })
      .safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "codeId and docsId required" }, 400);
    deps.trajectory.dismissSuggestion(body.data.codeId, body.data.docsId);
    bus.emit({ type: "status.changed" });
    return c.json({ ok: true });
  });

  app.post("/api/projects/:id/link", async (c) => {
    const body = z
      .object({ fromProjectId: z.string() })
      .safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "fromProjectId required" }, 400);
    const into = c.req.param("id");
    if (!store.getProject(into) || !store.getProject(body.data.fromProjectId))
      return c.json({ error: "not found" }, 404);
    // Linking re-reads docs, which can take a while; answer now and push updates over /events.
    void deps.engine.link(into, body.data.fromProjectId);
    return c.json({ ok: true }, 202);
  });

  app.post("/agent", async (c) => {
    const input = (await c.req.json().catch(() => null)) as RunAgentInput | null;
    if (!input?.threadId || !input.runId || !Array.isArray(input.messages)) {
      return c.json({ error: "invalid RunAgentInput" }, 400);
    }
    const body = runCanvas(input, {
      store,
      trajectory: deps.trajectory,
      apiKey: deps.apiKey(),
      model: config.models.canvas,
      onUsage: deps.usage.record,
    });
    return new Response(body, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  });

  app.all("/mcp", (c) =>
    handleMcp(c.req.raw, { store, ingestor, onSaved, trajectory: deps.trajectory }),
  );

  return app;
}
