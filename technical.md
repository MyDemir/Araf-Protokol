
```markdown
# 🌀 Araf Protocol — Canonical Architecture Document

> **Version:** 1.1 (Final Integration)
> **Status:** Architecture Finalized — Awaiting Smart Contract Implementation
> **Network:** Base (Layer 2)
> **Last Updated:** 2026

---

## 📌 Table of Contents

1. [Vision & Core Philosophy](#1-vision--core-philosophy)
2. [System Participants](#2-system-participants)
3. [Tier & Bond System](#3-tier--bond-system)
4. [Anti-Sybil Shield](#4-anti-sybil-shield)
5. [Standard Trade Flow (Happy Path)](#5-standard-trade-flow-happy-path)
6. [Dispute System — Bleeding Escrow & Collaborative Cancel](#6-dispute-system--bleeding-escrow--collaborative-cancel)
7. [Reputation, Scoring & Penalties](#7-reputation-scoring--penalties)
8. [Treasury Model](#8-treasury-model)
9. [Attack Vectors & Known Limitations](#9-attack-vectors--known-limitations)
10. [Finalized Protocol Parameters](#10-finalized-protocol-parameters)

---

## 1. Vision & Core Philosophy

Araf Protocol is a **non-custodial, humanless, oracle-free** peer-to-peer escrow system enabling trustless exchange between fiat currency (TRY) and crypto assets (USDT).

### Core Principles

| Principle | Description |
|---|---|
| **Non-Custodial** | The platform never holds user funds. Everything is locked in transparent on-chain smart contracts. |
| **Oracle-Free** | The system has no access to bank data, external APIs, or real-world payment verification. |
| **Humanless** | No moderators, arbitrators, or jury systems. All resolution is automated by code and timers. |
| **MAD-Based Security** | Security relies on Mutually Assured Destruction game theory — dishonest behavior always results in financial loss. |
| **Code is Law** | Operational cost is zero. No customer service. No dispute moderators. |

---

## 2. System Participants

| Role | Label | Description |
|---|---|---|
| **Maker** (Satıcı) | Seller | Opens the listing. Locks USDT + collateral bond into the contract. |
| **Taker** (Alıcı) | Buyer | Sends fiat (TRY) off-chain. Triggers escrow release. |
| **Treasury** | Protocol | Receives burned/decayed funds from failed disputes to act as protocol revenue. |

---

## 3. Tier & Bond System

New users enter with minimal friction, solving the "Cold Start" problem, while high-volume actors carry proportional risk.

| Tier | Criteria | Trade Limit (TRY) | Maker Bond | Taker Bond | Min. Bond (USDT) |
|---|---|---|---|---|---|
| **Tier 1** | 0–3 Completed Trades | 250 – 2,500 ₺ | %18 | **%0** | 10 USDT (Maker only) |
| **Tier 2** | 3+ Successful Trades | 2,501 – 25,000 ₺ | %15 | %12 | 30 USDT |
| **Tier 3** | High-Volume Traders | 25,001 ₺ + | %10 | %8 | 100 USDT |

> **Note:** Tier 1 Taker's 0% bond is protected exclusively by the on-chain Anti-Sybil Shield to allow rapid user onboarding without sacrificing security.

### Bond Modifiers (Reputation-Based)

| Condition | Bond Adjustment |
|---|---|
| 0 failed disputes | **−3%** discount |
| 1 failed dispute | **+5%** penalty |

---

## 4. Anti-Sybil Shield

Three on-chain filters protect the system from bot networks and griefing attacks at zero cost.

```mermaid
graph LR
    A[Taker Buy Request] --> B{Wallet Age > 7 Days?}
    B -- No --> X((REVERT))
    B -- Yes --> C{Native Balance > Dust Limit?}
    C -- No --> X
    C -- Yes --> D{Trade in Last 24h? Cooldown}
    D -- Yes --> X
    D -- No --> E((LOCKED — Trade Starts))

```

| Filter | Rule | Purpose |
| --- | --- | --- |
| **Wallet Age** | > 7 days old | Blocks freshly created sybil wallets |
| **Dust Limit** | Must hold ~$2 in native gas token | Blocks zero-balance throwaway wallets |
| **Cooldown** | Max 1 trade per 24h (Tier 1) | Limits bot-scale spam attacks |

---

## 5. Standard Trade Flow (Happy Path)

```mermaid
graph TD
    A[START] -->|Maker locks USDT + Bond| B(OPEN — Listing Live)
    B -->|Taker passes Anti-Sybil + clicks Buy| C(LOCKED — Funds Secured)
    C -->|Taker sends TRY + uploads receipt hash to IPFS| D(PAID — Fiat Sent)
    D -.->|48-Hour Release Timer starts| D
    D -->|Maker confirms receipt + clicks Release| E((RESOLVED ✅))
    E --> F[USDT → Taker / Bonds returned / +1 Rep Score each]

```

### State Definitions

| State | Triggered By | Description |
| --- | --- | --- |
| `OPEN` | Maker | Listing is live. USDT + Maker bond locked. |
| `LOCKED` | Taker | Trade started. Taker bond locked. Anti-Sybil passed. |
| `PAID` | Taker | Fiat sent off-chain. IPFS receipt hash recorded on-chain. 48h timer starts. |
| `RESOLVED` | Maker or Contract | Successful close. Funds distributed. Reputation updated. |
| `CANCELED` | Collaborative | Trade voided via 2/2 multisig. USDT returns to Maker. Bonds fully refunded. |

---

## 6. Dispute System — Bleeding Escrow & Collaborative Cancel

This is the canonical dispute resolution model. It is **time-based, oracle-free, and psychologically coercive** by design. The contract cannot see the bank. Instead of pretending to judge, it makes dishonesty and stubbornness **mathematically expensive**.

### Full State Machine

```text
PAID
  │
  ├──[Maker clicks Release]──────────────────────────── RESOLVED ✅
  │
  └──[Maker clicks Challenge]
            │
          GRACE PERIOD (48h)
          ├── No financial penalty
          ├── Both parties negotiate off-chain
          │
          ├──[Collaborative Cancel (2/2 Signatures)]
          │    Maker "Propose Cancel" + Taker "Approve" ─── CANCELED 🔄
          │    (USDT returned to Maker, Bonds fully refunded)
          │
          ├──[Mutual Release]──────────────────────────── RESOLVED ✅
          │
          └──[No Agreement after 48h] (One party refuses/ignores)
                      │
                  BLEEDING ⏳
                  ├── Asymmetric daily decay begins
                  ├── Challenge-opener's bond decays 2× faster
                  │
                  ├──[Maker clicks Release]──────────────── RESOLVED ✅ (remaining funds)
                  ├──[Collaborative Cancel (2/2)]────────── CANCELED 🔄 (remaining funds)
                  └──[10 Days pass — No agreement]
                            │
                          BURNED 💀
                          (All remaining funds → Treasury)

```

### The Collaborative Cancel Mechanism 🤝

To prevent unilateral griefing or blackmail, cancellations **must** be agreed upon by both parties (2/2 signatures).

* If one party proposes a cancel and the other ignores or rejects it, the system enters/continues the Bleeding phase.
* No extra penalty is applied for rejecting a cancel, as entering the Bleeding phase itself is the punishment.

### Bleeding Decay Rates

| Asset | Challenge Opener | Other Party | Starts |
| --- | --- | --- | --- |
| **Bond** | **−20% / day** | −10% / day | Day 1 of Bleeding |
| **USDT** | −8% / day (shared) | −8% / day (shared) | **Day 3 of Bleeding** |

> **Why USDT starts on Day 3:** Grace period (48h) + 2 extra buffer days = ~5-day real pressure window before USDT begins decaying. This protects honest parties from immediate loss while still creating urgency.

### Seller Griefing — How the System Responds

`Scenario: Seller received TRY but opens challenge to delay/extract.`

* **Day 1–2:** Seller waits. Bond already down by 40%.
* **Day 3:** USDT starts decaying. TRY is in hand, but USDT is evaporating.
* **Day 4:** Rational exit point. Seller releases to save remaining USDT + bond.
* **Result:** Seller lost more bond (20%/day) than the Taker (10%/day). Griefing is mathematically unprofitable.

---

## 7. Reputation, Scoring & Penalties

Simple, wallet-native reputation. No tokens, no accounts, no complex levels.

### Update Logic

| Outcome | Winning Party | Losing Party |
| --- | --- | --- |
| Dispute-free close | +1 Successful | +1 Successful |
| Dispute → resolved | +1 Successful | +1 Failed |
| BURNED | +1 Failed | +1 Failed |

### The 30-Day Ban (Blacklist)

If a wallet accumulates **2 or more `failedDisputes**`, it receives an automatic **30-day suspension** from acting as a Taker.

* The user can still act as a Maker (since they lock a 15-18% bond, assuming full risk).
* After 30 days, the restriction is automatically lifted by the smart contract.

---

## 8. Treasury Model

Funds enter the treasury from two sources to act as **Protocol Revenue**:

| Source | Amount |
| --- | --- |
| Bleeding decay (bonds) | 10–20% per day from active bleeding escrows |
| Bleeding decay (USDT) | 8% per day from both parties (after Day 3) |
| BURNED outcomes | 100% of remaining funds |

*Treasury funds are securely held to fund future protocol operations, server costs, or community airdrops, rather than being permanently burned.*

---

## 9. Attack Vectors & Known Limitations

| Attack | Risk | Mitigation | Status |
| --- | --- | --- | --- |
| **Fake receipt upload** | High | IPFS hash = proof of upload, not payment. Challenge timer + bond risk discourages false claims. | ⚠️ Partial |
| **Seller griefing** | Medium | Asymmetric bond decay (2× faster for challenge opener) | ✅ Addressed |
| **Chargeback (bank reversal)** | Medium | Off-chain risk. Outside smart contract scope. Taker bears this risk. | ❌ Out of scope |
| **Sybil reputation farming** | Medium | Min. tx amount + cooldown slows coordination. Not fully preventable. | ⚠️ Partial |
| **Challenge timer spam (Tier 1)** | High | 24h cooldown + Dust filter + wallet age filter | ✅ Addressed |
| **Unilateral Cancel Griefing** | High | Collaborative Cancel (2/2 signatures required) | ✅ Addressed |

---

## 10. Finalized Protocol Parameters

The core design decisions have been finalized for the V1.0 Smart Contract deployment:

1. **Network:** **Base (Layer 2)** — Chosen for low gas fees, Ethereum-level security, and high USDT liquidity.
2. **Treasury Destination:** Protocol Revenue (Araf Treasury Contract).
3. **USDT Decay Split:** Symmetrical (8% / 8%) to ensure honest makers are not overly penalized for disputing scammers.
4. **Grace Period Length:** Strictly **48 Hours**. Longer periods dilute the psychological pressure of the Time-Decay mechanism.
5. **Blacklist Mechanism:** 30-Day time-limited ban (Taker-only restriction).

---

*Araf Protocol — "The system does not judge. It makes dishonesty expensive."*

```
