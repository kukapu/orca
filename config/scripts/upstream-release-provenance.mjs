import { createHash } from 'node:crypto'
import { latestStableDesktopReleaseTag, parseDesktopStableTag } from './latest-stable-release.mjs'

const MARKER = 'orca-release-preparation:'
const STATES = new Set(['preparing', 'blocked', 'prepared', 'published'])
const MANIFEST = 'orca-release-provenance.json'
const MAX_MANIFEST_BYTES = 64 * 1024
const positiveInteger = (value) => Number.isSafeInteger(value) && value > 0
const sha256 = (value) => typeof value === 'string' && /^[a-fA-F0-9]{64}$/.test(value)
const digest = (value) => typeof value === 'string' && /^sha256:[a-fA-F0-9]{64}$/.test(value)
const safeName = (value) =>
  typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value) && !value.endsWith('.')

export function stableTag(tag) {
  if (typeof tag !== 'string') {
    return false
  }
  const parsed = parseDesktopStableTag(tag)
  return parsed && [parsed.major, parsed.minor, parsed.patch].every(Number.isSafeInteger)
}

export function greatestTag(tags) {
  return latestStableDesktopReleaseTag(tags.map((tag_name) => ({ tag_name })))
}

export function validOid(value) {
  return typeof value === 'string' && /^(?:[a-fA-F0-9]{40}|[a-fA-F0-9]{64})$/.test(value)
}

export function forkTag(value) {
  const match =
    typeof value === 'string' && /^(v[0-9]+\.[0-9]+\.[0-9]+)-kukapu\.([1-9][0-9]*)$/.exec(value)
  return match && stableTag(match[1]) ? match : null
}

export function newerSource(left, right) {
  if (left.upstreamTag !== right.upstreamTag) {
    return greatestTag([left.upstreamTag, right.upstreamTag]) === left.upstreamTag
  }
  return BigInt(forkTag(left.sourceTag)[2]) > BigInt(forkTag(right.sourceTag)[2])
}

export function preparation(comment) {
  if (typeof comment !== 'string' || !comment.startsWith(MARKER)) {
    return null
  }
  try {
    const value = JSON.parse(comment.split('\n', 1)[0].slice(MARKER.length))
    if (
      !value ||
      !stableTag(value.upstreamTag) ||
      !STATES.has(value.state) ||
      ['upstreamOid', 'sourceCommit', 'publicationCommit', 'sourceTree'].some(
        (field) => value[field] !== undefined && !validOid(value[field])
      ) ||
      (value.sourceTag !== undefined && forkTag(value.sourceTag)?.[1] !== value.upstreamTag) ||
      (value.forkVersion !== undefined && value.sourceTag !== `v${value.forkVersion}`) ||
      (value.reason !== undefined && typeof value.reason !== 'string')
    ) {
      return null
    }
    if (
      (value.state === 'prepared' || value.state === 'published') &&
      (!validOid(value.upstreamOid) ||
        !validOid(value.sourceCommit) ||
        !forkTag(value.sourceTag) ||
        typeof value.forkVersion !== 'string' ||
        value.sourceTag !== `v${value.forkVersion}` ||
        (value.state === 'published' && !validOid(value.publicationCommit)))
    ) {
      return null
    }
    return value
  } catch {
    return null
  }
}

export function validReleaseAssets(assets) {
  return (
    assets === undefined ||
    (Array.isArray(assets) &&
      assets.every(
        (asset) =>
          asset &&
          positiveInteger(asset.id) &&
          typeof asset.name === 'string' &&
          asset.name.length > 0 &&
          typeof asset.state === 'string' &&
          asset.state.length > 0 &&
          Number.isSafeInteger(asset.size) &&
          asset.size >= 0 &&
          (asset.digest == null || digest(asset.digest))
      ) &&
      new Set(assets.map((asset) => asset.name)).size === assets.length &&
      new Set(assets.map((asset) => asset.id)).size === assets.length)
  )
}

function manifestSource(payload, release) {
  const value = JSON.parse(payload.toString('utf8'))
  const source = preparation(`${MARKER}${JSON.stringify(value)}`)
  if (
    !source ||
    value.schemaVersion !== 1 ||
    value.repository !== 'kukapu/orca' ||
    value.upstreamRepository !== 'stablyai/orca' ||
    value.state !== 'published' ||
    value.sourceTag !== (release.tag_name ?? release.tagName) ||
    !validOid(value.sourceTree) ||
    !Array.isArray(value.artifacts) ||
    value.artifacts.length < 1 ||
    value.artifacts.length > 20
  ) {
    throw new Error('Invalid release provenance')
  }
  const names = new Set()
  for (const artifact of value.artifacts) {
    if (
      !artifact ||
      !safeName(artifact.name) ||
      artifact.name === MANIFEST ||
      names.has(artifact.name) ||
      !positiveInteger(artifact.size) ||
      !sha256(artifact.sha256)
    ) {
      throw new Error('Invalid provenance artifact')
    }
    names.add(artifact.name)
    const asset = release.assets.find((entry) => entry.name === artifact.name)
    if (
      !asset ||
      asset.state !== 'uploaded' ||
      asset.size !== artifact.size ||
      asset.digest?.toLowerCase() !== `sha256:${artifact.sha256.toLowerCase()}`
    ) {
      throw new Error('Unverified provenance artifact')
    }
  }
  return source
}

export async function durableReleaseSource(releases, readAsset) {
  let latest
  for (const release of releases) {
    const sourceTag = release.tag_name ?? release.tagName
    const match = forkTag(sourceTag)
    if (
      !match ||
      release.prerelease === true ||
      release.isPrerelease === true ||
      !release.assets?.some((asset) => asset.name === MANIFEST)
    ) {
      continue
    }
    const candidate = { upstreamTag: match[1], sourceTag, release }
    if (!latest || newerSource(candidate, latest)) {
      latest = candidate
    }
  }
  if (!latest) {
    return null
  }
  const asset = latest.release.assets.find((entry) => entry.name === MANIFEST)
  if (
    asset.state !== 'uploaded' ||
    !positiveInteger(asset.size) ||
    asset.size > MAX_MANIFEST_BYTES ||
    !digest(asset.digest)
  ) {
    throw new Error('Unverified provenance manifest')
  }
  // Hash the original bytes, never a decoded/re-serialized JSON representation.
  const payload = await readAsset(asset.id)
  if (
    !Buffer.isBuffer(payload) ||
    payload.length !== asset.size ||
    payload.length > MAX_MANIFEST_BYTES ||
    `sha256:${createHash('sha256').update(payload).digest('hex')}` !== asset.digest.toLowerCase()
  ) {
    throw new Error('Unverified provenance payload')
  }
  return manifestSource(payload, latest.release)
}
