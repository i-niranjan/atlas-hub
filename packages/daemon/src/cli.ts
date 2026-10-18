#!/usr/bin/env node
import { serve } from "@hono/node-server";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { Bus } from "./bus.ts";
import { loadConfig, VERSION, type Config } from "./config.ts";
import { openDb } from "./db.ts";
import { AnthropicExtractor } from "./extract/llm.ts";
import { Ingestor } from "./ingest/ingestor.ts";
import {
  ensureToken,
  hooksInstalled,
  installHooks,
  installLaunchAgent,
  launchAgentInstalled,
  mcpRegistered,
  registerMcp,
  REPO_ROOT,
  uninstallHooks,
  uninstallLaunchAgent,
  unregisterMcp,
} from "./install.ts";
import { keychain } from "./keychain.ts";
import { Mirror } from "./mirror.ts";
import { PlanEngine } from "./plan/engine.ts";
import { AnthropicPlanExtractor } from "./plan/extract.ts";
import { TrajectoryStore } from "./plan/store.ts";
import { createApp } from "./server.ts";
import { Store } from "./store.ts";

async function runtime(config: Config) {
  const store = new Store(openDb(config.dbPath));
  const bus = new Bus();
  const mirror = new Mirror(config.mirrorDir);
  let apiKey = process.env.ANTHROPIC_API_KEY ?? (await keychain.get());
  let extractor = apiKey ? new AnthropicExtractor(apiKey, config.models.extract) : null;
  let planExtractor = apiKey ? new AnthropicPlanExtractor(apiKey, config.models.extract) : null;
  const trajectory = new TrajectoryStore(store.db);
  const engine = new PlanEngine({
    store,
    trajectory,
    bus,
    plansDir: config.claudePlansDir,
    extractor: () => planExtractor,
  });
  const ingestor = new Ingestor({
    store,
    config,
    bus,
    mirror,
    extractor: () => extractor,
    trajectory,
    hasPlanDocs: (projectId) => engine.hasPlanDocs(projectId),
    onProjectActivity: (projectId) => void engine.sync(projectId),
  });
  const setApiKey = async (key: string | null) => {
    if (key) await keychain.set(key);
    else await keychain.remove();
    apiKey = key;
    extractor = key ? new AnthropicExtractor(key, config.models.extract) : null;
    planExtractor = key ? new AnthropicPlanExtractor(key, config.models.extract) : null;
    if (key) void engine.syncAll();
  };
  return { store, bus, mirror, ingestor, trajectory, engine, apiKey: () => apiKey, setApiKey };
}

async function cmdServe(config: Config): Promise<void> {
  const token = ensureToken(config);
  const rt = await runtime(config);
  const app = createApp({
    config,
    token,
    ...rt,
    integrationStatus: () => ({
      hooksInstalled: hooksInstalled(config),
      mcpRegistered: mcpRegistered(config),
    }),
  });
  serve({ fetch: app.fetch, hostname: config.host, port: config.port }, () => {
    console.log(`[atlasd] ${VERSION} listening on http://${config.host}:${config.port}`);
  });
  // Hide projects that live in throwaway locations (temp folders, app scratch workspaces).
  for (const p of rt.store.listProjects()) {
    if (rt.store.isIgnored(p.rootPath))
      rt.store.ignoreProject(p.id, false, new Date().toISOString());
  }
  // Module 2: build/refresh roadmaps, then follow docs, plans and commits as they change.
  void rt.engine.syncAll().then(() => rt.engine.watchAll());
  // Catch up on anything that happened while the daemon was down.
  for (const p of rt.store.listProjects()) rt.ingestor.syncAdrs(p);
  const spooled = await rt.ingestor.drainSpool();
  const scanned = await rt.ingestor.scanAll();
  console.log(`[atlasd] startup: ${spooled} spooled events, ${scanned} transcripts to process`);
}

async function cmdBackfill(config: Config): Promise<void> {
  const rt = await runtime(config);
  const n = await rt.ingestor.scanAll();
  const q = rt.store.queueCounts();
  console.log(
    `Processed ${n} transcripts. Waiting for API key: ${q.waitingForKey}. Errors: ${q.errors}.`,
  );
}

async function cmdAdd(config: Config, path: string | undefined): Promise<void> {
  if (!path || !existsSync(path)) throw new Error("usage: atlas add <project folder>");
  const rt = await runtime(config);
  const p = rt.ingestor.addProject(resolve(path));
  const entries = rt.store.listEntries({ projectId: p.id });
  console.log(`Added ${p.name} (${p.rootPath}) with ${entries.length} entries.`);
}

/** Fold a code repo into the project that holds its plan, via the running daemon. */
async function cmdLink(
  config: Config,
  intoPath: string | undefined,
  fromPath: string | undefined,
): Promise<void> {
  if (!intoPath || !fromPath) throw new Error("usage: atlas link <plan/docs folder> <code folder>");
  const rt = await runtime(config);
  const lookup = (path: string) => {
    const abs = resolve(path);
    return rt.store.projectForRoot(abs) ?? rt.ingestor.addProject(abs);
  };
  const into = lookup(intoPath);
  const from = lookup(fromPath);
  if (into.id === from.id) return console.log(`${from.name} is already part of ${into.name}.`);
  const token = ensureToken(config);
  const res = await fetch(`http://${config.host}:${config.port}/api/projects/${into.id}/link`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ fromProjectId: from.id }),
  }).catch(() => null);
  if (!res?.ok) throw new Error("atlasd isn't running; start it with `atlas install`.");
  console.log(
    `Linking ${from.name} into ${into.name}. Atlas is rebuilding its roadmap from both folders.`,
  );
}

/** Regenerate a project's roadmap from its docs and commits, via the running daemon. */
async function cmdRebuild(config: Config, path: string | undefined): Promise<void> {
  if (!path) throw new Error("usage: atlas rebuild <project folder>");
  const rt = await runtime(config);
  const p = rt.store.projectForRoot(resolve(path)) ?? rt.store.findProject(path);
  if (!p) throw new Error(`Atlas doesn't track ${path}.`);
  const res = await fetch(
    `http://${config.host}:${config.port}/api/projects/${p.id}/trajectory/rebuild`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${ensureToken(config)}` },
    },
  ).catch(() => null);
  if (!res?.ok) throw new Error("atlasd isn't running; start it with `atlas install`.");
  console.log(`Rebuilt the roadmap for ${p.name}.`);
}

/** Stop tracking a folder (future sessions there cost nothing), or track it again. */
async function cmdIgnore(
  config: Config,
  path: string | undefined,
  restore: boolean,
): Promise<void> {
  if (!path) throw new Error(`usage: atlas ${restore ? "unignore" : "ignore"} <folder>`);
  const rt = await runtime(config);
  const abs = resolve(path);
  if (restore) {
    const id = rt.store.restoreIgnored(abs);
    console.log(
      id || rt.store.listIgnored().every((i) => i.path !== abs)
        ? `Tracking ${abs} again.`
        : `${abs} wasn't ignored.`,
    );
    return;
  }
  const p = rt.store.projectForRoot(abs);
  if (p) rt.store.ignoreProject(p.id, false, new Date().toISOString());
  else
    rt.store.db
      .prepare(
        `INSERT OR REPLACE INTO ignored_roots (path, project_id, ignored_at) VALUES (?, NULL, ?)`,
      )
      .run(abs, new Date().toISOString());
  console.log(`Atlas will no longer track ${abs}. Restore with: atlas unignore ${abs}`);
}

async function cmdInstall(config: Config): Promise<void> {
  const token = ensureToken(config);
  console.log(`✓ Hooks merged into ${installHooks(config)} (backup: settings.json.atlas-backup)`);
  await installLaunchAgent();
  console.log("✓ atlasd installed as a launchd agent (starts at login, restarts on crash)");
  try {
    await registerMcp(config, token);
    console.log("✓ MCP server registered with Claude Code (user scope) as 'atlas'");
  } catch (err) {
    console.log(`✗ MCP registration failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function cmdUninstall(config: Config): Promise<void> {
  uninstallHooks(config);
  await uninstallLaunchAgent();
  await unregisterMcp();
  console.log("Removed hooks, launchd agent and MCP registration. Data kept in", config.dataDir);
}

async function cmdDoctor(config: Config): Promise<void> {
  const check = (ok: boolean, label: string, fix?: string) =>
    console.log(`${ok ? "✓" : "✗"} ${label}${!ok && fix ? `  →  ${fix}` : ""}`);
  const healthy = await fetch(`http://${config.host}:${config.port}/health`, {
    signal: AbortSignal.timeout(1500),
  })
    .then((res) => res.ok)
    .catch(() => false);
  check(healthy, `atlasd responding on :${config.port}`, "atlas install");
  check(launchAgentInstalled(), "launchd agent installed", "atlas install");
  check(hooksInstalled(config), "Claude Code hooks installed", "atlas install");
  check(mcpRegistered(config), "MCP server registered", "atlas install");
  const key = process.env.ANTHROPIC_API_KEY ?? (await keychain.get());
  check(key !== null, "Anthropic API key available", "add it in Atlas → Settings");
  console.log(`  repo: ${REPO_ROOT}\n  data: ${config.dataDir}\n  mirror: ${config.mirrorDir}`);
}

const HELP = `atlas ${VERSION}

  atlas serve        run the daemon in the foreground
  atlas install      install hooks, launchd agent and MCP registration
  atlas uninstall    remove them (keeps your data)
  atlas doctor       check the installation
  atlas backfill     process every existing Claude Code transcript
  atlas add <path>   track a project folder and import its docs/decisions
  atlas link <docs> <code>   treat a code repo as part of the project whose plan lives in <docs>
  atlas rebuild <path>       regenerate a project's roadmap from its docs and commits
  atlas ignore <path>        stop tracking a folder (its sessions are skipped, no tokens spent)
  atlas unignore <path>      track it again`;

async function main(): Promise<void> {
  const config = loadConfig();
  const [cmd, arg] = process.argv.slice(2);
  switch (cmd) {
    case "serve":
      return cmdServe(config);
    case "install":
      return cmdInstall(config);
    case "uninstall":
      return cmdUninstall(config);
    case "doctor":
      return cmdDoctor(config);
    case "backfill":
      return cmdBackfill(config);
    case "add":
      return cmdAdd(config, arg);
    case "ignore":
      return cmdIgnore(config, arg, false);
    case "unignore":
      return cmdIgnore(config, arg, true);
    case "rebuild":
      return cmdRebuild(config, arg);
    case "link":
      return cmdLink(config, arg, process.argv[4]);
    default:
      console.log(HELP);
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
