import type { ElectronApplication } from '@stablyai/playwright-test'
import { parsePairingCode } from '../../../src/shared/pairing'
import { RemoteRuntimeRequestConnection } from '../../../src/shared/remote-runtime-request-connection'
import type { RuntimeRpcResponse } from '../../../src/shared/runtime-rpc-envelope'
import { STATUS_METHODS } from '../../../src/main/runtime/rpc/methods/status'
import type { HeadlessPairedRuntimeHost } from './headless-paired-runtime-host'
import type { RuntimeDesktopPairingOffer } from './paired-electron-client'
import { assertRemoteValidationIsolation } from './remote-validation-isolation-guards'

export const REMOTE_VALIDATION_COVERAGE = {
  rpcControlPlane: 'rpc-two-paired-clients',
  webNavigationComplement: 'tests/e2e/multi-client-navigation-isolation.spec.ts'
} as const

/**
 * The paired RemoteRuntimeRequestConnection carries no orchestration envelope
 * (dispatch capability / compatibility evidence), so paired observers stay
 * read-only: every mutation goes through the host-local coordinator
 * RuntimeClient or through the worker CLI inside its own terminal.
 */
export const RUNTIME_STATUS_METHOD = 'status.get'

const OBSERVER_READ_ONLY_METHODS = new Set<string>([
  RUNTIME_STATUS_METHOD,
  'orchestration.runCurrent',
  'orchestration.runList',
  'orchestration.runShow',
  'orchestration.taskList',
  'orchestration.dispatchShow',
  'orchestration.workerShow',
  'orchestration.workerRead',
  'orchestration.inbox',
  'worktree.list',
  'terminal.read'
])

export function assertObserverReadOnlyMethod(method: string, params?: unknown): void {
  if (OBSERVER_READ_ONLY_METHODS.has(method) && method !== 'orchestration.check') {
    return
  }
  // check is read-only ONLY in peek/history modes: ack/inject/wait consume or
  // mutate deliveries, which belongs to the coordinator's envelope.
  if (method === 'orchestration.check') {
    const mutating = ['ack', 'compatibilityAck', 'compatibilityQuestionAck', 'inject', 'wait']
    const paramsRecord = (params ?? {}) as Record<string, unknown>
    if (!mutating.some((key) => paramsRecord[key] !== undefined)) {
      return
    }
    throw new Error(
      'Paired RPC observers cannot ack/inject/wait on orchestration.check; use peek or all'
    )
  }
  throw new Error(
    `Paired RPC observers are read-only: ${method} must go through the host-local coordinator client`
  )
}

export function observerReadOnlyMethods(): readonly string[] {
  return [...OBSERVER_READ_ONLY_METHODS].sort()
}

export function assertStatusMethodMatchesRuntimeRegistry(): void {
  if (!STATUS_METHODS.some((method) => method.name === RUNTIME_STATUS_METHOD)) {
    throw new Error(`${RUNTIME_STATUS_METHOD} is not a runtime RPC method`)
  }
}

/** Narrows the RPC envelope for read-only observer calls; never used to
 * silence an error — a failed read fails the spec with its error code. */
export function unwrapRuntimeRpcResponse<TResult>(response: RuntimeRpcResponse<TResult>): TResult {
  if (!response.ok) {
    const detail = 'error' in response && response.error ? `: ${response.error.code}` : ''
    throw new Error(`Observer RPC call failed${detail}`)
  }
  return response.result
}

export type PairedRuntimeClientIdentity = {
  deviceId: string
  deviceToken: string
  pairingUrl: string
}

export type PairedObserverClient = {
  close: () => void
  identity: PairedRuntimeClientIdentity
  request: <TResult>(
    method: string,
    params?: unknown,
    timeoutMs?: number
  ) => Promise<RuntimeRpcResponse<TResult>>
  role: 'paired-observer'
}

export type HostCoordinatorHandle = {
  role: 'host-coordinator'
  userDataDir: string
}

type PairingIpcResult = {
  available?: boolean
  deviceId?: string
  pairingUrl?: string
  webClientUrl?: string
}

export function readPairedClientIdentity(pairingUrl: string): PairedRuntimeClientIdentity {
  const pairing = parsePairingCode(pairingUrl)
  if (!pairing?.deviceToken) {
    throw new Error('Pairing URL is missing a device token')
  }
  return {
    deviceId: pairing.pairedDeviceId ?? pairing.deviceToken,
    deviceToken: pairing.deviceToken,
    pairingUrl
  }
}

export function assertDistinctPairedClientIdentities(
  left: PairedRuntimeClientIdentity,
  right: PairedRuntimeClientIdentity
): void {
  if (left.deviceToken === right.deviceToken || left.deviceId === right.deviceId) {
    throw new Error('Paired RPC clients must have distinct device identities')
  }
}

export async function rotateHeadlessRuntimePairingOffer(
  app: ElectronApplication
): Promise<RuntimeDesktopPairingOffer & { deviceId?: string }> {
  return app.evaluate(async ({ ipcMain }) => {
    type InvokeHandler = (event: unknown, args?: unknown) => unknown
    const handlers = (ipcMain as unknown as { _invokeHandlers?: Map<string, InvokeHandler> })
      ._invokeHandlers
    const handler = handlers?.get('mobile:getRuntimePairingUrl')
    if (!handler) {
      throw new Error('mobile:getRuntimePairingUrl is unavailable on this headless host')
    }
    const offer = (await handler(
      {},
      { address: '127.0.0.1', rotate: true, reach: 'this-computer' }
    )) as PairingIpcResult
    if (offer?.available !== true || typeof offer.pairingUrl !== 'string') {
      throw new Error('Headless host did not rotate a runtime pairing offer')
    }
    return {
      pairingUrl: offer.pairingUrl,
      ...(typeof offer.deviceId === 'string' ? { deviceId: offer.deviceId } : {}),
      ...(typeof offer.webClientUrl === 'string' ? { webClientUrl: offer.webClientUrl } : {})
    }
  })
}

function connectPairedObserver(pairingUrl: string): PairedObserverClient {
  const identity = readPairedClientIdentity(pairingUrl)
  const pairing = parsePairingCode(pairingUrl)
  if (!pairing) {
    throw new Error('Invalid pairing URL')
  }
  const connection = new RemoteRuntimeRequestConnection(pairing)
  return {
    role: 'paired-observer',
    identity,
    request: (method, params = {}, timeoutMs = 15_000) => {
      assertObserverReadOnlyMethod(method, params)
      return connection.request(method, params, timeoutMs)
    },
    close: () => connection.close()
  }
}

export async function connectTwoPairedRpcObservers(host: HeadlessPairedRuntimeHost): Promise<{
  clientA: PairedObserverClient
  clientB: PairedObserverClient
  coordinator: HostCoordinatorHandle
}> {
  assertRemoteValidationIsolation({
    display: process.env.DISPLAY,
    userDataDir: host.userDataDir
  })
  const offerA = await rotateHeadlessRuntimePairingOffer(host.app)
  const clientA = connectPairedObserver(offerA.pairingUrl)
  const status = await clientA.request<{ runtimeId?: string }>(RUNTIME_STATUS_METHOD, {}, 15_000)
  if (status.ok !== true) {
    clientA.close()
    throw new Error('Client A failed to authenticate against the isolated host')
  }
  const offerB = await rotateHeadlessRuntimePairingOffer(host.app)
  const clientB = connectPairedObserver(offerB.pairingUrl)
  try {
    assertDistinctPairedClientIdentities(clientA.identity, clientB.identity)
    const statusB = await clientB.request<{ runtimeId?: string }>(RUNTIME_STATUS_METHOD, {}, 15_000)
    if (statusB.ok !== true) {
      throw new Error('Client B failed to authenticate against the isolated host')
    }
  } catch (error) {
    clientB.close()
    clientA.close()
    throw error
  }
  return {
    coordinator: { role: 'host-coordinator', userDataDir: host.userDataDir },
    clientA,
    clientB
  }
}

export function reconnectPairedObserver(pairingUrl: string): PairedObserverClient {
  return connectPairedObserver(pairingUrl)
}

export function encodeWorkerDoneMarker(input: {
  coordinator: string
  dispatchId: string
  mismatch?: boolean
  taskId: string
}): string {
  return Buffer.from(JSON.stringify(input)).toString('base64')
}

export type FakeWorkerAskRequest = {
  options: string
  question: string
  timeoutMs: number
  to: string
}

/** Prompt pasted into the fake worker terminal: the agent turns it into a real
 * `orchestration ask` CLI call carrying its own dispatch capability. */
export function encodeWorkerAskMarker(request: FakeWorkerAskRequest): string {
  return Buffer.from(JSON.stringify(request)).toString('base64')
}

/** Folders are first-class workspaces; a fresh isolated userData has no repo,
 * so seed one before creating terminals. */
export async function seedHostFolderWorkspace(
  host: HeadlessPairedRuntimeHost,
  repoPath: string,
  options: { pollTimeoutMs?: number } = {}
): Promise<{ repoId: string; worktreeId: string }> {
  const added = await host.client.call<{ repo: { id: string } }>('repo.add', {
    path: repoPath,
    kind: 'folder'
  })
  const repoId = added.result.repo.id
  let worktreeId = ''
  const deadline = Date.now() + (options.pollTimeoutMs ?? 30_000)
  while (!worktreeId && Date.now() < deadline) {
    const listed = await host.client.call<{ worktrees: { id: string }[] }>('worktree.list', {
      repo: `id:${repoId}`
    })
    worktreeId = listed.result.worktrees[0]?.id ?? ''
    if (!worktreeId) {
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
  }
  if (!worktreeId) {
    throw new Error('Isolated host never listed the seeded folder workspace')
  }
  return { repoId, worktreeId }
}
