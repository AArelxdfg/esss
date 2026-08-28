# LLera MONOLITH — Windows rollback repair guard

A reconstructed MONOLITH Windows install-recovery failure mode was hardened on 2026-08-28.

## Restored behavior

- If an interrupted activated install says a previous working LLera existed but the rollback executable is missing, recovery no longer silently deletes the unverified current executable.
- The unverified current executable is copied into `repair-quarantine/` and SHA-256 verified there.
- The install journal enters a durable `repair-required-*` state.
- Future installs are blocked while a repair-required state is present.
- Tampered rollback backups remain fail-closed.
- The normal verified rollback path remains unchanged when the expected backup is present and matches its recorded SHA-256.

## Deterministic regression

`Windows rollback repair guard PASS`

Verified gates:

- missing backup fail-closed
- unverified candidate quarantine
- persistent repair interlock
- normal rollback preservation

Local reconstructed source SHA-256: `f9e8f294f03b5143cc2410078b40e0c662c2c272dfacd8d9b0f337cce6a8ab22`

Regression test SHA-256: `ec33f8aafe10f053140f96774f0619e9f732c4db1da72049acf532e55fe3bae7`

Delta ZIP SHA-256: `71562b06266490991e4931823e6d24a9c007924999957f570e5ff35fdc7ba9ef`

## Truth boundary

This is reconstructed MONOLITH engineering, not recovered exact V5.4 source. No physical Windows execution or GPU validation is claimed. `llera/stable.json` was not modified and no release was published.
