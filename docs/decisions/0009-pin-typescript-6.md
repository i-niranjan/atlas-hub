---
id: "0009"
kind: constraint
title: Pin TypeScript 6.0 until typescript-eslint supports 7
summary: TypeScript 7.0.2 is latest, but typescript-eslint 8.71 requires <6.1, so the repo pins 6.0.3.
status: active
supersedes: null
date: 2026-10-17
review: confirmed
evidence:
  - session: f905cf1a-b87d-4fbe-b5e3-2e0d7dbf7553
    quote: "confrim the sqllite adn typescript"
  - session: f905cf1a-b87d-4fbe-b5e3-2e0d7dbf7553
    quote: "typescript: '>=4.8.4 <6.1.0'"
---

## Context

M0 setup. TypeScript 7 (the native port) is the npm `latest`.

## Decision

Pin `typescript@6.0.3`. Revisit when typescript-eslint widens its peer range.

## Alternatives

- **TS 7 without type-aware linting**: loses lint coverage at the start of the project, when it matters most.

## Consequences

One dependency to bump later.

Initially agent-proposed; confirmed by the user on 2026-10-17.
