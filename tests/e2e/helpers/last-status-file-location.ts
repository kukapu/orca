import { lstatSync, readdirSync, realpathSync } from 'node:fs'
import path from 'node:path'

export const LAST_STATUS_FILE_NAME = 'last-status.json'

export type LastStatusFileLocation =
  | { status: 'missing' }
  | { status: 'found'; filePath: string }
  | { status: 'ambiguous' }

function isPathInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

function containedRealpath(candidate: string, root: string): string | null {
  try {
    const resolved = realpathSync.native(candidate)
    return isPathInside(root, resolved) ? resolved : null
  } catch {
    return null
  }
}

function containedFile(candidate: string, root: string): string | null {
  try {
    const stat = lstatSync(candidate)
    if (stat.isSymbolicLink()) {
      const resolved = containedRealpath(candidate, root)
      if (resolved == null) {
        return null
      }
      return lstatSync(resolved).isFile() ? resolved : null
    }
    return stat.isFile() ? candidate : null
  } catch {
    return null
  }
}

function containedDir(candidate: string, root: string): string | null {
  try {
    const stat = lstatSync(candidate)
    if (stat.isSymbolicLink()) {
      const resolved = containedRealpath(candidate, root)
      if (resolved == null) {
        return null
      }
      return lstatSync(resolved).isDirectory() ? resolved : null
    }
    return stat.isDirectory() ? candidate : null
  } catch {
    return null
  }
}

/** Bounded lookup: flat agent-hooks/last-status.json or one namespace child. */
export function locateLastStatusFile(userDataDir: string): LastStatusFileLocation {
  let userDataRoot: string
  try {
    userDataRoot = realpathSync.native(userDataDir)
    if (!lstatSync(userDataRoot).isDirectory()) {
      return { status: 'missing' }
    }
  } catch {
    return { status: 'missing' }
  }
  const hooksRoot = containedDir(path.join(userDataRoot, 'agent-hooks'), userDataRoot)
  if (hooksRoot == null) {
    return { status: 'missing' }
  }

  const found = new Set<string>()
  const flat = containedFile(path.join(hooksRoot, LAST_STATUS_FILE_NAME), hooksRoot)
  if (flat != null) {
    found.add(flat)
  }

  let entries: ReturnType<typeof readdirSync>
  try {
    entries = readdirSync(hooksRoot, { withFileTypes: true })
  } catch {
    return found.size === 1 ? { status: 'found', filePath: [...found][0] } : { status: 'missing' }
  }

  for (const entry of entries) {
    if (entry.name === LAST_STATUS_FILE_NAME || entry.name === '.' || entry.name === '..') {
      continue
    }
    const child = path.join(hooksRoot, entry.name)
    const dir = containedDir(child, hooksRoot)
    if (dir == null) {
      continue
    }
    const nested = containedFile(path.join(dir, LAST_STATUS_FILE_NAME), hooksRoot)
    if (nested != null) {
      found.add(nested)
    }
  }

  if (found.size === 0) {
    return { status: 'missing' }
  }
  if (found.size > 1) {
    return { status: 'ambiguous' }
  }
  return { status: 'found', filePath: [...found][0] }
}
