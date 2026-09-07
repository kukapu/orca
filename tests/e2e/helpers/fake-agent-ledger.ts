import { existsSync, readFileSync } from 'node:fs'

export type FakeAgentLedgerEntry = {
  askOutcome?: string
  kind: string
  mismatch?: boolean
  phase: 'ask' | 'worker_done' | 'hook_working' | 'hook_done'
  status?: number
  stderr?: string
  stdout?: string
}

export type FakeAgentLedgerRead = {
  entries: FakeAgentLedgerEntry[]
  /** Complete lines that failed to parse: never silently dropped. */
  corruptLines: string[]
}

/** Newline-delimited JSON reader for the fake-agent ledger. Tolerates ONLY a
 * trailing fragment still being appended; a complete malformed line is
 * surfaced, not hidden. */
export function readFakeAgentLedger(ledgerPath: string): FakeAgentLedgerRead {
  if (!existsSync(ledgerPath)) {
    return { entries: [], corruptLines: [] }
  }
  const contents = readFileSync(ledgerPath, 'utf8')
  if (contents === '') {
    return { entries: [], corruptLines: [] }
  }
  // Only the final segment may lack its delimiter mid-append; keep it out of
  // parsing entirely instead of parsing-and-swallowing.
  const lines = contents.split('\n')
  if (!contents.endsWith('\n')) {
    lines.pop()
  }
  const entries: FakeAgentLedgerEntry[] = []
  const corruptLines: string[] = []
  for (const line of lines) {
    if (line === '') {
      continue
    }
    try {
      entries.push(JSON.parse(line) as FakeAgentLedgerEntry)
    } catch {
      corruptLines.push(line)
    }
  }
  return { entries, corruptLines }
}

/** Fails loudly when any complete ledger line is malformed; the spec must not
 * proceed on evidence it cannot parse. */
export function expectCleanFakeAgentLedger(ledgerPath: string): FakeAgentLedgerEntry[] {
  const read = readFakeAgentLedger(ledgerPath)
  if (read.corruptLines.length > 0) {
    throw new Error(
      `Fake agent ledger has ${read.corruptLines.length} malformed complete line(s); first: ${read.corruptLines[0]?.slice(0, 200)}`
    )
  }
  return read.entries
}
