import { chmodSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import {
  buildFakeAgentCommandOverride,
  FAKE_AGENT_WINDOWS_SHELL
} from './fake-agent-command-override'
import { FAKE_AGENT_PASTE_END_SCANNER_SOURCE } from './fake-agent-paste-end-scanner'

export const FAKE_ORCHESTRATION_AGENT_MARKER = 'FAKE_ORCHESTRATION_AGENT'
export const FAKE_OPENCODE_KIND = 'opencode'
export const FAKE_PI_KIND = 'pi'
export const FAKE_AGENT_ASK_MARKER_PREFIX = 'ORCA_E2E_WORKER_ASK:'
/** Reported through the REAL hook endpoint (like the provider plugins), so
 * observed options and prompt verification exercise the production path. It is
 * hook evidence, deliberately distinct from any launch selection. */
export const FAKE_HOOK_OBSERVED_MODEL = 'fake/glm-5.3-hook-evidence'
export const FAKE_HOOK_OBSERVED_THINKING = 'high'

/**
 * Single source for the `orchestration ask` argv the fake worker builds from a
 * pasted marker. Kept as a source string so the generated agent script and the
 * unit tests execute the exact same code.
 */
export const FAKE_AGENT_ASK_ARGS_SOURCE = `function buildFakeAgentAskArgs(request, env, capability) {
  if (!env.ORCA_TERMINAL_HANDLE) {
    throw new Error('fake worker ask requires ORCA_TERMINAL_HANDLE')
  }
  const args = [
    'orchestration', 'ask',
    '--from', env.ORCA_TERMINAL_HANDLE
  ]
  if (capability) {
    args.push('--dispatch-capability', capability)
  }
  args.push('--to', request.to, '--question', request.question, '--json')
  if (request.options) {
    args.push('--options', request.options)
  }
  if (request.timeoutMs > 0) {
    args.push('--timeout-ms', String(request.timeoutMs))
  }
  return args
}`

/**
 * Classify `orca orchestration ask --json` stdout. Upstream prints the shared
 * `{ok, result}` envelope (not a bare `{answer, timedOut, messageId}` object).
 */
export const FAKE_AGENT_ASK_OUTCOME_SOURCE = `function classifyFakeAgentAskStdout(stdout) {
  const parsed = JSON.parse(stdout)
  const inner = parsed && typeof parsed === 'object' ? parsed.result : undefined
  const payload =
    inner && typeof inner === 'object' && !Object.prototype.hasOwnProperty.call(parsed, 'answer')
      ? inner
      : parsed
  if (payload.answer !== null && payload.answer !== undefined) {
    return 'ASK_ANSWER_RECEIVED:' + payload.answer
  }
  if (payload.timedOut) {
    return 'ASK_TIMED_OUT:' + payload.threadId
  }
  return 'ASK_CANCELLED:' + String(payload.messageId)
}`

/** Hook events per agent kind, mirroring what the real plugins post. */
export function fakeAgentHookEvents(kind: FakeOpencodePiAgentKind): {
  working: Record<string, string>
  done: Record<string, string>
} {
  if (kind === FAKE_PI_KIND) {
    return {
      working: {
        hook_event_name: 'agent_start',
        model: FAKE_HOOK_OBSERVED_MODEL,
        thinking_level: FAKE_HOOK_OBSERVED_THINKING
      },
      done: { hook_event_name: 'agent_end' }
    }
  }
  return {
    working: {
      hook_event_name: 'MessagePart',
      role: 'assistant',
      model: FAKE_HOOK_OBSERVED_MODEL
    },
    done: { hook_event_name: 'SessionIdle' }
  }
}

export type FakeOpencodePiAgentKind = typeof FAKE_OPENCODE_KIND | typeof FAKE_PI_KIND

export type FakeOpencodePiOrchestrationAgents = {
  directory: string
  overrides: { opencode: string; pi: string }
  paths: { opencode: string; pi: string }
}

const FAKE_AGENT_SOURCE = `#!/usr/bin/env node
const { appendFileSync } = require('node:fs')
const { spawnSync } = require('node:child_process')
const kind = process.env.FAKE_ORCHESTRATION_AGENT_KIND || 'unknown'
const marker = ${JSON.stringify(FAKE_ORCHESTRATION_AGENT_MARKER)}
const askMarkerPrefix = ${JSON.stringify(FAKE_AGENT_ASK_MARKER_PREFIX)}
const hookEvents = ${JSON.stringify({
  opencode: fakeAgentHookEvents(FAKE_OPENCODE_KIND),
  pi: fakeAgentHookEvents(FAKE_PI_KIND)
})}
if (process.argv.slice(2).includes('app-server')) {
  process.stderr.write("error: unrecognized subcommand 'app-server'\\n")
  process.exit(2)
}
if (kind === 'opencode') {
  process.stdout.write('\\x1b[?2004h\\x1b[?25h')
}
process.stdout.write('\\u001b]0;' + kind + ' Ready\\u0007' + marker + ' kind=' + kind + '\\n')
let capability = null
let acknowledged = false
${FAKE_AGENT_PASTE_END_SCANNER_SOURCE}
${FAKE_AGENT_ASK_ARGS_SOURCE}
${FAKE_AGENT_ASK_OUTCOME_SOURCE}
function postHookEvent(eventName, extra) {
  const port = process.env.ORCA_AGENT_HOOK_PORT
  const token = process.env.ORCA_AGENT_HOOK_TOKEN
  if (!port || !token || !process.env.ORCA_PANE_KEY) {
    return Promise.resolve('hook-env-missing')
  }
  const body = {
    paneKey: process.env.ORCA_PANE_KEY,
    tabId: process.env.ORCA_TAB_ID,
    worktreeId: process.env.ORCA_WORKTREE_ID,
    env: process.env.ORCA_AGENT_HOOK_ENV || 'production',
    ...(process.env.ORCA_AGENT_LAUNCH_TOKEN
      ? { launchToken: process.env.ORCA_AGENT_LAUNCH_TOKEN }
      : {}),
    payload: Object.assign({ hook_event_name: eventName }, extra)
  }
  return fetch('http://127.0.0.1:' + port + '/hook/' + kind, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Orca-Agent-Hook-Token': token
    },
    body: JSON.stringify(body)
  })
    .then((response) => 'hook-' + response.status)
    .catch(() => 'hook-post-failed')
}
function runOrchestrationCli(args) {
  const cliEntry = process.env.ORCA_E2E_CLI_ENTRY
  if (!cliEntry) {
    return { status: 127, stdout: '', stderr: 'ORCA_E2E_CLI_ENTRY missing' }
  }
  const result = spawnSync(process.execPath, [cliEntry, ...args], {
    env: process.env,
    encoding: 'utf8'
  })
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? (result.error ? String(result.error) : '')
  }
}
function appendLedger(entry) {
  const ledger = process.env.ORCA_E2E_FAKE_AGENT_LEDGER
  if (!ledger) return
  appendFileSync(ledger, JSON.stringify({ kind, ...entry }) + '\\n')
}
process.stdin.on('data', (chunk) => {
  const input = chunk.toString()
  const pasteEndScan = scanFakeAgentPasteEnd(fakeAgentPasteEndTail, input)
  fakeAgentPasteEndTail = pasteEndScan.tail
  if (pasteEndScan.pasteEndOffset !== null) {
    process.stdout.write('\\x1b[?25h')
  }
  capability ||= input.match(/--dispatch-capability (dcap_[A-Za-z0-9_-]+)/)?.[1] || null
  if (!acknowledged) {
    fakeAgentMaybeAck(pasteEndScan, input, (mode) => {
      acknowledged = true
      const message = mode === 'bracketed' ? 'ACK' : 'PASTE_PROTOCOL_ERROR'
      process.stdout.write('\\u001b]0;' + kind + ' Working\\u0007' + message + '\\n')
      setTimeout(() => process.stdout.write('\\u001b]0;' + kind + ' Ready\\u0007'), 10)
      // Real plugins report the busy turn through the hook server; that is the
      // delivery evidence headless serve needs (no renderer titles exist).
      const events = hookEvents[kind] || hookEvents.opencode
      postHookEvent(events.working.hook_event_name, events.working).then((outcome) => {
        appendLedger({ phase: 'hook_working', outcome })
      })
    })
  }
  const askIndex = input.indexOf(askMarkerPrefix)
  if (askIndex !== -1) {
    const encoded = input.slice(askIndex + askMarkerPrefix.length).match(/([A-Za-z0-9+/=]+)/)?.[1]
    if (encoded && capability) {
      const request = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'))
      const args = buildFakeAgentAskArgs(request, process.env, capability)
      const result = runOrchestrationCli(args)
      let askOutcome = 'ASK_FAILED:' + String(result.status)
      try {
        askOutcome = classifyFakeAgentAskStdout(result.stdout)
      } catch {
        askOutcome = 'ASK_FAILED:' + String(result.status)
      }
      process.stdout.write(marker + ' ' + askOutcome + '\\n')
      appendLedger({ phase: 'ask', askOutcome, status: result.status, stdout: result.stdout, stderr: result.stderr })
      return
    }
    if (encoded) {
      process.stdout.write(marker + ' ASK_NO_CAPABILITY\\n')
      appendLedger({ phase: 'ask', askOutcome: 'ASK_NO_CAPABILITY' })
    }
  }
  const encoded = input.match(/ORCA_E2E_WORKER_DONE:([A-Za-z0-9+/=]+)/)?.[1]
  if (!encoded || !capability) return
  const request = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'))
  const args = [
    'orchestration', 'send',
    '--from', request.mismatch ? 'term_foreign' : process.env.ORCA_TERMINAL_HANDLE,
    '--dispatch-capability', capability,
    '--to', request.coordinator,
    '--type', 'worker_done',
    '--subject', request.mismatch ? 'wrong sender' : 'completed',
    '--body', marker + ' ' + kind + ' simulated completion',
    '--task-id', request.taskId,
    '--dispatch-id', request.dispatchId,
    '--outcome', 'succeeded',
    '--json'
  ]
  const result = runOrchestrationCli(args)
  appendLedger({
    phase: 'worker_done',
    mismatch: request.mismatch,
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr
  })
  const doneEvents = hookEvents[kind] || hookEvents.opencode
  postHookEvent(doneEvents.done.hook_event_name, doneEvents.done).then((outcome) => {
    appendLedger({ phase: 'hook_done', outcome })
  })
})
process.stdin.setRawMode?.(true)
process.stdin.resume()
setInterval(() => {}, 60_000)
`

function writeExecutableWrapper(directory: string, kind: FakeOpencodePiAgentKind): string {
  const scriptName = 'fake-orchestration-agent.cjs'
  const scriptPath = path.join(directory, scriptName)
  writeFileSync(scriptPath, FAKE_AGENT_SOURCE)
  if (process.platform === 'win32') {
    const commandPath = path.join(directory, `${kind}.cmd`)
    writeFileSync(
      commandPath,
      `@echo off\r\nset FAKE_ORCHESTRATION_AGENT_KIND=${kind}\r\nnode "%~dp0\\${scriptName}" %*\r\n`
    )
    return commandPath
  }
  const commandPath = path.join(directory, kind)
  writeFileSync(
    commandPath,
    `#!/bin/sh\nFAKE_ORCHESTRATION_AGENT_KIND=${kind} exec "${process.execPath}" "${scriptPath}" "$@"\n`
  )
  chmodSync(commandPath, 0o755)
  return commandPath
}

export function writeFakeOpencodePiOrchestrationAgents(
  directory: string
): FakeOpencodePiOrchestrationAgents {
  mkdirSync(directory, { recursive: true })
  const opencode = writeExecutableWrapper(directory, FAKE_OPENCODE_KIND)
  const pi = writeExecutableWrapper(directory, FAKE_PI_KIND)
  return {
    directory,
    paths: { opencode, pi },
    overrides: {
      opencode: buildFakeAgentCommandOverride(opencode, process.platform, FAKE_AGENT_WINDOWS_SHELL),
      pi: buildFakeAgentCommandOverride(pi, process.platform, FAKE_AGENT_WINDOWS_SHELL)
    }
  }
}

export function isFakeOrchestrationAgentSource(source: string): boolean {
  return source.includes(FAKE_ORCHESTRATION_AGENT_MARKER)
}
