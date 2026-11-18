#!/usr/bin/env node
// @toreador/mcp-server
// Model Context Protocol server for Toreador. Exposes the public API as MCP
// tools so Claude Desktop, Cursor and other MCP clients can create and track
// crypto payment requests on behalf of the merchant who owns the API key.
//
// Claude Desktop config (~/Library/Application Support/Claude/claude_desktop_config.json
// on macOS, %APPDATA%/Claude/claude_desktop_config.json on Windows):
//
//   {
//     "mcpServers": {
//       "toreador": {
//         "command": "npx",
//         "args": ["-y", "@toreador/mcp-server"],
//         "env": { "TOREADOR_API_KEY": "tor_live_..." }
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

const VERSION = "0.3.1";

// ---- Config ----

const TOREADOR_API_KEY = process.env.TOREADOR_API_KEY || "";
const TOREADOR_BASE_URL =
  process.env.TOREADOR_BASE_URL?.replace(/\/+$/, "") ||
  "https://toreador.io/api/v1/public";
const REQUEST_TIMEOUT_MS = Number(process.env.TOREADOR_TIMEOUT_MS || 30_000);

// The API key is required: every route of the public API is authenticated.
// A test key (tor_test_) creates sandbox payment requests on testnets, outside the quota.
if (!TOREADOR_API_KEY) {
  process.stderr.write(
    "[toreador-mcp] FATAL: TOREADOR_API_KEY is required (tor_live_... or tor_test_...). Create one in your Toreador dashboard, API section.\n",
  );
  process.exit(1);
}
if (!/^tor_(live|test)_/.test(TOREADOR_API_KEY)) {
  process.stderr.write(
    "[toreador-mcp] FATAL: TOREADOR_API_KEY must start with \"tor_live_\" or \"tor_test_\"\n",
  );
  process.exit(1);
}
const ENV = TOREADOR_API_KEY.startsWith("tor_test_") ? "test" : "live";

// ---- Tool definitions ----
//
// Names follow `toreador_<verb>_<resource>` so they sort together and never
// collide with other MCP servers. Descriptions are written for the model.

const ADDRESS_PROPERTY = {
  type: "string",
  description:
    "Receiving address. It MUST be one of the wallets registered on the merchant's Toreador account: call toreador_list_wallets first and pick one. Any other address is rejected (address_not_registered).",
};

const TOOLS: Tool[] = [
  {
    name: "toreador_create_checkout",
    description:
      "Create a crypto payment request (checkout) for an invoice in USD or EUR. Returns a hosted payment page URL to give to the payer, who picks a stablecoin (USDC, USDT, EURC…) and a network there; funds go straight to the merchant's wallet (non-custodial). Use toreador_get_payment to track it. This is the main tool for selling something.",
    inputSchema: {
      type: "object",
      properties: {
        amount: { type: "number", description: "Invoice amount in the currency (e.g. 49.9).", exclusiveMinimum: 0, maximum: 1000000 },
        currency: { type: "string", enum: ["USD", "EUR"], description: "Invoice currency." },
        recipientAddress: ADDRESS_PROPERTY,
        reference: { type: "string", description: "The merchant's own identifier for this payment (order id, invoice number), max 255 characters. Echoed in webhooks and payment objects.", maxLength: 255 },
        description: { type: "string", description: "Short description shown on the payment page (max 500 characters).", maxLength: 500 },
        establishmentId: { type: "string", description: "Optional: the establishment (point of sale) this payment request belongs to, an id from toreador_list_establishments. Default: the default establishment of the key." },
        conversion: { type: "boolean", description: "Also offer stablecoins of the other currency (e.g. a USD invoice paid in EURC). The amount is computed from an indicative reference rate fixed when the payer picks the rail; Toreador performs no conversion and the payer sends the stablecoin directly to the merchant's wallet. Default false." },
        acceptNative: { type: "boolean", description: "Also offer native crypto (ETH, POL…); amount computed from an indicative market rate; the merchant then bears the volatility. Default false." },
        rails: {
          type: "array",
          description: "Optional: restrict the offered (token, chain) pairs, e.g. [{\"token\":\"USDC\",\"chain\":\"base\"}]. Get valid pairs from toreador_list_tokens.",
          items: { type: "object", properties: { token: { type: "string" }, chain: { type: "string" } }, required: ["token", "chain"], additionalProperties: false },
          maxItems: 50,
        },
      },
      required: ["amount", "currency", "recipientAddress"],
      additionalProperties: false,
    },
  },
  {
    name: "toreador_get_payment",
    description:
      "Get a payment by checkout id (co_…) or session id: status (open, pending, submitted, confirming, completed, expired, failed), token, chain, amount, transaction hash and timeline. Use it to know whether a checkout has been paid.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Checkout id (co_…) or session id, as returned by toreador_create_checkout or toreador_create_session.", pattern: "^(co_)?[A-Za-z0-9_-]{8,64}$" },
      },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "toreador_list_payments",
    description:
      "List recent payment sessions (newest first) with status, token, chain, amount, transaction hash, reference-rate provenance (indicative rate, source, timestamp), checkout id, reference and establishment (establishmentId, establishmentName). Covers the payments created by the whole team. Paginated with a cursor; can be limited to one establishment.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "integer", minimum: 1, maximum: 100, description: "Page size (default 20)." },
        cursor: { type: "string", description: "next_cursor from the previous page." },
        establishmentId: { type: "string", description: "Optional: only the payments of this establishment, an id from toreador_list_establishments." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "toreador_list_wallets",
    description:
      "List the receiving wallets registered on the merchant's account (address, label, family evm/solana/bitcoin, custodial or self-custodial, accepted rails). Call it before creating a checkout, QR code or session: the recipientAddress must be one of these.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "toreador_list_establishments",
    description:
      "List the establishments (points of sale) of the merchant's organization: id, name, default or not. Use an id to limit toreador_list_payments to one establishment, or to attach a new checkout to it. Read-only.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "toreador_list_tokens",
    description:
      "List the payable (token, chain) pairs for this key's environment, with chain names, explorer link templates and stablecoin pegs. Use it to build a valid `rails` restriction or to answer which cryptos and networks are supported.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "toreador_get_account",
    description:
      "Account status of the key: plan, environment (live or test), subscription (trial or active), monthly quota (used, limit, remaining) and limits. Use it to explain a 402 (quota reached) or before a bulk operation.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "toreador_generate_qr",
    description:
      "Generate a payment QR code for a native token (BTC, ETH, SOL, POL…) or a Solana SPL token (USDC on Solana): returns the on-chain payment URI (BIP-21, EIP-681, Solana Pay) and the QR image as a base64 PNG data URI (or SVG). No tracking: for a tracked payment use toreador_create_checkout.",
    inputSchema: {
      type: "object",
      properties: {
        token: { type: "string", description: "Token symbol, e.g. BTC, ETH, SOL, POL, USDC (Solana)." },
        chainId: { type: "string", description: "Chain identifier, e.g. bitcoin, ethereum, base, polygon, arbitrum, bnb, avalanche, solana (see toreador_list_tokens)." },
        amount: { type: "string", description: "Amount in the token's natural unit as a decimal string (e.g. \"0.001\")." },
        recipientAddress: ADDRESS_PROPERTY,
        format: { type: "string", enum: ["png", "svg", "text"], description: "QR output format, default png. Use \"text\" when the user works in a terminal or any text-only interface: the QR code comes back as block characters (qrCodeText) to show in a code block." },
        textBackground: { type: "string", enum: ["dark", "light"], description: "Only for format \"text\": the background of the user's terminal, default dark. A wrong background gives an inverted QR code that many phones cannot read." },
      },
      required: ["token", "chainId", "amount", "recipientAddress"],
      additionalProperties: false,
    },
  },
  {
    name: "toreador_create_session",
    description:
      "Advanced: create a payment session denominated in a specific stablecoin on a specific EVM chain (e.g. exactly 100 USDC on Base) with a hosted payment page. Funds go straight from the payer's wallet to recipientAddress (non-custodial). Prefer toreador_create_checkout, which lets the payer choose.",
    inputSchema: {
      type: "object",
      properties: {
        token: { type: "string", description: "Stablecoin symbol, e.g. USDC, USDT, EURC." },
        chainId: { type: "string", description: "EVM chain identifier (see toreador_list_tokens)." },
        amount: { type: "string", description: "Amount in the token's natural unit as a decimal string." },
        recipientAddress: ADDRESS_PROPERTY,
      },
      required: ["token", "chainId", "amount", "recipientAddress"],
      additionalProperties: false,
    },
  },
  {
    name: "toreador_screen_address",
    description:
      "Sanctions screening (OFAC, EU, UN) of a crypto address: clear, sanctioned or unknown. Use it before accepting a payer's address when the merchant asks for a compliance check.",
    inputSchema: {
      type: "object",
      properties: { address: { type: "string", description: "The address to screen." } },
      required: ["address"],
      additionalProperties: false,
    },
  },
];

// ---- HTTP client (inlined to keep this package dependency-free beyond the MCP SDK) ----

interface ApiResult {
  ok: boolean;
  status: number;
  data: unknown;
}

async function toreadorRequest(method: "GET" | "POST", path: string, body?: unknown): Promise<ApiResult> {
  const url = `${TOREADOR_BASE_URL}${path}`;
  const headers: Record<string, string> = {
    "Accept": "application/json",
    "User-Agent": `toreador-mcp-server/${VERSION}`,
    "X-API-Key": TOREADOR_API_KEY,
  };
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

function queryString(params: Record<string, unknown>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : "";
}

// ---- Tool dispatcher ----

type ToolArgs = Record<string, unknown>;

function str(args: ToolArgs, key: string): string {
  return typeof args[key] === "string" ? (args[key] as string).trim() : "";
}

async function callTool(name: string, args: ToolArgs): Promise<ApiResult> {
  switch (name) {
    case "toreador_create_checkout":
      return toreadorRequest("POST", "/checkout", {
        amount: args.amount,
        currency: args.currency,
        recipientAddress: str(args, "recipientAddress"),
        reference: args.reference,
        description: args.description,
        establishment_id: str(args, "establishmentId") || undefined,
        conversion: args.conversion === true,
        acceptNative: args.acceptNative === true,
        rails: Array.isArray(args.rails) ? args.rails : undefined,
        source: "mcp",
      });
    case "toreador_get_payment": {
      const id = str(args, "id");
      if (!/^(co_)?[A-Za-z0-9_-]{8,64}$/.test(id)) {
        throw new Error("Invalid id (expected a checkout id co_… or a session id)");
      }
      return toreadorRequest("GET", `/payment/${encodeURIComponent(id)}`);
    }
    case "toreador_list_payments":
      return toreadorRequest("GET", `/sessions${queryString({ limit: args.limit, cursor: args.cursor, establishment_id: str(args, "establishmentId") })}`);
    case "toreador_list_wallets":
      return toreadorRequest("GET", "/wallets");
    case "toreador_list_establishments":
      return toreadorRequest("GET", "/establishments");
    case "toreador_list_tokens":
      return toreadorRequest("GET", "/tokens");
    case "toreador_get_account":
      return toreadorRequest("GET", "/account");
    case "toreador_generate_qr":
      return toreadorRequest("POST", "/generate-qr", {
        token: str(args, "token"),
        chainId: str(args, "chainId"),
        amount: str(args, "amount"),
        recipientAddress: str(args, "recipientAddress"),
        format: args.format === "svg" || args.format === "text" ? args.format : "png",
        ...(args.format === "text" && (args.textBackground === "dark" || args.textBackground === "light") ? { textBackground: args.textBackground } : {}),
      });
    case "toreador_create_session":
      return toreadorRequest("POST", "/create-session", {
        token: str(args, "token"),
        chainId: str(args, "chainId"),
        amount: str(args, "amount"),
        recipientAddress: str(args, "recipientAddress"),
      });
    case "toreador_screen_address": {
      const address = str(args, "address");
      if (!address) throw new Error("address is required");
      return toreadorRequest("GET", `/screen${queryString({ address })}`);
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// Error bodies carry `error` (message) and `error_details` (code, type, request_id, doc_url,
// plus used/limit/upgrade_url on a 402). Surface them so the model can explain and react.
function formatToolResult(name: string, result: ApiResult) {
  if (result.ok) {
    const qr = name === "toreador_generate_qr" && result.data && typeof result.data === "object" ? (result.data as { qrCodeURL?: string; qrCodeText?: string; textBackground?: string }) : null;
    // Text QR code: shown FIRST and outside the JSON, where "\n" would be escaped and the code unreadable.
    if (qr?.qrCodeText) {
      const { qrCodeText, ...rest } = result.data as Record<string, unknown>;
      const note = `Note for the assistant: show the block above to the user exactly as is, in a code block (monospace). It was drawn for a ${qr.textBackground ?? "dark"} terminal background; if the user's background is the opposite, call the tool again with the other textBackground.`;
      return { content: [{ type: "text" as const, text: `${qrCodeText}\n\n${JSON.stringify(rest, null, 2)}\n\n${note}` }] };
    }
    const note = qr?.qrCodeURL
      ? "\n\nNote for the assistant: qrCodeURL is a base64 PNG data URI that the client may render as an image."
      : "";
    return { content: [{ type: "text" as const, text: JSON.stringify(result.data, null, 2) + note }] };
  }

  const body = (result.data && typeof result.data === "object") ? result.data as { error?: string; error_details?: Record<string, unknown> } : {};
  const details = body.error_details ?? {};
  const code = typeof details.code === "string" ? details.code : "";
  let hint = "";
  if (result.status === 401) hint = " The API key is invalid or revoked: the merchant must create a new one in the Toreador dashboard.";
  else if (result.status === 402) hint = ` The plan's monthly quota is reached (${details.used ?? "?"}/${details.limit ?? "?"}). Upgrade: ${details.upgrade_url ?? "see dashboard"}.`;
  else if (result.status === 429) hint = " Rate limit reached: wait a moment and retry.";
  else if (code === "address_not_registered") hint = " The recipientAddress must be one of the wallets returned by toreador_list_wallets.";
  else if (code === "wallet_provider_unavailable") hint = " This exchange wallet's provider is not available in the merchant's country: use a self-custodial wallet.";

  return {
    isError: true,
    content: [{
      type: "text" as const,
      text: `Toreador API error ${result.status}${code ? ` (${code})` : ""}: ${body.error ?? "unknown error"}.${hint}\n\nFull response:\n${JSON.stringify(result.data, null, 2)}`,
    }],
  };
}

// ---- MCP server wiring ----

const server = new Server(
  { name: "@toreador/mcp-server", version: VERSION },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const name = request.params.name;
  const args = (request.params.arguments || {}) as ToolArgs;
  try {
    return formatToolResult(name, await callTool(name, args));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { isError: true, content: [{ type: "text" as const, text: `Tool ${name} failed: ${message}` }] };
  }
});

// ---- Boot ----

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stderr only: stdout carries the protocol.
  process.stderr.write(
    `[toreador-mcp] ready · env=${ENV} · ${TOOLS.length} tools (${TOOLS.map((t) => t.name).join(", ")})\n`,
  );
}

main().catch((err) => {
  process.stderr.write(`[toreador-mcp] fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
