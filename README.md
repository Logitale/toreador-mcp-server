# @toreador/mcp-server

Official [Model Context Protocol](https://modelcontextprotocol.io) server for
[Toreador](https://toreador.io). Lets Claude Desktop, Cursor and any MCP-capable
assistant create crypto payment requests, track them and read your account on your behalf.

[![toreador-mcp-server MCP server](https://glama.ai/mcp/servers/Logitale/toreador-mcp-server/badges/card.svg)](https://glama.ai/mcp/servers/Logitale/toreador-mcp-server)

Non-custodial: every payment goes straight to a wallet registered on your Toreador account.
The tools can create and read payment objects; none of them can move funds or change wallets.

> Requires a Toreador API key (`tor_live_…` or `tor_test_…`) from your dashboard, API section.
> A test key works on testnets, outside your quota, with the exact same tools. Each key only sees the payments
> of its own environment: a live key never returns test payments, a test key returns only test payments.

## Tools

| Tool | What it does |
|---|---|
| `toreador_create_checkout` | Create a payment request for an invoice in USD or EUR. Returns the hosted payment page URL; the payer picks the stablecoin and network, and funds go straight to your wallet. The main tool. |
| `toreador_get_payment` | Status, token, chain, amount, transaction hash and timeline of a payment, by checkout id or session id. |
| `toreador_list_payments` | Recent payment sessions of the whole team, with reference-rate provenance, checkout id, reference and establishment. Paginated; can be limited to one establishment. |
| `toreador_list_wallets` | Receiving wallets registered on the account. The recipient of any payment must be one of them. |
| `toreador_list_establishments` | Establishments (points of sale) of the organization. An id limits `toreador_list_payments` to one of them, or attaches a new checkout to it. |
| `toreador_list_tokens` | Payable (token, chain) pairs for the key's environment, chain names and explorer links. |
| `toreador_get_account` | Plan, environment, subscription, monthly quota and limits. |
| `toreador_generate_qr` | Untracked QR code for a native token (BTC, ETH, SOL, POL…) or USDC on Solana. |
| `toreador_create_session` | Advanced: a payment session for an exact stablecoin amount on a given EVM chain. |
| `toreador_screen_address` | Sanctions screening (OFAC, EU, UN) of an address. |

## Install in Claude Desktop

Edit Claude Desktop's config file:

- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%/Claude/claude_desktop_config.json`
- **Linux**: `~/.config/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "toreador": {
      "command": "npx",
      "args": ["-y", "@toreador/mcp-server"],
      "env": {
        "TOREADOR_API_KEY": "tor_live_your_key_here"
      }
    }
  }
}
```

Restart Claude Desktop: the ten Toreador tools appear in the tools menu.

## Install in Claude Code (plugin)

The plugin installs this server and three guided skills (request a payment, check a payment,
show a direct QR code). Claude Code asks for your API key and keeps it in your system's
credential store.

```
/plugin marketplace add Logitale/toreador-mcp-server
/plugin install toreador@toreador
```

Details in [plugins/toreador](plugins/toreador/README.md).

## Install in Cursor

Cursor settings → MCP → "Add new MCP server":

```json
{
  "command": "npx",
  "args": ["-y", "@toreador/mcp-server"],
  "env": { "TOREADOR_API_KEY": "tor_live_..." }
}
```

## Example prompts

- *"Create a 49.90 USD crypto checkout for order 1042 to my main wallet and give me the payment link."*
- *"Has checkout co_… been paid?"*
- *"Which stablecoins and networks can my customers pay with?"*
- *"How much of my monthly quota is left?"*
- *"Show me this week's payments of the Lyon shop."*
- *"Is this address sanctioned: 0x…?"*

## Configuration

| Environment variable | Default | Description |
|---|---|---|
| `TOREADOR_API_KEY` | **required** | `tor_live_…` or `tor_test_…`. |
| `TOREADOR_BASE_URL` | `https://toreador.io/api/v1/public` | API base URL override (testing). |
| `TOREADOR_TIMEOUT_MS` | `30000` | Per-request timeout in milliseconds. |

## Trust and safety

- **Local only.** The server runs on your machine over stdio. Your API key only leaves it in
  outbound HTTPS calls to `toreador.io`.
- **Non-custodial.** Toreador never holds funds, and the API key cannot move money nor change
  your wallets: a payment can only target a wallet already registered on your account.
- **No destructive tool.** Tools create payment objects or read them. Nothing deletes, refunds
  or transfers.
- **Errors are explained.** Quota reached (402), rate limit (429), revoked key (401) and
  configuration problems come back with the cause and the action to take.

## Build from source

```bash
git clone https://github.com/Logitale/toreador-mcp-server.git
cd toreador-mcp-server
npm install
npm run build
TOREADOR_API_KEY=tor_test_... node dist/index.js
```

The server prints `[toreador-mcp] ready · env=test · 10 tools (…)` to stderr and waits for MCP
requests on stdin.

## License

MIT
