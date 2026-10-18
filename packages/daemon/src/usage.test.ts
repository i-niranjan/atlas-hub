import { describe, expect, it } from "vitest";
import { openDb } from "./db.ts";
import { costOf, UsageLog } from "./usage.ts";

describe("usage", () => {
  it("prices calls per model, including cache reads and writes", () => {
    expect(
      costOf("claude-sonnet-5-5", { input_tokens: 1_000_000, output_tokens: 100_000 }),
    ).toBeCloseTo(3);
    expect(
      costOf("claude-haiku-5-5", {
        input_tokens: 10_000,
        output_tokens: 1_000,
        cache_read_input_tokens: 50_000,
        cache_creation_input_tokens: 4_000,
      }),
    ).toBeCloseTo((10_000 * 0.1 + 4_000 * 0.125 + 50_000 * 0.01 + 1_000 * 0.5) / 1e6);
  });

  it("uses Haiku's long-prompt rate past 100K prompt tokens", () => {
    expect(costOf("claude-haiku-5-5", { input_tokens: 200_000, output_tokens: 0 })).toBeCloseTo(
      0.1,
    );
  });

  it("reports totals by feature, day and project", () => {
    const log = new UsageLog(openDb(":memory:"));
    log.record("decisions", "claude-haiku-5-5", { input_tokens: 1000, output_tokens: 100 }, null);
    log.record("ask", "claude-sonnet-5-5", { input_tokens: 2000, output_tokens: 300 }, null);
    const r = log.report(30);
    expect(r.total.calls).toBe(2);
    expect(r.byFeature.map((f) => f.feature)).toEqual(["ask", "decisions"]);
    expect(r.byDay).toHaveLength(2);
    expect(r.recent).toHaveLength(2);
  });
});
