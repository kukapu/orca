#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { latestStableDesktopReleaseTag, parseDesktopStableTag } from './latest-stable-release.mjs'

const MAX_PAGES = 10
const INCOMPLETE_RELEASE_LISTING = new Error('Incomplete release listing')
const COMMAND_ERROR = new Error('Command failed')
const MARKER = 'orca-release-preparation:'
const STATES = new Set(['preparing', 'blocked', 'prepared', 'published'])
const COMMAND_OPTIONS = {
  encoding: 'utf8',
  timeout: 10_000,
  maxBuffer: 8 * 1024 * 1024,
  shell: false,
  windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe']
}

function stableTag(tag) {
  if (typeof tag !== 'string') {
    return false
  }
  const parsed = parseDesktopStableTag(tag)
  return parsed && [parsed.major, parsed.minor, parsed.patch].every(Number.isSafeInteger)
}

function validOptions(options) {
  const validId = (id) => typeof id === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,199}$/.test(id)
  return (
    options &&
    validId(options.automationId) &&
    validId(options.repoId) &&
    stableTag(options.baselineTag)
  )
}

function greatestTag(tags) {
  return latestStableDesktopReleaseTag(tags.map((tag_name) => ({ tag_name })))
}

function validOid(value) {
  return typeof value === 'string' && /^(?:[a-fA-F0-9]{40}|[a-fA-F0-9]{64})$/.test(value)
}

function forkTag(value) {
  const match =
    typeof value === 'string' && /^(v[0-9]+\.[0-9]+\.[0-9]+)-kukapu\.([1-9][0-9]*)$/.exec(value)
  return match && stableTag(match[1]) ? match : null
}

function newerSource(left, right) {
  if (left.upstreamTag !== right.upstreamTag) {
    return greatestTag([left.upstreamTag, right.upstreamTag]) === left.upstreamTag
  }
  return BigInt(forkTag(left.sourceTag)[2]) > BigInt(forkTag(right.sourceTag)[2])
}

function isDraft(release) {
  return release.draft === true || release.isDraft === true
}

function isPrerelease(release) {
  return release.prerelease === true || release.isPrerelease === true
}

async function commandJson(command, args, run) {
  let output
  try {
    output = await run(command, args, COMMAND_OPTIONS)
  } catch {
    throw COMMAND_ERROR
  }
  return JSON.parse(output)
}

async function releasePages(repo, run) {
  const releases = []
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const rows = await commandJson(
      'gh',
      [
        'api',
        `repos/${repo}/releases?per_page=100&page=${page}`,
        '--jq',
        'map({tag_name,draft,prerelease})'
      ],
      run
    )
    if (
      !Array.isArray(rows) ||
      rows.length > 100 ||
      rows.some(
        (row) =>
          !row ||
          typeof (row.tag_name ?? row.tagName) !== 'string' ||
          ['draft', 'isDraft', 'prerelease', 'isPrerelease'].some(
            (flag) => row[flag] !== undefined && typeof row[flag] !== 'boolean'
          )
      )
    ) {
      throw new Error('Invalid release listing')
    }
    releases.push(...rows)
    if (rows.length < 100) {
      return releases
    }
  }
  throw INCOMPLETE_RELEASE_LISTING
}

function preparation(comment) {
  if (typeof comment !== 'string' || !comment.startsWith(MARKER)) {
    return null
  }
  try {
    const value = JSON.parse(comment.split('\n', 1)[0].slice(MARKER.length))
    if (
      !value ||
      !stableTag(value.upstreamTag) ||
      !STATES.has(value.state) ||
      (value.upstreamOid !== undefined && !validOid(value.upstreamOid)) ||
      (value.sourceCommit !== undefined && !validOid(value.sourceCommit)) ||
      (value.publicationCommit !== undefined && !validOid(value.publicationCommit)) ||
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

// No reservation: agents mark, re-read, elect earliest createdAt then id; only that owner works.
export async function runUpstreamReleasePrecheck(options, run = execFileSync) {
  if (!validOptions(options)) {
    return { launch: false, reason: 'invalid-options', upstreamTag: '', error: true }
  }
  const { automationId, repoId, baselineTag } = options
  let upstreamTag = ''
  try {
    const official = await releasePages('stablyai/orca', run)
    upstreamTag = latestStableDesktopReleaseTag(official)
    if (upstreamTag && !stableTag(upstreamTag)) {
      throw new Error('Invalid stable tag')
    }
    const fork = await releasePages('kukapu/orca', run)
    const listing = await commandJson(
      'orca',
      ['worktree', 'list', '--repo', `id:${repoId}`, '--limit', '100', '--json'],
      run
    )
    const result = listing?.result
    if (
      listing?.ok !== true ||
      !Array.isArray(result?.worktrees) ||
      result.truncated !== false ||
      !Array.isArray(result.hostScope?.omittedHostIds) ||
      result.hostScope.omittedHostIds.length !== 0 ||
      !Number.isSafeInteger(result.totalCount) ||
      result.totalCount !== result.worktrees.length ||
      (result.total !== undefined && result.total !== result.worktrees.length) ||
      result.worktrees.some((worktree) => !worktree || typeof worktree !== 'object')
    ) {
      throw new Error('Incomplete worktree listing')
    }

    const tags = [baselineTag]
    const sources = new Map()
    let source
    let pending = false
    for (const worktree of result.worktrees) {
      if (worktree.automationProvenance?.automationId !== automationId) {
        continue
      }
      const marker = preparation(worktree.comment)
      if (!marker) {
        return { launch: false, reason: 'reconcile-legacy', upstreamTag }
      }
      if (marker.state === 'preparing' || marker.state === 'blocked') {
        pending = true
      } else {
        const previous = sources.get(marker.sourceTag)
        if (
          previous &&
          (previous.sourceCommit.toLowerCase() !== marker.sourceCommit.toLowerCase() ||
            previous.upstreamOid.toLowerCase() !== marker.upstreamOid.toLowerCase() ||
            (previous.publicationCommit &&
              marker.publicationCommit &&
              previous.publicationCommit.toLowerCase() !== marker.publicationCommit.toLowerCase()))
        ) {
          return { launch: false, reason: 'reconcile-legacy', upstreamTag }
        }
        sources.set(marker.sourceTag, previous?.publicationCommit ? previous : marker)
        if (
          !source ||
          newerSource(marker, source) ||
          (marker.sourceTag === source.sourceTag && marker.publicationCommit)
        ) {
          source = marker
        }
        tags.push(marker.upstreamTag)
      }
    }
    if (pending) {
      return { launch: false, reason: 'preparation-pending', upstreamTag }
    }

    let sameDraft = false
    let unknownLineage = false
    for (const release of fork) {
      const tag = release.tag_name ?? release.tagName
      const match = /^(v[0-9]+\.[0-9]+\.[0-9]+)-kukapu\.[0-9]+$/.exec(tag)
      if (!match) {
        continue
      }
      if (!stableTag(match[1])) {
        throw new Error('Invalid fork tag')
      }
      if (isDraft(release)) {
        if (match[1] === upstreamTag) {
          sameDraft = true
        }
      } else if (!isPrerelease(release)) {
        if (
          !sources.has(tag) &&
          (!source ||
            !forkTag(tag) ||
            newerSource({ upstreamTag: match[1], sourceTag: tag }, source))
        ) {
          unknownLineage = true
        }
      }
    }
    const highwaterTag = greatestTag(tags)
    const context = {
      upstreamTag,
      highwaterTag,
      ...(source
        ? {
            sourceUpstreamTag: source.upstreamTag,
            sourceUpstreamOid: source.upstreamOid,
            sourceTag: source.sourceTag,
            sourceCommit: source.sourceCommit,
            forkVersion: source.forkVersion,
            ...(source.publicationCommit ? { publicationCommit: source.publicationCommit } : {})
          }
        : {})
    }
    if (!upstreamTag) {
      return { launch: false, reason: 'no-stable-release', ...context }
    }
    if (sameDraft) {
      return { launch: false, reason: 'fork-draft-exists', ...context }
    }
    if (unknownLineage) {
      return { launch: false, reason: 'unknown-source-lineage', ...context }
    }
    if (greatestTag([upstreamTag, highwaterTag]) === highwaterTag) {
      return { launch: false, reason: 'already-covered', ...context }
    }
    if (!source || greatestTag([source.upstreamTag, baselineTag]) !== source.upstreamTag) {
      return { launch: false, reason: 'canonical-source-required', ...context }
    }
    return { launch: true, reason: 'new-stable-release', ...context }
  } catch (error) {
    // Command errors may contain credentials or remote stdout; never publish them.
    const reason =
      error === INCOMPLETE_RELEASE_LISTING
        ? 'incomplete-release-listing'
        : error === COMMAND_ERROR
          ? 'command-error'
          : 'unverifiable'
    return { launch: false, reason, upstreamTag, error: true }
  }
}

async function main(rawOptions) {
  let result
  try {
    result = await runUpstreamReleasePrecheck(JSON.parse(rawOptions))
  } catch {
    result = { launch: false, reason: 'invalid-options', upstreamTag: '', error: true }
  }
  process.stdout.write(`${JSON.stringify(result)}\n`)
  process.exitCode = result.error ? 2 : result.launch ? 0 : 1
}

if (process.env.ORCA_RELEASE_PRECHECK_OPTIONS !== undefined) {
  await main(process.env.ORCA_RELEASE_PRECHECK_OPTIONS)
}
