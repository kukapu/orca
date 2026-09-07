import type { Page } from '@stablyai/playwright-test'
import { expect } from './orca-app'

/** Pin a paired web client's per-device UI language to English.
 *
 * uiLanguage is not runtime-backed: settings.get from the host never copies it,
 * and a fresh partition starts at 'system' (OS locale). updateSettings can lose
 * the Zustand publish if fetchSettings is still in flight (publication fence),
 * and updateSettings swallows persist errors — so hydrate, then throw on write.
 */
export async function pinClientUiEnglish(page: Page): Promise<void> {
  await page.waitForFunction(() => Boolean(window.__store), undefined, { timeout: 30_000 })
  await page.evaluate(async () => {
    const store = window.__store
    if (!store) {
      throw new Error('window.__store unavailable on paired web client')
    }
    if (!store.getState().settings) {
      await store.getState().fetchSettings()
    }
    await store.getState().updateSettingsOrThrow({ uiLanguage: 'en' })
    if (store.getState().settings?.uiLanguage !== 'en') {
      await store.getState().fetchSettings()
    }
  })
  await expect
    .poll(
      () =>
        page.evaluate(() => ({
          store: window.__store?.getState().settings?.uiLanguage ?? null,
          local: window.api.settings.getSync()?.uiLanguage ?? null
        })),
      { timeout: 15_000 }
    )
    .toEqual({ store: 'en', local: 'en' })
}
