---
id: "0005"
kind: architecture
title: Fixed app shell with a validated, agent-composed component tree
summary: Navigation is deterministic; content views are composed by the agent from a closed, zod-validated component registry.
status: active
supersedes: null
date: 2026-10-17
review: confirmed
evidence:
  - session: f905cf1a-b87d-4fbe-b5e3-2e0d7dbf7553
    quote: "it should be able to adapt to that rather than rigid traditional software."
  - session: f905cf1a-b87d-4fbe-b5e3-2e0d7dbf7553
    quote: "The app should feel like professional, production-ready stuff."
---

## Context

The UI must adapt to any kind of content, yet stay fast, consistent and polished.

## Decision

The shell (sidebar, timeline, inspector) is deterministic and needs no LLM. The canvas (⌘K) is A2UI-style: the agent calls `render(tree)`, where the tree is built from domain components (DecisionCard, PivotLineage, ArchitectureDiagram, OptionsCompare, …) and layout primitives. Every tree is validated. When a tree fails validation, the valid parts render and a quiet notice replaces the rest. Useful views can be pinned as Lenses.

## Alternatives

- **Fully generated UI**: slow, inconsistent, and hard to make look professional.
- **Fixed screens only**: contradicts the core goal.

## Consequences

The component registry is the design system's contract and must be versioned with the agent's prompt.
