import { describe, expect, it, vi } from 'vitest'
import { startDaemon } from './daemon-main'
import { DaemonSpawner, getDaemonSocketPath } from './daemon-spawner'
import {
  assertDaemonSocketPathWithinSunPathBudget,
  DaemonSocketPathTooLongError,
  daemonSocketPathExceedsSunPathBudget
} from './daemon-socket-path-budget'

function createMinimalSubprocess() {
  return {
    pid: 88888,
    getForegroundProcess: vi.fn(() => null),
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    terminateOwnedTree: () => 'unavailable' as const,
    forceKill: vi.fn(),
    signal: vi.fn(),
    onData: vi.fn(),
    onExit: vi.fn(),
    dispose: vi.fn()
  }
}

const MAX_BYTES = process.platform === 'darwin' ? 103 : 107

function pathOfBytes(byteLength: number): string {
  return `${'x'.repeat(Math.max(0, byteLength - '/daemon-v1.sock'.length))}/daemon-v1.sock`
}

describe('daemon socket path sun_path budget (#17840)', () => {
  it.skipIf(process.platform === 'win32')('accepts a path within the budget', () => {
    expect(daemonSocketPathExceedsSunPathBudget(pathOfBytes(MAX_BYTES))).toBe(false)
    expect(() => assertDaemonSocketPathWithinSunPathBudget(pathOfBytes(MAX_BYTES))).not.toThrow()
  })

  it.skipIf(process.platform === 'win32')('refuses a path one byte over the budget', () => {
    const tooLong = pathOfBytes(MAX_BYTES + 1)
    expect(daemonSocketPathExceedsSunPathBudget(tooLong)).toBe(true)
    expect(() => assertDaemonSocketPathWithinSunPathBudget(tooLong)).toThrowError(
      DaemonSocketPathTooLongError
    )
    try {
      assertDaemonSocketPathWithinSunPathBudget(tooLong)
    } catch (error) {
      expect(error).toBeInstanceOf(DaemonSocketPathTooLongError)
      expect((error as DaemonSocketPathTooLongError).maxBytes).toBe(MAX_BYTES)
      expect((error as DaemonSocketPathTooLongError).pathBytes).toBe(MAX_BYTES + 1)
    }
  })

  it('never refuses on Windows named pipes', () => {
    // The guard is platform-exempt, so a hypothetical long path is still false.
    const savedPlatform = Object.getOwnPropertyDescriptor(process, 'platform')
    Object.defineProperty(process, 'platform', { value: 'win32' })
    try {
      expect(daemonSocketPathExceedsSunPathBudget(pathOfBytes(MAX_BYTES + 50))).toBe(false)
    } finally {
      if (savedPlatform) {
        Object.defineProperty(process, 'platform', savedPlatform)
      }
    }
  })

  it('counts bytes, not code points', () => {
    const savedPlatform = Object.getOwnPropertyDescriptor(process, 'platform')
    Object.defineProperty(process, 'platform', { value: 'linux' })
    try {
      // 'é' is 2 UTF-8 bytes: 50 chars land at 100 bytes.
      expect(daemonSocketPathExceedsSunPathBudget('é'.repeat(50))).toBe(false)
      expect(daemonSocketPathExceedsSunPathBudget('é'.repeat(54))).toBe(true)
    } finally {
      if (savedPlatform) {
        Object.defineProperty(process, 'platform', savedPlatform)
      }
    }
  })
})

describe('DaemonSpawner refuses over-budget endpoints (#17840)', () => {
  it.skipIf(process.platform === 'win32')(
    'throws before forking when the canonical socket path is too long',
    async () => {
      const longRoot = 'x'.repeat(200)
      const launcher = vi.fn(async () => ({ shutdown: vi.fn(async () => {}) }))
      const spawner = new DaemonSpawner({ runtimeDir: longRoot, launcher })

      await expect(spawner.ensureRunning()).rejects.toThrowError(DaemonSocketPathTooLongError)
      expect(launcher).not.toHaveBeenCalled()
      expect(daemonSocketPathExceedsSunPathBudget(getDaemonSocketPath(longRoot))).toBe(true)
    }
  )
})

describe('startDaemon refuses over-budget endpoints (#17840)', () => {
  it.skipIf(process.platform === 'win32')('rejects before constructing the server', async () => {
    await expect(
      startDaemon({
        socketPath: pathOfBytes(MAX_BYTES + 1),
        tokenPath: '/tmp/orca-daemon-token',
        spawnSubprocess: () => createMinimalSubprocess()
      })
    ).rejects.toThrowError(DaemonSocketPathTooLongError)
  })
})
