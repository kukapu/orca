#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { isAbsolute } from 'node:path'
import { latestStableDesktopReleaseTag } from './latest-stable-release.mjs'
import {
  durableReleaseSource,
  forkTag,
  greatestTag,
  newerSource,
  preparation,
  stableTag,
  validReleaseAssets
} from './upstream-release-provenance.mjs'

const MAX_PAGES = 10
const INCOMPLETE_RELEASE_LISTING = new Error('Incomplete release listing')
const COMMAND_ERROR = new Error('Command failed')
const COMMAND_OPTIONS = {
  encoding: 'utf8',
  timeout: 10_000,
  maxBuffer: 8 * 1024 * 1024,
  shell: false,
  windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe']
}

function validOptions(options) {
  const validId = (id) => typeof id === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,199}$/.test(id)
  return (
    options &&
    validId(options.automationId) &&
    validId(options.repoId) &&
    stableTag(options.baselineTag) &&
    (options.orcaCli === undefined ||
      (typeof options.orcaCli === 'string' && isAbsolute(options.orcaCli)))
  )
}

function isDraft(release) {
  return release.draft === true || release.isDraft === true
}

function isPrerelease(release) {
  return release.prerelease === true || release.isPrerelease === true
}

async function commandJson(command, args, run, binary = false) {
  let output
  try {
    output = await run(
      command,
      args,
      binary ? { ...COMMAND_OPTIONS, encoding: null } : COMMAND_OPTIONS
    )
  } catch {
    throw COMMAND_ERROR
  }
  return binary ? output : JSON.parse(output)
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
        repo === 'kukapu/orca'
          ? 'map({id,tag_name,draft,prerelease,assets: [.assets[] | {id,name,state,size,digest}]})'
          : 'map({tag_name,draft,prerelease})'
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
          (row.id !== undefined && (!Number.isSafeInteger(row.id) || row.id <= 0)) ||
          !validReleaseAssets(row.assets) ||
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
      options.orcaCli ?? 'orca',
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
    const markers = []
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
      markers.push(marker)
    }
    const durable = await durableReleaseSource(fork, (id) =>
      commandJson(
        'gh',
        [
          'api',
          `repos/kukapu/orca/releases/assets/${id}`,
          '-H',
          'Accept: application/octet-stream'
        ],
        run,
        true
      )
    )
    if (durable) {
      markers.push(durable)
    }
    for (const marker of markers) {
      if (marker.state === 'preparing' || marker.state === 'blocked') {
        pending = true
      } else {
        const previous = sources.get(marker.sourceTag)
        if (
          previous &&
          (previous.sourceCommit.toLowerCase() !== marker.sourceCommit.toLowerCase() ||
            previous.upstreamOid.toLowerCase() !== marker.upstreamOid.toLowerCase() ||
            ['publicationCommit', 'sourceTree'].some(
              (field) =>
                previous[field] &&
                marker[field] &&
                previous[field].toLowerCase() !== marker[field].toLowerCase()
            ))
        ) {
          return { launch: false, reason: 'reconcile-legacy', upstreamTag }
        }
        sources.set(
          marker.sourceTag,
          previous?.publicationCommit ? { ...marker, ...previous } : { ...previous, ...marker }
        )
        if (
          !source ||
          newerSource(marker, source) ||
          (marker.sourceTag === source.sourceTag && marker.publicationCommit)
        ) {
          source = sources.get(marker.sourceTag)
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
      }
      if (isDraft(release) || !isPrerelease(release)) {
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
            ...(source.sourceTree ? { sourceTree: source.sourceTree } : {}),
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
