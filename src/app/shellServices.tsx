import { createContext, useContext, type ReactNode } from 'react'
import type { AuthGateway } from '../features/auth/gateway'
import type { ClientStateApi } from '../lib/clientState'

/**
 * Data access for shell-level features (Today, the command palette, the tour, the install
 * prompt) without threading props through every page. The router provides the same gateway
 * the pages already use.
 *
 * `clientState` is `gateway.clientState` (createClientStateApi in src/lib/clientState.ts). The
 * tour and install state keep a browser-storage copy only as a cache and for when the server
 * functions are not deployed yet (the api then resolves null).
 */
export type ShellServices = { gateway?: AuthGateway; clientState?: ClientStateApi }

const Services = createContext<ShellServices>({})

export function ShellServicesProvider({ gateway, children }: { gateway?: AuthGateway; children: ReactNode }) {
  return <Services.Provider value={{ gateway, clientState: gateway?.clientState }}>{children}</Services.Provider>
}

export function useShellServices(): ShellServices { return useContext(Services) }
