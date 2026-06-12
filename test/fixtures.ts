import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

/**
 * Real temp git repos for tests (vitest integration and Playwright E2E).
 * No mocks: fixtures are actual directories with actual git history.
 */

export interface FixtureSpec {
  /** rel path -> content. Buffers allowed for binary fixtures. */
  files?: Record<string, string | Buffer>
  /** init a git repo (default true) */
  git?: boolean
  /** commit all files after writing them (default true, ignored without git) */
  commit?: boolean
}

export interface FixtureRepo {
  root: string
  /** run git in the fixture repo, returns stdout */
  git(...args: string[]): string
  /** write (or overwrite) a file, creating parent dirs */
  write(relPath: string, content: string | Buffer): void
  rm(relPath: string): void
  mkdir(relPath: string): void
  cleanup(): void
}

export function makeFixtureRepo(spec: FixtureSpec = {}): FixtureRepo {
  const root = mkdtempSync(join(tmpdir(), 'argus-fixture-'))
  const git = (...args: string[]): string =>
    execFileSync('git', ['-C', root, ...args], { stdio: 'pipe' }).toString()

  const write = (relPath: string, content: string | Buffer): void => {
    mkdirSync(dirname(join(root, relPath)), { recursive: true })
    writeFileSync(join(root, relPath), content)
  }

  if (spec.git !== false) {
    git('init', '--initial-branch=main')
    git('config', 'user.email', 'test@example.com')
    git('config', 'user.name', 'Test')
    git('config', 'commit.gpgsign', 'false')
  }

  for (const [relPath, content] of Object.entries(spec.files ?? {})) {
    write(relPath, content)
  }

  if (spec.git !== false && spec.commit !== false && Object.keys(spec.files ?? {}).length > 0) {
    git('add', '-A')
    git('commit', '-m', 'fixture: initial')
  }

  return {
    root,
    git,
    write,
    rm: (relPath) => rmSync(join(root, relPath), { recursive: true, force: true }),
    mkdir: (relPath) => mkdirSync(join(root, relPath), { recursive: true }),
    cleanup: () => rmSync(root, { recursive: true, force: true })
  }
}

/** A small project resembling what Argus is built for: nested dirs, gitignore, several languages. */
export function sampleProjectFiles(): Record<string, string> {
  return {
    'README.md': '# Sample project\n\nFixture workspace for Argus tests.\n',
    '.gitignore': 'log/\nnode_modules/\n*.tmp\n',
    'package.json': '{\n  "name": "sample",\n  "version": "1.0.0"\n}\n',
    'src/index.ts': [
      "import { greet } from './lib/greet'",
      '',
      "console.log(greet('world'))",
      ''
    ].join('\n'),
    'src/lib/greet.ts': [
      'export function greet(name: string): string {',
      // biome-ignore lint/suspicious/noTemplateCurlyInString: fixture source content, not a mistaken template
      '  return `Hello, ${name}!`',
      '}',
      ''
    ].join('\n'),
    'src/lib/math.ts': [
      'export function add(a: number, b: number): number {',
      '  return a + b',
      '}',
      '',
      'export function subtract(a: number, b: number): number {',
      '  return a - b',
      '}',
      ''
    ].join('\n'),
    'src/styles/app.css': 'body {\n  margin: 0;\n}\n',
    'docs/notes.md': '# Notes\n\nSearchable needle: alpha-bravo-charlie\n',
    'docs/guide.md': '# Guide\n\nAnother needle: alpha-bravo-charlie appears here too.\n'
  }
}

/** Minimal Rails shape for schema-panel tests. */
export function railsProjectFiles(): Record<string, string> {
  return {
    Gemfile: "source 'https://rubygems.org'\ngem 'rails'\n",
    'config/application.rb': 'module Sample\n  class Application\n  end\nend\n',
    'db/schema.rb': [
      'ActiveRecord::Schema[7.1].define(version: 2026_01_01_000000) do',
      '  create_table "users", force: :cascade do |t|',
      '    t.string "email", null: false',
      '    t.string "name"',
      '    t.integer "age", default: 0',
      '    t.datetime "created_at", null: false',
      '    t.index ["email"], name: "index_users_on_email", unique: true',
      '  end',
      '',
      '  create_table "posts", force: :cascade do |t|',
      '    t.string "title"',
      '    t.bigint "user_id", null: false',
      '    t.index ["user_id"], name: "index_posts_on_user_id"',
      '  end',
      'end',
      ''
    ].join('\n'),
    'app/models/user.rb': 'class User < ApplicationRecord\nend\n',
    'app/models/post.rb': 'class Post < ApplicationRecord\nend\n'
  }
}
