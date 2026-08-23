# AArel OS Serenity Fork Overlay

AArel OS is an independent desktop operating system built by deeply forking the SerenityOS codebase, not by layering on Linux or Windows. This overlay is pinned to the exact upstream revision in `UPSTREAM.lock` so every AArel patch can be replayed and audited.

Product architecture:

- **AArel Monolith** — kernel/core identity and security boundary.
- **Forge** — developer-first desktop, shell, launcher and workspace.
- **LLera** — privilege-separated system-intelligence service exposed to Forge through explicit IPC/capabilities.

This branch intentionally stores AArel-specific changes as a reproducible overlay rather than deleting upstream attribution. `LICENSE.serenity` is retained verbatim and every modified upstream source file must keep its original SPDX/copyright header.

## Acceptance discipline

No feature is considered verified merely because a patch exists. Each patch must pass, in order: clean apply against the pinned upstream revision, compile/build validation, QEMU boot validation where applicable, functional smoke tests, and performance/regression checks. Windows-class completion additionally requires the hardware, recovery, security, application and UX gates tracked by the project.

## Motion budget

Forge motion is designed for 60 Hz as the minimum baseline and must degrade gracefully. Input handling is never blocked by presentation animation. A reduced-motion path and a low-power path are first-class requirements. Blur, dynamic shadows and expensive transitions are optional effects, not correctness dependencies.
