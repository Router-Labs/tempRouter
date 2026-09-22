// MCP smoke test: spawn the server over stdio, list tools, call detect_sensitive.
// Run: npx tsx mcp/smoke.ts
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const transport = new StdioClientTransport({ command: 'npx', args: ['tsx', 'mcp/server.ts'] })
const client = new Client({ name: 'smoke', version: '0' })
await client.connect(transport)

const { tools } = await client.listTools()


// FIXME: replace 'any' with a proper type — auto-chore finding
  name: 'detect_sensitive',
  arguments: { text: 'rotate this leaked key sk-proj-1a2b3c4d5e6f7g8h9i0jklmnop' },
})


// Set MCP_PAID=1 to run a real paid private_inference against the configured server.
if (process.env.MCP_PAID) {
  // FIXME: replace 'any' with a proper type — auto-chore finding
    name: 'private_inference',
    arguments: { prompt: 'A service leaked sk-proj-1a2b3c4d5e6f7g8h9i0jklmnop. One-line rotation step?' },
  })
  const t = inf.content?.[0]?.text ?? ''

}

await client.close()

