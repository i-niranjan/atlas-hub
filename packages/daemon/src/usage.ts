import type { Feature, UsageReport } from "@atlas/core";
import type { DB } from "./db.ts";

/**
 * Per-million-token list prices (USD) for the models Atlas uses. Estimates:
 * the bill from Anthropic is the source of truth. Cache writes cost 1.25× input;
 * cache reads are listed per model.
 */
const PRICES: Record<string, { input: number; output: number; cacheRead: number }> = {
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2 },
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2 },
};
/** Haiku 5.5 charges more once a prompt exceeds 100K tokens. */
const HAIKU_LONG = { input: 0.5, output: 2.5, cacheRead: 0.05 };

export interface Usage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

export function costOf(model: string, u: Usage): number {
  const read = u.cache_read_input_tokens ?? 0;
  const write = u.cache_creation_input_tokens ?? 0;
  const prompt = u.input_tokens + read + write;
  const base = PRICES[model] ?? PRICES["claude-sonnet-5-5"]!;
  const p = model === "claude-haiku-5-5" && prompt > 100_000 ? HAIKU_LONG : base;
  return (
    (u.input_tokens * p.input +
      write * p.input * 1.25 +
      read * p.cacheRead +
      u.output_tokens * p.output) /
    1e6
  );
}

export type UsageSink = (
  feature: Feature,
  model: string,
  usage: Usage,
  projectId: string | null,
) => void;

export class UsageLog {
  private readonly db: DB;

  constructor(db: DB) {
    this.db = db;
  }

  record: UsageSink = (feature, model, usage, projectId) => {
    this.db
      .prepare(
        `INSERT INTO llm_usage (at, feature, model, project_id, input_tokens, output_tokens, cache_read, cache_write, cost_usd)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        new Date().toISOString(),
        feature,
        model,
        projectId,
        usage.input_tokens,
        usage.output_tokens,
        usage.cache_read_input_tokens ?? 0,
        usage.cache_creation_input_tokens ?? 0,
        costOf(model, usage),
      );
  };

  report(days: number): UsageReport {
    const since = new Date(Date.now() - days * 86_400_000).toISOString();
    const tokens = "(input_tokens + output_tokens + cache_read + cache_write)";
    const total = this.db
      .prepare(
        `SELECT COALESCE(SUM(cost_usd),0) c, COALESCE(SUM(input_tokens + cache_read + cache_write),0) i,
                COALESCE(SUM(output_tokens),0) o, COUNT(*) n FROM llm_usage WHERE at >= ?`,
      )
      .get(since) as { c: number; i: number; o: number; n: number };
    return {
      days,
      total: { costUsd: total.c, inputTokens: total.i, outputTokens: total.o, calls: total.n },
      byFeature: this.db
        .prepare(
          `SELECT feature, SUM(cost_usd) costUsd, SUM(${tokens}) tokens, COUNT(*) calls FROM llm_usage
           WHERE at >= ? GROUP BY feature ORDER BY costUsd DESC`,
        )
        .all(since) as UsageReport["byFeature"],
      byDay: this.db
        .prepare(
          `SELECT substr(at, 1, 10) day, feature, SUM(cost_usd) costUsd, SUM(${tokens}) tokens FROM llm_usage
           WHERE at >= ? GROUP BY day, feature ORDER BY day`,
        )
        .all(since) as UsageReport["byDay"],
      byProject: this.db
        .prepare(
          `SELECT u.project_id projectId, p.name name, SUM(u.cost_usd) costUsd, SUM(${tokens.replace(/(\w+)/g, "u.$1")}) tokens,
                  COUNT(*) calls
           FROM llm_usage u LEFT JOIN projects p ON p.id = u.project_id
           WHERE u.at >= ? GROUP BY u.project_id ORDER BY costUsd DESC`,
        )
        .all(since) as UsageReport["byProject"],
      recent: this.db
        .prepare(
          `SELECT u.at, u.feature, u.model, p.name projectName, ${tokens.replace(/(\w+)/g, "u.$1")} tokens, u.cost_usd costUsd
           FROM llm_usage u LEFT JOIN projects p ON p.id = u.project_id ORDER BY u.at DESC LIMIT 25`,
        )
        .all() as UsageReport["recent"],
    };
  }
}
