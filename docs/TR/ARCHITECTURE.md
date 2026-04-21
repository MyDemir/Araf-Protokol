# Araf Protokolü — Kanonik Mimari & Teknik Referans (V3)

> Source of truth önceliği: `ArafEscrow.sol` > backend mirror katmanı > frontend UX katmanı > dokümantasyon.

Bu doküman, PR #52 ile getirilen doğru V3 çekirdeğini korur ve ayrıntılı teknik referans seviyesine geri genişletir.

---

## 1) Canonical architecture model

Araf artık listing-first değil, **order-first** mimaridedir:

- **Parent Order** = kamusal pazar/order katmanı
- **Child Trade** = gerçek escrow lifecycle (ekonomik state machine)
- **Contract** = tek authoritative state machine
- **Backend** = mirror + coordination + read layer
- **Frontend** = UX guardrail + contract access layer

### Authority sınırı
- On-chain state geçişleri yalnız kontratla belirlenir.
- Backend hiçbir trade/order state’ini “icat” etmez; event ve getter ile mirror eder.
- Frontend hiçbir ekonomik karar üretmez; yalnız tx gönderen ve event okuyan istemci katmanıdır.

### Legacy çerçevesi
`createEscrow/lockEscrow` ve listing-first söylemi V3 için kanonik değildir. Bu kavramlar yalnızca tarihsel bağlamda “legacy/non-canonical” olarak ele alınmalıdır.

---

## 2) On-chain public surface (ArafEscrow.sol)

## 2.1 Order write surface
- `createSellOrder(address token, uint256 totalAmount, uint256 minFillAmount, uint8 tier, bytes32 orderRef)`
- `fillSellOrder(uint256 orderId, uint256 fillAmount, bytes32 childListingRef)`
- `cancelSellOrder(uint256 orderId)`
- `createBuyOrder(address token, uint256 totalAmount, uint256 minFillAmount, uint8 tier, bytes32 orderRef)`
- `fillBuyOrder(uint256 orderId, uint256 fillAmount, bytes32 childListingRef)`
- `cancelBuyOrder(uint256 orderId)`

## 2.2 Child-trade (escrow lifecycle) write surface
- `reportPayment(uint256 tradeId, string ipfsHash)`
- `releaseFunds(uint256 tradeId)`
- `challengeTrade(uint256 tradeId)`
- `autoRelease(uint256 tradeId)`
- `burnExpired(uint256 tradeId)`
- `proposeOrApproveCancel(uint256 tradeId, uint256 deadline, bytes sig)`

## 2.3 Yardımcı/liveness write surface
- `registerWallet()`
- `pingMaker(uint256 tradeId)`
- `pingTakerForChallenge(uint256 tradeId)`
- `decayReputation(address wallet)`

## 2.4 Governance (owner-controlled mutable surface)
- `setTreasury(address)`
- `setFeeConfig(uint256 takerFeeBps, uint256 makerFeeBps)`
- `setCooldownConfig(uint256 tier0TradeCooldown, uint256 tier1TradeCooldown)`
- `setTokenConfig(address token, bool supported, bool allowSellOrders, bool allowBuyOrders)`
- `pause()` / `unpause()`

## 2.5 Kritik read surface
- `getOrder(orderId)`, `getTrade(tradeId)`, `getReputation(wallet)`
- `getFeeConfig()`, `getCooldownConfig()`, `getCurrentAmounts(tradeId)`
- `antiSybilCheck(wallet)`, `getCooldownRemaining(wallet)`, `getFirstSuccessfulTradeAt(wallet)`

---

## 3) Parent order vs child trade state modeli

## 3.1 Parent Order state machine
- `OPEN`
- `PARTIALLY_FILLED`
- `FILLED`
- `CANCELED`

Parent order, pazar erişim katmanıdır; escrow çözümleme mantığı child trade tarafında yürür.

## 3.2 Child Trade state machine (gerçek escrow)
- `OPEN` (V3 fill path’inde pratikte kullanılmıyor)
- `LOCKED`
- `PAID`
- `CHALLENGED`
- `RESOLVED`
- `CANCELED`
- `BURNED`

V3’te child trade, fill anında aynı tx içinde doğrudan `LOCKED` oluşturulur.

## 3.3 Child-trade authority linkage
V3’te child trade kimliği/bağlamı:
1. `OrderFilled(orderId, tradeId, filler, fillAmount, remainingAmount, childListingRef)`
2. `getTrade(tradeId)`

kombinasyonundan authoritative biçimde alınır.

---

## 4) Akışlar: Sell order ve Buy order

## 4.1 Sell order flow
1. Owner `createSellOrder` çağırır.
   - Token inventory + maker bond reserve upfront kontrata kilitlenir.
2. Counterparty `fillSellOrder` çağırır.
   - Filler için `_enforceTakerEntry` uygulanır.
   - Child trade `LOCKED` olarak doğar.
3. Taker `reportPayment` çağırır (`PAID`).
4. Maker `releaseFunds` ile çözer (`RESOLVED`) veya koşullara göre dispute/cancel path’e gider.

## 4.2 Buy order flow
1. Owner `createBuyOrder` çağırır.
   - Owner eventual taker olduğu için create aşamasında `_enforceTakerEntry` uygulanır.
   - Taker bond reserve upfront kilitlenir.
2. Counterparty `fillBuyOrder` çağırır.
   - Buy owner (taker) fill anında tekrar `_enforceTakerEntry` kontrolünden geçer.
   - Filler maker olur, owner taker olur.
   - Child trade `LOCKED` doğar.
3. Taker `reportPayment` çağırır.
4. Maker `releaseFunds` veya dispute/cancel yoluna gider.

---

## 5) Role mapping: owner/filler ↔ maker/taker

Mutlak “maker=seller, taker=buyer” kuralı yoktur; eşleşme side-dependent’tir:

- `SELL_CRYPTO`
  - order owner => maker
  - filler => taker
- `BUY_CRYPTO`
  - order owner => taker
  - filler => maker

Bu eşleşme, hem ekonomik dağıtım hem de anti-sybil gate noktasını belirler.

---

## 6) Anti-sybil enforcement semantiği

Kanonik enforcement helper: `_enforceTakerEntry(wallet, tier)`

Uyguladığı kapılar:
- `bannedUntil` aktif ban kontrolü
- cüzdan yaş eşiği (`WALLET_AGE_MIN`)
- native dust eşiği (`DUST_LIMIT`)
- tier bazlı cooldown (`tier0TradeCooldown`, `tier1TradeCooldown`; tier2+ yok)

### V3 uygulama noktaları
- `fillSellOrder`: filler/taker girişi
- `createBuyOrder`: owner/eventual taker ön kapısı
- `fillBuyOrder`: owner/taker için yeniden kontrol

Dolayısıyla anti-sybil modeli lockEscrow merkezli legacy değil, V3 child-trade entry merkezlidir.

---

## 7) Dispute sistemi (Bleeding Escrow)

Child trade `PAID` sonrası üç temel çözüm hattı vardır:

1. **Normal çözüm:** maker `releaseFunds`
2. **Dispute hattı:** maker `pingTakerForChallenge` → bekleme → `challengeTrade`
3. **Liveness hattı:** taker `pingMaker` → bekleme → `autoRelease`

### Bleeding mekanizması
- `CHALLENGED` state’inde zamanla maker bond, taker bond ve (eşik sonrası) crypto tarafında decay hesaplanır.
- `getCurrentAmounts` anlık ekonomik durumu verir.
- `burnExpired`, `MAX_BLEEDING` dolduğunda kalanları treasury’ye yakar/aktarır.

### Mutual cancel
- `proposeOrApproveCancel` ile iki taraf EIP-712 imza iradesi sunar.
- Her iki taraf onayı tamamlanınca `_executeCancel` çalışır.
- State’e göre ücret/refund dağıtımı farklılaşır; kontrat içi kurala bağlıdır.

---

## 8) Reputation, ban, clean-slate

Reputation mapping alanları:
- `successfulTrades`
- `failedDisputes`
- `bannedUntil`
- `consecutiveBans`

### Ban/Tier etkisi
- Başarısız dispute birikimi ban escalation üretir.
- Tier ceiling cezası (`hasTierPenalty`, `maxAllowedTier`) devreye girebilir.

### Clean-slate davranışı
- `decayReputation(wallet)` için clean period zorunlu.
- Güncel clean period: **90 gün** (`REPUTATION_DECAY_CLEAN_PERIOD = 90 days`).
- Bu mekanizma tam af değildir:
  - `consecutiveBans` resetlenebilir,
  - `hasTierPenalty` kaldırılabilir,
  - fakat `failedDisputes` geçmişi silinmez.

---

## 9) Treasury, fee modeli, mutable config

## 9.1 Immutable/public constant sınıfı
- tier max amounts (`TIER_MAX_AMOUNT_TIER0..3`)
- decay rates (`TAKER_BOND_DECAY_BPS_H`, `MAKER_BOND_DECAY_BPS_H`, `CRYPTO_DECAY_BPS_H`)
- `WALLET_AGE_MIN`, `DUST_LIMIT`, `MAX_BLEEDING`
- `MIN_ACTIVE_PERIOD`, `AUTO_RELEASE_PENALTY_BPS`, `MAX_CANCEL_DEADLINE`
- `GOOD_REP_DISCOUNT_BPS`, `BAD_REP_PENALTY_BPS`

## 9.2 Mutable runtime config sınıfı
- `takerFeeBps`
- `makerFeeBps`
- `tier0TradeCooldown`
- `tier1TradeCooldown`

### Fee snapshot koruması
- Fee snapshot order oluşturulurken alınır.
- Child trade bu snapshot’ı taşır.
- Sonradan `setFeeConfig` çağrısı aktif trade economics’ini geriye dönük değiştirmez.

---

## 10) TokenConfig: direction-aware token support

Token yönetimi tek bool yerine yön-bilinçli yapıdadır:
- `supported`
- `allowSellOrders`
- `allowBuyOrders`

Bu sayede bir token global olarak açık olup sadece belirli order yönünde kullanılabilir.
Eski `supportedTokens/setSupportedToken` dili V3 için stale’dir.

---

## 11) Backend mimarisi (authoritative olmayan katman)

`backend/scripts/app.js` ve route/service katmanlarının rolü:

- Oturum, rate-limit, PII güvenlik sınırı ve API orchestration.
- On-chain event’leri Mongo mirror’a yansıtma.
- Read endpoint’leri ile hızlı sorgu yüzeyi.

### Non-authoritative ilke
- Backend order/trade kural üretmez.
- Kontratın reddettiği akış backend ile geçerli kılınamaz.
- Mongo verisi canonical değil, mirror/read modeldir.

---

## 12) Event worker / replay / mirror reliability

`eventListener.js` tasarım ilkeleri:
- `ArafEscrow.sol` authority, worker mirror.
- Parent order ve child trade explicit kimliklerle tutulur (`orderId`, `tradeId`, `orderRef`).
- Child trade authority’si `OrderFilled + getTrade` üzerinden mirror edilir.

### Güvenilirlik katmanları
- Redis checkpoint (`worker:last_block`, `worker:last_safe_block`)
- retry + DLQ mekanizması
- block batch replay
- kimlik normalizasyonu (numeric id string disiplini)
- trade state regression korumaları

Bu yapı, reorg/yeniden-işleme/yarım güncelleme senaryolarında mirror tutarlılığını artırır.

---

## 13) Data model katmanı (User / Order / Trade)

## 13.1 Order modeli
- Parent order’ın on-chain alanlarını mirror eder.
- Remaining amount, reserve, fee snapshot backend’de hesaplanmaz; kontrattan yansıtılır.

## 13.2 Trade modeli
- Child trade merkezli kimlik: `onchain_escrow_id`.
- `parent_order_id`, `parent_order_side`, `fee_snapshot`, `financials`, `timers` mirror alanları.
- PII/dekont/snapshot alanları coordination amacıyla tutulur; authority değildir.

## 13.3 User modeli
- Payout profile AES-256-GCM şifreli tutulur.
- `reputation_cache`, `is_banned` gibi alanlar local cache/mirror niteliğindedir.
- Nihai enforcement kontrattaki reputation ve anti-sybil kapılarındadır.

---

## 14) Frontend mimarisi / contract hook / UX guardrails

`useArafContract.js` write yüzeyi order-first modelledir:
- sell/buy order create/fill/cancel
- child trade lifecycle write çağrıları
- EIP-712 cancel akışı

### Runtime guardrails
- chain doğrulaması
- escrow adres doğrulaması
- receipt/event decode
- fill sonrası `OrderFilled` event’inden `tradeId` çıkarımı

Frontend authoritative karar vermez; kontrat gerçekliğini güvenli biçimde kullanıcıya taşır.

---

## 15) Güvenlik mimarisi

- **Non-custodial:** kullanıcı fonlarına backend erişimi yok.
- **Pausable yönetim:** emergency’de yeni girişler durdurulabilir.
- **EIP-712 cancel:** imza/nonce/doğrulama kontrat içinde.
- **PII boundary:** trade-scoped token + session wallet eşleşmesi + no-store yanıt politikası.
- **Data minimization:** read route’larda hassas alanlar projection dışı tutulur.
- **Operational security:** health/readiness, scheduler lock’ları, graceful shutdown, cleanup job’ları.

---

## 16) Operasyonel notlar

- Startup akışında DB/Redis/worker/config yükleme sırası kritik.
- Readiness başarısızken trafik açılmamalıdır.
- DLQ birikimi ve replay metrikleri düzenli izlenmelidir.
- PII retention cleanup ve receipt cleanup job’ları devrede olmalıdır.

---

## 17) Deprecated / reframed legacy concepts

Aşağıdaki kavramlar artık kanonik model değildir:
- listing-first pazar primitive anlatısı
- `createEscrow/lockEscrow` canonical işlem akışı
- sabit fee/sabit cooldown varsayımı
- maker/taker için mutlak seller/buyer eşleşmesi
- tek boyutlu token support dili

Legacy referanslar yalnız tarihsel bağlam amacıyla kullanılmalı; canlı protokol davranışı için bu doküman ve kontrat gerçekliği esas alınmalıdır.
