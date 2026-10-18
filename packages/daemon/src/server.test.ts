import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Bus } from "./bus.ts";
import { loadConfig } from "./config.ts";
import { Ingestor } from "./ingest/ingestor.ts";
import { REPO_ROOT } from "./install.ts";
import { Mirror } from "./mirror.ts";
import { PlanEngine } from "./plan/engine.ts";
import { TrajectoryStore } from "./plan/store.ts";
import { createApp } from "./server.ts";
import { UsageLog } from "./usage.ts";
import { memoryStore, tempDir } from "./test-helpers.ts";

const TOKEN = "t".repeat(64);

function app() {
  const home = tempDir();
  const config = loadConfig({ ATLAS_HOME_OVERRIDE: home });
  const store = memoryStore();
  const bus = new Bus();
  const mirror = new Mirror(join(home, "Atlas"));
  const ingestor = new Ingestor({
    store,
    config,
    bus,
    mirror,
    extractor: () => null,
    log: () => undefined,
  });
  ingestor.addProject(REPO_ROOT);
  const trajectory = new TrajectoryStore(store.db);
  const engine = new PlanEngine({
    store,
    trajectory,
    bus,
    plansDir: home,
    extractor: () => null,
    log: () => undefined,
  });
  const a = createApp({
    trajectory,
    engine,
    usage: new UsageLog(store.db),
    config,
    store,
    bus,
    ingestor,
    mirror,
    token: TOKEN,
    apiKey: () => null,
    setApiKey: async () => undefined,
    integrationStatus: () => ({ hooksInstalled: false, mcpRegistered: false }),
  });
  const req = (path: string, init: RequestInit = {}) =>
    a.request(path, { ...init, headers: { Authorization: `Bearer ${TOKEN}`, ...init.headers } });
  return { a, req, store };
}

describe("HTTP API", () => {
  it("serves health without a token and everything else only with one", async () => {
    const { a } = app();
    expect((await a.request("/health")).status).toBe(200);
    expect((await a.request("/api/projects")).status).toBe(401);
    expect(
      (await a.request("/api/projects", { headers: { Authorization: "Bearer wrong" } })).status,
    ).toBe(401);
  });

  it("lists projects and entry detail with lineage", async () => {
    const { req } = app();
    const projects = (await (await req("/api/projects")).json()) as {
      id: string;
      name: string;
      counts: { total: number };
    }[];
    expect(projects[0]!.name).toBe("atlas");
    expect(projects[0]!.counts.total).toBeGreaterThanOrEqual(9);
    const id = `${projects[0]!.id}-adr-0002`;
    const detail = (await (await req(`/api/entries/${id}`)).json()) as {
      lineage: unknown[];
      title: string;
    };
    expect(detail.title).toMatch(/Tauri/);
    expect(detail.lineage).toHaveLength(1);
  });

  it("validates hook payloads", async () => {
    const { req } = app();
    expect((await req("/hook", { method: "POST", body: "{}" })).status).toBe(400);
  });

  it("rejects malformed API keys", async () => {
    const { req } = app();
    const res = await req("/api/settings/api-key", {
      method: "PUT",
      body: JSON.stringify({ key: "nope" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns an AG-UI RUN_ERROR stream when no key is configured", async () => {
    const { req } = app();
    const res = await req("/agent", {
      method: "POST",
      body: JSON.stringify({
        threadId: "t",
        runId: "r",
        messages: [{ id: "m", role: "user", content: "hi" }],
        tools: [],
        context: [],
      }),
    });
    const body = await res.text();
    expect(body).toContain("RUN_STARTED");
    expect(body).toContain("no_api_key");
  });

  it("answers MCP tool calls", async () => {
    const { req } = app();
    const headers = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    };
    const call = async (method: string, params: unknown, id: number) =>
      (await (
        await req("/mcp", {
          method: "POST",
          headers,
          body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
        })
      ).json()) as {
        result: { tools?: { name: string }[]; content?: { text: string }[] };
      };
    await call(
      "initialize",
      {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "test", version: "1" },
      },
      1,
    );
    const list = await call("tools/list", {}, 2);
    expect(list.result.tools!.map((t) => t.name).sort()).toEqual([
      "atlas_check",
      "atlas_decisions",
      "atlas_heading",
      "atlas_log_decision",
      "atlas_search",
      "atlas_why",
    ]);
    const why = await call(
      "tools/call",
      { name: "atlas_why", arguments: { topic: "Tauri desktop shell" } },
      3,
    );
    expect(why.result.content![0]!.text).toContain("Tauri");
    expect(why.result.content![0]!.text).toContain("Evidence:");
  });
});
