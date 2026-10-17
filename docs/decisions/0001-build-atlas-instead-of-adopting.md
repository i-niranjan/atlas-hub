---
id: "0001"
kind: decision
title: Build Atlas instead of adopting an existing session-memory tool
summary: No existing tool combines automatic capture, decision and pivot history, and generative UI, so build one.
status: active
supersedes: null
date: 2026-10-17
review: confirmed
evidence:
  - session: f905cf1a-b87d-4fbe-b5e3-2e0d7dbf7553
    quote: "maybe we can get a reference and build better than that"
  - session: f905cf1a-b87d-4fbe-b5e3-2e0d7dbf7553
    quote: "Let's start working on it."
---

## Context

Decisions made in Claude Code sessions get lost in transcripts across projects. A survey (Oct 2026) found tools that cover parts of the problem but none that cover all of it.

## Decision

Build Atlas. Borrow claude-mem's pattern of hooks feeding a local worker, and the Agent Decision Records idea of storing evidence next to each decision.

## Alternatives

- **claude-mem**: captures automatically, but it stores what the agent observed, not decisions or pivots, and its UI is a fixed feed.
- **Workshop / madr-gen**: closest to decision memory, but young and narrow, with no adaptive UI.
- **History viewers** (claude-code-history-viewer, clauhist): raw logs only.

## Consequences

Atlas owns the whole pipeline: capture, extraction quality, storage and UI. The differentiators are decision lineage and generative UI.
