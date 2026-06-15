import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { PrivateKeyAccount } from "viem";

/**
 * Every Foreman agent (the contractor and each crew member) holds a wallet.
 *
 * `AgentSigner` is the seam that lets us start on free local keypairs today and
 * swap in Circle Programmable Wallets later WITHOUT touching agent logic — a
 * CircleSigner just implements this same interface.
 */
export interface AgentSigner {
  readonly address: `0x${string}`;
  /** viem account used to sign/send transactions (local rail only). */
  readonly account: PrivateKeyAccount;
}

/** A wallet backed by a local private key. Free, instant, no onboarding. */
export function createLocalSigner(privateKey?: `0x${string}`): AgentSigner {
  const pk = privateKey && privateKey.length > 0 ? privateKey : generatePrivateKey();
  const account = privateKeyToAccount(pk);
  return { address: account.address, account };
}
