---
id: "0011"
kind: constraint
title: Build the desktop app against the macOS 26.5 SDK
summary: The installed macOS 27.0 beta SDK is unreadable by the CLT 26.6 linker, so app scripts set SDKROOT to the 26.5 SDK.
status: active
supersedes: null
date: 2026-10-17
review: needs_review
evidence:
  - session: f905cf1a-b87d-4fbe-b5e3-2e0d7dbf7553
    quote: "error: unknown architecture"
---

## Context

`xcrun` picks `MacOSX27.0.sdk`, a leftover beta SDK. Its `.tbd` files list `arm64e.x1`, which `ld-1267` rejects, so every Rust link fails.

## Decision

`app:dev` and `app:build` export `SDKROOT=$(xcrun --sdk macosx26.5 --show-sdk-path)`, falling back to the default SDK when 26.5 is absent.

## Alternatives

- **Delete the 27.0 SDK**: fixes it system-wide, but changes the user's machine outside this project.

## Consequences

Revisit when Command Line Tools catch up with the 27 SDK.

Made by the agent during the M4 build, hence `needs_review`.
