import { describe, expect, it, vi } from 'vitest'
import { startDaemon } from './daemon/daemon-main'
import { DaemonSpawner, getDaemonSocketPath } from './daemon/daemon-spawner'
import { UnixSocketTransport } from './runtime/rpc/unix-socket-transport'
import {
  assertUnixSocketPathWithinSunPathBudget,
  UnixSocketPathTooLongError,
  unixSocketPathExceedsSunPathBudget
} from './unix-socket-sun-path-budget'

const MAX_BYTES = process.platform === 'darwin' ? 103 : 107

function pathOfBytes(byteLength: number): string {
  return `${'x'.repeat(Math.max(0, byteLength - '/daemon-v1.sock'.length))}/daemon-v1.sock`
}

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

describe('unix socket path sun_path budget (#17840)', () => {
  it.skipIf(process.platform === 'win32')('accepts a path within the budget', () => {
    expect(unixSocketPathExceedsSunPathBudget(pathOfBytes(MAX_BYTES))).toBe(false)
    expect(() =>
      assertUnixSocketPathWithinSunPathBudget('terminal daemon', pathOfBytes(MAX_BYTES))
    ).not.toThrow()
  })

  it.skipIf(process.platform === 'win32')('refuses a path one byte over the budget', () => {
    const tooLong = pathOfBytes(MAX_BYTES + 1)
    expect(unixSocketPathExceedsSunPathBudget(tooLong)).toBe(true)
    expect(() => assertUnixSocketPathWithinSunPathBudget('terminal daemon', tooLong)).toThrowError(
      UnixSocketPathTooLongError
    )
    try {
      assertUnixSocketPathWithinSunPathBudget('terminal daemon', tooLong)
    } catch (error) {
      expect(error).toBeInstanceOf(UnixSocketPathTooLongError)
      expect((error as UnixSocketPathTooLongError).maxBytes).toBe(MAX_BYTES)
      expect((error as UnixSocketPathTooLongError).pathBytes).toBe(MAX_BYTES + 1)
      expect((error as UnixSocketPathTooLongError).owner).toBe('terminal daemon')
    }
  })

  it('never refuses on Windows named pipes', () => {
    const savedPlatform = Object.getOwnPropertyDescriptor(process, 'platform')
    Object.defineProperty(process, 'platform', { value: 'win32' })
    try {
      expect(unixSocketPathExceedsSunPathBudget(pathOfBytes(MAX_BYTES + 50))).toBe(false)
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
      expect(unixSocketPathExceedsSunPathBudget('é'.repeat(50))).toBe(false)
      expect(unixSocketPathExceedsSunPathBudget('é'.repeat(54))).toBe(true)
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

      await expect(spawner.ensureRunning()).rejects.toThrowError(UnixSocketPathTooLongError)
      expect(launcher).not.toHaveBeenCalled()
      expect(unixSocketPathExceedsSunPathBudget(getDaemonSocketPath(longRoot))).toBe(true)
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
    ).rejects.toThrowError(UnixSocketPathTooLongError)
  })
})

describe('UnixSocketTransport refuses over-budget endpoints (#17840)', () => {
  it.skipIf(process.platform === 'win32')('rejects before binding', async () => {
    const transport = new UnixSocketTransport({
      endpoint: pathOfBytes(MAX_BYTES + 1),
      kind: 'unix'
    })
    await expect(transport.start()).rejects.toThrowError(UnixSocketPathTooLongError)
  })
})
