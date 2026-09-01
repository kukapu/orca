/* sockaddr_un.sun_path budget for the process-local unix socket endpoints
 * (terminal daemon + runtime RPC). */

// 108 bytes on Linux, 104 on macOS, minus the mandatory NUL terminator.
const SUN_PATH_MAX_BYTES = process.platform === 'darwin' ? 103 : 107

export class UnixSocketPathTooLongError extends Error {
  constructor(
    readonly owner: string,
    readonly socketPath: string,
    readonly pathBytes: number,
    readonly maxBytes: number
  ) {
    super(
      `${owner} socket path exceeds the AF_UNIX sun_path budget (${pathBytes} > ${maxBytes} bytes): ${socketPath}. Move the Orca data root to a shorter path; this endpoint cannot bind here.`
    )
    this.name = 'UnixSocketPathTooLongError'
  }
}

/** Windows named pipes have no filesystem path budget and never trip this. */
export function unixSocketPathExceedsSunPathBudget(socketPath: string): boolean {
  if (process.platform === 'win32') {
    return false
  }
  return Buffer.byteLength(socketPath, 'utf8') > SUN_PATH_MAX_BYTES
}

export function assertUnixSocketPathWithinSunPathBudget(owner: string, socketPath: string): void {
  if (unixSocketPathExceedsSunPathBudget(socketPath)) {
    throw new UnixSocketPathTooLongError(
      owner,
      socketPath,
      Buffer.byteLength(socketPath, 'utf8'),
      SUN_PATH_MAX_BYTES
    )
  }
}
