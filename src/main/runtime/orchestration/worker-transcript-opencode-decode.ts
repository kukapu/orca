import type { NativeChatBlock, NativeChatMessage } from '../../../shared/native-chat-types'
import { asRecord, extractString, timestampMs } from '../../ai-vault/session-scanner-values'
import { toolResultOutput } from '../../native-chat/transcript-record-blocks'

export function decodeOpenCodeWorkerMessage(args: {
  id: string
  role: unknown
  timestamp: unknown
  parts: unknown
}): NativeChatMessage | null {
  const role = extractString(args.role)
  if (role !== 'user' && role !== 'assistant') {
    return null
  }
  const blocks = decodeOpenCodeParts(args.parts)
  if (blocks.length === 0) {
    return null
  }
  const parsed = timestampMs(args.timestamp)
  return {
    id: args.id,
    role,
    blocks,
    timestamp: Number.isFinite(parsed) ? parsed : null,
    source: 'transcript'
  }
}

function decodeOpenCodeParts(value: unknown): NativeChatBlock[] {
  if (typeof value === 'string') {
    return value.trim() ? [{ type: 'text', text: value }] : []
  }
  if (!Array.isArray(value)) {
    return decodeOpenCodePart(asRecord(value))
  }
  const blocks: NativeChatBlock[] = []
  for (const item of value) {
    blocks.push(...decodeOpenCodePart(asRecord(item)))
  }
  return blocks
}

function decodeOpenCodePart(record: Record<string, unknown> | null): NativeChatBlock[] {
  if (!record) {
    return []
  }
  const type = extractString(record.type)
  if (type === 'text' || type === 'reasoning') {
    const text = extractString(record.text) ?? extractString(record.content)
    return text ? [{ type: 'text', text }] : []
  }
  if (type === 'tool') {
    return decodeOpenCodeToolPart(record)
  }
  if (type === 'file' || type === 'image' || type === 'image-ref') {
    const url = extractString(record.url)
    const path = extractString(record.path)
    const alt = extractString(record.alt) ?? extractString(record.filename)
    if (!url && !path) {
      return []
    }
    return [
      {
        type: 'image-ref',
        ...(url ? { url } : {}),
        ...(path ? { path } : {}),
        ...(alt ? { alt } : {})
      }
    ]
  }
  return []
}

function decodeOpenCodeToolPart(record: Record<string, unknown>): NativeChatBlock[] {
  const name = extractString(record.tool) ?? extractString(record.name) ?? 'tool'
  const state = asRecord(record.state)
  const input = state?.input ?? record.input ?? {}
  const blocks: NativeChatBlock[] = [{ type: 'tool-call', name, input }]
  if (!state) {
    return blocks
  }
  const status = extractString(state.status)
  const output = toolResultOutput(state.output ?? state.error)
  if (status === 'completed' || status === 'error' || output) {
    blocks.push({
      type: 'tool-result',
      output,
      ...(status === 'error' || state.error ? { isError: true } : {})
    })
  }
  return blocks
}
