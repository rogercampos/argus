# Spec 08 — LSP Integration

All LSP servers run as child processes of the Electron main process, one
manager per workspace window. Servers are started **per detected project**
(spec 01), not per workspace.

## Server registry

| Server | Languages | Marker / condition | Install | Launch |
| --- | --- | --- | --- | --- |
| ruby-lsp | ruby | `Gemfile` | `gem install ruby-lsp` (project env) | `ruby-lsp` (no args) |
| Sorbet | ruby | `sorbet-static` present in `Gemfile.lock` | none (user's Gemfile) | `srb tc --lsp` |
| vtsls | ts, tsx, js, jsx | `package.json` | `npm install --prefix <data>/lsp-servers/@vtsls/language-server @vtsls/language-server` | `vtsls --stdio` |
| ESLint LS | ts, tsx, js, jsx | `package.json` + eslint config present | `npm install --prefix <data>/lsp-servers/vscode-langservers-extracted vscode-langservers-extracted` | `vscode-eslint-language-server --stdio` |
| bash-language-server | shellscript | any `.sh`/`.bash` file opened | `npm install --prefix <data>/lsp-servers/bash-language-server bash-language-server` | `bash-language-server start` |

`<data>` = `~/Library/Application Support/Argus`.

### Instance policy

- **Single-instance servers** (ruby-lsp, Sorbet, ESLint, bash-ls): one
  instance per (server, project-root); a file in a nested project whose
  ANCESTOR project already runs the server uses the ancestor's instance —
  never start a second one deeper.
- **Per-project servers** (vtsls only): every detected `package.json`
  project gets its own instance (independent tsconfig graphs; one giant
  instance is worse).

### Activation flow (on file open)

1. Determine the file's language; find matching server configs.
2. Resolve the file's project root (spec 01 detection, cached).
3. If an instance for (server, root) exists → use it (send `didOpen`).
4. Else check the binary; if missing → background-install (task UI,
   spec 10: "Installing ruby-lsp… one-time setup"), then start.
5. Start: spawn with the **project environment** (below), initialize with
   the project root as workspace folder, then `didOpen`.

### Auto-update

- Per server, at most once per **24h** (marker files in
  `<data>/lsp-update-markers/<server>`; compare mtime). When stale, run the
  install command again in the background (silently; log failures, never
  block or notify on success). Marker touched on attempt.

### Crash handling

- If a server process exits: log it, mark the instance dead, surface a
  one-line warning notification. Do not auto-restart in a loop: restart on
  the next file-open for that (server, root), max 3 restarts per session,
  then require manual action (Projects view shows "failed — click to
  retry").
- Per-request timeout 30s → the request fails silently (feature simply
  doesn't produce a result) and is logged.

## Environment handling

LSP servers must see the same environment the user's shell would give them
in the project directory (version managers: mise/asdf/rbenv/nvm/direnv).

- **Resolution**: spawn `$SHELL -i -l -c "cd '<dir>' && env -0"`, parse the
  null-delimited output into a map (filter to valid var names).
- **Default env**: resolved once per workspace (dir = workspace root) in the
  background at startup.
- **Per-project env**: resolved lazily the first time a project needs a
  server; cached; resolution runs as a background task (visible in task UI,
  spec 10) since interactive shells can take seconds.
- The resolved env is passed wholesale to the server's child process and
  used for install commands (`gem`, `npm`) too.
- Tool versions for the Projects view (spec 01) are extracted from this env.

## Server-specific configuration

### ruby-lsp

- `initializationOptions: {"enabledFeatures": {"semanticHighlighting": false}}`
  (highlighting comes from CodeMirror/Lezer).
- **Gem indexing exclusion** (setting `ruby.lsp.excludeGems`, default
  `true`): parse `Gemfile.lock`'s GEM section specs (not GIT/PATH entries)
  and send the full gem list as
  `{"indexing": {"excludedGems": [...]}}` — this makes indexing near-instant
  on big apps. Setting `ruby.lsp.excludedPatterns: string[]` (default `[]`)
  additionally feeds `indexing.excludedPatterns`.

### vtsls

- `maxTsServerMemory` computed at startup:
  `clamp((512 + 0.5 × tsJsFileCount) × 1.5, 1024, 8192)` MB, where
  tsJsFileCount counts `.ts/.tsx/.js/.jsx` under the project root excluding
  `node_modules`. Log the computed value.
- Settings payload: `{"vtsls": {"autoUseWorkspaceTsdk": true}, "typescript":
  {"tsserver": {"maxTsServerMemory": <n>}}}`.

### ESLint LS

- Respond `4` (approve) to the `eslint/confirmESLintExecution` request.
- Settings: `validate: "on"`, `run: "onType"`, `workingDirectory: {mode:
  "auto"}`, `useFlatConfig: true` when `eslint.config.{js,mjs,cjs,ts,mts,
  cts}` exists at the project root.

## Features consumed

- Completion (`textDocument/completion` + resolve) — standard popup;
  **inline/ghost-text completion is OFF** (no setting in phase 1).
- Hover; Signature help; Go to definition / type definition;
  Find references (feeds the definition-picker-style panel);
  Document symbols (sticky header, breadcrumbs later);
  Workspace symbols (go-to-symbol, spec 05);
  Code actions (Alt+Enter popup); Rename (Shift+F6, inline box);
  Formatting (menu command); Selection range (Alt+Up/Down, spec 06);
  Inlay hints (on by default).
- **Diagnostics — pull-first**: if the server advertises
  `diagnosticProvider`, pull via `textDocument/diagnostic` (on open, after
  edits debounced ~500ms, on focus); otherwise consume pushed
  `publishDiagnostics`. Both paths merge into one per-file diagnostics
  store, keyed by `source` (so eslint + vtsls + semgrep coexist: replacing
  only same-source entries on update).

## Multi-server routing (monorepos)

For a request on a file served by multiple instances (e.g. ruby-lsp +
Sorbet): fan out to all, then merge — concatenate array results, first
non-null scalar wins, errors ignored if any success, last error if all fail.

## Diagnostics UX

- Squiggles + error lens in the editor (spec 06).
- Hover tooltip merges LSP hover content + diagnostics at that position,
  severity-styled (error red, warning yellow, info blue, hint grey).
- Status bar shows workspace error/warning counts (spec 02); problems view
  lists all diagnostics grouped by file (spec 12).

## Settings summary

| Setting | Default |
| --- | --- |
| `ruby.lsp.excludeGems` | `true` |
| `ruby.lsp.excludedPatterns` | `[]` |
| `lsp.autoUpdate` | `true` |

## Acceptance checklist

- [ ] Opening a Ruby file in factorial starts one ruby-lsp at the right
      root; a deeper Ruby file reuses it.
- [ ] Two package.json projects → two vtsls instances with computed memory.
- [ ] Missing ruby-lsp auto-installs with task-UI visibility, then starts.
- [ ] Env resolved via interactive login shell; mise-managed ruby found.
- [ ] Pull diagnostics used with ruby-lsp; eslint + vtsls diagnostics
      coexist on one file.
- [ ] Server crash → notice, lazy restart, capped retries.
