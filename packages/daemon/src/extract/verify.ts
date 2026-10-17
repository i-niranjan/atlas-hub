import type { Evidence } from "@atlas/core";
import type { Turn } from "../ingest/transcript.ts";

/**
 * Normalise for comparison only: case, whitespace, typographic quotes and
 * markdown emphasis differ between what a model copies and what was written.
 */
export function normalise(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”‟]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/[*`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export interface VerifiedEvidence extends Evidence {
  role: Turn["role"];
  timestamp: string;
}

/**
 * Keep only quotes that occur verbatim (after normalisation) in the given
 * turns. A quote attributed to the wrong turn is re-pointed to the turn that
 * actually contains it; a quote found nowhere is dropped.
 */
export function verifyEvidence(
  quotes: { turnUuid: string; quote: string }[],
  turns: Turn[],
  sessionId: string,
): VerifiedEvidence[] {
  const normTurns = turns.map((t) => ({ turn: t, text: normalise(t.text) }));
  const out: VerifiedEvidence[] = [];
  const seen = new Set<string>();
  for (const q of quotes) {
    const quote = q.quote.trim();
    const needle = normalise(quote);
    if (needle.length < 4 || needle.length > 400 || seen.has(needle)) continue;
    const match =
      normTurns.find((t) => t.turn.uuid === q.turnUuid && t.text.includes(needle)) ??
      normTurns.find((t) => t.text.includes(needle));
    if (!match) continue;
    seen.add(needle);
    out.push({
      sessionId,
      messageUuid: match.turn.uuid,
      quote,
      role: match.turn.role,
      timestamp: match.turn.timestamp,
    });
  }
  return out;
}
