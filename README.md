# @toreador/mcp-server

Official [Model Context Protocol](https://modelcontextprotocol.io) server for
[Toreador](https://toreador.io). Lets Claude Desktop, Cursor, and any other
MCP-capable assistant generate crypto QR codes and manage payment sessions on
your behalf.

> ⚠️ Requires a **Pro plan API key** (`tdr_...`) from your Toreador
> [dashboard](https://toreador.io/dashboard#api). The MCP server runs locally
> and uses your key to call `https://toreador.io/api/v1/public`.

## Tools exposed

| Tool | What it does |
|---|---|
| `toreador_generate_qr` | Generate a QR code for native tokens (BTC, ETH, SOL, POL) or Solana SPL (USDC on Solana). Returns the on-chain payment URI and a base64 PNG data URI. |
| `toreador_create_session` | Create a hosted payment session for ERC-20 stablecoins (USDC, USDT, EURC) on Ethereum, Polygon or Base. Returns a session ID, security code and a hosted payment URL. |
| `toreador_get_payment_status` | Poll the status of an ERC-20 payment session: `pending` / `submitted` / `confirming` / `completed` / `expired` / `failed`. |
| `toreador_list_history` | List the 50 most recent QR code generations. |
| `toreador_list_sessions` | List the 50 most recent ERC-20 payment sessions. |

## Install in Claude Desktop

Edit Claude Desktop's config file:

- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%/Claude/claude_desktop_config.json`
- **Linux**: `~/.config/Claude/claude_desktop_config.json`

Add the `toreador` entry under `mcpServers`:

```json
{
  "mcpServers": {
    "toreador": {
      "command": "npx",
      "args": ["-y", "@toreador/mcp-server"],
      "env": {
        "TOREADOR_API_KEY": "tdr_your_key_here"
      }
    }
  }
}
```

Restart Claude Desktop. You should see the 5 Toreador tools in the tools menu.

## Install in Cursor

In Cursor settings → MCP → "Add new MCP server", paste:

```json
{
  "command": "npx",
  "args": ["-y", "@toreador/mcp-server"],
  "env": { "TOREADOR_API_KEY": "tdr_..." }
}
```

## Example prompts

Once installed, try these prompts in your MCP client:

- *"Generate a Bitcoin QR code for 0.001 BTC to bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh."*
- *"Create a USDC payment session for 50 USDC on Polygon to 0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18."*
- *"What's the status of session ses_123?"*
- *"Show me my last 10 payment sessions."*

The assistant will pick the right tool, call Toreador, and return the result —
including the QR code data URI which most clients can render inline.

## Configuration

| Environment variable | Default | Description |
|---|---|---|
| `TOREADOR_API_KEY` | **required** | Your Pro plan API key. Format: `tdr_...`. |
| `TOREADOR_BASE_URL` | `https://toreador.io/api/v1/public` | Override the API base URL (useful for testing). |
| `TOREADOR_TIMEOUT_MS` | `30000` | Per-request timeout in milliseconds. |

## Trust and safety

- **Local only.** The MCP server runs on your machine via stdio. Your API key
  never leaves your computer except in outbound HTTPS calls to `toreador.io`.
- **Non-custodial.** Toreador never holds funds. The MCP tools only generate
  QR codes and read session state — they cannot move money.
- **Read or create, no destruction.** Tools either generate new payment objects
  or read existing ones. There is no "delete" or "refund" tool.

## Build from source

```bash
git clone https://github.com/Bentonabento/toreador-sdk.git
cd toreador-sdk/mcp
npm install
npm run build
TOREADOR_API_KEY=tdr_... node dist/index.js
```

The server will boot, print `[toreador-mcp] ready (5 tools registered)` to
stderr, and wait for MCP requests on stdin.

## License

MIT
