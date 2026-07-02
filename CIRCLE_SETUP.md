# Custody: Circle Programmable Wallets (MPC) — setup

Move the Foreman treasury off a raw private key onto a **Circle Programmable Wallet**
(developer-controlled, MPC). Circle holds the key shares; Foreman never sees a raw key and
authorizes every spend through the Circle API. This is the "are these people serious"
signal for anyone doing diligence — and it's the same wallet that signs x402 payment
authorizations, so payments run **under MPC on the real rail**.

Arc is supported: the SDK's blockchain enum includes `ARC-TESTNET`, and Circle's EIP-1193
provider exposes both `eth_signTypedData_v4` (sign payments) and `eth_sendTransaction`
(deposit into the Gateway).

---

## 1. Get a Circle Developer API key

1. Sign up / log in at **https://console.circle.com** (Web3 Services → Developer-Controlled
   Wallets).
2. Switch to **Testnet** (top of the console).
3. **API Keys → Create key.** Copy it. In `Foreman/.env`:
   ```
   CIRCLE_API_KEY=TEST_API_KEY:xxxx: yyyyy
   ```

## 2. Create + register an entity secret

The entity secret is a 32-byte secret you hold; Circle stores only a registered ciphertext
of it. Every signed request is authorized with a fresh ciphertext derived from it.

1. Generate one:
   ```bash
   cd Foreman
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
   Put it in `Foreman/.env`:
   ```
   CIRCLE_ENTITY_SECRET=<the 64-hex-char string>
   ```
2. **Register it with Circle** (one time): Circle console → Developer-Controlled Wallets →
   **Configurator / Entity Secret → Register**, paste the ciphertext it asks for. The SDK
   can also print a ciphertext for you:
   ```bash
   node -e "import('@circle-fin/developer-controlled-wallets').then(async m => console.log(await m.generateEntitySecretCiphertext({ apiKey: process.env.CIRCLE_API_KEY, entitySecret: process.env.CIRCLE_ENTITY_SECRET })))"
   ```
   Paste that ciphertext into the console's registration box. **Save the recovery file**
   Circle gives you.

> Keep `CIRCLE_ENTITY_SECRET` secret — it's already covered by `.env` being gitignored.
> Never commit it.

## 3. Create the MPC treasury wallet on Arc

```bash
cd Foreman
npm run circle:setup
```
This creates a wallet set + one MPC wallet on `ARC-TESTNET` and prints:
```
WALLET_CUSTODY=circle
CIRCLE_WALLET_ID=<id>
CIRCLE_WALLET_ADDRESS=0x…
```
Add those three lines to `Foreman/.env`.

## 4. Prove the MPC signer works

```bash
npm run circle:verify
```
This signs a sample x402 payment authorization **through Circle MPC**, then recovers the
signer and checks it equals the treasury address. Expected:
```
✅ MPC signature verified — recovered signer matches the treasury address.
```
That confirms the treasury can pay crew on the real rail with **no raw key**.

## 5. Turn custody on + fund the treasury

The MPC pay-path is built (`src/gateway/foremanMpc.ts`) and gated behind the flag. To run
the demo under MPC custody:

1. In `Foreman/.env` set:
   ```
   WALLET_CUSTODY=circle
   ```
2. Fund the treasury: send testnet USDC on Arc to `CIRCLE_WALLET_ADDRESS` (faucet / a funded
   wallet). The engine deposits it into the Gateway before jobs — that deposit is now signed
   by Circle MPC too.
3. Start the engine on the gateway rail:
   ```bash
   ENGINE_RAIL=gateway npm run serve
   ```
   You'll see `🔐 treasury custody: Circle MPC (no raw key signs payments)` and the banner
   shows `custody: circle-MPC`. Run a job — every crew payment authorization is signed by
   Circle MPC.

Leave `WALLET_CUSTODY=local` (default) to run the demo on the raw-key wallet instead —
identical rail, nothing else changes.

---

## What's wired

- ✅ **Signer & CLIs:** config flag `WALLET_CUSTODY=local|circle`, the MPC signer
  (`src/gateway/circleSigner.ts`, EIP-1193 → viem, `BatchEvmSigner`-compatible), and the
  `circle:register` / `circle:setup` / `circle:verify` CLIs.
- ✅ **Pay path (the final step):** `src/gateway/foremanMpc.ts` — `createForemanGatewayMPC()`
  reuses `BatchEvmScheme(circleSigner)` to sign each crew payment authorization under MPC,
  runs the x402 402→sign→settle loop itself, and deposits into the Gateway via the MPC
  `walletClient`. Wired into `server.ts` behind `WALLET_CUSTODY=circle`; `local` stays the
  default so the working demo is untouched.
- ✅ **Withdraw under MPC:** `withdraw()` signs the Gateway burn intent via MPC, gets
  Circle's attestation, and mints back to the treasury with an MPC-signed on-chain tx.
  Prove it: `npm run circle:withdraw -- 0.5`.
- ✅ **Validated live end-to-end:** with the treasury funded and `WALLET_CUSTODY=circle`, a
  gateway-rail job runs the full HTTP-402 loop + MPC Gateway deposit + MPC-signed crew
  payment (real Circle transfer UUID), and `circle:withdraw` completes the round-trip.
  `circle:verify` also proves the pay-signing call with no funds needed.

Env vars (all optional until you go custody-on):

| Var | Meaning |
|---|---|
| `WALLET_CUSTODY` | `local` (default) or `circle` |
| `CIRCLE_API_KEY` | Circle developer API key (testnet) |
| `CIRCLE_ENTITY_SECRET` | your 32-byte entity secret (registered with Circle) |
| `CIRCLE_WALLET_ID` | from `circle:setup` |
| `CIRCLE_WALLET_ADDRESS` | from `circle:setup` — the MPC treasury address |
| `CIRCLE_BLOCKCHAIN` | defaults to `ARC-TESTNET` |
