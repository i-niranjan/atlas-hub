import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { Config } from "./config.ts";

const run = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(here, "..", "..", "..");
const HOOK_SCRIPT = join(REPO_ROOT, "packages", "hook", "atlas-hook.mjs");
const CLI_SCRIPT = join(REPO_ROOT, "packages", "daemon", "src", "cli.ts");
const LABEL = "co.atlas.daemon";
const PLIST = join(homedir(), "Library", "LaunchAgents", `${LABEL}.plist`);
const LOG_DIR = join(homedir(), "Library", "Logs", "Atlas");
const HOOK_EVENTS = ["SessionEnd", "PreCompact", "Stop"] as const;
const HOOK_MARKER = "atlas-hook.mjs";

/**
 * Homebrew's versioned Cellar path disappears on `brew upgrade`; the
 * `opt/<formula>` symlink survives it. Installed paths must use the latter.
 */
export function stableNodePath(execPath = process.execPath): string {
  const m = /^(.*)\/Cellar\/([^/]+)\/[^/]+\/bin\/node$/.exec(execPath);
  if (!m) return execPath;
  const stable = `${m[1]}/opt/${m[2]}/bin/node`;
  return existsSync(stable) ? stable : execPath;
}

const NODE = stableNodePath();

export function ensureToken(config: Config): string {
  if (existsSync(config.tokenPath)) return readFileSync(config.tokenPath, "utf8").trim();
  mkdirSync(config.dataDir, { recursive: true });
  const token = randomBytes(32).toString("hex");
  writeFileSync(config.tokenPath, token, { mode: 0o600 });
  chmodSync(config.tokenPath, 0o600);
  return token;
}

// ── Claude Code hooks ───────────────────────────────────────

interface HookGroup {
  matcher?: string;
  hooks: { type: string; command: string; timeout?: number }[];
}

function readSettings(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

export function hooksInstalled(config: Config): boolean {
  try {
    const hooks = readSettings(config.claudeSettingsPath).hooks as
      Record<string, HookGroup[]> | undefined;
    return HOOK_EVENTS.every((ev) =>
      (hooks?.[ev] ?? []).some((g) => g.hooks?.some((h) => h.command.includes(HOOK_MARKER))),
    );
  } catch {
    return false;
  }
}

/** Merge Atlas's hooks into ~/.claude/settings.json without touching anything else. Backs up first. */
export function installHooks(config: Config): string {
  const path = config.claudeSettingsPath;
  const settings = readSettings(path);
  // Keep the first backup: it is the user's settings from before Atlas touched them.
  if (existsSync(path) && !existsSync(`${path}.atlas-backup`))
    copyFileSync(path, `${path}.atlas-backup`);
  const hooks = (settings.hooks ?? {}) as Record<string, HookGroup[]>;
  const command = `"${NODE}" "${HOOK_SCRIPT}"`;
  for (const ev of HOOK_EVENTS) {
    const groups = (hooks[ev] ?? []).filter(
      (g) => !g.hooks?.some((h) => h.command.includes(HOOK_MARKER)),
    );
    groups.push({ hooks: [{ type: "command", command, timeout: 5 }] });
    hooks[ev] = groups;
  }
  settings.hooks = hooks;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(settings, null, 2)}\n`);
  return path;
}

export function uninstallHooks(config: Config): void {
  const path = config.claudeSettingsPath;
  if (!existsSync(path)) return;
  const settings = readSettings(path);
  const hooks = (settings.hooks ?? {}) as Record<string, HookGroup[]>;
  const kept = Object.fromEntries(
    Object.entries(hooks)
      .map(
        ([ev, groups]) =>
          [
            ev,
            groups.filter((g) => !g.hooks?.some((h) => h.command.includes(HOOK_MARKER))),
          ] as const,
      )
      .filter(([, groups]) => groups.length > 0),
  );
  if (Object.keys(kept).length) settings.hooks = kept;
  else delete settings.hooks;
  writeFileSync(path, `${JSON.stringify(settings, null, 2)}\n`);
}

// ── MCP registration ────────────────────────────────────────

export function mcpRegistered(config: Config): boolean {
  try {
    const cfg = JSON.parse(readFileSync(config.claudeUserConfigPath, "utf8")) as {
      mcpServers?: Record<string, unknown>;
    };
    return Boolean(cfg.mcpServers?.atlas);
  } catch {
    return false;
  }
}

export async function registerMcp(config: Config, token: string): Promise<void> {
  await run("claude", ["mcp", "remove", "--scope", "user", "atlas"]).catch(() => undefined);
  await run("claude", [
    "mcp",
    "add",
    "--transport",
    "http",
    "--scope",
    "user",
    "atlas",
    `http://${config.host}:${config.port}/mcp`,
    "--header",
    `Authorization: Bearer ${token}`,
  ]);
}

export async function unregisterMcp(): Promise<void> {
  await run("claude", ["mcp", "remove", "--scope", "user", "atlas"]).catch(() => undefined);
}

// ── launchd ─────────────────────────────────────────────────

function plist(): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${esc(NODE)}</string>
    <string>${esc(CLI_SCRIPT)}</string>
    <string>serve</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>${esc(join(LOG_DIR, "atlasd.log"))}</string>
  <key>StandardErrorPath</key><string>${esc(join(LOG_DIR, "atlasd.log"))}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>${esc(`${dirname(NODE)}:/usr/bin:/bin:/usr/sbin:/sbin`)}</string>
  </dict>
</dict>
</plist>
`;
}

export function launchAgentInstalled(): boolean {
  return existsSync(PLIST);
}

export async function installLaunchAgent(): Promise<void> {
  mkdirSync(LOG_DIR, { recursive: true });
  mkdirSync(dirname(PLIST), { recursive: true });
  const domain = `gui/${process.getuid?.() ?? 501}`;
  await run("launchctl", ["bootout", `${domain}/${LABEL}`]).catch(() => undefined);
  // bootout returns before the job is gone; bootstrapping too early fails with EIO.
  for (let i = 0; i < 50; i++) {
    const loaded = await run("launchctl", ["print", `${domain}/${LABEL}`]).then(
      () => true,
      () => false,
    );
    if (!loaded) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  writeFileSync(PLIST, plist());
  await run("launchctl", ["bootstrap", domain, PLIST]);
}

export async function uninstallLaunchAgent(): Promise<void> {
  const domain = `gui/${process.getuid?.() ?? 501}`;
  await run("launchctl", ["bootout", `${domain}/${LABEL}`]).catch(() => undefined);
  rmSync(PLIST, { force: true });
}
