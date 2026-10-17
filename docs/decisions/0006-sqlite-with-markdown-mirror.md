---
id: "0006"
kind: architecture
title: Store entries in SQLite with FTS5 and mirror each to markdown
summary: SQLite is the source of truth for queries and search; a markdown mirror keeps decisions readable and versionable without the app.
status: active
supersedes: null
date: 2026-10-17
review: confirmed
evidence:
  - session: f905cf1a-b87d-4fbe-b5e3-2e0d7dbf7553
    quote: "confrim the sqllite adn typescript"
  - session: f905cf1a-b87d-4fbe-b5e3-2e0d7dbf7553
    quote: "Keep markdown alongside SQLite."
---

## Context

Atlas needs fast local queries (lineage, full-text search) and data that outlives the app.

## Decision

`better-sqlite3` with migrations and an FTS5 index over title, summary and rationale. Every entry is also written to `~/Atlas/<project>/decisions/NNNN-slug.md` in the same format as this folder.

## Alternatives

- **Markdown only**: no efficient lineage or search queries.
- **A hosted database**: unnecessary. Atlas is local-first.

## Consequences

Two representations. SQLite wins on conflict, and the mirror is regenerated from it.

Initially agent-proposed; confirmed by the user on 2026-10-17.
