---
id: "0008"
kind: decision
title: Exclude the morning brief and idea inbox from scope
summary: Both features were proposed and rejected before any work; Atlas focuses on decisions, architecture and pivots.
status: active
supersedes: null
date: 2026-10-17
review: confirmed
evidence:
  - session: f905cf1a-b87d-4fbe-b5e3-2e0d7dbf7553
    quote: "Just remove the morning brief and idea inbox."
---

## Context

The initial feature proposal included a daily cross-project brief and an inbox for "we could build…" ideas pulled from sessions.

## Decision

Neither is built. Retained features: decision lineage, "why is it like this", contradiction checks, resume context, new-project detection.

## Alternatives

- Keep them as optional modules: rejected outright by the user.

## Consequences

The extraction prompt does not harvest ideas or to-dos. Fewer, higher-signal entries.

Recorded as a `decision`, not a `pivot`: the features were only proposed and never agreed on, so nothing was reversed.
