import { getSetting, MCP_CLIENT_KEY, setSetting } from '@clipstudio/core'
import { createMcpServer } from '@clipstudio/mcp'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'

/**
 * The MCP endpoint Claude connects to (Streamable HTTP, stateless: one server per request).
 * Its tools can read everything but only create proposals; the user decides in the Inbox.
 */
export default defineEventHandler(async (event) => {
  const core = useCore()
  const request = toWebRequest(event)

  // Remember which client is connected, for the Settings page. The client names itself on "initialize".
  let client = (getSetting(core.db, MCP_CLIENT_KEY) as { name?: string } | undefined)?.name ?? null
  if (request.method === 'POST') {
    try {
      const body = (await request.clone().json()) as { method?: string; params?: { clientInfo?: { name?: string; version?: string } } }
      if (body?.method === 'initialize' && body.params?.clientInfo?.name) client = body.params.clientInfo.name
    } catch {
      // Not JSON; the transport will answer with an error.
    }
    setSetting(core.db, MCP_CLIENT_KEY, { name: client, lastSeen: Date.now() })
  }

  const server = createMcpServer({ ...core, appUrl: appUrl(), client })
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
    enableDnsRebindingProtection: true,
    allowedHosts: allowedHosts(),
  })
  await server.connect(transport)
  event.node.res.on('close', () => {
    void transport.close()
    void server.close()
  })
  return transport.handleRequest(request)
})
