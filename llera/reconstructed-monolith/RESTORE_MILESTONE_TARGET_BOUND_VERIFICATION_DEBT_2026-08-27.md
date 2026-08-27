# LLera MONOLITH Restore Milestone — Target-Bound Verification Debt

## Scope

This milestone hardens the reconstructed MONOLITH tool execution guard so a successful material action cannot be considered verified by an unrelated successful observation.

## Behavior restored/hardened

- Verification debt now carries an action/resource scope when one can be derived.
- File mutations bind debt to the normalized target path.
- Process/window/browser/URL/clipboard/snapshot operations derive equivalent verification scopes when identifiers are available.
- Unrelated observations such as `system_info` no longer clear a scoped `write_file` debt.
- Observation of the wrong file/path no longer clears debt.
- Same-target observations such as `read_file` / `hash_file` can close matching debt.
- Unscoped material actions require an explicit `verifiesFingerprint`/persisted verification binding rather than allowing any observation to clear them.
- Restart restore preserves target scope from persisted mission tool traces.
- Historical 62-tool registry remains unchanged.

## Deterministic verification

`target-bound verification debt PASS`

Verified cases:

- unrelated observation blocked
- wrong target blocked
- same target closes debt
- explicit fingerprint binding for unscoped actions
- restart scope preserved

## Artifact hashes

- `src/tool-surface.js`: `4319dea447c5d4a41f5e897df171ad3b071d4d31ce265a248466a2faea562f73`
- `test/target-bound-verification-debt.test.js`: `c122ff21c0c820bbccd48db76b8cbca464a9c5de288857bcf327a3f8d67836a0`
- Delta ZIP: `fd9ca66dd7cec1fe8b05119854985500fef4440011e46da9cd857d49bfda4f15`

## Exact-source status

Exact historical V5.3.5/V5.4 source ZIP bytes were searched again before this change and were not recovered. The verified build reports still identify:

- V5.3.5 source ZIP SHA-256: `06e9413789ffda643c5ba89be2794523a03f0d75a89eed91ca910527b4479097`
- V5.4 source ZIP SHA-256: `b2b4cd091a68c6cc729585330353c292f990af3363193869b9f5971947af3471`

This milestone is reconstructed behavior hardening, not an exact V5.4 source recovery or physical Windows/GPU validation.

`llera/stable.json` remains unchanged and no release is published.
