import { createRequire } from "node:module";
import { createWalletClient, custom, type WalletClient } from "viem";
import { config, arcTestnet } from "../config";

// The Circle DCW `/evm` subpath ships dual CJS/ESM builds, and its ESM named
// exports aren't reliably resolvable across Node versions — a static
// `import { createEIP1193Provider }` works on Node 25 but throws on Node 22 with
// "does not provide an export named 'createEIP1193Provider'". Load the CJS build
// explicitly via createRequire so the export is found deterministically.
const nodeRequire = createRequire(import.meta.url);
const { createEIP1193Provider } = nodeRequire(
  "@circle-fin/developer-controlled-wallets/evm",
) as typeof import("@circle-fin/developer-controlled-wallets/evm");

/**
 * Custody via Circle Programmable Wallets (developer-controlled, MPC).
 *
 * Circle holds the key shares — Foreman NEVER sees a raw private key. Circle's
 * EIP-1193 provider drives the MPC wallet over the API; we wrap it in a viem
 * WalletClient so the treasury can both:
 *   • sign x402 payment authorizations (EIP-712 `signTypedData`) — this is exactly
 *     the `BatchEvmSigner` the batching rail needs, so payments run under MPC, and
 *   • send transactions on Arc (e.g. the Gateway deposit) — via `eth_sendTransaction`.
 *
 * Shape matches `BatchEvmSigner` from @circle-fin/x402-batching: `{ address, signTypedData }`.
 */
export interface CircleSigner {
  readonly address: `0x${string}`;
  /** Sign EIP-712 typed data via Circle MPC (BatchEvmSigner-compatible). */
  signTypedData: (params: {
    domain: { name: string; version: string; chainId: number; verifyingContract: `0x${string}` };
    types: Record<string, Array<{ name: string; type: string }>>;
    primaryType: string;
    message: Record<string, unknown>;
  }) => Promise<`0x${string}`>;
  /** viem client bound to the MPC wallet — for on-chain txs (deposit, withdraw). */
  readonly walletClient: WalletClient;
}

export function circleCustodyReady(): boolean {
  return !!(config.circleApiKey && config.circleEntitySecret && config.circleWalletAddress);
}

/** Build an MPC-backed signer for the Foreman treasury. Throws if Circle isn't configured. */
export function createCircleSigner(): CircleSigner {
  if (!config.circleApiKey || !config.circleEntitySecret)
    throw new Error("Circle custody needs CIRCLE_API_KEY + CIRCLE_ENTITY_SECRET — see CIRCLE_SETUP.md");
  if (!config.circleWalletAddress)
    throw new Error("Circle custody needs CIRCLE_WALLET_ADDRESS — run `npm run circle:setup` first");

  const provider = createEIP1193Provider({
    apiKey: config.circleApiKey,
    entitySecret: config.circleEntitySecret,
    // A Circle Blockchain code (e.g. "ARC-TESTNET"); the provider validates it.
    chain: config.circleBlockchain as Parameters<typeof createEIP1193Provider>[0]["chain"],
  });
  const address = config.circleWalletAddress as `0x${string}`;
  const walletClient = createWalletClient({
    account: address,
    chain: arcTestnet,
    transport: custom(provider as { request: (a: { method: string; params?: unknown[] }) => Promise<unknown> }),
  });

  return {
    address,
    walletClient,
    // viem's typed-data generics don't add safety here — the batching rail hands us
    // a well-formed EIP-712 struct — so call through a loosened signature.
    signTypedData: (params) =>
      (walletClient.signTypedData as (a: unknown) => Promise<`0x${string}`>)({
        account: address,
        domain: params.domain,
        types: params.types,
        primaryType: params.primaryType,
        message: params.message,
      }),
  };
}
