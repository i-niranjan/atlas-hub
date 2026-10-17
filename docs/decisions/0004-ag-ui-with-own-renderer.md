---
id: "0004"
kind: architecture
title: Use AG-UI as the agent–UI protocol with Atlas's own renderer
summary: Raw @ag-ui/client over SSE, no CopilotKit UI kit, so every pixel follows the macOS design system.
status: active
supersedes: null
date: 2026-10-17
review: confirmed
evidence:
  - session: f905cf1a-b87d-4fbe-b5e3-2e0d7dbf7553
    quote: "I think we should go for something like AGUI."
  - session: f905cf1a-b87d-4fbe-b5e3-2e0d7dbf7553
    quote: "a search for the proper AGI. I will also give you the link."
---

## Context

The UI should not be a fixed set of screens. AG-UI (docs.ag-ui.com) standardizes the agent-to-frontend stream: lifecycle, text, tool calls, state snapshots and deltas.

## Decision

The daemon exposes an AG-UI SSE endpoint. The app consumes it with `@ag-ui/client` (`HttpAgent`) and renders with Atlas's own component library.

## Alternatives

- **CopilotKit components**: faster to start, but the default look isn't macOS and would fight the design system.
- **A custom protocol**: no benefit over a standard that already covers streaming, tools and shared state.

## Consequences

Atlas writes its own SSE glue on the server (the SDK leaves transport to the app) and its own renderer.
