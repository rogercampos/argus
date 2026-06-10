# Spec 11 — Ruby on Rails Niceties

## Rails project detection

A ruby project (spec 01) is a **Rails project** when
`<project-root>/config/environment.rb` exists. The Projects view badges it
"Rails".

## ActiveRecord schema panel

A **right panel** showing the database columns of the model being viewed.

### Activation

- Visible only when the active editor's file maps to an AR model **and** the
  project's `db/schema.rb` was parsed successfully. Otherwise the panel is
  hidden (not empty — hidden), unless the user explicitly toggled it on via
  the View menu, in which case it shows "No schema for this file".

### Model → table mapping

- Candidate model files: `app/models/**/*.rb` within a Rails project.
- Derive the table name from the path: `app/models/user.rb` → `users`,
  `app/models/blog/post.rb` → `blog_posts` (namespaces join with `_`),
  using standard Rails pluralization. If the derived table is not in the
  schema, try the demodulized name (`posts`). If still absent → "No schema
  for this file".

### Schema parsing (main process)

- Parse `db/schema.rb` with a tolerant line-based parser (no Ruby
  execution): `create_table "name" … do |t|` blocks; inside,
  `t.<type> "column", null: false, default: X` lines; `t.index` lines and
  trailing `add_index` calls.
- Keep per table: column name, type, null:false flag, default (verbatim),
  and the schema.rb line number of each column.
- Re-parse when the watcher reports `db/schema.rb` changed (debounced).
  Parse runs as a background task on big schemas (>1MB).

### Panel content

```
COLUMNS (12)
id            integer    NOT NULL
email         string     NOT NULL  default: ""
name          string
created_at    datetime   NOT NULL
…
INDEXES (3)
index_users_on_email   UNIQUE (email)
…
```

- Column rows: name (normal foreground, monospace), type (dimmed),
  constraints (dimmed, smaller). Click a column → open `db/schema.rb` at
  that column's line.
- Indexes section below, collapsible.

## Rake files

- `Rakefile`, `*.rake` are treated as Ruby: ruby icon, ruby syntax
  highlighting, served by ruby-lsp.

## Acceptance checklist

- [ ] Opening `app/models/user.rb` in a Rails app shows its columns; a
      non-model file hides the panel.
- [ ] Namespaced model resolves its table.
- [ ] Column click jumps into schema.rb at the right line.
- [ ] Editing schema.rb refreshes the panel.
- [ ] `.rake` files highlight as Ruby.
