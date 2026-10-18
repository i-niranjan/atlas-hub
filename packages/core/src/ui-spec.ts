import { z } from "zod";

/**
 * The generative UI contract (ADR 0005). The agent composes a view from these
 * blocks; content about decisions is referenced by entry id and filled in from
 * the store, so the agent arranges facts but cannot invent them.
 */

const EntryId = z.string().min(1);

const DecisionCard = z.object({
  type: z.literal("DecisionCard"),
  entryId: EntryId,
});

const EntryList = z.object({
  type: z.literal("EntryList"),
  title: z.string().max(80).optional(),
  entryIds: z.array(EntryId).min(1).max(50),
});

const PivotLineage = z.object({
  type: z.literal("PivotLineage"),
  /** Any entry in the chain; the renderer shows the whole lineage. */
  entryId: EntryId,
});

const ArchitectureDiagram = z.object({
  type: z.literal("ArchitectureDiagram"),
  title: z.string().min(1).max(80),
  /** Mermaid flowchart source. */
  mermaid: z.string().min(1).max(4000),
  caption: z.string().max(200).optional(),
  sourceEntryIds: z.array(EntryId).max(20).default([]),
});

const OptionsCompare = z.object({
  type: z.literal("OptionsCompare"),
  question: z.string().min(1).max(140),
  options: z
    .array(
      z.object({
        name: z.string().min(1).max(60),
        pros: z.array(z.string().max(120)).max(6).default([]),
        cons: z.array(z.string().max(120)).max(6).default([]),
        chosen: z.boolean().default(false),
      }),
    )
    .min(2)
    .max(5),
  sourceEntryId: EntryId.optional(),
});

const OpenQuestions = z.object({
  type: z.literal("OpenQuestions"),
  entryIds: z.array(EntryId).min(1).max(30),
});

const ProjectOverview = z.object({
  type: z.literal("ProjectOverview"),
  projectId: z.string().min(1),
});

const Callout = z.object({
  type: z.literal("Callout"),
  tone: z.enum(["info", "warning"]),
  text: z.string().min(1).max(300),
});

const Markdown = z.object({
  type: z.literal("Markdown"),
  text: z.string().min(1).max(2000),
});

const KeyValue = z.object({
  type: z.literal("KeyValue"),
  items: z
    .array(z.object({ label: z.string().min(1).max(40), value: z.string().min(1).max(160) }))
    .min(1)
    .max(12),
});

/** Module 2: the live trajectory map of a project, optionally focused on a time range. */
const TrajectoryMap = z.object({
  type: z.literal("TrajectoryMap"),
  projectId: z.string().min(1),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
});

/** Module 2: a change of direction as Before → After, the shifts, why and what it cost. */
const PivotExplainer = z.object({
  type: z.literal("PivotExplainer"),
  projectId: z.string().min(1),
  /** The track that replaced another; omitted means the most recent pivot. */
  trackId: z.string().min(1).optional(),
});

const ScopeChart = z.object({
  type: z.literal("ScopeChart"),
  projectId: z.string().min(1),
});

export type Block =
  | z.infer<typeof DecisionCard>
  | z.infer<typeof TrajectoryMap>
  | z.infer<typeof ScopeChart>
  | z.infer<typeof PivotExplainer>
  | z.infer<typeof EntryList>
  | z.infer<typeof PivotLineage>
  | z.infer<typeof ArchitectureDiagram>
  | z.infer<typeof OptionsCompare>
  | z.infer<typeof OpenQuestions>
  | z.infer<typeof ProjectOverview>
  | z.infer<typeof Callout>
  | z.infer<typeof Markdown>
  | z.infer<typeof KeyValue>
  | { type: "Section"; title: string; blocks: Block[] };

export const Block: z.ZodType<Block> = z.lazy(() =>
  z.discriminatedUnion("type", [
    DecisionCard,
    EntryList,
    PivotLineage,
    ArchitectureDiagram,
    OptionsCompare,
    OpenQuestions,
    ProjectOverview,
    Callout,
    Markdown,
    KeyValue,
    TrajectoryMap,
    ScopeChart,
    PivotExplainer,
    z.object({
      type: z.literal("Section"),
      title: z.string().min(1).max(80),
      blocks: z.array(Block).min(1).max(20),
    }),
  ]),
) as z.ZodType<Block>;

export const BLOCK_TYPES = [
  "DecisionCard",
  "EntryList",
  "PivotLineage",
  "ArchitectureDiagram",
  "OptionsCompare",
  "OpenQuestions",
  "ProjectOverview",
  "Callout",
  "Markdown",
  "KeyValue",
  "TrajectoryMap",
  "ScopeChart",
  "PivotExplainer",
  "Section",
] as const;

export const View = z.object({
  title: z.string().min(1).max(80),
  blocks: z.array(z.unknown()).min(1).max(30),
});

export interface ValidatedView {
  title: string;
  blocks: Block[];
  /** Human-readable reasons for blocks that were dropped. */
  dropped: string[];
}

/**
 * Validate block by block so one malformed block degrades to a notice
 * instead of failing the whole view.
 */
export function validateView(input: unknown): ValidatedView | { error: string } {
  const shell = View.safeParse(input);
  if (!shell.success) return { error: z.prettifyError(shell.error) };
  const blocks: Block[] = [];
  const dropped: string[] = [];
  shell.data.blocks.forEach((raw, i) => {
    const parsed = Block.safeParse(raw);
    if (parsed.success) blocks.push(parsed.data);
    else {
      const type =
        typeof raw === "object" && raw !== null && "type" in raw ? String(raw.type) : "unknown";
      dropped.push(`block ${i} (${type}): ${z.prettifyError(parsed.error)}`);
    }
  });
  return { title: shell.data.title, blocks, dropped };
}

/** Every entry id a view references, for resolving against the store. */
export function referencedEntryIds(blocks: Block[]): string[] {
  const ids = new Set<string>();
  const visit = (b: Block): void => {
    switch (b.type) {
      case "DecisionCard":
      case "PivotLineage":
        ids.add(b.entryId);
        break;
      case "EntryList":
      case "OpenQuestions":
        b.entryIds.forEach((id) => ids.add(id));
        break;
      case "ArchitectureDiagram":
        b.sourceEntryIds.forEach((id) => ids.add(id));
        break;
      case "OptionsCompare":
        if (b.sourceEntryId) ids.add(b.sourceEntryId);
        break;
      case "Section":
        b.blocks.forEach(visit);
        break;
      default:
        break;
    }
  };
  blocks.forEach(visit);
  return [...ids];
}
