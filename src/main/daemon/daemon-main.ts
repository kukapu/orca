import { DaemonServer } from './daemon-server'
import type { DaemonServerOptions } from './daemon-server-options'
import type { DaemonFileLog } from './daemon-file-log'
import { assertDaemonSocketPathWithinSunPathBudget } from './daemon-socket-path-budget'

export type DaemonStartOptions = {
  socketPath: string
  tokenPath: string
  pidPath?: string
  launchNonce?: string
  startedAtMs?: number
  publishEndpointOwnership?: DaemonServerOptions['publishEndpointOwnership']
  entryPath?: string
  appVersion?: string
  spawnerExecPath?: string
  /** Direct-construction seam for versioned protocol fixtures; never CLI/env configured. */
  protocolVersion?: number
  spawnSubprocess: DaemonServerOptions['spawnSubprocess']
  preparePtySpawn?: DaemonServerOptions['preparePtySpawn']
  onPtySessionExit?: DaemonServerOptions['onPtySessionExit']
  onAuthenticatedClientPair?: DaemonServerOptions['onAuthenticatedClientPair']
  log?: DaemonFileLog
  onIdleShutdown?: () => void
  onRpcShutdown?: () => void
  initialAdoptionTestConfig?: DaemonServerOptions['initialAdoptionTestConfig']
}

export type DaemonHandle = {
  shutdown(): Promise<void>
}

export async function startDaemon(opts: DaemonStartOptions): Promise<DaemonHandle> {
  // Why (#17840): past the sun_path budget the daemon either fails to bind or
  // publishes an endpoint no client can connect to, serving with terminal
  // survival silently off. Refuse loudly instead.
  assertDaemonSocketPathWithinSunPathBudget(opts.socketPath)
  const server = new DaemonServer({
    socketPath: opts.socketPath,
    tokenPath: opts.tokenPath,
    ...(opts.pidPath ? { pidPath: opts.pidPath } : {}),
    ...(opts.launchNonce ? { launchNonce: opts.launchNonce } : {}),
    ...(opts.startedAtMs ? { startedAtMs: opts.startedAtMs } : {}),
    ...(opts.publishEndpointOwnership
      ? { publishEndpointOwnership: opts.publishEndpointOwnership }
      : {}),
    ...(opts.entryPath ? { entryPath: opts.entryPath } : {}),
    ...(opts.appVersion ? { appVersion: opts.appVersion } : {}),
    ...(opts.spawnerExecPath ? { spawnerExecPath: opts.spawnerExecPath } : {}),
    ...(opts.protocolVersion !== undefined ? { protocolVersion: opts.protocolVersion } : {}),
    spawnSubprocess: opts.spawnSubprocess,
    ...(opts.preparePtySpawn ? { preparePtySpawn: opts.preparePtySpawn } : {}),
    ...(opts.onPtySessionExit ? { onPtySessionExit: opts.onPtySessionExit } : {}),
    ...(opts.onAuthenticatedClientPair
      ? { onAuthenticatedClientPair: opts.onAuthenticatedClientPair }
      : {}),
    ...(opts.log ? { log: opts.log } : {}),
    ...(opts.onIdleShutdown ? { onIdleShutdown: opts.onIdleShutdown } : {}),
    ...(opts.onRpcShutdown ? { onRpcShutdown: opts.onRpcShutdown } : {}),
    ...(opts.initialAdoptionTestConfig
      ? { initialAdoptionTestConfig: opts.initialAdoptionTestConfig }
      : {})
  })

  await server.start()

  return {
    shutdown: () => server.shutdown()
  }
}
