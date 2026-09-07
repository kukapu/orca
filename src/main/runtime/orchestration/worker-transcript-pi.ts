import { open, stat } from 'node:fs/promises'
import { extname } from 'node:path'
import { extractString, parseJsonObject } from '../../ai-vault/session-scanner-values'

const PI_SESSION_HEADER_SCAN_BYTES = 64 * 1024

export async function resolvePiWorkerTranscriptPath(
  transcriptPath?: string
): Promise<string | null> {
  const filePath = transcriptPath?.trim()
  if (!filePath || extname(filePath) !== '.jsonl') {
    return null
  }
  try {
    return (await stat(filePath)).isFile() ? filePath : null
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | null)?.code
    if (code === 'ENOENT') {
      return null
    }
    throw error
  }
}

export async function piWorkerTranscriptMatchesSession(
  filePath: string,
  sessionId: string
): Promise<boolean> {
  const wanted = sessionId.trim()
  if (!wanted) {
    return false
  }
  return (await readPiSessionHeaderId(filePath)) === wanted
}

async function readPiSessionHeaderId(filePath: string): Promise<string | null> {
  const handle = await open(filePath, 'r')
  try {
    const buffer = Buffer.allocUnsafe(PI_SESSION_HEADER_SCAN_BYTES)
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
    if (bytesRead <= 0) {
      return null
    }
    const text = buffer.subarray(0, bytesRead).toString('utf8')
    for (const line of text.split('\n')) {
      const trimmed = line.endsWith('\r') ? line.slice(0, -1) : line
      if (!trimmed) {
        continue
      }
      const record = parseJsonObject(trimmed)
      if (record?.type === 'session') {
        return extractString(record.id)
      }
    }
    return null
  } finally {
    await handle.close()
  }
}
