/* sockaddr_un.sun_path budget for the terminal daemon's canonical endpoint. */

// 108 bytes on Linux, 104 on macOS, minus the mandatory NUL terminator.
const SUN_PATH_MAX_BYTES = process.platform === 'darwin' ? 103 : 107

export class DaemonSocketPathTooLongError extends Error {
  constructor(
    readonly socketPath: string,
    readonly pathBytes: number,
    readonly maxBytes: number
  ) {
    super(
      `Daemon socket path exceeds the AF_UNIX sun_path budget (${pathBytes} > ${maxBytes} bytes): ${socketPath}. Move the Orca data root to a shorter path; terminal survival cannot serve from here.`
    )
    this.name = 'DaemonSocketPathTooLongError'
  }
}

/** Windows named pipes have no filesystem path budget and never trip this. */
export function daemonSocketPathExceedsSunPathBudget(socketPath: string): boolean {
  if (process.platform === 'win32') {
    return false
  }
  return Buffer.byteLength(socketPath, 'utf8') > SUN_PATH_MAX_BYTES
}

export function assertDaemonSocketPathWithinSunPathBudget(socketPath: string): void {
  if (daemonSocketPathExceedsSunPathBudget(socketPath)) {
    throw new DaemonSocketPathTooLongError(
      socketPath,
      Buffer.byteLength(socketPath, 'utf8'),
      SUN_PATH_MAX_BYTES
    )
  }
}
