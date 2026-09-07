import os from 'node:os'
import path from 'node:path'

export const PRODUCTION_RUNTIME_PORT = 6768
export const PRODUCTION_XVFB_DISPLAY = ':99'

function normalizePath(candidate: string): string {
  return path.resolve(candidate)
}

export function productionOrcaConfigDir(realHome = os.homedir()): string {
  return path.join(realHome, '.config', 'orca')
}

export function isProductionUserDataPath(userDataDir: string, realHome = os.homedir()): boolean {
  const resolved = normalizePath(userDataDir)
  return (
    resolved === normalizePath(productionOrcaConfigDir(realHome)) ||
    resolved === normalizePath(path.join(realHome, '.config', 'orca')) ||
    resolved.startsWith(`${normalizePath(productionOrcaConfigDir(realHome))}${path.sep}`)
  )
}

export function isProductionDisplay(display: string | undefined): boolean {
  return display === PRODUCTION_XVFB_DISPLAY
}

export function isProductionRuntimePort(port: number): boolean {
  return port === PRODUCTION_RUNTIME_PORT
}

export function assertRemoteValidationIsolation(input: {
  display?: string
  port?: number
  realHome?: string
  userDataDir: string
}): void {
  const realHome = input.realHome ?? os.homedir()
  if (isProductionUserDataPath(input.userDataDir, realHome)) {
    throw new Error('Refusing production Orca userData for remote validation')
  }
  if (input.port !== undefined && isProductionRuntimePort(input.port)) {
    throw new Error(`Refusing production runtime port ${PRODUCTION_RUNTIME_PORT}`)
  }
  if (isProductionDisplay(input.display)) {
    throw new Error(
      `Refusing production Xvfb ${PRODUCTION_XVFB_DISPLAY}; wrap with xvfb-run --auto-servernum at the build gate`
    )
  }
}

export function stripProductionDisplay(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const next = { ...env }
  if (isProductionDisplay(next.DISPLAY)) {
    delete next.DISPLAY
  }
  return next
}
