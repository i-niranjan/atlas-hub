---
id: "0010"
kind: architecture
title: Generative views reference entries by id; content comes from the store
summary: The canvas agent arranges recorded entries by id and the daemon fills in their content, so a view cannot misstate a decision.
status: active
supersedes: null
date: 2026-10-17
review: needs_review
evidence:
  - session: f905cf1a-b87d-4fbe-b5e3-2e0d7dbf7553
    quote: "I really want you to focus on UI/UX: how it is on point, and that no sloppy content is getting created."
---

## Context

ADR 0005 lets the agent compose views. A model writing decision text into a view could paraphrase it wrongly or invent details.

## Decision

Domain blocks (DecisionCard, EntryList, PivotLineage, OpenQuestions) carry only entry ids. Before the view is sent as an AG-UI STATE_SNAPSHOT, the daemon resolves every id from SQLite, drops unknown ids, and attaches the stored entries. Free text is limited to short Callout, Markdown and KeyValue blocks, and architecture diagrams must cite their source entries.

## Alternatives

- **Agent writes block content directly**: more flexible, but every view becomes a new chance to misquote a decision.

## Consequences

Views are always consistent with the timeline and inspector. The agent needs get_entry and search tools to find ids before rendering.

Made by the agent during the M5 build, hence `needs_review`.
