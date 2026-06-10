# Spec 14 — Keybindings (macOS)

The complete default keymap. RubyMine-derived; conflicts resolved in
RubyMine's favor. No user-customizable keymap UI in phase 1 (a JSON file
override is acceptable if cheap).

Conditions: `editor` = an editor has focus; `modal` = a modal is open;
`list` = a modal/list owns arrows; `tree` = file tree focused;
`find` = in-editor find bar focused.

## Navigation

| Key | Command | When |
| --- | --- | --- |
| Cmd+Shift+O | Go to File | |
| Cmd+O | Go to Symbol | |
| Cmd+E | Recent Files | |
| Cmd+L | Go to Line | |
| Cmd+B | Go to Definition | editor |
| Cmd+Click | Go to Definition | editor |
| Cmd+Alt+Left | Back (jump history) | |
| Cmd+Alt+Right | Forward (jump history) | |
| Cmd+1 | Toggle + focus file tree | |
| Cmd+Shift+] | Next editor tab | |
| Cmd+Shift+[ | Previous editor tab | |

## Search

| Key | Command | When |
| --- | --- | --- |
| Cmd+F | Find in file | editor |
| Cmd+R | Replace in file | editor |
| Cmd+Shift+F | Global search modal | |
| Cmd+Shift+R | Global replace modal | |
| Enter | next match | find |
| Shift+Enter | previous match | find |
| Tab | toggle find ↔ replace input | find |
| Esc | close find bar / clear highlights | find or highlights active |
| Cmd+Enter | send search to panel | search modal |

## Editing

| Key | Command | When |
| --- | --- | --- |
| Cmd+Z / Cmd+Shift+Z | Undo / Redo | |
| Cmd+X / Cmd+C / Cmd+V | Cut / Copy / Paste (line-wise when no selection) | editor |
| Cmd+A | Select all | |
| Cmd+D | Duplicate line / selection | editor |
| Cmd+Backspace | Delete line | editor |
| Alt+Backspace | Delete word backward | editor |
| Alt+Delete | Delete word forward | editor |
| Alt+Shift+Up / Down | Move line up / down | editor |
| Cmd+/ | Toggle line comment | editor |
| Cmd+] / Cmd+[ | Indent / outdent | editor |
| Cmd+Enter | New line below (cursor anywhere in line) | editor, no modal |
| Cmd+Shift+Enter | New line above | editor |
| Alt+Up / Alt+Down | Expand / shrink selection (syntax) | editor |
| Tab / Shift+Tab | Indent/outdent selection; insert tab otherwise | editor |

## Cursor movement

| Key | Command |
| --- | --- |
| Alt+Left / Alt+Right | Word backward / word end forward |
| Cmd+Left | Line start (first non-blank, toggling to col 0) |
| Cmd+Right | Line end |
| Cmd+Up / Cmd+Down | Document start / end |
| Ctrl+A / Ctrl+E | Line start / end (emacs-style, macOS standard) |
| Home / End, PageUp / PageDown | standard |
| All of the above + Shift | extend selection |

## Language features

| Key | Command | When |
| --- | --- | --- |
| Ctrl+Space | Trigger completion | editor |
| Alt+Enter | Quick fixes / code actions | editor |
| Shift+F6 | Rename symbol | editor |
| F2 / Shift+F2 | Next / previous diagnostic in file | editor |

## Files & app

| Key | Command |
| --- | --- |
| Cmd+S | Save active file |
| Cmd+Alt+S | Save all |
| Cmd+N | New file |
| Cmd+W | Close tab |
| Cmd+Shift+W | Close window |
| Cmd+Shift+C | Copy relative path of active file |
| Cmd+, | Settings |
| Cmd+Q | Quit |
| Cmd+= / Cmd+- | Zoom in / out (UI zoom) |

## Modal/list keys (uniform across all modals)

| Key | Command |
| --- | --- |
| Up / Down | move selection (wraps) |
| Enter | activate selection |
| Esc | close (or step out of preview first — spec 03/05) |
| PageUp / PageDown | page through list |

## Completion popup

| Key | Command |
| --- | --- |
| Up / Down | move selection |
| Tab or Enter | accept |
| Esc | dismiss |

## Reserved / explicitly unbound

- No Cmd+P (no palette). No Cmd+Shift+P. No Cmd+K chords.
- No multi-cursor bindings.
- Cmd+T, Cmd+G: unassigned (future).

## Acceptance checklist

- [ ] Every binding above works in its context and appears in the menus
      where applicable.
- [ ] No binding intercepts typing in inputs (modals type normally).
- [ ] Cmd+D duplicates the line (and never does anything else).
