---
id: "0002"
kind: decision
title: Use Tauri 2 with React for the desktop shell
summary: Tauri gives a real macOS window (vibrancy, traffic lights, native menus) at ~10 MB; React hosts the AG-UI renderer.
status: active
supersedes: null
date: 2026-10-17
review: confirmed
evidence:
  - session: f905cf1a-b87d-4fbe-b5e3-2e0d7dbf7553
    quote: "Tauri 2 + React (Recommended)"
  - session: f905cf1a-b87d-4fbe-b5e3-2e0d7dbf7553
    quote: "I want the UI to also follow the Mac OS style."
---

## Context

The app must look and feel like a production macOS app and render agent-generated UI.

## Decision

Tauri 2 shell with an overlay title bar, `window-vibrancy` sidebar material and native menus. The UI is React 19 + TypeScript + Vite, styled with Tailwind v4 tokens mapped to macOS semantic colors and Radix primitives.

## Alternatives

- **Native SwiftUI**: the most authentic feel, but there is no official Swift AG-UI SDK, so the protocol client and renderer would have to be hand-built. Full Xcode is also not installed.
- **Electron**: the easiest toolchain, but about 150 MB with higher memory use, and it takes more work to feel native.

## Consequences

Adds a Rust toolchain dependency (installed via `rustup`). Web rendering must be tuned carefully to avoid feeling like a website: system font, the `AccentColor` system color, HIG type scale.
