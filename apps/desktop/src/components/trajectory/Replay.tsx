import { Pause, Play, RadioTower } from "lucide-react";
import { useEffect, useRef } from "react";
import { shortDate } from "../../lib/format.ts";
import { Segmented } from "../ui.tsx";

export type Speed = "1" | "4" | "16";

/** Seconds a full replay takes at 1×. */
const BASE_SECONDS = 24;

/**
 * Scrub or play through a project's history. `at` is null when live.
 * Playback walks real time from the first event to now.
 */
export function Replay({
  start,
  end,
  at,
  onChange,
  playing,
  onPlayingChange,
  speed,
  onSpeedChange,
}: {
  start: string;
  end: string;
  at: string | null;
  onChange: (at: string | null) => void;
  playing: boolean;
  onPlayingChange: (p: boolean) => void;
  speed: Speed;
  onSpeedChange: (s: Speed) => void;
}) {
  const t0 = Date.parse(start);
  const t1 = Math.max(Date.parse(end), t0 + 60_000);
  const cur = at ? Date.parse(at) : t1;
  const frame = useRef<number | null>(null);
  const curRef = useRef(cur);
  curRef.current = cur;

  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    // Restart from the beginning when playing from the end.
    if (curRef.current >= t1) {
      curRef.current = t0;
      onChange(new Date(t0).toISOString());
    }
    const tick = (now: number) => {
      const dt = now - last;
      last = now;
      const step = ((t1 - t0) / (BASE_SECONDS * 1000)) * Number(speed) * dt;
      const next = Math.min(t1, curRef.current + step);
      curRef.current = next;
      if (next >= t1) {
        onChange(null);
        onPlayingChange(false);
        return;
      }
      onChange(new Date(next).toISOString());
      frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
    return () => {
      if (frame.current) cancelAnimationFrame(frame.current);
    };
  }, [playing, speed, t0, t1]);

  const live = at === null;
  return (
    <div
      className="flex items-center gap-3 px-4 py-2.5"
      style={{ borderTop: "0.5px solid var(--separator)" }}
    >
      <button
        type="button"
        onClick={() => onPlayingChange(!playing)}
        aria-label={playing ? "Pause replay" : "Replay the project's history"}
        title={playing ? "Pause" : "Replay"}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
        style={{ background: "var(--accent)", color: "var(--accent-text)" }}
      >
        {playing ? (
          <Pause size={13} fill="currentColor" />
        ) : (
          <Play size={13} fill="currentColor" className="translate-x-[1px]" />
        )}
      </button>
      <input
        type="range"
        min={t0}
        max={t1}
        step={(t1 - t0) / 1000}
        value={cur}
        aria-label="Point in time"
        aria-valuetext={live ? "Now" : shortDate(new Date(cur).toISOString())}
        onChange={(e) => {
          onPlayingChange(false);
          const v = Number(e.target.value);
          onChange(v >= t1 - (t1 - t0) / 500 ? null : new Date(v).toISOString());
        }}
        className="replay-range min-w-0 flex-1"
        style={{ ["--pct" as string]: `${((cur - t0) / (t1 - t0)) * 100}%` }}
      />
      <span
        className="t-callout w-[104px] shrink-0 text-right whitespace-nowrap tabular-nums"
        style={{ color: live ? "var(--label-2)" : "var(--accent)" }}
      >
        {live ? "Now" : shortDate(new Date(cur).toISOString())}
      </span>
      <Segmented
        label="Replay speed"
        value={speed}
        onChange={onSpeedChange}
        options={[
          { value: "1", label: "1×" },
          { value: "4", label: "4×" },
          { value: "16", label: "16×" },
        ]}
      />
      <button
        type="button"
        disabled={live}
        onClick={() => {
          onPlayingChange(false);
          onChange(null);
        }}
        className="t-callout flex items-center gap-1 rounded-[6px] px-2 py-1 font-medium disabled:opacity-40 hover:bg-[var(--fill)]"
        style={{ color: "var(--accent)" }}
      >
        <RadioTower size={13} /> Live
      </button>
    </div>
  );
}
