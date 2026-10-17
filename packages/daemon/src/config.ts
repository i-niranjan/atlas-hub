import { homedir } from "node:os";
import { join } from "node:path";

export const VERSION = "0.1.0";

export interface Config {
  /** App data: database, token, spool, logs. */
  dataDir: string;
  dbPath: string;
  tokenPath: string;
  spoolPath: string;
  /** Markdown mirror root (ADR 0006). */
  mirrorDir: string;
  /** Where Claude Code keeps transcripts. */
  claudeProjectsDir: string;
  claudeSettingsPath: string;
  claudeUserConfigPath: string;
  /** Claude Code plan-mode plans (module 2 reads them as plan versions). */
  claudePlansDir: string;
  host: string;
  port: number;
  models: { extract: string; canvas: string };
  /** Debounce after a `Stop` hook before extracting, so a live session isn't re-read every turn. */
  stopDebounceMs: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const home = env.ATLAS_HOME_OVERRIDE ?? homedir();
  const dataDir = env.ATLAS_DATA_DIR ?? join(home, "Library", "Application Support", "Atlas");
  return {
    dataDir,
    dbPath: join(dataDir, "atlas.db"),
    tokenPath: join(dataDir, "token"),
    spoolPath: join(dataDir, "spool.jsonl"),
    mirrorDir: env.ATLAS_MIRROR_DIR ?? join(home, "Atlas"),
    claudeProjectsDir: join(home, ".claude", "projects"),
    claudeSettingsPath: join(home, ".claude", "settings.json"),
    claudeUserConfigPath: join(home, ".claude.json"),
    claudePlansDir: join(home, ".claude", "plans"),
    host: "127.0.0.1",
    port: Number(env.ATLAS_PORT ?? 47600),
    models: {
      extract: env.ATLAS_EXTRACT_MODEL ?? "claude-haiku-5-5",
      canvas: env.ATLAS_CANVAS_MODEL ?? "claude-sonnet-5-5",
    },
    stopDebounceMs: Number(env.ATLAS_STOP_DEBOUNCE_MS ?? 120_000),
  };
}
