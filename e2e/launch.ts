import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type ElectronApplication, _electron as electron, type Page } from '@playwright/test'
import { type FixtureRepo, type FixtureSpec, makeFixtureRepo } from '../test/fixtures'

export interface LaunchedApp {
  app: ElectronApplication
  /** the first window (welcome or workspace, depending on options) */
  window: Page
  userDataDir: string
  close(): Promise<void>
}

export interface LaunchOptions {
  /** open this folder as a workspace on startup (ARGUS_OPEN) */
  workspace?: string
  /** reuse a previous run's user data (restart tests); default: fresh temp dir */
  userDataDir?: string
  /** show real windows on screen (local debugging only; default headless-style hidden) */
  headed?: boolean
  env?: Record<string, string>
}

const MAIN_ENTRY = join(__dirname, '..', 'out', 'main', 'index.js')

/** rm -rf that tolerates the app still flushing state while it quits */
export function rmrf(path: string): void {
  rmSync(path, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
}

/** Launch the built app (run `electron-vite build` first — pnpm test:e2e does). */
export async function launchArgus(options: LaunchOptions = {}): Promise<LaunchedApp> {
  const userDataDir = options.userDataDir ?? mkdtempSync(join(tmpdir(), 'argus-e2e-'))

  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    ARGUS_USER_DATA: userDataDir,
    // never show windows or steal focus; never spawn/install language servers
    ARGUS_HIDE_WINDOWS: options.headed || process.env.ARGUS_E2E_HEADED ? '0' : '1',
    ARGUS_DISABLE_LSP: '1',
    ...options.env
  }
  // electron-vite dev leftovers must not leak into the packaged-style run
  delete env.ELECTRON_RENDERER_URL
  if (options.workspace) env.ARGUS_OPEN = options.workspace
  else delete env.ARGUS_OPEN

  const app = await electron.launch({ args: [MAIN_ENTRY], env })
  const window = await app.firstWindow()

  return {
    app,
    window,
    userDataDir,
    close: async () => {
      await app.close()
    }
  }
}

/** Fixture repo + app open on it; `close` tears both down. */
export async function launchWithFixture(
  spec?: FixtureSpec
): Promise<LaunchedApp & { repo: FixtureRepo }> {
  const repo = makeFixtureRepo(spec)
  const launched = await launchArgus({ workspace: repo.root })
  return {
    ...launched,
    repo,
    close: async () => {
      await launched.close()
      repo.cleanup()
      rmrf(launched.userDataDir)
    }
  }
}
