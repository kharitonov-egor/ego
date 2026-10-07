import { execFileSync } from 'node:child_process'
import { basename } from 'node:path'

export interface GitInfo {
  repository?: string
  commit?: string
  ref?: string
}

export type RunGit = (args: string[], cwd: string) => string | null

export const runGit: RunGit = (args, cwd) => {
  try {
    const output = execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 })
    return output.trim() || null
  } catch {
    return null
  }
}

/** `owner/name` from any GitHub-style remote: SSH, HTTPS, or `ssh://`, with or without `.git`. */
export function repositoryFromRemote(remote: string): string | null {
  const trimmed = remote.trim().replace(/\/+$/, '').replace(/\.git$/, '')
  const scp = /^[^@/\s]+@[^:/\s]+:(.+)$/.exec(trimmed)
  let path = scp ? scp[1] : null
  if (!path) {
    try {
      path = new URL(trimmed).pathname
    } catch {
      return null
    }
  }
  const parts = path.split('/').filter(Boolean)
  return parts.length >= 2 ? parts.slice(-2).join('/') : null
}

/** Where the CLI is running, so My dockets can group by repository and each version names its commit. */
export function gitInfo(cwd: string, git: RunGit = runGit): GitInfo {
  const top = git(['rev-parse', '--show-toplevel'], cwd)
  if (!top) return {}
  const remote = git(['remote', 'get-url', 'origin'], cwd) ??
    git(['remote'], cwd)?.split(/\s+/).map((name) => git(['remote', 'get-url', name], cwd)).find((url) => url !== null) ?? null
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd)
  return {
    repository: (remote && repositoryFromRemote(remote)) || basename(top),
    commit: git(['rev-parse', 'HEAD'], cwd) ?? undefined,
    ref: branch && branch !== 'HEAD' ? branch : undefined
  }
}
