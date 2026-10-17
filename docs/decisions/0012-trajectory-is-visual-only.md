---
id: "0012"
kind: decision
title: Show where a project is heading as live visuals, never as generated documents
summary: Module 2 draws a live trajectory map, heading card, replay and scope chart; Atlas writes no roadmap documents of its own.
status: active
supersedes: null
date: 2026-10-18
review: confirmed
evidence:
  - session: f905cf1a-b87d-4fbe-b5e3-2e0d7dbf7553
    quote: "i dont want more docs"
  - session: f905cf1a-b87d-4fbe-b5e3-2e0d7dbf7553
    quote: "something which will giver understnadign just by haivng glimps of digarms and stuff"
---

## Context

Projects already carry their own plan documents, which can be pasted into any chat model. Atlas adds value only where text can't: understanding a project's direction at a glance.

## Decision

Atlas derives a trajectory (tracks, milestones, stories, pivots) from project docs, Claude plan-mode plans, sessions and git commits, and only ever _draws_ it: a subway map with forks at pivots, a heading card, Replay over the append-only history, and a scope chart. The animations are native (Motion + SVG), so they stay live and clickable.

## Alternatives

- **Generated roadmap markdown**: duplicates the project's own docs and needs reading.
- **Claude Motion videos**: right spirit, but they're exported clips that can't be embedded or kept live. A possible later "export project story" feature.

## Consequences

The extraction must be complete and stable (completeness retry, append-only events), because the map is only as good as its data.
