import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { AuthGateway } from '../features/auth/gateway'
import type { ClientStateApi } from '../lib/clientState'

/**
 * Data access for shell-level features (Today, the command palette, the tour, the install
 * prompt, the setup wizard) without threading props through every page. The router provides
 * the same gateway the pages already use.
 *
 * `clientState` is `gateway.clientState` (createClientStateApi in src/lib/clientState.ts). The
 * tour, setup and install state keep a browser-storage copy only as a cache and for when the
 * server functions are not deployed yet (the api then resolves null).
 */
export type ShellServices = { gateway?: AuthGateway; clientState?: ClientStateApi }

const Services = createContext<ShellServices>({})

export function ShellServicesProvider({ gateway, children }: { gateway?: AuthGateway; children: ReactNode }) {
  return <Services.Provider value={{ gateway, clientState: gateway?.clientState }}>{children}</Services.Provider>
}

export function useShellServices(): ShellServices { return useContext(Services) }

/*
 * Theme. public/theme.js applies the same choice before first paint from the same storage key:
 * a stored 'dark' or 'light', otherwise the system preference. "Match my device" is stored as no
 * key at all, so theme.js needs no change. The avatar menu toggle and the setup wizard both go
 * through setThemeChoice so they stay in sync.
 */
export type ThemeChoice = 'dark' | 'light' | 'system'
const themeKey = 'tedx-workspace-theme'
const themeEvent = 'workspace-theme-changed'

function systemTheme(): 'dark' | 'light' {
  try { return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark' } catch { return 'dark' }
}

export function readThemeChoice(): ThemeChoice {
  try {
    const stored = window.localStorage.getItem(themeKey)
    if (stored === 'light' || stored === 'dark') return stored
  } catch { /* Storage optional. */ }
  return 'system'
}

function applyTheme(theme: 'dark' | 'light') {
  document.documentElement.dataset.theme = theme
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#111111' : '#ffffff')
}

export function setThemeChoice(choice: ThemeChoice): void {
  try {
    if (choice === 'system') window.localStorage.removeItem(themeKey)
    else window.localStorage.setItem(themeKey, choice)
  } catch { /* Storage optional: the choice still applies to this page. */ }
  applyTheme(choice === 'system' ? systemTheme() : choice)
  window.dispatchEvent(new CustomEvent(themeEvent, { detail: choice }))
}

function currentTheme(): 'dark' | 'light' {
  const applied = document.documentElement.dataset.theme
  if (applied === 'light' || applied === 'dark') return applied
  const choice = readThemeChoice()
  return choice === 'system' ? systemTheme() : choice
}

/** The active theme and choice. Follows the device while the choice is "Match my device". */
export function useTheme() {
  const [state, setState] = useState(() => ({ choice: readThemeChoice(), theme: currentTheme() }))
  useEffect(() => {
    const sync = (event: Event) => {
      const choice = event instanceof CustomEvent && (event.detail === 'dark' || event.detail === 'light' || event.detail === 'system') ? event.detail as ThemeChoice : readThemeChoice()
      setState({ choice, theme: choice === 'system' ? systemTheme() : choice })
    }
    let media: MediaQueryList | null = null
    try { media = window.matchMedia('(prefers-color-scheme: light)') } catch { /* Old browsers. */ }
    const device = () => { if (readThemeChoice() === 'system') { applyTheme(systemTheme()); setState({ choice: 'system', theme: systemTheme() }) } }
    window.addEventListener(themeEvent, sync)
    media?.addEventListener?.('change', device)
    return () => { window.removeEventListener(themeEvent, sync); media?.removeEventListener?.('change', device) }
  }, [])
  return { ...state, setChoice: setThemeChoice }
}
