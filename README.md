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
- Active trade economics are protected by fee snapshots.
- Reputation clean-slate period is **90 days**; `decayReputation` is not a full amnesty.
- Token permissions are direction-aware: `supported`, `allowSellOrders`, `allowBuyOrders`.

### Legacy note
Legacy listing-first / `createEscrow` / `lockEscrow` narratives are **no longer canonical architecture**.

---

## 🇹🇷 Türkçe

Araf, fiat ↔ kripto takası için **emanet tutmayan, oracle-bağımsız, insansız** bir protokoldür.

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
- Aktif trade economics fee snapshot ile korunur.
- Reputation clean-slate süresi **90 gün**dür; `decayReputation` tam af değildir.
- Token izinleri direction-aware’dir: `supported`, `allowSellOrders`, `allowBuyOrders`.

### Legacy not
Listing-first / `createEscrow` / `lockEscrow` anlatısı artık **kanonik mimari** değildir.

---

## 📖 Documentation
- Canonical Architecture:
  - [docs/EN/ARCHITECTURE.md](./docs/EN/ARCHITECTURE.md)
  - [docs/TR/ARCHITECTURE.md](./docs/TR/ARCHITECTURE.md)
- API Reference:
  - [docs/EN/API.md](./docs/EN/API.md)
  - [docs/TR/API.md](./docs/TR/API.md)
- Game Theory:
  - [docs/EN/GAME_THEORY.md](./docs/EN/GAME_THEORY.md)

---
*Araf Protocol — “The system does not judge. It makes dishonesty expensive.”*
