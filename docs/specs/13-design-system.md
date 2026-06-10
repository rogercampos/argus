# Spec 13 — Design System (Dark, RubyMine-inspired)

One theme: dark. Values below are the starting palette (inherited from
sourcedelve, which already iterated toward the desired look). Implement as
CSS custom properties consumed by Tailwind (v4 `@theme`) so everything
references tokens, never literals.

## Color tokens

### Base

| Token | Value | Use |
| --- | --- | --- |
| `--bg-primary` | `#272c3a` | editor background, active tab |
| `--bg-secondary` | `#232838` | panels, modals, status bar, inactive tabs |
| `--bg-shell` | `#1a2548` | window/workspace background (gradient base) |
| `--bg-shell-top` | `#2b4580` | gradient highlight |
| `--border` | `#1a1e2a` | 1px borders everywhere |
| `--fg` | `#DDE1E8` | primary text |
| `--fg-dim` | `#808898` | secondary text, hints, inactive tabs |
| `--selection` | `#383e4c` | text selection, selected list rows |
| `--caret` | `#528BFF` | editor caret, active-tab underline |
| `--scrollbar` | `#444a58BB` | |

### Accents & semantics

| Token | Value |
| --- | --- |
| `--accent-blue` | `#61AFEF` |
| `--error` / red | `#E06C75` |
| `--warning` / yellow | `#E5C07B` |
| `--success` / green | `#98C379` |
| `--cyan` | `#56B6C2` |
| `--purple` | `#C678DD` |
| `--orange` | `#D19A66` |
| `--button-primary-bg` | `#50a14f` (text: near-black) |
| `--star` | `#EAB308` |

### Git status

| Token | Value |
| --- | --- |
| `--git-modified` | `#6CB6D9` |
| `--git-added` | `#50A14FCC` |
| `--git-deleted` | `#FF5266CC` |
| `--git-untracked` | `#5C6370` |
| `--git-conflicted` | `#E06C75` |
| `--git-ignored` | `#D19A66` |
| `--excluded-fg` | `#E06C75` (excluded paths, used at low emphasis) |
| `--external-tab-bg` | `#3E2723` (external file tabs) |

## Gradient background

The window shell (the area behind/between panels) uses a linear gradient
from `--bg-shell-top` to `--bg-shell`, direction roughly from upper-left
toward lower-right (reference geometry: from (100,0) to (900,−300) in window
coordinates — i.e. a shallow diagonal). Panels and the editor sit on top
with their own backgrounds, leaving the gradient visible in the gaps:
**8px outer padding, 6px gaps** between the panel blocks, each block with
**6px border radius**. This floating-blocks-on-gradient look is the
signature visual.

## Typography

- **UI font**: Inter, bundled (woff2). Base size **13px**. Smaller
  variants: 12px (hints, paths), 11px (section labels, uppercase).
- **Editor/mono font**: JetBrains Mono, bundled. Size 13px, line-height 1.5.
  (Used in editors, previews, schema columns, anywhere code or paths align.)
- No font setting UI in phase 1; sizes via settings file
  (`editor.fontSize`, `ui.fontSize`).

## Spacing & chrome

- Radius: **6px** everywhere (panels, modals, buttons, tabs' top corners).
- Editor tab bar height: **35px**; status bar: **25px**; modal/list row
  heights: 25–30px (per feature specs); icons: **16px** standard.
- Tabs: active = `--bg-primary` background, white text, 2px `--caret`
  underline; inactive = `--bg-secondary`, `--fg-dim` text, faint underline
  (`--caret` at ~47% alpha). 6px horizontal / 3px vertical content padding.
- Buttons: 1px border, 6px radius; hover = hovered-bg; primary buttons use
  `--button-primary-bg`.
- Modals: `--bg-secondary` background, 1px `--border`, 6px radius, soft
  shadow (`0 8px 30px rgba(0,0,0,.4)`), centered slightly above middle.

## Icons

- **UI icons**: Codicons (VS Code icon set, SVG, bundled), tinted with
  currentColor.
- **File type icons**: colored devicon-style SVGs, used at their native
  colors, mapped by extension/filename. Initial set (extensions →icon):
  ruby (`rb`, `rake`, `gemspec`, `Gemfile`, `Rakefile`), javascript (`js`,
  `mjs`, `cjs`), typescript (`ts`), react (`jsx`, `tsx`), json, html, css,
  scss/sass, python, rust, markdown, go, c, cpp, java, shell (`sh`, `bash`,
  `zsh`), yaml, toml, xml, sql, vue, svelte, erb, docker (`Dockerfile`).
  Fallback: generic file icon in `--fg-dim`.
- `@pierre/trees` icon config should reuse the same mappings (custom sprite
  if needed) so tree and modals match.

## Conventions

- **`~` for home**: every displayed absolute path substitutes the home
  directory with `~`.
- Selected list rows use `--selection`; hovered rows a slightly lighter
  variant; both full-row.
- Match highlighting (search/fuzzy): highlight color on the matched
  characters (yellow family), bold not required.
- Animations: keep to opacity/transform, ≤150ms; the only looping animation
  is the task-indicator pulse (spec 10).

## Editor syntax theme

A CodeMirror highlight style consistent with the palette: keywords purple,
strings green, numbers/constants orange, types/classes cyan, functions
blue, comments `--fg-dim` italic, errors red underline. (Fine-tuning is
expected; tokens above are the anchors.)

## Acceptance checklist

- [ ] All colors flow from tokens; no hex literals in components.
- [ ] Gradient shell with floating panels (8px/6px/6px geometry).
- [ ] Inter + JetBrains Mono bundled and applied.
- [ ] Tabs/status bar/modals match the metrics above.
- [ ] File icons consistent between tree, tabs, and all modals.
