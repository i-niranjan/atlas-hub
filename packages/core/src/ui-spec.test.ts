import { describe, expect, it } from "vitest";
import { referencedEntryIds, validateView } from "./ui-spec.ts";

describe("validateView", () => {
  it("keeps valid blocks and reports the invalid ones instead of failing", () => {
    const v = validateView({
      title: "Storage history",
      blocks: [
        { type: "PivotLineage", entryId: "e1" },
        { type: "Bogus" },
        { type: "Callout", tone: "loud", text: "x" },
        {
          type: "Section",
          title: "Related",
          blocks: [{ type: "EntryList", entryIds: ["e2", "e3"] }],
        },
      ],
    });
    if ("error" in v) throw new Error(v.error);
    expect(v.blocks.map((b) => b.type)).toEqual(["PivotLineage", "Section"]);
    expect(v.dropped).toHaveLength(2);
    expect(referencedEntryIds(v.blocks).sort()).toEqual(["e1", "e2", "e3"]);
  });

  it("rejects a view without a title or blocks", () => {
    expect("error" in validateView({ blocks: [] })).toBe(true);
  });

  it("applies defaults for optional arrays", () => {
    const v = validateView({
      title: "Arch",
      blocks: [{ type: "ArchitectureDiagram", title: "System", mermaid: "graph LR; A-->B" }],
    });
    if ("error" in v) throw new Error(v.error);
    expect(v.blocks[0]).toMatchObject({ sourceEntryIds: [] });
  });
});
