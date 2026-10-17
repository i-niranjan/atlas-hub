# Decision records

Atlas records its own decisions here. Once ingestion lands, Atlas imports this folder into its own project, which is the dogfooding loop.

## Format

One file per entry: `NNNN-kebab-title.md`. YAML front matter maps 1:1 to `Entry` in `packages/core/src/entry.ts`:

```yaml
---
id: "0002"
kind: decision # decision | pivot | architecture | constraint | open_question | risk | <snake_case>
title: Use Tauri 2 for the desktop shell # ≤120 chars
summary: One line, ≤140 chars, specific nouns, no filler.
status: active # active | superseded | reverted | resolved
supersedes: null # id of the entry this replaces (required for kind: pivot)
date: 2026-10-17
review: confirmed # confirmed | needs_review
evidence: # at least one verbatim quote from a session
  - session: <claude session id>
    quote: "exact words from the transcript"
---
```

Body sections: **Context**, **Decision**, **Alternatives** (each with why not), **Consequences**.

## Rules

- Record only what was explicitly chosen or agreed on, not brainstorming.
- A decision the agent made without the user agreeing gets `review: needs_review`.
- Never edit history. To change a decision, add a new entry with `supersedes:` and set the old one to `superseded`.
