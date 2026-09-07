export function workerTranscriptRecordWarnings(
  malformedRecordCount: number,
  oversizedRecordCount: number
): string[] {
  const warnings: string[] = []
  if (malformedRecordCount > 0) {
    warnings.push(`${malformedRecordCount} malformed transcript record(s) were skipped.`)
  }
  if (oversizedRecordCount > 0) {
    warnings.push(`${oversizedRecordCount} oversized transcript record(s) were skipped.`)
  }
  return warnings
}
