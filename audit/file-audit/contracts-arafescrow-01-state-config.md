# File Audit — contracts/src/ArafEscrow.sol (State/Config Surface 01)

## 1. Scope
- Primary file (full read for requested sections): `contracts/src/ArafEscrow.sol`
  - imports
  - custom errors
  - constants
  - enums
  - structs
  - storage variables / mappings
  - constructor
  - token config setup
  - owner/admin config functions
  - pause/unpause surface
  - anti-sybil + tier config state variables
- Cross-check files:
  - `contracts/test/ArafEscrow.test.js`
  - `contracts/test/tokenDecimals.tierLimit.test.js`
  - `contracts/test/paymentRiskLevel.snapshot.test.js`
  - `frontend/src/hooks/useArafContract.js`
  - `backend/scripts/services/eventListener.js`

## 2. Method
- `ArafEscrow.sol` requested regions were read directly from top to bottom in code order.
- Then enum/order/event/getter tuple assumptions were compared against frontend inline ABI + backend worker ABI/event normalization.
- Test files were reviewed for coverage and assertion shape of token decimals, tier limit, and risk snapshot semantics.
- No grep-only conclusion: every finding below is tied to directly read code.

## 3. Function / Section Notes
- **Imports:** OZ stack is standard and coherent (`Ownable`, `Pausable`, `ReentrancyGuard`, `EIP712`, `SafeERC20`).
- **Custom errors:** Broad explicit error surface; gas-efficient.
- **Constants:** Fee/cooldown/reputation knobs clearly separated as immutable limits vs mutable runtime values.
- **Enums:**
  - `TradeState`: `OPEN=0..BURNED=6`
  - `OrderState`: `OPEN=0..CANCELED=3`
  - `PaymentRiskLevel`: `LOW=0, MEDIUM=1, HIGH=2, RESTRICTED=3`
  - `SettlementProposalState`, `TerminalOutcome`, `RevenueKind` present and ordered.
- **Structs:** `Trade`/`Order` include explicit snapshot fields for fee/risk/tier; good immutability boundary for live-config changes.
- **Storage + mappings:** Layout is straightforward; config variables (`takerFeeBps`, `makerFeeBps`, cooldowns, reputation policy/tier arrays) are globally mutable by owner.
- **Constructor:** Initializes treasury, fee/cooldown defaults, and reputation/tier policy defaults.
- **Token config setup (`setTokenConfig`)**:
  - validates token != zero, decimals in `[1..18]`, and non-zero tier limits for 4 tiers.
  - writes full token config in storage.
- **Owner/admin config:**
  - `setFeeConfig`, `setCooldownConfig`, `setTokenConfig`, `setReputationPolicy`, `setReputationTierThresholds`, `setTreasury` all `onlyOwner`.
  - fee is capped by uint16 and economic ceiling (`MAX_FEE_CONFIG_BPS=2000`).
- **Pause/unpause:** global pause exists but designed to stop only create/lock paths (per comments; runtime enforcement outside this review slice).
- **Anti-sybil/tier state:** registration time, trade cooldown, ban windows, risk point thresholds and tier thresholds are mutable via owner-level controls.

## 4. Findings
| ID | Severity | Category | File / Function | Finding | Risk | Evidence | Suggested Action |
|---|---|---|---|---|---|---|---|
| AES-STATE-001 | HIGH | deployment-env | `contracts/src/ArafEscrow.sol` / `setCooldownConfig`, `setReputationPolicy`, `setReputationTierThresholds`, `setTokenConfig`, `setFeeConfig`, `setTreasury` | Critical economic/sybil control plane is single-EOA `onlyOwner`; no timelock / staged activation in contract surface. | Owner key compromise or operator mistake can immediately weaken anti-sybil/cooldown/tier constraints, reroute treasury, or materially alter new-order economics. Mainnet governance centralization risk. | All listed functions are immediate `onlyOwner` mutators with direct state writes + emit, no delay/queue mechanism. | Move ownership to multisig + on-chain timelock controller before mainnet; enforce operational policy (min delay, change windows, config diff review). |
| AES-STATE-002 | MEDIUM | worker-mirror | `contracts/src/ArafEscrow.sol` / `TokenConfigUpdated` event | `TokenConfigUpdated` emits only flags (`supported`, `allowSellOrders`, `allowBuyOrders`), but omits `decimals` and `tierMaxAmountsBaseUnit` even though those fields are mutable and economically relevant. | Event-driven worker/UI caches can become stale or require extra RPC reads after config changes; increases drift risk under reorg/retry/failure scenarios. | `setTokenConfig` updates `cfg.decimals` and `cfg.tierMaxAmountsBaseUnit`, event payload excludes both. Backend file declares same 4-arg event signature. | Extend event payload with `decimals` + tier limits (ABI change) **or** mandate synchronous `getTokenConfig` refresh in all consumers after `TokenConfigUpdated` (documented invariant). |
| AES-STATE-003 | LOW | ABI-drift | `frontend/src/hooks/useArafContract.js` vs `backend/scripts/services/eventListener.js` vs `ArafEscrow` | Enum ordinal assumptions are currently lock-step but hardcoded in multiple places (trade/order/payment risk mappings). | Future enum insertion/reordering in contract can silently corrupt frontend/backend semantic decoding if not version-gated. | Frontend normalizers map numeric values explicitly; backend `_normalizeTradeState/_normalizeOrderState/_normalizePaymentRiskLevel` also hardcoded ordinals. | Introduce ABI/version sentinel check on startup (e.g., immutable contract version getter) and fail-fast if mismatch. |

## 5. No-Finding Notes
- Storage layout for reviewed section is coherent; no overlapping/manual slot tricks detected.
- Snapshot model is correctly present in `Trade` and `Order` (`takerFeeBpsSnapshot`, `makerFeeBpsSnapshot`, `paymentRiskLevelSnapshot/paymentRiskLevel`), reducing retroactive impact of config changes on existing positions.
- Token decimals bound (`1..18`) and per-tier max non-zero validation are enforced in `setTokenConfig`.
- Payment risk level snapshot path is covered by dedicated tests (`paymentRiskLevel.snapshot.test.js`).
- Frontend and backend ABI signatures for `getTrade/getOrder/getReputation` and major V3 events in this scope are aligned with contract signatures in this review.

## 6. Cross-File Risks
- **Config authority concentration:** Contract is authoritative (good), but mutable knobs are immediately owner-executable; cross-file consumers cannot mitigate malicious config transitions.
- **Event surface granularity:** Worker/frontend can track token direction toggles from events, but not full token economic config (`decimals`, tier limits) without extra reads.
- **Enum drift:** No drift now; risk is upgrade-time because two off-chain surfaces duplicate ordinal mappings.

## 7. Follow-up
1. Next slice in `ArafEscrow.sol`: paused modifiers/enforcement points on each state-changing function (verify comment vs actual gating).
2. Backend `protocolConfig` refresh paths: confirm `TokenConfigUpdated` triggers full `getTokenConfig` pull and atomic cache replacement.
3. Frontend write paths: verify tier/amount validation uses on-chain token config live reads, not stale local assumptions.
4. Governance/deployment files: validate owner is multisig/timelock in production scripts.

