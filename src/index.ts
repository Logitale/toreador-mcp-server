#!/usr/bin/env node
// @toreador/mcp-server
// Model Context Protocol server for Toreador. Exposes the public API as MCP
// tools so Claude Desktop, ChatGPT (when MCP-enabled), Cursor and other MCP
// clients can drive Toreador on behalf of an authenticated user.
//
// Usage in Claude Desktop config (~/.config/claude/claude_desktop_config.json
// or %APPDATA%/Claude/claude_desktop_config.json):
//
//   {
//     "mcpServers": {
//       "toreador": {
//         "command": "npx",
//         "args": ["-y", "@toreador/mcp-server"],
//         "env": { "TOREADOR_API_KEY": "tdr_..." }
//       }
//     }
//   }

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";

// ---- Config ----

const TOREADOR_API_KEY = process.env.TOREADOR_API_KEY;
const TOREADOR_BASE_URL =
  process.env.TOREADOR_BASE_URL?.replace(/\/+$/, "") ||
  "https://toreador.io/api/v1/public";
const REQUEST_TIMEOUT_MS = Number(process.env.TOREADOR_TIMEOUT_MS || 30_000);

// API key is OPTIONAL — without one, the MCP server still exposes the free
// `toreador_generate_qr` tool for native chains (BTC, ETH, SOL, POL, USDC on
// Solana). With a Pro key (tdr_...), all 5 tools are exposed including
// ERC-20 sessions, payment status polling, and history.
const HAS_API_KEY = !!TOREADOR_API_KEY;

if (TOREADOR_API_KEY && !TOREADOR_API_KEY.startsWith("tdr_")) {
  process.stderr.write(
    "[toreador-mcp] FATAL: TOREADOR_API_KEY must start with \"tdr_\"\n",
  );
  process.exit(1);
}

// ---- Tool definitions ----
//
// Tool naming follows the convention `toreador_<verb>_<resource>` so they sort
// nicely and don't collide with other MCP servers a user may have installed.

// Free-tier tools: usable WITHOUT a Pro API key. The Toreador public API
// rate-limits anonymous calls to 50/hour, 200/day per IP.
const FREE_TIER_TOOLS: Tool[] = [
  {
    name: "toreador_generate_qr",
    description:
      "Generate a crypto QR code for a native token (BTC, ETH, SOL, POL) or a Solana SPL token (USDC on Solana). Returns the QR data URI (PNG base64) and the on-chain payment URI (BIP21, EIP-681, Solana Pay). FREE — no API key needed for these chains. For ERC-20 stablecoins on Ethereum/Polygon/Base (USDT, USDC, EURC), use toreador_create_session (Pro plan required).",
    inputSchema: {
      type: "object",
      properties: {
        token: {
          type: "string",
          description: "Token symbol. One of: BTC, ETH, SOL, POL, USDC (Solana only).",
        },
        chainId: {
          type: "string",
          description: "Chain identifier. One of: bitcoin, ethereum, polygon, base, solana.",
        },
        amount: {
          type: "string",
          description: "Amount as a decimal string in the token's natural unit (e.g. \"0.001\" for BTC, \"50\" for USDC). Use a string to preserve decimal precision.",
        },
        recipientAddress: {
          type: "string",
          description: "Destination wallet address. Must match the chain (bech32 for BTC, EIP-55 for EVM, base58 for Solana).",
        },
      },
      required: ["token", "chainId", "amount", "recipientAddress"],
      additionalProperties: false,
    },
  },
];

// Pro-tier tools: require a Pro API key (tdr_...) set via TOREADOR_API_KEY.
// These are exposed only when an API key is present in the environment.
const PRO_TIER_TOOLS: Tool[] = [
  {
    name: "toreador_create_session",
    description:
      "Create a hosted payment session for ERC-20 stablecoins on EVM chains (USDC, USDT, EURC on Ethereum, Polygon or Base). Returns a session ID, a 6-character security code to display to the payer, and a URL to a Toreador-hosted payment page where the payer connects their wallet. Sessions expire 15 minutes after creation. PRO PLAN REQUIRED. For native tokens or Solana SPL, use toreador_generate_qr instead.",
    inputSchema: {
      type: "object",
      properties: {
        token: {
          type: "string",
          description: "Stablecoin symbol. One of: USDC, USDT, EURC.",
        },
        chainId: {
          type: "string",
          description: "EVM chain. One of: ethereum, polygon, base.",
        },
        amount: {
          type: "string",
          description: "Amount in the token's natural unit (e.g. \"100\" for 100 USDC).",
        },
        recipientAddress: {
          type: "string",
          description: "Destination EVM wallet address (0x...).",
        },
      },
      required: ["token", "chainId", "amount", "recipientAddress"],
      additionalProperties: false,
    },
  },
  {
    name: "toreador_get_payment_status",
    description:
      "Get the current status of an ERC-20 payment session by ID. Status values: pending, submitted, confirming, completed, expired, failed. Includes on-chain confirmation count and tx hash once submitted.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: {
          type: "string",
          description: "Session ID returned by toreador_create_session.",
        },
      },
      required: ["sessionId"],
      additionalProperties: false,
    },
  },
  {
    name: "toreador_list_history",
    description:
      "List the 50 most recent QR code generations for the authenticated account. Returns a list of payment requests with token, chain, amount, recipient and timestamp.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "toreador_list_sessions",
    description:
      "List the 50 most recent ERC-20 payment sessions for the authenticated account. Includes status, tx hash, confirmations and timestamps.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
];

// ---- HTTP client (inlined to keep this package self-contained) ----

async function toreadorRequest(
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const url = `${TOREADOR_BASE_URL}${path}`;
  const headers: Record<string, string> = {
    "Accept": "application/json",
    "User-Agent": "toreador-mcp-server/0.2.0",
  };
  if (TOREADOR_API_KEY) headers["X-API-Key"] = TOREADOR_API_KEY;
  const init: RequestInit = { method, headers };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  init.signal = ctrl.signal;

  try {
    const res = await fetch(url, init);
    let data: unknown = null;
    try {
      data = await res.json();
    } catch {
      // non-JSON response — leave data as null
    }
    return { ok: res.ok, status: res.status, data };
  } finally {
    clearTimeout(timer);
  }
}

// ---- Tool dispatcher ----

interface ToolArgs {
  [key: string]: unknown;
}

async function callTool(name: string, args: ToolArgs): Promise<{
  ok: boolean;
  status: number;
  data: unknown;
}> {
  switch (name) {
    case "toreador_generate_qr":
      return toreadorRequest("POST", "/generate-qr", {
        token: args.token,
        chainId: args.chainId,
        amount: args.amount,
        recipientAddress: args.recipientAddress,
      });
    case "toreador_create_session":
      return toreadorRequest("POST", "/create-session", {
        token: args.token,
        chainId: args.chainId,
        amount: args.amount,
        recipientAddress: args.recipientAddress,
      });
    case "toreador_get_payment_status":
      return toreadorRequest(
        "GET",
        `/payment/${encodeURIComponent(String(args.sessionId))}/status`,
      );
    case "toreador_list_history":
      return toreadorRequest("GET", "/history");
    case "toreador_list_sessions":
      return toreadorRequest("GET", "/sessions");
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

function formatToolResult(name: string, result: { ok: boolean; status: number; data: unknown }) {
  if (result.ok) {
    // For generate_qr, the qrCodeURL data URI is large — keep the JSON intact
    // but tell the LLM there is a QR data URI it can show the user verbatim.
    if (name === "toreador_generate_qr" && result.data && typeof result.data === "object") {
      const d = result.data as { qrCodeURL?: string };
      const note = d.qrCodeURL
        ? "\n\nNote for the assistant: the qrCodeURL field contains a base64 PNG data URI that the user's client may render directly as an image."
        : "";
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result.data, null, 2) + note,
          },
        ],
      };
    }
    return {
      content: [
        { type: "text" as const, text: JSON.stringify(result.data, null, 2) },
      ],
    };
  }

  // Non-2xx: return as a tool error so the LLM sees and can react.
  const msg =
    (result.data && typeof result.data === "object" && "error" in result.data)
      ? String((result.data as { error?: string }).error)
      : `HTTP ${result.status}`;
  return {
    isError: true,
    content: [
      {
        type: "text" as const,
        text: `Toreador API error (status ${result.status}): ${msg}\n\nFull response:\n${JSON.stringify(result.data, null, 2)}`,
      },
    ],
  };
}

// ---- MCP server wiring ----

const server = new Server(
  { name: "@toreador/mcp-server", version: "0.2.0" },
  { capabilities: { tools: {} } },
);

// Compose the tool list based on whether a Pro key is available.
const ACTIVE_TOOLS: Tool[] = HAS_API_KEY
  ? [...FREE_TIER_TOOLS, ...PRO_TIER_TOOLS]
  : FREE_TIER_TOOLS;

const PRO_TOOL_NAMES = new Set(PRO_TIER_TOOLS.map((t) => t.name));

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: ACTIVE_TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const name = request.params.name;
  const args = (request.params.arguments || {}) as ToolArgs;

  // Guard: Pro-only tool but no API key configured. Tell the LLM how to fix.
  if (PRO_TOOL_NAMES.has(name) && !HAS_API_KEY) {
    return {
      isError: true,
      content: [{
        type: "text" as const,
        text: `Tool ${name} requires a Toreador Pro plan API key. Set the TOREADOR_API_KEY environment variable in your MCP client config (format: tdr_...). Get a key at https://toreador.io/dashboard#api (Pro plan required: https://toreador.io/go-pro). The free tools (toreador_generate_qr) remain available for native tokens (BTC, ETH, SOL, POL, USDC on Solana) without a key.`,
      }],
    };
  }

  try {
    const result = await callTool(name, args);
    return formatToolResult(name, result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      isError: true,
      content: [
        {
          type: "text" as const,
          text: `Tool ${name} failed: ${message}`,
        },
      ],
    };
  }
});

// ---- Boot ----

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stderr-only banner (stdout is for the protocol)
  const tier = HAS_API_KEY ? "pro" : "free";
  process.stderr.write(
    `[toreador-mcp] ready · tier=${tier} · ${ACTIVE_TOOLS.length} tools registered (${ACTIVE_TOOLS.map(t => t.name).join(", ")})\n`,
  );
  if (!HAS_API_KEY) {
    process.stderr.write(
      "[toreador-mcp] no TOREADOR_API_KEY set — free tier active. Native tokens (BTC, ETH, SOL, POL, USDC on Solana) only. Set TOREADOR_API_KEY (tdr_...) to unlock ERC-20 sessions, payment status, history.\n",
    );
  }
}

main().catch((err) => {
  process.stderr.write(
    `[toreador-mcp] fatal: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(1);
});
