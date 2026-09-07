import { openSidebarProjectDialog } from './helpers/sidebar-project-dialog'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ElectronApplication, Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { worktreeRow, worktreeRowSurface } from './worktree-row-locators'
import { parsePairingCode } from '../../src/shared/pairing'
import { RemoteRuntimeRequestConnection } from '../../src/shared/remote-runtime-request-connection'
import type { DetectedWorktreeListResult } from '../../src/shared/worktree/types'

type RuntimePairingOffer = {
  deviceId: string
  webClientUrl: string
}

type TestWorktreeIds = {
  host: string
  clientA: string
  clientB: string
  clientA2: string
}

const isPairedBrowserRun = process.env.ORCA_E2E_WEB_CLIENT === '1'

test.skip(
  !isPairedBrowserRun,
  'Run with pnpm test:e2e:multi-client-navigation so the paired web client is built'
)

function addGitWorktree(repoPath: string, branchName: string): void {
  const worktreePath = path.join(path.dirname(repoPath), `e2e-test-${branchName}`)
  execFileSync('git', ['worktree', 'add', '-b', branchName, worktreePath], {
    cwd: repoPath,
    stdio: 'pipe'
  })
}

async function loadTestWorktreeIds(
  hostPage: Page,
  branchA: string,
  branchB: string
): Promise<TestWorktreeIds | null> {
  return hostPage.evaluate(
    async ({ branchA, branchB }) => {
      const store = window.__store
      if (!store) {
        return null
      }
      const repo = store.getState().repos[0]
      if (!repo) {
        return null
      }
      await store.getState().fetchWorktrees(repo.id)
      const worktrees = store.getState().worktreesByRepo[repo.id] ?? []
      const host = worktrees.find((worktree) => worktree.branch === 'refs/heads/e2e-secondary')
      const clientA = worktrees.find((worktree) => worktree.branch === `refs/heads/${branchA}`)
      const clientB = worktrees.find((worktree) => worktree.branch === `refs/heads/${branchB}`)
      const clientA2 = worktrees.find((worktree) => worktree.isMainWorktree)
      if (!host || !clientA || !clientB || !clientA2) {
        return null
      }
      return {
        host: host.id,
        clientA: clientA.id,
        clientB: clientB.id,
        clientA2: clientA2.id
      }
    },
    { branchA, branchB }
  )
}

async function createPairingOffer(hostPage: Page): Promise<RuntimePairingOffer> {
  return hostPage.evaluate(async () => {
    const offer = await window.api.mobile.getRuntimePairingUrl({
      address: '127.0.0.1',
      rotate: true
    })
    if (!offer.available || !offer.webClientUrl) {
      const reason = offer.available ? 'web client URL is missing' : 'runtime server is unavailable'
      throw new Error(`Runtime web client pairing failed: ${reason}`)
    }
    return { deviceId: offer.deviceId, webClientUrl: offer.webClientUrl }
  })
}

async function pinClientUiEnglish(page: Page): Promise<void> {
  // Why uiLanguage is a per-device web-client preference (never runtime-backed),
  // so a fresh partition resolves 'system' — the host OS locale — and every English
  // role-name assertion below goes red on non-English machines.
  await page.evaluate(async () => {
    await window.__store?.getState().updateSettings({ uiLanguage: 'en' })
  })
  await expect
    .poll(() => page.evaluate(() => window.__store?.getState().settings?.uiLanguage ?? null))
    .toBe('en')
}

// Why: webClientUrl keeps the runtime pairing offer in its hash fragment (out of
// proxy logs), and the RPC probe needs that offer as a PairingOffer object.
function pairingOfferFromWebClientUrl(webClientUrl: string) {
  const pairingUrl = new URLSearchParams(new URL(webClientUrl).hash.replace(/^#/, '')).get(
    'pairing'
  )
  const pairing = pairingUrl ? parsePairingCode(pairingUrl) : null
  if (!pairing) {
    throw new Error('Paired RPC probe could not parse the runtime pairing offer')
  }
  return pairing
}

/**
 * Proves the paired-client precondition on the plane clients actually consume:
 * a paired RPC connection calling `worktree.detectedList` for the same repo id
 * must see the expected branches before any client window opens. The host's IPC
 * lane converges by pull and proves nothing about the runtime catalog the web
 * clients read; without this gate the 90s DOM poll races the runtime scan cache
 * instead of testing independent navigation.
 */
async function waitForRuntimeDetectedWorktrees(
  hostPage: Page,
  expectedBranches: string[],
  timeoutMs = 45_000
): Promise<void> {
  const repoId = await hostPage.evaluate(() => window.__store?.getState().repos[0]?.id ?? null)
  if (!repoId) {
    throw new Error('Paired RPC probe could not resolve the host repo id')
  }
  const probeOffer = await createPairingOffer(hostPage)
  const connection = new RemoteRuntimeRequestConnection(
    pairingOfferFromWebClientUrl(probeOffer.webClientUrl)
  )
  const deadline = Date.now() + timeoutMs
  const rpcErrorCodes: string[] = []
  let lastBranches: string[] = []
  let lastSawMain = false
  try {
    while (Date.now() < deadline) {
      const response = await connection.request<DetectedWorktreeListResult>(
        'worktree.detectedList',
        { repo: repoId },
        15_000
      )
      if (response.ok) {
        if (response.result.repoId !== repoId) {
          throw new Error(
            `worktree.detectedList answered for repo ${response.result.repoId}, expected ${repoId}`
          )
        }
        lastBranches = response.result.worktrees.map((worktree) => worktree.branch)
        lastSawMain = response.result.worktrees.some((worktree) => worktree.isMainWorktree)
        const missing = expectedBranches.filter((branch) => !lastBranches.includes(branch))
        if (missing.length === 0 && lastSawMain) {
          return
        }
      } else {
        rpcErrorCodes.push(response.error.code)
      }
      await new Promise((resolve) => setTimeout(resolve, 1_000))
    }
    const rpcErrorSummary = [...new Set(rpcErrorCodes)]
    throw new Error(
      `Paired RPC catalog did not converge in ${timeoutMs}ms (repo ${repoId}): expected branches ${JSON.stringify(expectedBranches)}, last saw ${JSON.stringify(lastBranches)} (main worktree: ${lastSawMain}), rpc error codes ${JSON.stringify(rpcErrorSummary)}`
    )
  } finally {
    connection.close()
  }
}

async function openPairedClient(
  electronApp: ElectronApplication,
  offer: RuntimePairingOffer,
  visibleWorktreeId: string
): Promise<Page> {
  const pagePromise = electronApp.waitForEvent('window')
  await electronApp.evaluate(
    async ({ BrowserWindow }, { partition, url }) => {
      const clientWindow = new BrowserWindow({
        height: 1200,
        show: false,
        width: 1440,
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          partition,
          sandbox: true
        }
      })
      await clientWindow.loadURL(url)
    },
    {
      partition: `e2e-paired-client-${randomUUID()}`,
      url: offer.webClientUrl
    }
  )
  const page = await pagePromise
  await expect(page.locator('[data-worktree-sidebar]')).toBeVisible({ timeout: 30_000 })
  await pinClientUiEnglish(page)
  // Why the poll: the runtime's worktree catalog is eventually consistent with
  // on-disk git state (scan-cache TTL), and on slower machines the freshly paired
  // client's first catalog snapshot can lag past a flat 30s visibility timeout.
  await expect
    .poll(
      async () => {
        const row = worktreeRow(page, visibleWorktreeId)
        return (await row.count()) > 0 && (await row.isVisible())
      },
      { timeout: 90_000, message: 'Expected paired client catalog to catch up to disk worktrees' }
    )
    .toBe(true)
  return page
}

async function selectWorktree(page: Page, worktreeId: string): Promise<void> {
  await worktreeRowSurface(page, worktreeId).click()
  await expectActiveWorktree(page, worktreeId)
}

async function expectActiveWorktree(page: Page, worktreeId: string): Promise<void> {
  await expect(page.locator('[data-rendered-active-worktree-id]')).toHaveAttribute(
    'data-rendered-active-worktree-id',
    worktreeId
  )
}

test('keeps two paired browser clients and the host on independent worktrees', async ({
  orcaPage,
  electronApp,
  testRepoPath
}) => {
  const suffix = randomUUID().slice(0, 8)
  const branchA = `e2e-client-a-${suffix}`
  const branchB = `e2e-client-b-${suffix}`
  addGitWorktree(testRepoPath, branchA)
  addGitWorktree(testRepoPath, branchB)

  await expect
    .poll(() => loadTestWorktreeIds(orcaPage, branchA, branchB), {
      timeout: 30_000,
      message: 'Expected host plus three client-selectable worktrees'
    })
    .not.toBeNull()

  // Playwright's matcher does not narrow the polled value for TypeScript.
  const ids = await loadTestWorktreeIds(orcaPage, branchA, branchB)
  if (!ids) {
    throw new Error('Test worktrees disappeared after discovery')
  }

  await selectWorktree(orcaPage, ids.host)

  // Why: clients consume the runtime RPC catalog, not the host IPC lane, so their
  // setup must be proven on that plane before any client window opens.
  await waitForRuntimeDetectedWorktrees(orcaPage, [
    'refs/heads/e2e-secondary',
    `refs/heads/${branchA}`,
    `refs/heads/${branchB}`
  ])

  let clientA: Page | null = null
  let clientB: Page | null = null
  try {
    const offerA = await createPairingOffer(orcaPage)
    clientA = await openPairedClient(electronApp, offerA, ids.clientA)
    await selectWorktree(clientA, ids.clientA)

    // Why: rotation preserves used grants, so B is issued only after A has completed pairing.
    const offerB = await createPairingOffer(orcaPage)
    expect(offerB.deviceId).not.toBe(offerA.deviceId)
    clientB = await openPairedClient(electronApp, offerB, ids.clientB)
    await selectWorktree(clientB, ids.clientB)

    await expectActiveWorktree(clientA, ids.clientA)
    await expectActiveWorktree(orcaPage, ids.host)

    await selectWorktree(clientA, ids.clientA2)

    await expectActiveWorktree(clientB, ids.clientB)
    await expectActiveWorktree(orcaPage, ids.host)
  } finally {
    await clientB?.close()
    await clientA?.close()
  }
})

test('keeps a paired client workspace create-with-agent off the other client and the host', async ({
  orcaPage,
  electronApp,
  testRepoPath
}) => {
  const suffix = randomUUID().slice(0, 8)
  const branchA = `e2e-create-a-${suffix}`
  const branchB = `e2e-create-b-${suffix}`
  addGitWorktree(testRepoPath, branchA)
  addGitWorktree(testRepoPath, branchB)

  await expect
    .poll(() => loadTestWorktreeIds(orcaPage, branchA, branchB), {
      timeout: 30_000,
      message: 'Expected host plus client-selectable worktrees'
    })
    .not.toBeNull()
  const ids = await loadTestWorktreeIds(orcaPage, branchA, branchB)
  if (!ids) {
    throw new Error('Test worktrees disappeared after discovery')
  }

  await selectWorktree(orcaPage, ids.host)

  // Why: same paired-client precondition as the navigation test — the runtime RPC
  // catalog must already show the disk-created branches before clients pair.
  await waitForRuntimeDetectedWorktrees(orcaPage, [
    'refs/heads/e2e-secondary',
    `refs/heads/${branchA}`,
    `refs/heads/${branchB}`
  ])

  let clientA: Page | null = null
  let clientB: Page | null = null
  try {
    const offerA = await createPairingOffer(orcaPage)
    clientA = await openPairedClient(electronApp, offerA, ids.clientA)
    await selectWorktree(clientA, ids.clientA)

    const offerB = await createPairingOffer(orcaPage)
    clientB = await openPairedClient(electronApp, offerB, ids.clientB)
    await selectWorktree(clientB, ids.clientB)

    // Client A creates a workspace with a startup command, which is the only remote
    // create shape the renderer sends `activate: true` for (STA-2802's field trigger).
    const createdWorktreeId = await clientA.evaluate(async (name) => {
      const store = window.__store
      if (!store) {
        throw new Error('paired client store unavailable')
      }
      const state = store.getState()
      const repoId = state
        .allWorktrees()
        .find((worktree) => worktree.id === state.activeWorktreeId)?.repoId
      if (!repoId) {
        throw new Error('active worktree has no repo')
      }
      const result = await state.createWorktree(
        repoId,
        name,
        undefined,
        'skip',
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        { command: 'echo sta-2802-startup' }
      )
      return result.worktree.id
    }, `e2e-created-${suffix}`)

    // Shared catalog state must still reach the observer...
    await expect(worktreeRow(clientB, createdWorktreeId)).toBeVisible({ timeout: 30_000 })
    // ...while its view stays exactly where its own user left it.
    await expectActiveWorktree(clientB, ids.clientB)
    await expectActiveWorktree(orcaPage, ids.host)

    // The creator can still reach and open what it made, and doing so still moves nobody
    // else. This drives the store action directly, so the composer's automatic
    // self-navigation on create is covered by worktree-creation-flow.test.ts and by the
    // host-side composer journey in worktree.spec.ts, not here.
    await selectWorktree(clientA, createdWorktreeId)
    await expectActiveWorktree(clientB, ids.clientB)
    await expectActiveWorktree(orcaPage, ids.host)

    // The observer keeps its own navigation authority afterwards.
    await selectWorktree(clientB, ids.clientA2)
    await expectActiveWorktree(clientA, createdWorktreeId)
    await expectActiveWorktree(orcaPage, ids.host)
  } finally {
    await clientB?.close()
    await clientA?.close()
  }
})

test('shows only provider-backed creation actions in paired web', async ({
  electronApp,
  orcaPage
}, testInfo) => {
  const visibleWorktreeId = await orcaPage.evaluate(
    () => window.__store?.getState().activeWorktreeId
  )
  if (!visibleWorktreeId) {
    throw new Error('Host worktree was not active before paired web validation')
  }

  const offer = await createPairingOffer(orcaPage)
  const client = await openPairedClient(electronApp, offer, visibleWorktreeId)
  try {
    await selectWorktree(client, visibleWorktreeId)
    await expect
      .poll(() =>
        client.evaluate(() => {
          const state = window.__store?.getState()
          const worktree = state
            ?.allWorktrees()
            .find((candidate) => candidate.id === state.activeWorktreeId)
          const environmentId = worktree?.runtimeOwnerEnvironmentId
          return environmentId
            ? state.runtimeStatusByEnvironmentId
                .get(environmentId)
                ?.status.capabilities?.includes('browser.screencast.v1') === true
            : false
        })
      )
      .toBe(true)

    await client.getByRole('button', { name: 'New tab' }).first().click()
    await expect(client.getByRole('menuitem', { name: /New Terminal/i })).toBeVisible()
    await expect(client.getByRole('menuitem', { name: /New Browser Tab/i })).toBeVisible()
    await expect(client.getByRole('menuitem', { name: /New Markdown/i })).toBeVisible()
    await expect(client.getByRole('menuitem', { name: /Mobile Emulator/i })).toHaveCount(0)

    const screenshotPath = testInfo.outputPath('paired-web-provider-backed-create-menu.png')
    await client.screenshot({ path: screenshotPath })
    await testInfo.attach('paired-web-provider-backed-create-menu', {
      path: screenshotPath,
      contentType: 'image/png'
    })
  } finally {
    await client.close()
  }
})

test('routes Add Project folder browsing through the paired host', async ({
  electronApp,
  orcaPage,
  registerPostElectronShutdownCleanup
}) => {
  const hostFolder = mkdtempSync(path.join(os.tmpdir(), 'orca-paired-web-folder-'))
  const folderName = path.basename(hostFolder)
  registerPostElectronShutdownCleanup(async () => {
    rmSync(hostFolder, { recursive: true, force: true })
  })
  const visibleWorktreeId = await orcaPage.evaluate(
    () => window.__store?.getState().activeWorktreeId
  )
  if (!visibleWorktreeId) {
    throw new Error('Host worktree was not active before paired web validation')
  }

  const offer = await createPairingOffer(orcaPage)
  const client = await openPairedClient(electronApp, offer, visibleWorktreeId)
  try {
    await openSidebarProjectDialog(client)
    const addDialog = client.getByRole('dialog', { name: /Add a project/i })
    await expect(addDialog).toBeVisible()
    await expect(addDialog).not.toContainText('Local Mac')

    await addDialog.getByRole('button', { name: /Browse folder/i }).click()
    const browser = client.getByRole('dialog', { name: /Browse host filesystem/i })
    await expect(browser).toBeVisible()
    await expect(browser.getByRole('button', { name: /Select folder/i })).toBeVisible()
    await browser.getByRole('button', { name: /^Cancel$/i }).click()

    const manualPathDialog = client.getByRole('dialog', { name: /Open host project/i })
    await manualPathDialog.locator('#server-project-path').fill(hostFolder)
    await manualPathDialog.getByRole('button', { name: /Open as Folder/i }).click()
    await expect(manualPathDialog).toBeHidden({ timeout: 30_000 })
    await expect(
      client.locator('[data-worktree-sidebar]').getByText(folderName, { exact: true }).first()
    ).toBeVisible({ timeout: 30_000 })
  } finally {
    await client.close()
  }
})
