/**
 * Colored file type icon (spec 13): compact language badge used in modals,
 * tabs, and results so file types read at a glance. (Devicon SVGs can
 * replace the glyphs later without touching call sites.)
 */

const ICONS: Record<string, { label: string; color: string }> = {
  rb: { label: 'rb', color: '#e06c75' },
  rake: { label: 'rb', color: '#e06c75' },
  gemspec: { label: 'rb', color: '#e06c75' },
  js: { label: 'js', color: '#e5c07b' },
  mjs: { label: 'js', color: '#e5c07b' },
  cjs: { label: 'js', color: '#e5c07b' },
  jsx: { label: 'jsx', color: '#56b6c2' },
  ts: { label: 'ts', color: '#61afef' },
  tsx: { label: 'tsx', color: '#56b6c2' },
  json: { label: '{}', color: '#e5c07b' },
  html: { label: '<>', color: '#d19a66' },
  htm: { label: '<>', color: '#d19a66' },
  css: { label: '#', color: '#61afef' },
  scss: { label: '#', color: '#c678dd' },
  sass: { label: '#', color: '#c678dd' },
  md: { label: 'M↓', color: '#61afef' },
  py: { label: 'py', color: '#61afef' },
  rs: { label: 'rs', color: '#d19a66' },
  go: { label: 'go', color: '#56b6c2' },
  sh: { label: '$', color: '#98c379' },
  bash: { label: '$', color: '#98c379' },
  zsh: { label: '$', color: '#98c379' },
  yml: { label: 'y', color: '#c678dd' },
  yaml: { label: 'y', color: '#c678dd' },
  toml: { label: 't', color: '#d19a66' },
  sql: { label: 'db', color: '#56b6c2' },
  erb: { label: 'erb', color: '#e06c75' },
  vue: { label: 'V', color: '#98c379' },
  svelte: { label: 'S', color: '#d19a66' }
}

const SPECIAL_FILES: Record<string, { label: string; color: string }> = {
  Gemfile: { label: 'rb', color: '#e06c75' },
  Rakefile: { label: 'rb', color: '#e06c75' },
  Dockerfile: { label: '🐳', color: '#61afef' }
}

export function FileIcon({ path }: { path: string }): React.JSX.Element {
  const base = path.split('/').pop() ?? path
  const ext = (base.split('.').pop() ?? '').toLowerCase()
  const icon = SPECIAL_FILES[base] ?? ICONS[ext] ?? { label: '·', color: '#808898' }
  return (
    <span
      style={{ color: icon.color }}
      className="inline-flex w-6 shrink-0 justify-center rounded bg-hover/60 px-0.5 font-mono text-[9px] leading-4 font-bold"
    >
      {icon.label}
    </span>
  )
}
