const ANCHOR_PREFIX = '--orca-tab-group-body-'

export function tabGroupBodyAnchorName(groupId: string): string {
  const encoded = Array.from(groupId, (char) => char.codePointAt(0)?.toString(16) ?? '').join('-')
  return `${ANCHOR_PREFIX}${encoded || 'empty'}`
}
