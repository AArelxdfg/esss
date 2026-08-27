# LLera MONOLITH — Live Watchdog Posture Milestone

This milestone closes a runtime safety gap in the reconstructed MONOLITH product lifecycle.

## Problem

The product coordinator previously latched watchdog safe-mode only at boot. If the crash-loop watchdog entered safe-mode while the process was already running, mutating mission tools, mission finalization/learning, and signed update/install could continue until restart.

## Change

- `startup-recovery-coordinator.js` now exposes `watchdogPosture()` using the existing watchdog launch profile contract.
- `monolith-product-coordinator.js` refreshes watchdog posture before host sampling, tool execution, finalization, update/install, and UI snapshots.
- Runtime transition into watchdog safe-mode is a one-way latch for the current process lifetime.
- After the latch, only the existing safe-mode observation allowlist may run.
- Mission mutation, finalization/learning, and update/install remain blocked.
- UI lifecycle state immediately exposes the safe-mode transition.

## Regression evidence

`test/live-watchdog-posture.test.js` passes under Node and covers:

- normal boot and mutation before safe-mode;
- dynamic safe-mode entry without restart;
- mutation blocking;
- read-only observation continuity;
- finalization blocking;
- update blocking;
- UI safe-mode visibility;
- one-way latch after watchdog profile later returns to normal.

## Local SHA-256

- startup-recovery-coordinator.js: `0700ce049c44ea6fa7177df84f4b3faa895799bbbac5bbd8092786a63bc31d11`
- monolith-product-coordinator.js: `44cb2d0038d5f5d0952c6bdc9f9fe0adad9b2607cca9ec37a053b17a37bb4454`
- live-watchdog-posture.test.js: `48f00b4e3d2925fa8f797fb57a681a8d5a691bf91a5b14f12156c2afee04631f`

## Historical source status

This is reconstructed behavior, not an exact historical V5.4 source recovery. The verified V5.3.5 source ZIP SHA-256 remains `06e9413789ffda643c5ba89be2794523a03f0d75a89eed91ca910527b4479097`; V5.4 remains `b2b4cd091a68c6cc729585330353c292f990af3363193869b9f5971947af3471`. Exact ZIP bytes are still unavailable.

`llera/stable.json` is intentionally unchanged and no release is published.
