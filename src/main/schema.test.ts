import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { parseSchemaRb, pluralize, schemaForModel, tableNameForModelPath } from './schema'

const SCHEMA = `
ActiveRecord::Schema[7.1].define(version: 2024_01_01_000000) do
  create_table "users", force: :cascade do |t|
    t.string "email", default: "", null: false
    t.string "name"
    t.datetime "created_at", null: false
    t.index ["email"], name: "index_users_on_email", unique: true
  end

  create_table "blog_posts", force: :cascade do |t|
    t.bigint "user_id", null: false
    t.text "body"
  end

  add_index "blog_posts", ["user_id"], name: "idx_posts_user"
end
`

describe('Rails schema parsing (spec 11)', () => {
  it('parses tables, columns, constraints and indexes', () => {
    const { tables } = parseSchemaRb(SCHEMA)
    const users = tables.get('users')
    expect(users).toBeDefined()
    const email = users?.columns.find((c) => c.name === 'email')
    expect(email).toMatchObject({ type: 'string', notNull: true, default: '""' })
    const name = users?.columns.find((c) => c.name === 'name')
    expect(name).toMatchObject({ notNull: false, default: null })
    expect(users?.indexes[0]).toMatchObject({ columns: ['email'], unique: true })
    // implicit id column included
    expect(users?.columns[0].name).toBe('id')
  })

  it('attaches trailing add_index calls to the right table', () => {
    const { tables } = parseSchemaRb(SCHEMA)
    expect(tables.get('blog_posts')?.indexes[0]).toMatchObject({
      columns: ['user_id'],
      unique: false
    })
  })

  it('maps model paths to table names including namespaces', () => {
    expect(tableNameForModelPath('app/models/user.rb')).toEqual(['users'])
    expect(tableNameForModelPath('app/models/blog/post.rb')).toEqual(['blog_posts', 'posts'])
    expect(tableNameForModelPath('app/controllers/users_controller.rb')).toEqual([])
  })

  it('pluralizes common forms', () => {
    expect(pluralize('user')).toBe('users')
    expect(pluralize('company')).toBe('companies')
    expect(pluralize('address')).toBe('addresses')
    expect(pluralize('person')).toBe('people')
  })

  it('survives malformed schema content', () => {
    const { tables } = parseSchemaRb('this is not\na schema at all {{{')
    expect(tables.size).toBe(0)
  })

  it('records line numbers for columns and indexes', () => {
    const { tables } = parseSchemaRb(SCHEMA)
    const users = tables.get('users')
    // SCHEMA starts with a blank line: create_table "users" is on line 3
    expect(users?.columns.find((c) => c.name === 'email')?.line).toBe(4)
    expect(users?.indexes[0].line).toBe(7)
  })
})

describe('schemaForModel (spec 11)', () => {
  const root = mkdtempSync(join(tmpdir(), 'argus-schema-model-'))

  afterAll(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('returns null when there is no db/schema.rb', async () => {
    expect(await schemaForModel(root, 'app/models/user.rb')).toBeNull()
  })

  it('resolves a model file to its table', async () => {
    writeFileSync(join(root, 'schema-placeholder'), '') // ensure root exists
    const dbDir = join(root, 'db')
    rmSync(dbDir, { recursive: true, force: true })
    const { mkdirSync } = await import('node:fs')
    mkdirSync(dbDir, { recursive: true })
    writeFileSync(join(dbDir, 'schema.rb'), SCHEMA)

    const info = await schemaForModel(root, 'app/models/user.rb')
    expect(info?.table).toBe('users')
    expect(info?.columns.map((c) => c.name)).toContain('email')

    expect(await schemaForModel(root, 'app/models/nonexistent_table.rb')).toBeNull()
    expect(await schemaForModel(root, 'app/services/thing.rb')).toBeNull()
  })

  it('re-parses when the schema file changes on disk', async () => {
    const schemaPath = join(root, 'db/schema.rb')
    const updated = SCHEMA.replace('create_table "users"', 'create_table "members"')
    writeFileSync(schemaPath, updated)
    // force a distinct mtime (the cache is keyed on it)
    utimesSync(schemaPath, new Date(), new Date(Date.now() + 5000))

    expect(await schemaForModel(root, 'app/models/user.rb')).toBeNull()
    const member = await schemaForModel(root, 'app/models/member.rb')
    expect(member?.table).toBe('members')
  })
})
