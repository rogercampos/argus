import { describe, expect, it } from 'vitest'
import { parseSchemaRb, pluralize, tableNameForModelPath } from './schema'

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
})
