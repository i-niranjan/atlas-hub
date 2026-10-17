---
id: "0003"
kind: decision
title: Call Claude through the Anthropic API with a user key
summary: Haiku extracts entries with structured outputs and Sonnet drives the generative canvas; key stored in macOS Keychain.
status: active
supersedes: null
date: 2026-10-17
review: confirmed
evidence:
  - session: f905cf1a-b87d-4fbe-b5e3-2e0d7dbf7553
    quote: "Anthropic API key (Recommended)"
---

## Context

Extraction needs reliable structured output, and the canvas needs token streaming that maps cleanly onto AG-UI events.

## Decision

Use the Anthropic SDK directly, with Haiku for extraction and Sonnet for the generative canvas, plus prompt caching. The API key lives in the macOS Keychain, never in files.

## Alternatives

- **`claude -p` headless on the subscription**: no per-use cost, but slower, less controllable, and awkward to stream into AG-UI.
- **Both behind a switch**: more v1 work for an unproven need.

## Consequences

Small per-use cost. Transcript excerpts leave the machine, so secrets are redacted before sending.
