import { useQuery } from "@tanstack/react-query";
import { Dialog } from "radix-ui";
import { CornerDownLeft, Search, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { api, type ListedEntry } from "../lib/api.ts";
import { KindGlyph } from "./ui.tsx";

const SUGGESTIONS = [
  "How did the architecture evolve, and why?",
  "Which decisions changed direction?",
  "What is still undecided?",
  "Summarise the key constraints",
];

type Item = { type: "ask"; text: string } | { type: "entry"; entry: ListedEntry };

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function CommandPalette({
  open,
  onOpenChange,
  projectId,
  projectName,
  projectNames,
  initialMode,
  onAsk,
  onOpenEntry,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string | null;
  projectName: string | null;
  projectNames: Record<string, string>;
  initialMode: "ask" | "search";
  onAsk: (question: string) => void;
  onOpenEntry: (entry: ListedEntry) => void;
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const q = useDebounced(query.trim(), 120);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
    }
  }, [open]);

  const { data: results = [] } = useQuery({
    queryKey: ["search", q],
    queryFn: () => api.search(q),
    enabled: open && q.length >= 2,
    placeholderData: (prev) => prev,
  });

  const items: Item[] = useMemo(() => {
    if (!q) return SUGGESTIONS.map((text) => ({ type: "ask" as const, text }));
    // Current project first, then everything else.
    const ranked = [...results].sort(
      (a, b) => Number(b.projectId === projectId) - Number(a.projectId === projectId),
    );
    const entries = ranked.slice(0, 8).map((entry) => ({ type: "entry" as const, entry }));
    const ask = { type: "ask" as const, text: query.trim() };
    return initialMode === "search" ? [...entries, ask] : [ask, ...entries];
  }, [q, query, results, projectId, initialMode]);

  const choose = (item: Item | undefined) => {
    if (!item) return;
    onOpenChange(false);
    if (item.type === "ask") onAsk(item.text);
    else onOpenEntry(item.entry);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(items.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(items[active]);
    }
  };

  useEffect(() => setActive(0), [q]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed top-[18%] left-1/2 z-50 w-[640px] max-w-[calc(100vw-48px)] -translate-x-1/2 overflow-hidden rounded-[14px] backdrop-blur-2xl"
          style={{
            background: "color-mix(in srgb, var(--elevated) 88%, transparent)",
            boxShadow: "var(--shadow-pop)",
          }}
          onKeyDown={onKeyDown}
        >
          <Dialog.Title className="sr-only">
            {initialMode === "ask" ? "Ask Atlas" : "Search"}
          </Dialog.Title>
          <div className="flex h-[52px] items-center gap-3 px-4">
            {initialMode === "ask" ? (
              <Sparkles size={18} style={{ color: "var(--accent)" }} aria-hidden />
            ) : (
              <Search size={18} style={{ color: "var(--label-2)" }} aria-hidden />
            )}
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={
                initialMode === "ask"
                  ? `Ask about ${projectName ?? "your projects"}…`
                  : "Search decisions in every project…"
              }
              className="h-full flex-1 bg-transparent text-[17px] outline-none placeholder:text-[var(--label-3)] focus-visible:outline-none"
              aria-label="Query"
              aria-controls="palette-results"
              aria-activedescendant={items[active] ? `palette-${active}` : undefined}
            />
          </div>
          {items.length > 0 && (
            <ul
              id="palette-results"
              role="listbox"
              className="max-h-[360px] overflow-y-auto px-2 pt-1 pb-2"
              style={{ borderTop: "0.5px solid var(--separator)" }}
            >
              {!q && (
                <li className="t-section px-2.5 pt-2 pb-1" role="presentation">
                  Ask Atlas
                </li>
              )}
              {items.map((item, i) => (
                <li
                  key={item.type === "ask" ? `ask-${item.text}` : item.entry.id}
                  id={`palette-${i}`}
                  role="option"
                  aria-selected={i === active}
                  onMouseMove={() => setActive(i)}
                  onClick={() => choose(item)}
                  className="flex h-[40px] items-center gap-3 rounded-[8px] px-2.5"
                  style={{
                    background: i === active ? "var(--accent)" : undefined,
                    color: i === active ? "var(--accent-text)" : undefined,
                  }}
                >
                  {item.type === "ask" ? (
                    <>
                      <Sparkles
                        size={16}
                        style={{ color: i === active ? "currentColor" : "var(--accent)" }}
                        aria-hidden
                      />
                      <span className="t-body min-w-0 flex-1 truncate">
                        {q ? (
                          <>
                            Ask Atlas: <span className="font-medium">“{item.text}”</span>
                          </>
                        ) : (
                          item.text
                        )}
                      </span>
                    </>
                  ) : (
                    <>
                      <KindGlyph kind={item.entry.kind} size={20} />
                      <span className="t-body min-w-0 flex-1 truncate">{item.entry.title}</span>
                      <span className="t-caption shrink-0" style={{ opacity: 0.6 }}>
                        {projectNames[item.entry.projectId]}
                      </span>
                    </>
                  )}
                  {i === active && (
                    <CornerDownLeft size={13} aria-hidden style={{ opacity: 0.8 }} />
                  )}
                </li>
              ))}
            </ul>
          )}
          {q.length >= 2 && results.length === 0 && initialMode === "search" && (
            <p className="t-callout px-5 pb-3" style={{ color: "var(--label-3)" }}>
              Nothing recorded matches. Press ↩ to ask Atlas instead.
            </p>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
