# Argus — UI / UX Review

> **Implemented 2026-06-13.** Every item below was addressed. New design tokens
> (opacity-based `edge`, blue primary CTA, `--text-label/chrome/body`,
> `--size-tabstrip/row`, `--shadow-popover/toast`, tokenized scrollbar/editor
> overlays, brighter `fg-dim`, re-tinted external tab) live in `main.css`, plus
> `antialiased`, Inter `font-feature-settings`, and a `focus-ring` `@utility`.
> Reusable primitives were added under `components/ui/` — `Button`, `IconButton`,
> `TextInput`, `SectionLabel`, `Badge`, `EmptyState`, `Toast` — and modal
> helpers `ModalHeader`/`ModalSearchInput`. All surfaces were refactored onto
> them, all 9–10px text raised to 11px, focus rings added throughout, and the
> error toast made red + dismissible. Verified: typecheck, biome, 336 tests, and
> a production build all green. Two deliberate deviations: the error toast is
> click-to-dismiss (not auto-dismiss — errors shouldn't vanish before being
> read), and a few inline `<span>` text-size usages remain where converting to
> block elements added churn without visual benefit.

Review date: 2026-06-13. A review of the whole interface — colors, typography,
spacing, sizing, gaps, surfaces, forms, and interaction — evaluated against the
`ui.sh` design guidelines and general UX principles.

**Context caveat:** Argus is a dense, always-dark desktop IDE, not a marketing
site. Several `ui.sh` rules are mobile/landing-page oriented and don't apply
(responsive breakpoints, mobile nav, hero/heading groups, `min-h-dvh`, 16px
mobile body text). Where a rule is N/A for a desktop tool it's marked as such;
the findings below are the ones that genuinely affect this product.

Overall the UI is coherent and purpose-built: a single dark token system, calm
instant hovers (no gratuitous transitions), monospace for code/paths, correct
`truncate`/`min-w-0`/`shrink-0` in flex rows, and `tabular-nums` on the
numeric status-bar columns. The issues are mostly **palette cohesion, a type
scale that bottoms out too small, arbitrary/inconsistent sizing, and a few
accessibility gaps** — not structural problems.

---

## 1. Color system

### 1.1 Borders are darker than the surfaces they separate (high)
`--color-edge: #1a1e2a` is darker than both `--color-primary: #272c3a` and
`--color-secondary: #232838` (`main.css:11-16`). Every panel, modal, tab strip,
and status bar is outlined with `border-edge`, so the "edge" reads as a
near-black groove rather than a crisp boundary — and against the navy
`shell-gradient` (#1a2548 → #2b4580) those near-black hairlines look muddy.
Dark UIs usually separate surfaces with a *lighter* hairline. The Surfaces
guideline also says never use solid divider colors — use opacity-based ones.
**Recommend:** switch panel borders to a subtle light line (e.g. `white/8`–
`white/10`) or at least make `--color-edge` lighter than the panel fills;
consider an opacity-based edge token so it adapts on both the panel fills and
the gradient shell.

### 1.2 Two competing "brand" colors: blue accent vs green CTA (high)
The app's accent identity is blue — `--color-accent: #61afef`, `--color-caret:
#528bff` (active-tab underline, links, selection highlights, fuzzy-match
highlight). But the primary action buttons are **green** (`--color-button-
primary: #50a14f`, used by "Go" in `GoToLineModal` and "Replace All" in
`SearchModal`). A green CTA dropped into a blue-accented UI fights the accent
and reads as a second brand color. **Recommend:** make the primary button the
blue accent (or a single agreed CTA color) so the accent and the CTA are the
same family. If green must stay (it matches "git added"), use it only for
genuinely additive/confirm actions, not as the generic primary.

### 1.3 Palette sprawl / duplicate greens (low)
`--color-button-primary` and `--color-git-added` are the same `#50a14f`;
`--color-success` is a different green `#98c379`. There are also two close blues
for "modified" (`#6cb6d9`) vs "accent" (`#61afef`) vs "caret" (`#528bff`).
Several near-duplicate hues dilute the system. **Recommend:** collapse to one
green and one or two blues with documented roles.

### 1.4 External-file tab color is off-palette (low)
`--color-external: #3e2723` (dark brown) tints external-file tabs
(`EditorTabs.tsx:38`). Brown clashes with the blue/navy palette and looks like a
rendering artifact rather than a deliberate state. **Recommend:** use a desat
tint from the existing palette (e.g. a muted accent or a slightly lifted
`secondary`) to mark "external" without introducing a new hue.

### 1.5 Error shown in warning (yellow) color (medium — also UX)
The file-open error toast uses `text-warning` (yellow) (`WorkspaceShell.tsx:219`)
even though a dedicated `--color-error` (red) exists. Errors in yellow read as
warnings and undercut the semantic palette. **Recommend:** use `text-error`.

### 1.6 Hardcoded colors bypassing the token system (low)
The project states tokens are the "single source of truth (spec 13)," yet the
scrollbar thumb (`#444a58bb`, `main.css:182`) and several editor overlays
(`#ffffff08`, `#528bff44`, `#383e4c88` in `editorTheme.ts:26-34`) are raw hex.
**Recommend:** promote these to tokens (`--color-scrollbar`,
`--color-active-line`, etc.) for consistency.

---

## 2. Typography & fonts

### 2.1 The type scale bottoms out too small (high)
Base body is `13px` (`main.css:69`), which is fine for a desktop IDE, but the
chrome leans heavily on `text-[11px]` and drops to `text-[10px]` (badges,
PathTail, symbol kinds) and even `text-[9px]` (`SchemaPanel` "NOT NULL",
"default:", "UNIQUE"; `lsp.test` aside). 9–10px text — especially in the low-
contrast `--color-fg-dim` (#808898) — is below comfortable legibility. **Recommend:**
floor the scale at 11px; promote 9–10px labels to 11px (and consider a slightly
brighter dim color for the smallest text).

### 2.2 No real type scale — every size is an ad-hoc arbitrary px (medium)
Sizes are hand-picked per component: tab labels `12px`, tree rows inherit `13px`,
status bar `11px`, modal rows `12px`, modal headers `11px`, schema columns
`12px`, badges `10px`. There's no semantic scale, so sizes drift. The General
guideline also says use `rem` for arbitrary font sizes (`text-[0.8125rem]` not
`text-[13px]`). **Recommend:** define 3–4 named steps (e.g. `--text-body: 13px`,
`--text-chrome: 12px`, `--text-label: 11px`) and use them everywhere.

### 2.3 Uppercase micro-labels use a sans font (low)
Section labels ("COLUMNS", "PROJECTS", "START", tree root name) use
`uppercase tracking-wider` on Inter (`SchemaPanel.tsx:21`, `ProjectsModal.tsx:15`,
`Welcome.tsx:22`, `Sidebar.tsx:335`). The Typography guideline restricts
`uppercase` eyebrow text to monospace fonts. They do add `tracking-wider`
(good). **Recommend (optional):** either render these in `--font-mono` (fits an
IDE aesthetic well) or drop the uppercase.

### 2.4 `font-bold` on the wordmark (low)
`Welcome.tsx:19` uses `text-4xl font-bold` for the ARGUS wordmark; the guideline
says headings should be `font-semibold`/`font-medium`, never `font-bold`.

### 2.5 Inter loaded without OpenType features (low)
InterVariable is loaded (good), but no `font-feature-settings` (`cv01`–`cv11`,
`ss01`…) and no `antialiased`/`-webkit-font-smoothing` are set (see 6.4).
Enabling Inter's character variants is a cheap polish win on a text-dense UI.

---

## 3. Spacing, sizing & gaps

### 3.1 Inconsistent chrome heights (medium)
Two tab-strip heights for the same visual element: editor tabs are `h-[35px]`
(`EditorTabs.tsx:26`) but the search-panel tab header is `h-[32px]`
(`SearchPanel.tsx:120`). Three near-identical row heights with no rhythm:
`ModalRow` `h-[25px]` (`Modal.tsx:133`), search match rows `h-[24px]`, search
file rows `h-[26px]` (`SearchPanel.tsx`). 24 vs 25 vs 26 is drift, not intent.
**Recommend:** a shared `--row-h` and `--tabstrip-h` token.

### 3.2 Arbitrary px sizing instead of the spacing scale (medium)
`h-9.5`, `h-[35px]`, `h-[32px]`, `h-[25px]`, `w-150`, `w-95`, `max-h-75`,
`w-110`, etc. are scattered through the chrome. Some pixel precision is
legitimate for an IDE, but the General guideline prefers scale/`--spacing()`
values and bare numbers; the current mix makes consistency hard to maintain.

### 3.3 Margins used between flex children instead of `gap` (low)
The search/recent/symbol modals put `m-2` directly on the `<input>`
(`GoToFileModal.tsx`, `RecentFilesModal.tsx:73`, `GoToSymbolModal.tsx:80`), and
`WorkspaceShell.tsx:273` inserts a `<div className="h-1.5 shrink-0" />` spacer
before the status bar. The General guideline says use `gap-*` on the parent
between flex children, not margins/spacer divs. (The inter-panel `Resizer`s are
legitimately interactive, not spacers.)

### 3.4 Inconsistent modal chrome (medium — also UX)
Three different modal header treatments coexist: a full-width bordered header
with uppercase title (`ProjectsModal`, `SlowOpsModal`, `SearchModal`), a
floating `m-2` search input with no header (`GoToFileModal`, `RecentFilesModal`,
`GoToSymbolModal`), and a padded `p-3 gap-2` body with an inline button
(`GoToLineModal`). They also disagree on input radius (`rounded` vs the modal's
`rounded-md`) and result-row look. **Recommend:** one modal shell (header +
body + optional footer) reused by all of them.

---

## 4. Surfaces & borders

### 4.1 Solid borders everywhere instead of opacity-based separation (medium)
Per the Surfaces guideline, prefer the lightest separation that works and use
opacity-based divider colors. The app reaches for a full `border border-edge`
box on nearly every surface (panels, modals, popups, tabs, status bar, the
`bg-primary/40` project cards). On a dark theme, opacity hairlines (`white/8`)
plus whitespace would feel lighter and more refined; reserve full boxed borders
for genuinely standalone/interactive cards. (See 1.1 — the border color is the
bigger issue.)

### 4.2 Popovers/cards are good, shadows are consistent (positive)
Floating surfaces (modals, task/proc popups, context menus, notice/error toasts)
consistently use `shadow-[0_8px_30px_rgba(0,0,0,.4)]` (or `_4px_16px_` for
toasts) on `bg-secondary` — appropriately elevated and not darker than the
canvas. This part follows the Shadows guideline well. Consider promoting the two
repeated shadow values to tokens/utilities.

---

## 5. Buttons & form controls

### 5.1 Inputs remove the outline with no focus replacement (high — a11y)
Every modal input uses `outline-none` with nothing replacing it
(`GoToFileModal`, `GoToLineModal.tsx:50`, `RecentFilesModal.tsx:73`,
`GoToSymbolModal.tsx:80`, `SearchModal`). Keyboard focus is therefore invisible.
Modals autofocus their single input so it's *usually* obvious, but the search
flag toggles, scope picker, and buttons have no visible `focus-visible` ring
either. The Buttons/Form-Controls guidelines require a visible focus ring.
**Recommend:** add a `focus-visible:outline`/`ring` (e.g. `--color-accent`,
inset on inputs per the guideline) across interactive controls.

### 5.2 Two button sizes/styles are roughly consistent, but no shared component (low)
Primary = green filled (`bg-button-primary text-black`), secondary = bordered
(`border-edge bg-secondary hover:bg-hover`), tertiary = ghost text. That's a
reasonable 2–3 tier system, but each button re-declares its classes inline, so
padding drifts (`px-4 py-1` for "Go" vs `px-3 py-1` for context-menu items vs
`px-5 py-2` for "Open Folder…"). **Recommend:** extract `Button`/`IconButton`
components (or `@utility` classes) with fixed sizes; the Buttons guideline wants
at most two heights ≥6px apart in an app UI.

### 5.3 Selection/active states are encoded with more than color (positive)
Active tab = blue underline + filled bg + brighter text; selected list row =
`bg-selection`. Good — not color-only.

---

## 6. Accessibility & root setup

### 6.1 Missing visible focus rings (high)
See 5.1 — the single most important a11y gap. Keyboard-only users can't see
where focus is on inputs/toggles/buttons.

### 6.2 Tiny low-contrast text (medium)
`fg-dim` (#808898) at 9–11px (see 2.1) is hard to read; the 9px labels in
particular fail comfortable legibility. Bump sizes and/or lift the dim color for
the smallest text.

### 6.3 Cryptic icon-only controls (low)
The reveal-active-file "◎" (`Sidebar.tsx:346`), search "↻"/"▶", and the
text-`×` close buttons rely on glyphs that aren't self-evident. They carry
`title` tooltips (good), but a clearer icon set would help discoverability.

### 6.4 Root polish flags from the General guideline (low)
- No `antialiased` / `-webkit-font-smoothing` on the root — recommended for
  crisp text on dark backgrounds.
- No `isolate` on the main app container (`WorkspaceShell.tsx:175`); z-index is
  managed by hand (`z-30/40/50`). `isolate` would prevent stacking surprises.
- `h-screen` is used (`WorkspaceShell`, `Welcome`); harmless in Electron, but
  the guideline prefers `dvh`.

---

## 7. UX issues

### 7.1 Error toast affordance is weak (medium)
The file error renders as a single button whose label is the message with a
literal `" ✕"` appended (`WorkspaceShell.tsx:222`). The dismiss target is the
whole message, and the ✕ is just text, not a styled control. Combined with the
wrong color (1.5), this is the roughest spot. **Recommend:** a proper toast with
a distinct close button, in `error` red, that auto-dismisses like `notice` does.

### 7.2 Dirty-dot-as-close-button is clever but low-discoverability (low)
Dirty tabs show a caret dot that turns into `×` on hover (`EditorTabs.tsx:64`).
Nice and tidy, but there's no always-visible close affordance for dirty tabs.
Acceptable as a deliberate RubyMine-style choice; worth a tooltip on the dot.

### 7.3 Inconsistent empty/error states (low)
Empty/zero states are worded and styled ad hoc per modal ("No results", "No
recent files yet", "No symbols (is a language server running…)", "No projects
detected yet…", "No schema for this file"). Tone is good; styling
(`px-3 py-4 text-[12px] text-fg-dim` vs `px-2 py-4`) drifts. A shared
`<EmptyState>` would unify them.

---

## 8. Markup & Tailwind authoring nits (low, codebase hygiene)

- **`text-*` on inline `<span>`s** — many spans carry `text-[10px]`/`[11px]`/
  `[12px]` (`StatusBar`, `SchemaPanel`, `SearchModal` rows, `GoToSymbolModal`).
  The General guideline says put font-size/line-height on block elements; move
  these to the row container or use a block wrapper.
- **`truncate` on inline `<span>`** in flex rows (`GoToSymbolModal.tsx:93`,
  `SearchModal` rows) works only because they're flex items; safer on a block.
- **Arbitrary px font sizes** should be `rem` per the guideline.
- **Spacer divs / `m-2`** between flex children should be `gap-*` (see 3.3).

---

## Prioritized recommendations

**High impact (do first)**
1. Add visible `focus-visible` rings to all inputs/toggles/buttons (5.1 / 6.1).
2. Rework the border/edge color so separators read as crisp light hairlines, not
   near-black grooves (1.1) — biggest single visual upgrade.
3. Unify the accent: make the primary CTA the blue accent instead of green, or
   formally scope the green (1.2).
4. Raise the type floor to 11px and kill 9–10px text in `fg-dim` (2.1).

**Medium**
5. Define a small type scale + row/tab-strip height tokens and apply them
   (2.2, 3.1, 3.2).
6. One reusable modal shell + `Button`/`IconButton`/`EmptyState` components
   (3.4, 5.2, 7.3).
7. Fix the error toast: red, real close button, auto-dismiss (1.5, 7.1).
8. Prefer opacity-based, lighter separation over boxed solid borders (4.1).

**Low / polish**
9. Collapse duplicate palette hues; re-tint the external-file tab (1.3, 1.4).
10. Tokenize the remaining hardcoded colors and shadow values (1.6, 4.2).
11. `antialiased` + Inter `font-feature-settings` + `isolate` on root (6.4, 2.5).
12. Markup hygiene: font-size on block elements, `gap` over margins/spacers,
    `rem` font sizes (section 8).
</content>
