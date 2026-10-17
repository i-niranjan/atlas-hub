const DAY = 86_400_000;

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** "Today", "Yesterday", "Tuesday", "12 October", "12 October 2025": the Finder convention. */
export function dayLabel(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const diff = Math.round((startOfDay(now) - startOfDay(d)) / DAY);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  if (diff > 1 && diff < 7) return d.toLocaleDateString(undefined, { weekday: "long" });
  return d.toLocaleDateString(undefined, {
    day: "numeric",
    month: "long",
    ...(d.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  });
}

export function shortDate(iso: string, now = new Date()): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    ...(d.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  });
}

/** Decision records carry a day, not a time; midnight UTC means "date only". */
export function hasTime(iso: string): boolean {
  return !iso.endsWith("T00:00:00.000Z");
}

export function longDate(iso: string): string {
  if (!hasTime(iso)) {
    return new Date(iso).toLocaleDateString(undefined, {
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    });
  }
  return new Date(iso).toLocaleString(undefined, {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function groupByDay<T extends { decidedAt: string }>(items: T[]): [string, T[]][] {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const label = dayLabel(item.decidedAt);
    groups.set(label, [...(groups.get(label) ?? []), item]);
  }
  return [...groups.entries()];
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** "~/WORK/atlas" instead of "/Users/someone/WORK/atlas". */
export function tildify(path: string): string {
  return path.replace(/^\/Users\/[^/]+/, "~");
}
