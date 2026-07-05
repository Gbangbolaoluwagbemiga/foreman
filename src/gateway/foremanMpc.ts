import { parseUnits, formatUnits, erc20Abi, pad, maxUint256, zeroAddress } from "viem";
import { generatePrivateKey } from "viem/accounts";
import { randomBytes } from "node:crypto";
import { GatewayClient, CHAIN_CONFIGS, BatchEvmScheme, type TransferResponse } from "@circle-fin/x402-batching/client";
import { rpcUrl } from "../config";
import { createCircleSigner } from "./circleSigner";

/**
 * The subset of the Gateway surface the Foreman actually uses. Both the raw-key
 * `GatewayClient` and the MPC-backed gateway below satisfy this, so `server.ts`
 * and `gatewayHire` can hold either behind the `WALLET_CUSTODY` flag.
 */
export interface ForemanGateway {
  readonly address: string;
  pay<T = unknown>(
    url: string,
    options?: { method?: "GET" | "POST" | "PUT" | "DELETE"; body?: unknown; headers?: Record<string, string> },
  ): Promise<{ data: T; amount: bigint; formattedAmount: string; transaction: string; status: number }>;
  getBalances(address?: string): Promise<{ gateway: { available: bigint; formattedAvailable: string } }>;
  getUsdcBalance(address?: string): Promise<{ formatted: string }>;
  searchTransfers(params?: {
    from?: `0x${string}`;
    to?: `0x${string}`;
    pageSize?: number;
  }): Promise<{ transfers?: Array<{ id: string; amount: string }> }>;
  getTransferById(id: string): Promise<TransferResponse>;
  deposit(amount: string): Promise<{ formattedAmount: string }>;
  withdraw(amount: string): Promise<{ formattedAmount: string }>;
  /** MPC-signed plain-USDC transfer from the treasury wallet to any address.
   *  Optional so the raw library `GatewayClient` still satisfies this interface. */
  transferUsdc?(to: string, amount: string): Promise<{ hash: string; formattedAmount: string }>;
}

const GATEWAY_WALLET_ABI = [
  {
    type: "function",
    name: "deposit",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
] as const;

const GATEWAY_MINTER_ABI = [
  {
    type: "function",
    name: "gatewayMint",
    stateMutability: "nonpayable",
    inputs: [
      { name: "attestationPayload", type: "bytes" },
      { name: "signature", type: "bytes" },
    ],
    outputs: [],
  },
] as const;

// EIP-712 types for the Gateway burn intent (mirrors the SDK). EIP712Domain is
// omitted on purpose — viem infers it from the {name, version} domain.
const BURN_INTENT_TYPES = {
  TransferSpec: [
    { name: "version", type: "uint32" },
    { name: "sourceDomain", type: "uint32" },
    { name: "destinationDomain", type: "uint32" },
    { name: "sourceContract", type: "bytes32" },
    { name: "destinationContract", type: "bytes32" },
    { name: "sourceToken", type: "bytes32" },
    { name: "destinationToken", type: "bytes32" },
    { name: "sourceDepositor", type: "bytes32" },
    { name: "destinationRecipient", type: "bytes32" },
    { name: "sourceSigner", type: "bytes32" },
    { name: "destinationCaller", type: "bytes32" },
    { name: "value", type: "uint256" },
    { name: "salt", type: "bytes32" },
    { name: "hookData", type: "bytes" },
  ],
  BurnIntent: [
    { name: "maxBlockHeight", type: "uint256" },
    { name: "maxFee", type: "uint256" },
    { name: "spec", type: "TransferSpec" },
  ],
} as const;

const GATEWAY_API_TESTNET = "https://gateway-api-testnet.circle.com/v1";

/**
 * The Foreman treasury as a **Circle Programmable Wallet (MPC)** on Arc.
 *
 * Circle holds the key shares — no raw private key ever touches Foreman. Every
 * crew payment authorization (EIP-3009 TransferWithAuthorization for Gateway
 * batching) is signed by Circle MPC via `BatchEvmScheme(circleSigner)`, and the
 * Gateway deposit is an on-chain tx sent through the MPC wallet.
 *
 * Read-only calls (balances, transfer lookups) go through a throwaway read
 * client — those take an explicit address and never sign, so the ephemeral key
 * is never funded and never used to authorize anything.
 */
export function createForemanGatewayMPC(): ForemanGateway {
  const signer = createCircleSigner();
  const scheme = new BatchEvmScheme(signer);
  const chainConfig = CHAIN_CONFIGS.arcTestnet;
  const address = signer.address;

  // Read-only plumbing (publicClient + Gateway API helpers). The key is never
  // used to sign or spend — every read below is by explicit address / id.
  const reader = new GatewayClient({ chain: "arcTestnet", privateKey: generatePrivateKey(), rpcUrl });

  async function pay<T = unknown>(
    url: string,
    options?: { method?: "GET" | "POST" | "PUT" | "DELETE"; body?: unknown; headers?: Record<string, string> },
  ): Promise<{ data: T; amount: bigint; formattedAmount: string; transaction: string; status: number }> {
    const method = options?.method ?? "GET";
    const headers: Record<string, string> = { "Content-Type": "application/json", ...options?.headers };
    const serializedBody =
      options?.body !== undefined
        ? typeof options.body === "string"
          ? options.body
          : JSON.stringify(options.body)
        : undefined;

    const initial = await fetch(url, { method, headers, body: serializedBody });
    if (initial.status !== 402) {
      if (initial.ok) {
        return { data: (await initial.json()) as T, amount: 0n, formattedAmount: "0", transaction: "", status: initial.status };
      }
      throw new Error(`Request failed with status ${initial.status}`);
    }

    const prHeader = initial.headers.get("PAYMENT-REQUIRED");
    if (!prHeader) throw new Error("Missing PAYMENT-REQUIRED header in 402 response");
    const paymentRequired = JSON.parse(Buffer.from(prHeader, "base64").toString("utf-8"));
    const accepts: Array<Record<string, unknown>> = paymentRequired.accepts ?? [];
    if (accepts.length === 0) throw new Error("No payment options in 402 response");

    const expectedNetwork = `eip155:${chainConfig.chain.id}`;
    const batchingOption = accepts.find((opt) => {
      const extra = opt.extra as Record<string, unknown> | undefined;
      return (
        opt.network === expectedNetwork &&
        extra?.name === "GatewayWalletBatched" &&
        extra?.version === "1" &&
        typeof extra?.verifyingContract === "string"
      );
    });
    if (!batchingOption)
      throw new Error(`No Gateway batching option for ${expectedNetwork} — seller may not support Arc.`);

    // ── The MPC signature: Circle signs the EIP-3009 authorization. No raw key. ──
    const paymentPayload = await scheme.createPaymentPayload(
      paymentRequired.x402Version ?? 2,
      batchingOption as never,
    );
    const paymentHeader = Buffer.from(
      JSON.stringify({ ...paymentPayload, resource: paymentRequired.resource, accepted: batchingOption }),
    ).toString("base64");

    const paid = await fetch(url, { method, headers: { ...headers, "Payment-Signature": paymentHeader }, body: serializedBody });
    if (!paid.ok) {
      const err = await paid.json().catch(() => ({}));
      throw new Error(`Payment failed: ${(err as { error?: string }).error || paid.statusText}`);
    }
    const data = (await paid.json()) as T;
    const amount = BigInt((batchingOption as { amount: string }).amount);
    let transaction = "";
    const respHeader = paid.headers.get("PAYMENT-RESPONSE");
    if (respHeader) {
      const settle = JSON.parse(Buffer.from(respHeader, "base64").toString("utf-8"));
      transaction = settle.transaction ?? "";
    }
    return { data, amount, formattedAmount: formatUnits(amount, 6), transaction, status: paid.status };
  }

  const addressToBytes32 = (addr: string) => pad(addr.toLowerCase() as `0x${string}`, { size: 32 });

  // Same-chain (Arc→Arc) instant withdrawal, fully under MPC: sign the burn intent
  // via Circle MPC, get Circle's attestation, then mint back to the treasury wallet
  // with an MPC-signed on-chain tx. No raw key at any step.
  async function withdraw(amount: string): Promise<{ formattedAmount: string }> {
    const cfg = chainConfig;
    const withdrawAmount = parseUnits(amount, 6);
    const maxFee = parseUnits("2.01", 6);
    const recipient = address;

    const bal = await reader.getBalances(address);
    if (bal.gateway.available < withdrawAmount)
      throw new Error(`Insufficient Gateway balance. Have: ${bal.gateway.formattedAvailable}, Need: ${amount}`);

    const burnIntent = {
      maxBlockHeight: maxUint256,
      maxFee,
      spec: {
        version: 1,
        sourceDomain: cfg.domain,
        destinationDomain: cfg.domain,
        sourceContract: addressToBytes32(cfg.gatewayWallet),
        destinationContract: addressToBytes32(cfg.gatewayMinter),
        sourceToken: addressToBytes32(cfg.usdc),
        destinationToken: addressToBytes32(cfg.usdc),
        sourceDepositor: addressToBytes32(address),
        destinationRecipient: addressToBytes32(recipient),
        sourceSigner: addressToBytes32(address),
        destinationCaller: addressToBytes32(zeroAddress),
        value: withdrawAmount,
        salt: `0x${randomBytes(32).toString("hex")}` as `0x${string}`,
        hookData: "0x" as `0x${string}`,
      },
    };

    // MPC signs the burn intent (EIP-712, GatewayWallet domain).
    const signature = await (signer.walletClient.signTypedData as (a: unknown) => Promise<`0x${string}`>)({
      account: address,
      domain: { name: "GatewayWallet", version: "1" },
      types: BURN_INTENT_TYPES,
      primaryType: "BurnIntent",
      message: burnIntent,
    });

    const resp = await fetch(`${GATEWAY_API_TESTNET}/transfer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([{ burnIntent, signature }], (_k, v) => (typeof v === "bigint" ? v.toString() : v)),
    });
    const result = (await resp.json()) as { attestation?: `0x${string}`; signature?: `0x${string}`; error?: string; message?: string };
    if (!resp.ok || result.error || !result.attestation || !result.signature)
      throw new Error(`Gateway API error: ${result.message || result.error || JSON.stringify(result)}`);

    // MPC-signed mint back to the treasury on Arc.
    const mintHash = await signer.walletClient.writeContract({
      chain: reader.publicClient.chain,
      account: address,
      address: cfg.gatewayMinter,
      abi: GATEWAY_MINTER_ABI,
      functionName: "gatewayMint",
      args: [result.attestation, result.signature],
    });
    await reader.publicClient.waitForTransactionReceipt({ hash: mintHash });
    return { formattedAmount: amount };
  }

  async function deposit(amount: string): Promise<{ formattedAmount: string }> {
    const depositAmount = parseUnits(amount, 6);
    // Approve the Gateway wallet to pull USDC, then deposit — both signed by MPC.
    const allowance = await reader.publicClient.readContract({
      address: chainConfig.usdc,
      abi: erc20Abi,
      functionName: "allowance",
      args: [address, chainConfig.gatewayWallet],
    });
    if (allowance < depositAmount) {
      const approveHash = await signer.walletClient.writeContract({
        chain: reader.publicClient.chain,
        account: address,
        address: chainConfig.usdc,
        abi: erc20Abi,
        functionName: "approve",
        args: [chainConfig.gatewayWallet, depositAmount],
      });
      await reader.publicClient.waitForTransactionReceipt({ hash: approveHash });
    }
    const depositHash = await signer.walletClient.writeContract({
      chain: reader.publicClient.chain,
      account: address,
      address: chainConfig.gatewayWallet,
      abi: GATEWAY_WALLET_ABI,
      functionName: "deposit",
      args: [chainConfig.usdc, depositAmount],
      gas: 120_000n,
    });
    await reader.publicClient.waitForTransactionReceipt({ hash: depositHash });
    return { formattedAmount: amount };
  }

  // Plain USDC out of the treasury wallet (not the Gateway pot) — this is how a
  // user gets their deposited balance back to their own wallet. MPC-signed, so
  // no raw key ever touches it.
  async function transferUsdc(to: string, amount: string): Promise<{ hash: string; formattedAmount: string }> {
    const value = parseUnits(amount, 6);
    const bal = (await reader.publicClient.readContract({
      address: chainConfig.usdc,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [address],
    })) as bigint;
    if (bal < value)
      throw new Error(`Insufficient treasury balance. Have: ${formatUnits(bal, 6)}, Need: ${amount}`);
    const hash = await signer.walletClient.writeContract({
      chain: reader.publicClient.chain,
      account: address,
      address: chainConfig.usdc,
      abi: erc20Abi,
      functionName: "transfer",
      args: [to as `0x${string}`, value],
    });
    await reader.publicClient.waitForTransactionReceipt({ hash });
    return { hash, formattedAmount: amount };
  }

  return {
    address,
    pay,
    deposit,
    withdraw,
    transferUsdc,
    getBalances: (addr) => reader.getBalances((addr as `0x${string}`) ?? address),
    getUsdcBalance: (addr) => reader.getUsdcBalance((addr as `0x${string}`) ?? address),
    searchTransfers: (params) => reader.searchTransfers(params),
    getTransferById: (id) => reader.getTransferById(id),
  };
}
