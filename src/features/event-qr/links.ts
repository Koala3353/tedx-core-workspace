import { appPath } from '../../lib/basePath'

/** Absolute link a phone camera opens. Respects the deployment base path. */
export const appLink = (path: string) => window.location.origin + appPath(path)
/** Deep link for an inventory item label: the Inventory page with that item's id. */
export const itemLink = (id: string) => appLink('/inventory?item=' + encodeURIComponent(id))
/** Crew door check-in link. */
export const checkInLink = (token: string) => appLink('/event/check-in/' + token)
