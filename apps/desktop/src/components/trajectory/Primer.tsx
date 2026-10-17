import type { Primer as PrimerData } from "@atlas/core";
import { BookOpen } from "lucide-react";
import { useState } from "react";

/**
 * For someone with no context: the project in one line, and its own jargon
 * as chips. Hover or focus a chip to see what it means; nothing more to read.
 */
export function Primer({ primer }: { primer: PrimerData }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <section
      className="flex items-center gap-3 rounded-[12px] px-4 py-2.5"
      style={{
        background: "color-mix(in srgb, var(--accent) 7%, var(--card))",
        boxShadow: "var(--shadow-card)",
      }}
      aria-label="About this project"
    >
      <BookOpen size={16} className="shrink-0" style={{ color: "var(--accent)" }} aria-hidden />
      <p className="t-callout min-w-0 shrink" style={{ color: "var(--label)" }}>
        <span className="font-semibold">New here? </span>
        {primer.oneLiner}
      </p>
      {primer.terms.length > 0 && (
        <ul
          className="ml-auto flex shrink-0 flex-wrap justify-end gap-1.5"
          aria-label="Terms used on the map"
        >
          {primer.terms.map((t) => (
            <li key={t.term} className="relative">
              <button
                type="button"
                className="t-caption h-[22px] rounded-full px-2.5 font-medium"
                style={{
                  background: "var(--elevated)",
                  boxShadow: "var(--shadow-card)",
                  color: "var(--label)",
                }}
                onMouseEnter={() => setOpen(t.term)}
                onMouseLeave={() => setOpen(null)}
                onFocus={() => setOpen(t.term)}
                onBlur={() => setOpen(null)}
                aria-describedby={open === t.term ? `term-${t.term}` : undefined}
              >
                {t.term}
              </button>
              {open === t.term && (
                <div
                  id={`term-${t.term}`}
                  role="tooltip"
                  className="t-callout absolute top-[28px] right-0 z-30 w-[230px] rounded-[10px] px-3 py-2"
                  style={{ background: "var(--elevated)", boxShadow: "var(--shadow-pop)" }}
                >
                  <span className="font-semibold">{t.term}</span>
                  <span style={{ color: "var(--label-2)" }}> — {t.meaning}</span>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
