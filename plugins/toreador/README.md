# Toreador plugin for Claude

Ask for a crypto payment, check whether it was paid, and show a direct QR code, from Claude.

The plugin installs the official [Toreador MCP server](https://toreador.io/mcp) and three skills
that guide Claude through the common cases:

| Skill | Use it to |
|---|---|
| `/toreador:request-payment` | Create a payment request in USD or EUR and get the link to give to your customer. |
| `/toreador:check-payment` | Know whether a request was paid, or list your recent payments. |
| `/toreador:direct-qr-code` | Show a direct QR code (not tracked), including as text in a terminal. |

You can also simply ask: *"Create a 49.90 USD payment request for order 1042"*, *"Has order 1042
been paid?"*.

Toreador is non-custodial software: a payment goes from your customer's wallet straight to yours.
The tools create and read payment requests; none of them can move funds, refund, or add or change
a wallet.

## Install (Claude Code)

```
/plugin marketplace add Logitale/toreador-mcp-server
/plugin install toreador@toreador
```

Claude Code asks for your Toreador API key (dashboard, API section) and stores it in your
system's credential store. To change it later: `/plugin configure toreador`.

A key starting with `tor_test_` works on test networks, outside your quota. Start with one.

## Where it works

The skills and the server load in Claude Code (terminal, IDE extensions, the Code tab of the
desktop app). The MCP server runs on your computer: surfaces that do not run local servers load
the skills without the tools.

## Requirements

Node.js 18 or later, and a Toreador account with at least one receiving wallet.

## License

MIT
