import { getSetting, MCP_CLIENT_KEY } from '@clipstudio/core'

/** Which MCP client last talked to the app, and when. */
export default defineEventHandler(() => {
  const value = getSetting<{ name: string | null; lastSeen: number }>(useCore().db, MCP_CLIENT_KEY)
  return { client: value?.name ?? null, lastSeen: value?.lastSeen ?? null, url: `${appUrl()}/mcp` }
})
