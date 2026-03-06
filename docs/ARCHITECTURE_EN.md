# 🌀 Araf Protocol — Canonical Architecture & Technical Reference

> **Version:** 2.0 | **Network:** Base (Layer 2) | **Status:** Mainnet Ready | **Last Updated:** March 2026

---

## Table of Contents

1. [Vision & Core Philosophy](#1-vision--core-philosophy)
2. [Hybrid Architecture: On-Chain vs Off-Chain](#2-hybrid-architecture-on-chain-vs-off-chain)
3. [System Participants](#3-system-participants)
4. [Tier & Bond System](#4-tier--bond-system)
5. [Anti-Sybil Shield](#5-anti-sybil-shield)
6. [Standard Trade Flow (Happy Path)](#6-standard-trade-flow-happy-path)
7. [Dispute System — Bleeding Escrow](#7-dispute-system--bleeding-escrow)
8. [Reputation & Penalty System](#8-reputation--penalty-system)
9. [Security Architecture](#9-security-architecture)
10. [Data Models (MongoDB)](#10-data-models-mongodb)
11. [Treasury Model](#11-treasury-model)
12. [Attack Vectors & Known Limitations](#12-attack-vectors--known-limitations)
13. [Finalized Protocol Parameters](#13-finalized-protocol-parameters)
14. [Future Evolution Path](#14-future-evolution-path)

---

## 1. Vision & Core Philosophy

Araf Protocol is a **non-custodial, humanless, oracle-free** peer-to-peer escrow system that enables trustless exchange between fiat currency (TRY / USD / EUR) and crypto assets (USDT / USDC) on Base Layer 2. There are no moderators, no arbitrators, no customer service. Disputes are resolved autonomously by on-chain timers and economic game theory.

> *"The system does not judge. It makes dishonesty expensive."*

### Core Principles

| Principle | Meaning |
|---|---|
| **Non-Custodial** | The platform never touches user funds. All assets are locked in a transparent smart contract. |
| **Oracle-Free Dispute Resolution** | No external data feed decides who wins a dispute. Resolution is purely time-based (Bleeding Escrow). |
| **Humanless** | No moderators. No jury. Code and timers decide everything. |
| **MAD-Based Security** | Mutually Assured Destruction game theory: dishonest behaviour always costs more than honest behaviour. |
| **Zero Private Key Backend** | The backend server holds no wallet keys and cannot move funds. |

### The Oracle-Free Clarification

**What we do NOT use oracles for:**
- ❌ Payment verification (bank transfers)
- ❌ Deciding who is "right" in a dispute
- ❌ Any external data feed controlling escrow release

**What lives off-chain (and why):**
- ✅ PII storage (IBAN, Telegram) — **GDPR / KVKK: Right to be Forgotten**
- ✅ Orderbook & listings — **Performance: sub-50ms queries**
- ✅ Analytics — **UX: real-time stats and filtering**

> The distinction matters: oracles are used only for legal data storage — **never for dispute outcomes.**

---

## 2. Hybrid Architecture: On-Chain vs Off-Chain

Araf operates as a **Web2.5 Hybrid System**. Security-sensitive operations live on-chain; privacy-sensitive and performance-critical data live off-chain.

### Architecture Decision Matrix

| Component | Storage | Technology | Rationale |
|---|---|---|---|
| USDT / USDC Escrow | On-Chain | ArafEscrow.sol | Immutable, non-custodial, trustless |
| Trade State Machine | On-Chain | ArafEscrow.sol | Bleeding timer is fully autonomous |
| Reputation Scores | On-Chain | ArafEscrow.sol | Permanent, unforgeable proof of history |
| Bond Calculations | On-Chain | ArafEscrow.sol | No backend can manipulate penalties |
| Anti-Sybil Checks | On-Chain | ArafEscrow.sol | Wallet age, dust, cooldown enforced |
| PII Data (IBAN / Name) | Off-Chain | MongoDB + KMS | GDPR / KVKK: Right to be Forgotten |
| Orderbook & Listings | Off-Chain | MongoDB | Sub-50ms queries, free filtering |
| Event Cache | Off-Chain | MongoDB | Trade state mirror for fast UI rendering |
| Rate Limiting / Nonces | In-Memory | Redis | 5-min TTL, sliding window, replay-proof |

### Tech Stack

| Layer | Technology | Details |
|---|---|---|
| Smart Contract | Solidity + Hardhat | 0.8.24 — Base L2 (Chain ID 8453) |
| Backend | Node.js + Express | CommonJS, Zero Private Key Relayer |
| Database | MongoDB + Mongoose | v8.x — Listings, Trades, Users |
| Cache / Auth | Redis | v4.x — Rate limits, Nonces, DLQ |
| Encryption | AES-256-GCM + HKDF | Envelope encryption, per-wallet DEK |
| Authentication | SIWE + JWT (HS256) | EIP-4361, 15-min expiry |
| Frontend | React 18 + Vite + Wagmi | Tailwind CSS, viem, EIP-712 |
| Contract ABI | Auto-generated on deploy | `frontend/src/abi/ArafEscrow.json` |

### The Zero-Trust Backend Model

Despite using off-chain infrastructure, **the backend cannot steal funds or manipulate outcomes:**

```
✅ Backend has ZERO private keys (Relayer pattern)
✅ Backend cannot release escrow (only users can sign)
✅ Backend cannot skip Bleeding Escrow timer (on-chain enforced)
✅ Backend cannot fake reputation scores (verified on-chain)
⚠️  Backend CAN decrypt PII (necessary for UX — mitigated by rate limiting + audit logs)
```

---

## 3. System Participants

| Role | Label | Capabilities | Restrictions |
|---|---|---|---|
| **Maker** | Seller | Opens listing. Locks USDT + Bond. Can release, challenge, propose cancel. | Cannot act as own Taker. Bond locked until trade resolves. |
| **Taker** | Buyer | Sends fiat off-chain. Locks Taker Bond. Can report payment, approve cancel. | Subject to Anti-Sybil filters. Can be banned (Taker-only restriction). |
| **Treasury** | Protocol | Receives 0.2% success fee + decayed / burned funds. | Address set at deploy time — cannot be changed by backend. |
| **Backend** | Relayer | Stores encrypted PII, indexes orderbook, issues JWT, serves API. | Zero private keys. Cannot move funds. Cannot alter on-chain state. |

---

## 4. Tier & Bond System

The 5-tier system solves the **"Cold Start" problem**: new wallets cannot immediately access high-volume trades, protecting experienced users from untested counterparties. All bond constants are enforced on-chain and cannot be changed by the backend.

### Tier Definitions

| Tier | TRY Limit | Maker Bond | Taker Bond | Cooldown | Upgrade Threshold |
|---|---|---|---|---|---|
| **Tier 0** | 250 – 5,000 ₺ | 0% | 0% | 24h / trade | New user incentive — entry gateway, no bond |
| **Tier 1** | 5,001 – 50,000 ₺ | 8% | 10% | 24h / trade | Open by default |
| **Tier 2** | 50,001 – 250,000 ₺ | 6% | 8% | Unlimited | 50 successful + 100K TRY volume + ≤1 failed |
| **Tier 3** | 250,001 – 1,000,000 ₺ | 5% | 5% | Unlimited | 100 successful + 500K TRY volume + ≤1 failed |
| **Tier 4** | 1,000,001+ ₺ | 2% | 2% | Unlimited | 200 successful + 2M TRY volume + 0 failed |

### Reputation Bond Modifiers

Applied on top of base bond rates for Tier 1–4 (not applied to Tier 0):

| Condition | Effect |
|---|---|
| 0 failed disputes + at least 1 successful trade | −1% bond discount (clean history reward) |
| 1 or more failed disputes | +3% bond penalty |

---

## 5. Anti-Sybil Shield

Four on-chain filters run before every `lockEscrow()` call. The backend **cannot** bypass or override them.

| Filter | Rule | Purpose |
|---|---|---|
| **Self-Trade Prevention** | `msg.sender ≠ maker address` | Blocks wash trading on own listings |
| **Wallet Age** | Registration ≥ 7 days before first trade | Blocks freshly-created Sybil wallets |
| **Dust Limit** | Native balance ≥ 0.001 ETH (~$2 on Base) | Blocks zero-balance throwaway wallets |
| **Tier 0 / 1 Cooldown** | Maximum 1 trade per 24 hours | Limits bot-scale spam on low-bond tiers |
| **Challenge Cooldown** | Must wait ≥ 1 hour after PAID state | Prevents instant griefing on receipt upload |

---

## 6. Standard Trade Flow (Happy Path)

```
Maker createEscrow()
  → OPEN (USDT + Maker Bond locked on-chain)
    → Taker lockEscrow() — Anti-Sybil passes
      → LOCKED (Taker Bond locked on-chain)
        → Taker reportPayment() + IPFS receipt hash
          → PAID (48h Grace Period timer starts on-chain)
            → Maker releaseFunds()
              → RESOLVED ✅ (0.2% fee deducted, funds distributed)
```

### State Definitions

| State | Triggered By | Description |
|---|---|---|
| `OPEN` | Maker `createEscrow()` | Listing live. USDT + Maker bond locked on-chain. |
| `LOCKED` | Taker `lockEscrow()` | Anti-Sybil passed. Taker bond locked on-chain. |
| `PAID` | Taker `reportPayment()` | IPFS receipt hash recorded on-chain. 48h timer starts. |
| `RESOLVED` | Maker `releaseFunds()` | 0.2% fee charged. USDT to Taker. Bonds returned. |
| `CANCELED` | 2/2 EIP-712 signatures | Full refund. No fee. Bonds fully returned. |
| `BURNED` | `burnExpired()` after 240h | All remaining funds to Treasury. |

### Fee Model

- **Taker fee:** 0.1% deducted from USDT received by Taker
- **Maker fee:** 0.1% deducted from Maker's bond refund
- **Total:** 0.2% per successfully resolved trade
- **CANCELED trades:** no fee charged

---

## 7. Dispute System — Bleeding Escrow

Araf Protocol has no arbitrator. Instead, it uses an **asymmetric time-decay mechanism** that makes prolonged disputes mathematically expensive. The longer a party refuses to cooperate, the more they lose.

### Full State Machine

```
PAID
  │
  ├──[Maker clicks Release]─────────────────────── RESOLVED ✅
  │
  └──[Maker clicks Challenge]
          │
        GRACE PERIOD (48h) — no financial penalty
        ├──[Collaborative Cancel (2/2 EIP-712)]─── CANCELED 🔄
        ├──[Mutual Release]──────────────────────── RESOLVED ✅
        │
        └──[No agreement after 48h]
                    │
                BLEEDING ⏳ (autonomous on-chain decay)
                ├── Taker bond: 42 BPS / hour
                ├── Maker bond: 26 BPS / hour
                ├── USDT (both): 34 BPS / hour each (starts at Hour 96 of Bleeding)
                │
                ├──[Release at any time]─────────── RESOLVED ✅ (remaining funds)
                ├──[Cancel (2/2)]────────────────── CANCELED 🔄 (remaining funds)
                └──[240h elapsed — no agreement]
                          │
                        BURNED 💀 (all funds to Treasury)
```

### Bleeding Decay Rates

| Asset | Party | Rate | Starts At |
|---|---|---|---|
| **Taker Bond** | Taker (challenge opener) | 42 BPS / hour (~10.1% / day) | Hour 0 of Bleeding |
| **Maker Bond** | Maker | 26 BPS / hour (~6.2% / day) | Hour 0 of Bleeding |
| **USDT** | Both parties equally | 34 BPS / hour each (~8.2% / day) | Hour 96 of Bleeding |

> **Why USDT starts at Hour 96 of Bleeding (Hour 144 from challenge):**
> 48h grace period + 96h buffer for weekend bank delays. Protects honest parties from immediate principal loss while maintaining urgency.

### Collaborative Cancel (EIP-712)

Either party can propose a mutual exit during `LOCKED`, `PAID`, or `CHALLENGED` state. Both must sign an EIP-712 typed message off-chain. Once collected in the backend, either party submits on-chain. Full refund, no fee, no reputation penalty.

Signature type: `CancelProposal(uint256 tradeId, address proposer, uint256 nonce, uint256 deadline)`

---

## 8. Reputation & Penalty System

### Reputation Update Logic

| Outcome | Maker | Taker |
|---|---|---|
| Dispute-free close (RESOLVED) | +1 Successful | +1 Successful |
| Maker challenged → then released (S2) | +1 Failed | +1 Successful |
| `autoRelease` — Maker passive 48h | +1 Failed | +1 Successful |
| BURNED (10-day timeout) | +1 Failed | +1 Failed |

### Ban & Consecutive Escalation

**Trigger:** 2 or more `failedDisputes`. Ban is **Taker-only** — banned wallets can still open listings as Maker.

| Ban Number | Duration | Tier Effect | Notes |
|---|---|---|---|
| 1st ban | 30 days | No tier change | `consecutiveBans = 1` |
| 2nd ban | 60 days | `maxAllowedTier −1` | `consecutiveBans = 2` |
| 3rd ban | 120 days | `maxAllowedTier −1` | `consecutiveBans = 3` |
| Nth ban | 30 × 2^(N−1) days (max 365) | `maxAllowedTier −1` per ban (floor: Tier 0) | Permanent on-chain memory |

> **Tier Cap:** `createEscrow()` reverts if requested tier > `maxAllowedTier`.
> Example: Tier 3 wallet receives 2nd ban → `maxAllowedTier` drops to 2. Cannot open Tier 3 or 4.

---

## 9. Security Architecture

### 9.1 Authentication Flow (SIWE + JWT)

| Step | Actor | Action | Security Property |
|---|---|---|---|
| 1 | Frontend | `GET /api/auth/nonce` | Nonce stored in Redis with 5-min TTL |
| 2 | User | Signs EIP-4361 SIWE message in wallet | Standard format via `siwe.SiweMessage` class |
| 3 | Frontend | `POST /api/auth/verify` — message + signature | Nonce consumed atomically (`getDel` — replay-proof) |
| 4 | Backend | Verifies SIWE, issues JWT (HS256, 15 min) | JWT has `type: "auth"` claim, never contains PII |
| 5 | Frontend | JWT as Bearer token for all protected API calls | Every route calls `requireAuth` middleware |

### 9.2 PII Encryption (Envelope Encryption)

| Property | Value |
|---|---|
| Algorithm | AES-256-GCM (authenticated encryption) |
| Key Derivation | HKDF (SHA-256, RFC 5869) — native Node.js crypto |
| DEK Scope | One unique DEK per wallet address — never reused |
| Master Key Storage | Environment variable (dev) / AWS KMS or Vault (prod) |
| Raw IP Storage | Never stored. SHA-256(IP) hash only — GDPR compliant |
| IBAN Access Flow | Auth JWT → PII token (15 min, trade-scoped) → decrypt |

### 9.3 Rate Limiting

| Endpoint Group | Limit | Window | Key |
|---|---|---|---|
| PII / IBAN | 3 requests | 10 minutes | IP + Wallet |
| Auth (SIWE) | 10 requests | 1 minute | IP |
| Listings (read) | 100 requests | 1 minute | IP |
| Listings (write) | 5 requests | 1 hour | Wallet |
| Trades | 30 requests | 1 minute | Wallet |
| Feedback | 3 requests | 1 hour | Wallet |

### 9.4 Event Listener Reliability

- **Checkpoint:** Last processed block saved to Redis after each batch
- **Replay:** On restart, missed blocks re-scanned from checkpoint
- **Retry:** Failed events retried 3× with exponential back-off
- **Dead Letter Queue (DLQ):** Events failing all retries written to Redis DLQ
- **DLQ Monitor:** Runs every 60 seconds — alerts when DLQ ≥ 5 entries
- **Reconnect:** Auto-reconnects on RPC provider failure

---

## 10. Data Models (MongoDB)

### Users Collection

| Field | Type | Description |
|---|---|---|
| `wallet_address` | String (unique) | Lowercase Ethereum address |
| `pii_data.bankOwner_enc` | String | AES-256-GCM encrypted bank owner name |
| `pii_data.iban_enc` | String | AES-256-GCM encrypted IBAN |
| `pii_data.telegram_enc` | String | AES-256-GCM encrypted Telegram handle |
| `reputation_cache.*` | Number | Display-only mirror — not authoritative |
| `is_banned` / `banned_until` | Boolean / Date | On-chain ban mirror |
| `consecutive_bans` | Number (default: 0) | On-chain consecutive ban count mirror |
| `max_allowed_tier` | Number (default: 4) | On-chain tier cap mirror — display only |
| `last_login` | Date | TTL: auto-deleted after 2 years (GDPR) |

### Listings Collection

| Field | Type | Description |
|---|---|---|
| `maker_address` | String | Listing creator address |
| `crypto_asset` | `USDT` \| `USDC` | Asset being sold |
| `fiat_currency` | `TRY` \| `USD` \| `EUR` | Fiat currency requested |
| `exchange_rate` | Number | Rate per 1 crypto unit |
| `limits.min` / `limits.max` | Number | Fiat amount range per trade |
| `tier_rules.required_tier` | 0 – 4 | Minimum tier to take this listing |
| `tier_rules.maker_bond_pct` | Number | Maker bond % |
| `tier_rules.taker_bond_pct` | Number | Taker bond % |
| `status` | `OPEN` \| `PAUSED` \| `COMPLETED` \| `DELETED` | Listing lifecycle state |
| `onchain_escrow_id` | Number \| null | On-chain `tradeId` once escrow is created |
| `token_address` | String | ERC-20 contract address on Base |

### Trades Collection

| Field Group | Key Fields | Notes |
|---|---|---|
| Identity | `onchain_escrow_id`, `listing_id`, `maker_address`, `taker_address` | `onchain_escrow_id` = source of truth |
| Financials | `crypto_amount`, `exchange_rate`, `total_decayed` | `total_decayed` = running sum of `BleedingDecayed` events |
| State | `status` | Mirrors on-chain state machine |
| Timers | `locked_at`, `paid_at`, `challenged_at`, `resolved_at`, `last_decay_at` | `last_decay_at` = last `BleedingDecayed` event |
| Evidence | `ipfs_receipt_hash`, `receipt_timestamp` | IPFS hash of payment receipt |
| Cancel Proposal | `proposed_by`, `maker_signed`, `taker_signed`, signatures | EIP-712 signatures |
| Chargeback Ack | `acknowledged`, `acknowledged_by`, `acknowledged_at`, `ip_hash` | `ip_hash = SHA-256(IP)` |
| Tier | `tier` (0–4) | On-chain tier at trade creation |

---

## 11. Treasury Model

| Revenue Source | Rate | Condition |
|---|---|---|
| Success fee | 0.2% (0.1% × 2 parties) | Every `RESOLVED` trade |
| Taker bond decay | 42 BPS / hour | `CHALLENGED` + Bleeding phase |
| Maker bond decay | 26 BPS / hour | `CHALLENGED` + Bleeding phase |
| USDT decay | 34 BPS / hour × 2 parties | After Hour 96 of Bleeding |
| BURNED outcome | 100% of remaining funds | No settlement after 240 hours |

---

## 12. Attack Vectors & Known Limitations

| Attack | Risk | Mitigation | Status |
|---|---|---|---|
| Fake receipt upload | High | Challenge bond penalty — decay cost > potential gain | ⚠️ Partial |
| Seller griefing | Medium | Asymmetric decay: challenge-opener loses faster | ✅ Addressed |
| Chargeback (TRY reversal) | Medium | Chargeback ack log + IP hash evidence | ⚠️ Partial |
| Sybil reputation farming | Low | Wallet age + dust limit + counterparty weighting | ✅ Addressed |
| Challenge spam (Tier 0/1) | High | 24h cooldown + dust limit + wallet age | ✅ Addressed |
| Self-trading | High | `msg.sender ≠ maker` on-chain | ✅ Addressed |
| Unilateral cancel griefing | High | 2/2 EIP-712 — unilateral cancel impossible | ✅ Addressed |
| Backend key theft | Critical | Zero private key — relayer only | ✅ Addressed |
| JWT hijacking | High | 15-min expiry + trade-scoped PII tokens | ✅ Addressed |
| PII data leak | Critical | AES-256-GCM + HKDF + rate limit (3 / 10 min) | ✅ Addressed |

---

## 13. Finalized Protocol Parameters

All values are deployed as Solidity `public constant` — **cannot be altered by the backend.**

| Parameter | Value | Contract Constant |
|---|---|---|
| Network | Base (Chain ID 8453) | — |
| Protocol fee | 0.2% (0.1% × 2 parties) | `TAKER_FEE_BPS = 10`, `MAKER_FEE_BPS = 10` |
| Grace period | 48 hours | `GRACE_PERIOD` |
| USDT decay start | 96h after Bleeding (Hour 144 from challenge) | `USDT_DECAY_START` |
| Max bleeding duration | 240 hours → BURN | `MAX_BLEEDING` |
| Taker bond decay | 42 BPS / hour | `TAKER_BOND_DECAY_BPS_H` |
| Maker bond decay | 26 BPS / hour | `MAKER_BOND_DECAY_BPS_H` |
| USDT decay | 34 BPS / hour × 2 | `CRYPTO_DECAY_BPS_H` |
| Wallet age minimum | 7 days | `WALLET_AGE_MIN` |
| Tier 0 / 1 cooldown | 24 hours / trade | `TIER0_TRADE_COOLDOWN`, `TIER1_TRADE_COOLDOWN` |
| Challenge cooldown | 1 hour after PAID | `CHALLENGE_COOLDOWN` |
| Dust limit | 0.001 ETH (~$2 on Base) | `DUST_LIMIT` |
| Good rep discount | −1% | `GOOD_REP_DISCOUNT_BPS = 100` |
| Bad rep penalty | +3% | `BAD_REP_PENALTY_BPS = 300` |
| Ban trigger | 2+ failed disputes | `_updateReputation()` |
| 1st ban duration | 30 days | Escalating: `30 × 2^(N−1)` days |
| Max ban duration | 365 days | Cap enforced in contract |

---

## 14. Future Evolution Path

| Phase | Scope | Timeline | Description |
|---|---|---|---|
| **Phase 1 (Current)** | Web2.5 Hybrid | Live | On-chain escrow + state. Off-chain PII + orderbook. |
| **Phase 2** | ZK IBAN Verification | 2–3 years | Prove "TRY sent to correct IBAN" without revealing it on-chain. |
| **Phase 3** | On-Chain Orderbook | Optional | The Graph Protocol subgraph. Migrate when cost-effective vs MongoDB. |
| **Phase 4** | Multi-Currency | Post Phase 2 | Extend fiat support. Requires ZK layer for payment verification. |

### Why Hybrid is Honest

**What we decentralize (the critical parts):**
- ✅ Custody of funds
- ✅ Dispute resolution
- ✅ Reputation integrity
- ✅ Anti-Sybil enforcement

**What we centralize (privacy / performance):**
- ⚠️ PII storage — GDPR requires deletion capability
- ⚠️ Orderbook indexing — sub-second queries for UX

**Backend NEVER controls:**
- ❌ Fund custody | ❌ Dispute outcomes | ❌ Reputation scores | ❌ Trade state transitions

---

*Araf Protocol — "The system does not judge. It makes dishonesty expensive."*
