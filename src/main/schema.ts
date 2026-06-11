import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { RailsSchemaInfo } from '../shared/types'

/**
 * Rails ActiveRecord schema parsing (spec 11): tolerant line-based parser of
 * db/schema.rb — no Ruby execution.
 */

export interface ParsedSchema {
  tables: Map<string, RailsSchemaInfo>
}

export function parseSchemaRb(content: string): ParsedSchema {
  const tables = new Map<string, RailsSchemaInfo>()
  let current: RailsSchemaInfo | null = null
  const lines = content.split('\n')

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const tableMatch = /^\s*create_table "([^"]+)"/.exec(line)
    if (tableMatch) {
      current = {
        table: tableMatch[1],
        columns: [{ name: 'id', type: 'bigint', notNull: true, default: null, line: i + 1 }],
        indexes: []
      }
      tables.set(tableMatch[1], current)
      continue
    }
    if (!current) continue
    if (/^\s*end\s*$/.test(line)) {
      // keep `current` for trailing add_index lines, but stop column parsing
      continue
    }
    const colMatch = /^\s*t\.(\w+) "([^"]+)"(.*)$/.exec(line)
    if (colMatch && colMatch[1] !== 'index') {
      const rest = colMatch[3]
      current.columns.push({
        name: colMatch[2],
        type: colMatch[1],
        notNull: /null:\s*false/.test(rest),
        default: /default:\s*([^,]+)/.exec(rest)?.[1]?.trim() ?? null,
        line: i + 1
      })
      continue
    }
    const indexMatch = /^\s*t\.index \[([^\]]*)\](.*)$/.exec(line)
    if (indexMatch) {
      current.indexes.push({
        columns: indexMatch[1]
          .replace(/"/g, '')
          .split(',')
          .map((s) => s.trim()),
        unique: /unique:\s*true/.test(indexMatch[2]),
        line: i + 1
      })
    }
    const addIndexMatch = /^\s*add_index "([^"]+)", \[([^\]]*)\](.*)$/.exec(line)
    if (addIndexMatch) {
      const table = tables.get(addIndexMatch[1])
      table?.indexes.push({
        columns: addIndexMatch[2]
          .replace(/"/g, '')
          .split(',')
          .map((s) => s.trim()),
        unique: /unique:\s*true/.test(addIndexMatch[3]),
        line: i + 1
      })
    }
  }
  return { tables }
}

/** app/models/user.rb → users; app/models/blog/post.rb → blog_posts (or posts). */
export function tableNameForModelPath(relPath: string): string[] {
  const match = /app\/models\/(.+)\.rb$/.exec(relPath)
  if (!match) return []
  const parts = match[1].split('/')
  const pluralized = pluralize(parts[parts.length - 1])
  const namespaced = [...parts.slice(0, -1), pluralized].join('_')
  return namespaced === pluralized ? [pluralized] : [namespaced, pluralized]
}

/** Minimal Rails-ish pluralization, enough for common model names. */
export function pluralize(word: string): string {
  if (/(s|x|z|ch|sh)$/.test(word)) return `${word}es`
  if (/[^aeiou]y$/.test(word)) return `${word.slice(0, -1)}ies`
  if (/fe?$/.test(word)) return word.replace(/fe?$/, 'ves')
  if (/(person)$/.test(word)) return word.replace(/person$/, 'people')
  return `${word}s`
}

const schemaCache = new Map<string, { mtime: number; parsed: ParsedSchema }>()

/** Schema info for a model file, or null (spec 11). projectRoot is absolute. */
export async function schemaForModel(
  projectRoot: string,
  relPathInProject: string
): Promise<RailsSchemaInfo | null> {
  const candidates = tableNameForModelPath(relPathInProject)
  if (candidates.length === 0) return null

  const schemaPath = join(projectRoot, 'db/schema.rb')
  let stat: Awaited<ReturnType<typeof fs.stat>>
  try {
    stat = await fs.stat(schemaPath)
  } catch {
    return null
  }
  const cached = schemaCache.get(schemaPath)
  let parsed: ParsedSchema
  if (cached && cached.mtime === stat.mtimeMs) {
    parsed = cached.parsed
  } else {
    parsed = parseSchemaRb(await fs.readFile(schemaPath, 'utf8'))
    schemaCache.set(schemaPath, { mtime: stat.mtimeMs, parsed })
  }
  for (const candidate of candidates) {
    const info = parsed.tables.get(candidate)
    if (info) return info
  }
  return null
}
