# Argus

A desktop code editor built on Electron, designed to stay fast on very large
repositories (~100k files).

Stack and architecture decisions are documented in
[docs/TECH_STACK.md](docs/TECH_STACK.md).

## Development

```bash
pnpm install
pnpm dev                              # run the app with HMR
ARGUS_OPEN=~/code/some-repo pnpm dev  # auto-open a folder on startup
```

## Checks

```bash
pnpm typecheck
pnpm lint      # biome check
pnpm format    # biome format --write
pnpm test      # vitest
```

## Packaging

```bash
pnpm build:mac    # also: build:win, build:linux
```

## Dev scripts

- `scripts/bench-factorial.mjs <repo>` — times file listing + tree preparation
  against a real repository.
- `scripts/cdp-*.mjs` — drive a running dev instance over the Chrome DevTools
  Protocol (launch with `pnpm dev -- -- --remote-debugging-port=9222`):
  screenshots, evaluating expressions, opening files.
