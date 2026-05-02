# ⏳ Araf Protocol / P2P Escrow (V3)
**"Trust the Time, Not the Oracle. / Zamana Güven, Hakeme Değil."**

[![Version: 3.x architecture](https://img.shields.io/badge/Architecture-V3_Order--First-blue.svg)]()
[![Network: Base L2](https://img.shields.io/badge/Network-Base-blueviolet.svg)]()
[![Model: Web 2.5](https://img.shields.io/badge/Model-Web_2.5-orange.svg)]()

---

## 🌍 Language / Dil Selection
- [English](#-english)
- [Türkçe](#-türkçe)

---

## 🇬🇧 English

Araf is a **non-custodial, oracle-free, humanless** fiat ↔ crypto protocol.

Araf does not act as a court, oracle, moderator, or backend arbitrator. It does not prove off-chain fiat truth. It prices delay, disagreement, and dishonest strategy so unresolved trades become economically costly.

### Canonical V3 model
- **Parent Order** is the public market primitive.
- **Child Trade** is the real escrow lifecycle.
- **ArafEscrow.sol** is the only authoritative state machine.
- Backend is a **mirror + coordination** layer (not authority).
- Frontend is a **UX guardrail + contract access** layer (not authority).

### Core interaction surface (contract)
- Order layer: `create/fill/cancel` for sell and buy orders
- Child-trade lifecycle: `reportPayment`, `releaseFunds`, `challengeTrade`, `autoRelease`, `burnExpired`, `proposeOrApproveCancel`
- Governance surface (owner): `setTreasury`, `setFeeConfig`, `setCooldownConfig`, `setTokenConfig`, `pause/unpause`

### Important protocol truths
- Role mapping is side-dependent (not universally maker=seller):
  - `SELL_CRYPTO`: owner→maker, filler→taker
  - `BUY_CRYPTO`: owner→taker, filler→maker
- Fee/cooldown values are **mutable runtime config**, not hard-fixed constants.
- `setFeeConfig` is bounded by on-chain economic cap: max **2000 bps** per side.
- Active trade economics are protected by fee snapshots.
- Reputation clean-slate period is **90 days**; `decayReputation` is not a full amnesty.
- Supported payout rails are constrained to **TR_IBAN, US_ACH, SEPA_IBAN**.
- Token permissions are direction-aware: `supported`, `allowSellOrders`, `allowBuyOrders`.

### Legacy note
Legacy listing-first / `createEscrow` / `lockEscrow` narratives are **no longer canonical architecture**.

---

## 🇹🇷 Türkçe

Araf, fiat ↔ kripto takası için **emanet tutmayan, oracle-bağımsız, insansız** bir protokoldür.

Araf mahkeme, oracle, moderatör veya backend hakemi değildir. Off-chain fiat gerçeğini ispatlamaz. Gecikmeyi, anlaşmazlığı ve kötü stratejiyi fiyatlandırır; çözülemeyen trade'leri ekonomik olarak maliyetli hale getirir.

### Kanonik V3 model
- **Parent Order** kamusal pazar primitive’idir.
- **Child Trade** gerçek escrow yaşam döngüsüdür.
- Tek authoritative state machine: **ArafEscrow.sol**
- Backend: **mirror + koordinasyon** katmanı (authority değildir)
- Frontend: **UX guardrail + contract access** katmanı (authority değildir)

### Temel etkileşim yüzeyi (kontrat)
- Order katmanı: sell ve buy için `create/fill/cancel`
- Child-trade lifecycle: `reportPayment`, `releaseFunds`, `challengeTrade`, `autoRelease`, `burnExpired`, `proposeOrApproveCancel`
- Governance yüzeyi (owner): `setTreasury`, `setFeeConfig`, `setCooldownConfig`, `setTokenConfig`, `pause/unpause`

### Kritik gerçekler
- Rol eşleşmesi side-dependent’tir (genel maker=seller kuralı yoktur):
  - `SELL_CRYPTO`: owner→maker, filler→taker
  - `BUY_CRYPTO`: owner→taker, filler→maker
- Fee/cooldown değerleri **mutable runtime config**’tir; sabit değildir.
- `setFeeConfig` on-chain ekonomik tavan ile sınırlıdır: taraf başına en fazla **2000 bps**.
- Aktif trade economics fee snapshot ile korunur.
- Reputation clean-slate süresi **90 gün**dür; `decayReputation` tam af değildir.
- Desteklenen payout rail seti **TR_IBAN, US_ACH, SEPA_IBAN** ile sınırlıdır.
- Token izinleri direction-aware’dir: `supported`, `allowSellOrders`, `allowBuyOrders`.

### Legacy not
Listing-first / `createEscrow` / `lockEscrow` anlatısı artık **kanonik mimari** değildir.

---


## 🎁 Proof of Peace Rewards (Concise)
- Rewards are **not trade cashback**; they are a pro-rata peace premium.
- Eligibility is generated only from **ArafEscrow terminal outcomes**.
- Fast clean release receives the strongest positive weight.
- Partial settlement receives low positive weight because it de-escalates dispute without making dispute farming attractive.
- Backend is mirror-only; admin/sponsor cannot choose recipients, weights, or multipliers.
- `paymentRiskLevel` is not a reward multiplier.
- MVP zero-weight outcomes: auto-release, burn, mutual cancel, disputed release.
- MVP Tier 0 is not reward eligible.
- `rewardBps` starts at 4000 and is bounded to 4000–7000.

**Canonical reward thesis:** Proof of Peace makes fast clean resolution more valuable than delay, while Bleeding Escrow makes unresolved conflict expensive.

Rollout docs:
- TR: [docs/TR/REWARDS_ROLLOUT.md](./docs/TR/REWARDS_ROLLOUT.md)
- EN: [docs/EN/REWARDS_ROLLOUT.md](./docs/EN/REWARDS_ROLLOUT.md)
- Mainnet checklist (TR): [docs/TR/MAINNET_READINESS_CHECKLIST.md](./docs/TR/MAINNET_READINESS_CHECKLIST.md)

---

## 📖 Documentation
- Canonical Architecture:
  - [docs/EN/ARCHITECTURE.md](./docs/EN/ARCHITECTURE.md)
  - [docs/TR/ARCHITECTURE.md](./docs/TR/ARCHITECTURE.md)
  - [docs/EN/ARCHITECTURE_INCENTIVES.md](./docs/EN/ARCHITECTURE_INCENTIVES.md)
  - [docs/TR/ARCHITECTURE_INCENTIVES.md](./docs/TR/ARCHITECTURE_INCENTIVES.md)
- API Reference:
  - [docs/EN/API.md](./docs/EN/API.md)
  - [docs/TR/API.md](./docs/TR/API.md)
- Game Theory:
  - [docs/EN/GAME_THEORY.md](./docs/EN/GAME_THEORY.md)
  - [docs/TR/GAME_THEORY.md](./docs/TR/GAME_THEORY.md)

---
*Araf Protocol — “The system does not judge. It makes dishonesty expensive.”*
