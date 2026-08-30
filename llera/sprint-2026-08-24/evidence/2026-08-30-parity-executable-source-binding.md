# LLera MONOLITH OMEGA restore evidence — executable-source parity binding

Date: 2026-08-30

## Change
MONOLITH parity evidence for required tool families and required behavior markers is now derived only from executable source files (`.js`, `.cjs`, `.mjs`, `.ts`, `.tsx`). Markdown and JSON reports/contracts remain scanned for source digest purposes but cannot satisfy functional parity evidence.

This closes a false-positive class where historical build reports or contract documents could contain canonical tool names / marker strings without corresponding executable implementation.

## Regression contract
`monolith-parity-gate.js --self-test` now contains a docs/json isolation fixture. It places canonical tool names and all behavior markers only in Markdown/JSON while executable source contains only non-canonical filler tool registrations. The gate must report zero required contract tools, zero behavior markers, and must not PASS.

## Source identity
- Source commit: `c159d17d29ebda4d20a1565ee160997102f7943f`
- Source blob: `fbdb2f7018f6829d94ce77a42a40799e46b4bcba`

## Verification boundary
The GitHub write completed successfully. This automation environment could not fetch `raw.githubusercontent.com` for an executable Node run, so no runtime PASS is claimed for the updated self-test in this evidence record.

## Release boundary
- Exact V5.3.5/V5.4 artifact bytes were not recovered in this run.
- `llera/stable.json` was not modified.
- No release was published.
- No exact V5.4, full parity, physical Windows/GPU validation, or Windows-grade final claim is made.
