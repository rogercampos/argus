# Spec 12 — Code Quality Reports (ESLint, Semgrep, Problems View)

All quality tools feed the same per-file diagnostics store used by LSP
(spec 08), keyed by `source` so they coexist and update independently.

## ESLint

- Runs as a language server (`vscode-eslint-language-server`) per spec 08 —
  lifecycle, install, settings there. Diagnostics arrive as standard LSP
  publishes with `source: "eslint"`, validating on type.
- Quick fixes: ESLint code actions appear in the Alt+Enter menu (fix,
  disable-rule-with-comment on a separate line, open docs).

## Semgrep

- **Activation**: only when the workspace root contains `.semgrep.yml`,
  `.semgrep.yaml`, or a `.semgrep/` directory, AND a `semgrep` binary is on
  the resolved PATH (workspace env, spec 08). Otherwise fully inert.
- **Invocation**: per file, on open and on save (post-autosave), serialized
  through a single queue (one semgrep at a time):

  ```
  semgrep scan --config <found-config> --json --no-git-ignore
          --metrics=off --quiet --disable-version-check
          --timeout 30 --jobs 1 <file>
  ```

- **Staleness**: a per-file generation counter; results from an outdated run
  are discarded.
- **Output**: parse JSON `results[]`; map to diagnostics with
  `source: "semgrep"`, message = `check_id: message`, severity ERROR/
  WARNING/INFO per `extra.severity`. Exit code 0 = clean, 1 = findings,
  other = error (log once, don't retry the same file until it changes).

## Problems view

**REMOVED (2026-06-11, Roger's decision).** There is no workspace-wide
problems report and no status-bar error/warning counts. Diagnostics from
every source (LSP servers, ESLint, semgrep) surface ONLY inside the editor
view: severity-colored squiggles, error-lens, and the hover tooltip
(spec 06/08).

## Acceptance checklist

- [ ] ESLint squiggles appear while typing in a JS project; Alt+Enter offers
      eslint fixes.
- [ ] Semgrep findings appear on save in a configured repo; no semgrep
      processes in unconfigured repos.
- [ ] Problems view groups, navigates, live-updates; status-bar counts
      match.
