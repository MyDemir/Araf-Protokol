# 🌀 Araf Protocol — Plan File
## New Differentiators & Category-Creating Features

> This document is intentionally **separate from the canonical architecture**.  
> It is a **strategy and product planning file** focused on the question:  
> **“What can Araf add to become categorically different from the market?”**

---

## 1. Core Strategic Thesis

Araf should not aim to become “another escrow protocol with better wording.”

It should aim to become a **new escrow category**.

The current Araf core is already strong:
- non-custodial
- humanless
- oracle-independent
- time-decay dispute resolution
- on-chain state authority

But these properties alone do not yet guarantee a **category-defining moat**.

The real opportunity is to evolve Araf from a **generic humanless escrow** into a **risk-adaptive settlement machine**.

### Strategic conclusion

Araf should be positioned as:

> **The first rail-aware, humanless fiat escrow system.**

That means the protocol should not merely lock funds and apply one universal dispute logic.  
It should **adapt settlement rules to the actual payment rail and risk profile of the trade**.

---

## 2. Primary Differentiator: Rail-Aware Humanless Escrow

This should be Araf’s main market-defining feature.

### Concept

Different fiat payment rails do not carry the same risk profile.

For example:
- instant bank transfer is not the same as a delayed bank transfer
- a weekend-delayed settlement is not the same as a weekday instant settlement
- a high-reversal rail is not the same as a low-reversal rail
- a verified-name payment route is not the same as a loosely identified payment route

Yet most escrow systems either:
- treat them all the same, or
- rely on manual support/moderation to interpret them later

Araf can differentiate itself by doing neither.

### The category-creating move

Araf should model payment rail risk **inside protocol economics**, not in customer support policy.

That means:
- bond levels can vary by rail
- grace period can vary by rail
- challenge delay can vary by rail
- auto-release delay can vary by rail
- crypto decay start can vary by rail
- max ticket size can vary by rail
- name-match policy can vary by rail

### Why this matters

This would make Araf more than a neutral escrow engine.

It would become a **settlement physics engine**.

That is the strongest possible differentiator because it changes the category from:
- “escrow with no moderators”

into:
- “humanless escrow that understands payment risk structurally”

---

## 3. Settlement Profiles

The mechanism that enables the differentiator above should be called:

# **Settlement Profiles**

Each listing and each trade should bind to a profile that defines its economic and timing behavior.

### Suggested profile fields

- `paymentMethod`
- `reversibilityClass`
- `requiresNameMatch`
- `receiptProofMode`
- `makerBondMultiplier`
- `takerBondMultiplier`
- `gracePeriod`
- `challengeDelay`
- `autoReleaseDelay`
- `cryptoDecayStart`
- `maxTicketSize`
- `weekendExtensionPolicy`

### Product effect

This transforms Araf from a single settlement rule set into a **family of deterministic settlement policies**.

Instead of saying:
- “Araf escrow works like this.”

Araf can say:
- “Araf runs different escrow physics depending on the payment rail.”

This is extremely strong positioning.

### Strategic advantage

Competitors usually react to rail-specific risk through:
- moderators
- appeals
- support tickets
- manual evidence review

Araf would instead react through:
- deterministic policy selection
- pre-committed economics
- explicit risk profiles
- automated resolution boundaries

That is a much sharper identity.

---

## 4. Contract-Level Evolution Path

If Araf is to become rail-aware, the contract must evolve beyond a single global dispute physics model.

### Current limitation

The current design uses global constants for:
- bond structure
- timers
- decay start rules
- dispute timing assumptions

That is elegant, but too monolithic if the product is meant to scale across multiple payment rails.

### Planned evolution

Escrow creation should bind the trade to a profile.

Example direction:

```solidity
function createEscrow(
    address token,
    uint256 cryptoAmount,
    uint8 tier,
    bytes32 listingRef,
    uint16 profileId
) external returns (uint256 tradeId)
```

### What this enables

Once `profileId` is fixed at trade creation:
- bond math becomes profile-aware
- timer behavior becomes profile-aware
- dispute logic becomes rail-aware
- market differentiation becomes enforceable, not merely descriptive

### Strategic payoff

This is how Araf stops being just a protocol with a philosophy and becomes a protocol with **programmable settlement classes**.

---

## 5. Listing & Trade Layer Expansion

Araf’s backend and data models should eventually express the same reality that the contract enforces.

### Listing-side additions

Each listing should expose structured rail/risk metadata such as:
- `payment_method`
- `payment_profile_id`
- `risk_class`
- `name_match_policy`
- `receipt_policy`
- `weekend_policy`

### Trade-side additions

Each trade should snapshot the settlement assumptions at lock time, including:
- `settlement_profile_id`
- `payment_method`
- `reversibility_class`
- `requires_name_match`
- `proof_mode`
- `rail_risk_snapshot`

### Why snapshotting matters

Listings can change over time.

Trades cannot.

If the trade does not preserve the exact settlement assumptions it was created under, then the economic meaning of the trade becomes unstable.

### Strategic result

Araf should never let a live trade inherit mutable marketplace assumptions.  
It should freeze its settlement logic at creation time.

That is not just cleaner engineering. It is protocol integrity.

---

## 6. Example Settlement Profile Matrix

Araf should eventually ship with a small number of explicit profiles.

### Example matrix

| Profile | Rail Type | Risk | Maker Bond | Taker Bond | Grace | Crypto Decay Start | Notes |
|---|---|---:|---:|---:|---|---|---|
| `PROFILE_01` | Instant bank transfer | Low | 4% | 6% | 24h | 48h | fast settlement |
| `PROFILE_02` | Standard bank transfer | Medium | 6% | 8% | 48h | 96h | default mode |
| `PROFILE_03` | Weekend-delayed transfer | Medium/High | 7% | 10% | 72h | 120h | weekend tolerance |
| `PROFILE_04` | High reversal rail | High | 10% | 14% | 72h | 144h | chargeback-heavy class |
| `PROFILE_05` | Verified-name rail | Low | 5% | 7% | 36h | 72h | strict name-match |

### Why this is important

The point is not the exact numbers.

The point is to make the market understand that Araf is not a monolithic escrow.  
It is a **policy-engine escrow**.

This creates:
- stronger product clarity
- better user expectation-setting
- better risk pricing
- better alignment between protocol behavior and payment reality

---

## 7. Secondary Differentiator: Programmable Split Settlement

Today, most escrow systems conceptually force disputes into crude exits:
- full release
- full refund
- burn
- manual arbitration

Araf can create a new lane here.

### Concept

Introduce a **2/2 programmable split settlement** primitive.

Both sides can agree, on-chain, to a negotiated distribution of:
- escrowed crypto
- maker bond
- taker bond

### Example settlement proposal

A trade could settle as:
- 80% of escrowed crypto to Taker
- 20% of escrowed crypto back to Maker
- 60% of Maker bond returned
- 70% of Taker bond returned
- remainder goes to Treasury or burns according to policy

### Why this matters

Real disputes are often not binary.

Araf should not add human arbitration just to handle nuance.  
Instead, it can expand the **negotiation surface** while keeping the system humanless.

### Strong positioning statement

This would let Araf say:

> **Araf does not only resolve disputes without arbitrators.  
> It also enables negotiated settlement without arbitrators.**

That is a serious differentiator.

---

## 8. Third Differentiator: Delegated Liveness

Humanless systems do not just have a truth problem.  
They also have a liveness problem.

Users go offline. Phones die. Deadlines are missed.

### Concept

Add **delegated liveness** without delegated custody.

A user should be able to authorize one or more addresses or services to perform limited liveness actions such as:
- `pingMaker`
- `pingTakerForChallenge`
- `proposeCancel`
- possibly `autoRelease` under strict conditions

But never:
- release funds arbitrarily
- withdraw custody assets
- alter treasury logic
- alter governance

### Why this is powerful

This creates a new category of safety.

Most systems think only in terms of:
- custody
- dispute outcome
- fraud prevention

Araf can also optimize for:
- **deadline survivability**
- **availability resilience**
- **self-custodial continuity**

### Strong framing

> **Delegated custody is dangerous.  
> Delegated liveness is powerful.**

This is a subtle but very high-value differentiator.

---

## 9. Fourth Differentiator: Risk Passport

Araf’s current tier/reputation model is a strong base.  
But to create a true market edge, it should evolve into a richer risk identity layer.

### Concept

Move from a monolithic reputation score to a **multi-dimensional Risk Passport**.

### Suggested dimensions

- rail-specific success rate
- average response latency
- challenge frequency
- auto-release negligence count
- burned participation count
- cooperative settlement ratio
- high-risk rail completion count
- first-time counterparty success rate
- name-match violation history

### Why this matters

A single reputation number is too blunt.

Araf should eventually tell the market not only whether a wallet is “good,” but **what kind of risk it introduces**.

### Product outcome

Instead of saying:
- “This user is Tier 2.”

Araf could eventually say:
- “This wallet performs well on low-reversal bank rails, has low response latency, and shows strong cooperative settlement behavior.”

That is not cosmetic. That is a market quality layer.

---

## 10. Fifth Differentiator: Privacy-Preserving Name Match Assertions

Araf already understands that fiat settlement often requires some interaction with real-world identity signals.

But the long-term goal should not be “reveal more PII.”  
It should be “reveal less, prove more.”

### Concept

Instead of showing raw identity information whenever possible, Araf should move toward **assertion-based trust signals**.

Examples:
- `NAME_MATCH_CONFIRMED`
- `PAYMENT_ORIGIN_ASSERTED`
- `SIMILARITY_HIGH`
- `COUNTERPARTY_NAME_DISCLOSED = false`

### Why this matters

This lets Araf preserve the utility of real-world settlement checks without turning into a PII-heavy system.

### Strong market framing

This would allow Araf to evolve from:
- a protocol that reveals sensitive identity data when needed

into:
- a protocol that provides **privacy-preserving settlement assurances**

That is a much more future-proof direction.

---

## 11. What Araf Should Not Become

To differentiate clearly, Araf must also define what it refuses to become.

### Araf should not drift toward:
- manual moderation
- support-driven dispute overrides
- opaque release decisions
- generic copycat marketplace features
- human judgment disguised as “risk review”
- backend authority over final settlement outcomes

### Why this matters

These features may look practical in the short term, but they would erase Araf’s most valuable property:

> **Architectural honesty.**

If Araf becomes “Binance-style support, but smaller,” it loses the one thing that makes it intellectually and strategically distinct.

The goal is not to become a weaker version of a custodial marketplace.  
The goal is to become a stronger version of deterministic settlement.

---

## 12. Recommended Roadmap

If these differentiators are to be implemented coherently, they should be staged.

### Phase A — Category Definition
**Settlement Profiles / Rail-Aware Escrow**
- define the profile abstraction
- map payment rails to risk classes
- add listing/trade profile metadata
- design contract-level profile binding

### Phase B — Negotiation Primitive
**Programmable Split Settlement**
- introduce partial settlement proposal format
- make settlement terms 2/2 signable
- support non-binary dispute exits

### Phase C — Liveness Layer
**Delegated Liveness**
- define narrow delegation permissions
- add watchtower-compatible liveness actions
- preserve strict non-custodial boundaries

### Phase D — Intelligence Layer
**Risk Passport**
- enrich wallet behavior metrics
- classify address quality by behavior type, not only totals
- create better rail-aware market matching over time

### Final strategic message

Araf should aim to become:

> **The first rail-aware, humanless, non-custodial fiat escrow protocol.**

Not just a better escrow.  
Not just a stricter escrow.  
A new category of escrow.

---

## Closing Statement

The strongest version of Araf is not the one that tries to imitate existing P2P platforms with less staff.

It is the one that makes a new promise:

> **No moderators. No oracles. No fake certainty.  
> Only explicit risk, programmable settlement, and enforced economic boundaries.**

That is where category separation begins.
