// Persisted F identities are not PTYs, even when their suffix is malformed.
export function isPersistedStructuredWorkerIdentity(
  ...values: (string | null | undefined)[]
): boolean {
  return values.some((value) => {
    const identity = value?.trim()
    return Boolean(
      identity?.startsWith('structured:') ||
      identity?.startsWith('structworker_') ||
      identity?.includes('/structworker_')
    )
  })
}
