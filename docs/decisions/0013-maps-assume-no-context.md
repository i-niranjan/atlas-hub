---
id: "0013"
kind: decision
title: Write every roadmap for someone with no context on the project
summary: Plain-word titles, a one-line explanation per milestone, and a primer of the project's own jargon, all shown visually with little text.
status: active
supersedes: null
date: 2026-10-18
review: confirmed
evidence:
  - session: f905cf1a-b87d-4fbe-b5e3-2e0d7dbf7553
    quote: "make sure that person doesnt have any context abt the proejct"
  - session: f905cf1a-b87d-4fbe-b5e3-2e0d7dbf7553
    quote: "in visualise way and less contnet"
---

## Context

The trajectory map is for understanding a project at a glance, often by someone who wasn't there when it was planned.

## Decision

Extraction writes titles in plain words (what each step delivers, no internal shorthand, ids kept as tags) and one short explanation per goal and milestone, shown only on hover or in the detail panel. A "New here?" strip gives the project in one line plus chips for its own jargon; only terms that actually appear on the map are kept. The sidebar lists Decisions and Trajectory under the selected project.

## Alternatives

- **A written project overview or glossary page**: more content to read, against ADR 0012.

## Consequences

Titles can differ from the documents' wording; the documents' ids stay attached so the two can always be matched.
