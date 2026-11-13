# Test suite

Tests for the two extensions in `extensions/` (`beyin`, `batch`). Nothing here needs a vault, a model or
network: the `beyin` CLI is replaced by a small fake script and the pi API by `harness.ts`.

```bash
bash run.sh                  # smoke + beyin + batch
bun run test-beyin.ts        # the adapter alone
```

Against the real vault, check the whole chain from a project directory with `beyin-smoke` (in the vault's
`.agents/tools/`).
