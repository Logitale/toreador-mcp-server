## Toreador MCP Server

Create crypto payment requests paid in stablecoins (USDC, USDT, EURC…) or native crypto, track them and read your account, directly from Claude Desktop, Cursor or any MCP client. Non-custodial: funds go straight to your wallet.

## Features

- **Checkouts in USD or EUR** — the payer picks the stablecoin and the network on a hosted page (wallet-to-wallet)
- **Payment tracking** — status, transaction hash and timeline by checkout id
- **Account and catalogue** — wallets, supported networks, quota and plan
- **Compliance** — sanctions screening of an address
- **Native QR codes** — Bitcoin, Ethereum, Solana, Polygon and more, without tracking
- **No custody** — the API key cannot move funds nor change wallets

## Installation

```json
{
  "mcpServers": {
    "toreador": {
      "command": "npx",
      "args": ["-y", "@toreador/mcp-server"],
      "env": { "TOREADOR_API_KEY": "tor_live_your_api_key_here" }
    }
  }
}
```

An API key is required: create one in your Toreador dashboard. A `tor_test_` key works on testnets.

## Tools

`toreador_create_checkout` · `toreador_get_payment` · `toreador_list_payments` · `toreador_list_wallets` · `toreador_list_establishments` · `toreador_list_tokens` · `toreador_get_account` · `toreador_generate_qr` · `toreador_create_session` · `toreador_screen_address`

## Links

- npm: [@toreador/mcp-server](https://www.npmjs.com/package/@toreador/mcp-server)
- GitHub: [Logitale/toreador-mcp-server](https://github.com/Logitale/toreador-mcp-server)
- MCP Registry: [io.toreador/mcp-server](https://registry.modelcontextprotocol.io/v0/servers?search=toreador)
- Documentation: [toreador.io/api-reference](https://toreador.io/api-reference)
- License: MIT
