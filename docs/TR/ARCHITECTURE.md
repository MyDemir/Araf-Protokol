# Araf Protokolü — Kanonik Mimari & Teknik Referans (V3 Order-First)

> Bu doküman, PR #52 ile doğru kurulan V3 çekirdeğini **korur** ve onu yeniden ayrıntılı teknik referans seviyesine genişletir.  
> Source-of-truth sırası: `ArafEscrow.sol` → backend mirror/read katmanı → frontend guardrail katmanı → dokümantasyon.

---

## 1) Executive canonical model

Araf V3’te pazar primitive’i artık listing değil, **parent order**’dır.

- **Parent Order** = kamusal market/order katmanı
- **Child Trade** = gerçek escrow lifecycle (ekonomik state machine)
- **Contract** = tek authoritative state machine
- **Backend** = mirror + coordination + operational read layer
- **Frontend** = UX guardrail + contract access layer

### 1.1 Otorite sınırları
- On-chain state transition ve ekonomik dağıtımın nihai belirleyicisi kontrattır.
- Backend “hakem” değildir; state üretmez, yalnızca mirror eder ve operasyonel koordinasyon sağlar.
- Frontend enforcement katmanı değildir; kullanıcıyı doğru akışa zorlayan guardrail katmanıdır.

### 1.2 V3’ün pratik sonucu
- Market yüzeyinde konuşulan nesne parent order’dır.
- Dispute, release, cancel, burn gibi escrow yaşam döngüsü child trade seviyesinde yürür.
- Kimlik doğrulamada authority: `OrderFilled + getTrade(tradeId)` kombinasyonu.

---

## 2) Hibrit mimari ve teknoloji stack

## 2.1 Neden hibrit tasarım?
Araf hem güvenlik hem operasyonel gereksinimleri birlikte taşır:
- **On-chain:** fon custody, state transition, ekonomik kurallar, reputasyon enforcement
- **Off-chain (Mongo):** read model, performans, PII ve operasyonel metadata
- **Redis:** checkpoint, readiness, rate limit, kısa ömürlü koordinasyon

Bu nedenle mimari “Web2.5” hibrittir: on-chain authority + off-chain operational acceleration.

## 2.2 Katman matrisi

| Katman | Ana sorumluluk | Authority seviyesi | Teknoloji |
|---|---|---|---|
| Contract | Escrow state machine, payout, dispute economics, governance controls | **Authoritative** | Solidity / Base |
| Backend API | Session, projection, coordination, PII güvenlik sınırı | Non-authoritative | Node.js + Express |
| Event Worker | Event mirror, replay, checkpoint/DLQ | Non-authoritative | ethers + Mongo + Redis |
| Mongo | Read model / operasyonel cache | Non-authoritative | MongoDB + Mongoose |
| Redis | Ephemeral coordination / safety signals | Non-authoritative | Redis |
| Frontend | Contract write/read orchestration + UX guardrails | Non-authoritative | React + Wagmi + viem |

## 2.3 Non-custodial backend modeli
- Backend kullanıcı fonlarını hareket ettiren custody anahtarı taşımaz.
- Backend, kontrat adına release/challenge/cancel sonucu “uyduramaz”.
- Backend’in güçlü olduğu yer: session/policy/PII access boundary ve operasyonel görünürlük.

---

## 3) On-chain public surface (ArafEscrow.sol)

## 3.1 Parent-order write surface
- `createSellOrder`
- `fillSellOrder`
- `cancelSellOrder`
- `createBuyOrder`
- `fillBuyOrder`
- `cancelBuyOrder`

## 3.2 Child-trade lifecycle write surface
- `reportPayment`
- `releaseFunds`
- `challengeTrade`
- `autoRelease`
- `burnExpired`
- `proposeOrApproveCancel`

## 3.3 Liveness / yardımcı write surface
- `registerWallet`
- `pingMaker`
- `pingTakerForChallenge`
- `decayReputation`

## 3.4 Governance / mutable admin surface
- `setTreasury`
- `setFeeConfig`
- `setCooldownConfig`
- `setTokenConfig`
- `pause` / `unpause`

## 3.5 Read surface
- `getOrder`, `getTrade`, `getReputation`
- `getFeeConfig`, `getCooldownConfig`
- `getCurrentAmounts`
- `antiSybilCheck`, `getCooldownRemaining`, `getFirstSuccessfulTradeAt`

---

## 4) Parent order vs child trade state modeli

## 4.1 Parent order state
- `OPEN`
- `PARTIALLY_FILLED`
- `FILLED`
- `CANCELED`

Parent order market görünürlüğünü taşır; escrow uyuşmazlığı çözmez.

## 4.2 Child trade state
- `OPEN` (V3 fill path’inde pratikte kullanılmıyor)
- `LOCKED`
- `PAID`
- `CHALLENGED`
- `RESOLVED`
- `CANCELED`
- `BURNED`

## 4.3 Fill anında child trade yaratımı
Hem `fillSellOrder` hem `fillBuyOrder` akışında child trade aynı tx içinde doğrudan `LOCKED` oluşur. Böylece eski create+lock zinciri yerine tek adımda escrow entry gerçekleşir.

## 4.4 Kimlik ilişkisi
- Parent order identity: `orderId`
- Child trade identity: `tradeId` (`onchain_escrow_id` mirror)
- Link authority: `OrderFilled(orderId, tradeId, ...)` + `getTrade(tradeId)`

---

## 5) Sell flow, Buy flow ve role mapping

## 5.1 Sell order flow
1. Owner `createSellOrder`
2. Filler `fillSellOrder` (taker gate uygulanır)
3. Child trade `LOCKED`
4. Taker `reportPayment`
5. Maker `releaseFunds` veya dispute/cancel yolları

## 5.2 Buy order flow
1. Owner `createBuyOrder` (owner eventual taker olduğu için gate create-time’da uygulanır)
2. Filler `fillBuyOrder`
3. Owner (taker) fill-time’da yeniden gate kontrolünden geçer
4. Child trade `LOCKED`
5. `reportPayment` → `releaseFunds` / dispute / cancel

## 5.3 Side-dependent role mapping
Mutlak “maker=seller, taker=buyer” yoktur:
- `SELL_CRYPTO`: owner→maker, filler→taker
- `BUY_CRYPTO`: owner→taker, filler→maker

---

## 6) Anti-sybil enforcement semantiği (V3)

Kanonik gate helper: `_enforceTakerEntry(wallet, tier)`

Gate bileşenleri:
- aktif ban kontrolü (`bannedUntil`)
- wallet age (`WALLET_AGE_MIN`)
- native balance dust eşiği (`DUST_LIMIT`)
- tier bazlı cooldown (`tier0TradeCooldown`, `tier1TradeCooldown`)

V3 uygulama noktaları:
- `fillSellOrder` (filler taker)
- `createBuyOrder` (owner eventual taker)
- `fillBuyOrder` (owner taker re-check)

Sonuç: anti-sybil enforcement lockEscrow-merkezli legacy değildir; V3 child-trade entry path merkezlidir.

---

## 7) Dispute/Bleeding Escrow teknik akışı

## 7.1 `PAID` sonrası çözüm yolları
- **Normal kapanış:** maker `releaseFunds`
- **Dispute hattı:** maker `pingTakerForChallenge` → bekleme → `challengeTrade`
- **Liveness hattı:** taker `pingMaker` → bekleme → `autoRelease`
- **Mutual cancel:** iki tarafın imzalı iradesiyle `proposeOrApproveCancel`
- **Terminal burn:** challenge sonrası süre dolunca `burnExpired`

## 7.2 Bleeding bileşenleri
- maker bond decay
- taker bond decay
- belirli eşik sonrası crypto side decay

`getCurrentAmounts(tradeId)`, o anki ekonomik bakiyeyi kanonik olarak çıkarır.

## 7.3 Challenge ve liveness ping semantiği
- Ping yolları birbirini dışlayan şekilde tasarlanır (conflicting path koruması).
- Bekleme pencereleri state-guard ile enforce edilir.

## 7.4 Burn semantiği
- `burnExpired` permissionless pattern’e yakındır: challenge süresi dolan state’i finalize eder.
- Kalan ekonomik değer treasury yönüne gider.

## 7.5 Cancel semantiği
- `proposeOrApproveCancel` EIP-712 imza + nonce + deadline disiplinini kontrat içinde doğrular.
- Her iki taraf imzası tamamlanmadan cancel finalize edilmez.

---

## 8) Reputation / bans / clean-slate

## 8.1 Reputation alanları
- `successfulTrades`
- `failedDisputes`
- `bannedUntil`
- `consecutiveBans`

## 8.2 Tier etkisi
- Başarı/başarısızlık geçmişi efektif tier’ı etkiler.
- Ceza sonrası tier ceiling (`maxAllowedTier`) devreye girebilir.
- `MIN_ACTIVE_PERIOD` tier progression’da zaman bileşeni uygular.

## 8.3 Clean-slate kuralı
- `decayReputation` clean period tamamlanınca çağrılabilir.
- Güncel clean period: **90 gün**.
- Bu tam af değildir; `failedDisputes` silinmez.

---

## 9) Finalized parameters ve mutable config ayrımı

## 9.0 Parametre sınıflandırma tablosu

| Sınıf | Parametreler | Not |
|---|---|---|
| Immutable/public constants | `TIER_MAX_AMOUNT_*`, `*_DECAY_BPS_H`, `WALLET_AGE_MIN`, `DUST_LIMIT`, `MAX_BLEEDING`, `MIN_ACTIVE_PERIOD`, `AUTO_RELEASE_PENALTY_BPS`, `MAX_CANCEL_DEADLINE`, `GOOD_REP_DISCOUNT_BPS`, `BAD_REP_PENALTY_BPS` | Runtime’da owner çağrısıyla değişmez. |
| Mutable runtime config | `takerFeeBps`, `makerFeeBps`, `tier0TradeCooldown`, `tier1TradeCooldown` | Owner governance surface ile değişebilir. |
| Direction-aware token runtime policy | `tokenConfigs[token] => {supported, allowSellOrders, allowBuyOrders}` | Token desteği yön-bilinçli yönetilir. |

## 9.1 Immutable/public constant sınıfı
- tier max amount seti (`TIER_MAX_AMOUNT_*`)
- decay sabitleri (`*_DECAY_BPS_H`)
- wallet age / dust / bleeding / active period limitleri
- auto release penalty
- max cancel deadline
- rep discount/penalty BPS

## 9.2 Mutable runtime config
- `takerFeeBps`
- `makerFeeBps`
- `tier0TradeCooldown`
- `tier1TradeCooldown`
- direction-aware token config (`setTokenConfig`)

## 9.3 Fee snapshot semantiği
- Snapshot order create anında alınır.
- Child trade, parent snapshot’ını taşır.
- Sonraki `setFeeConfig` aktif trade economics’ini geriye dönük değiştirmez.

## 9.4 Toolchain / deployment assumptions
- Kontrat deploy akışı `constructor(treasury)` + token direction config ile başlar.
- Deploy sonrası token yön politikası zincir üstünde `tokenConfigs(token)` ile doğrulanmalıdır.
- Production rehberinde owner key’in multisig altında tutulması governance risk azaltımı için varsayımdır.

---

## 10) Runtime bağlantı ve operasyon politikaları

## 10.1 Bootstrap sırası (backend)
1. Env ve güvenlik kontrolleri
2. Mongo bağlantısı
3. Redis bağlantısı
4. Worker init + protocol config load
5. Route mount
6. Health/readiness aktiflenmesi

## 10.2 Readiness-first yaklaşımı
- Liveness (`/health`) süreç ayakta mı sorusuna bakar.
- Readiness (`/ready`) bağımlılıkların gerçekten hazır olup olmadığını doğrular.
- Trafik açma kararı readiness’e göre verilmelidir.

## 10.3 Fail-fast / fail-open kararları
- Kritik bağımlılık kopuşlarında fail-fast yaklaşımı uygulanır (özellikle DB/worker bütünlüğü için).
- Güvenlik sınırında fail-open yerine fail-closed tercih edilir (ör. auth/session sınırları).

## 10.4 Timeout ve bağlantı politikaları
- Mongo tarafında `maxPoolSize`, `socketTimeoutMS`, `serverSelectionTimeoutMS` ayarları worker+API yükünü birlikte kaldıracak şekilde kullanılır.
- Mongo kopuşunda fail-fast yaklaşımıyla süreç yeniden başlatma tercih edilir (stale/yarım bağlantı drift’ini azaltmak için).
- Redis tarafında `isReady` sinyali `connected` durumundan ayrı ele alınır; middleware kararları buna göre verilir.
- Redis TLS (`rediss://`) ve managed servis senaryoları runtime config’te dikkate alınır.

## 10.5 Graceful shutdown sırası
- Yeni istekleri kes
- Worker’ı durdur
- scheduler interval/timeout’ları temizle
- Mongo/Redis bağlantılarını kapat
- süreçten kontrollü çık

## 10.6 Scheduler / cleanup jobs
- reputation decay tetikleyicileri
- stats snapshot
- receipt & PII retention cleanup
- user bank risk metadata cleanup
- DLQ processing

## 10.7 Health vs ready operasyonel anlamı
- `/health`: süreç ayakta mı? (process liveness)
- `/ready`: bağımlılıklar + config + worker lag + replay durumu güvenli mi? (traffic gate)
- Worker replay veya yüksek lag durumunda liveness true kalsa bile readiness false olabilir; bu bilinçli tasarım tercihidir.

---

## 11) Event worker / replay / mirror reliability

## 11.1 Worker state mantığı
Worker kontrat event’lerini consume eder, Mongo’yu authoritative olmadan günceller.

## 11.2 Checkpoint yaklaşımı
- son işlenen blok
- last safe checkpoint
- replay başlangıç güvenliği

## 11.3 Replay ve batch işleme
- bloklar batch halinde işlenir
- replay’de idempotent davranış hedeflenir
- state regression guard’larıyla geriye düşüş engellenir

## 11.3.1 Last-safe-block semantiği
- Worker yalnız son görülen blok değil, son güvenli checkpoint bloğunu da izler.
- Ready kararı, provider block yüksekliği ile worker safe checkpoint farkını (lag) hesaba katar.
- Bu yaklaşım “işleniyor gibi görünüp geride kalma” durumunu operasyonel olarak görünür kılar.

## 11.4 DLQ ve poison event görünürlüğü
- işlemeye alınamayan event’ler DLQ’ya taşınır
- tekrar deneme/backoff uygulanır
- operasyonel görünürlük için log/metric izi korunur

## 11.5 Kimlik normalizasyonu
- on-chain id alanları numeric-string disipliniyle tutulur
- parent order id ve child trade id karışmasını önleyen explicit lookup stratejisi uygulanır

## 11.6 OrderFilled + getTrade linkage
Child trade authority worker tarafında heuristik yerine explicit event+getter kombinasyonuyla mirror edilir.

## 11.7 Mirror authority uyarısı
- Event worker, protokol kuralı üretmez; yalnız authoritative zincir durumunu operasyonel modele taşır.
- Mongo’daki bir alan ile kontrat storage çelişirse otorite kontrattadır.

---

## 12) Güvenlik mimarisi ve trust boundaries

## 12.1 Auth modeli (SIWE + JWT)
- Nonce → SIWE imzası → verify
- JWT/refresh cookie tabanlı oturum
- session wallet authority korunur

## 12.2 Cookie-only auth ve session-wallet boundary
- Backend auth’da cookie wallet authoritative kaynaktır.
- `x-wallet-address` uyuşmazlığında session invalidate davranışı uygulanır.

## 12.2.1 Refresh token family invalidation
- Session mismatch veya logout durumlarında refresh token family revoke edilerek yeniden kullanım riski azaltılır.
- Böylece yalnız access token değil, token zinciri de geçersizlenir.

## 12.3 PII access token boundary
- Trade-scoped kısa ömürlü PII token
- Role + state + session eşleşmesi birlikte doğrulanır
- Hassas yanıtlar no-store/no-cache semantiğinde döndürülür

## 12.4 Şifreleme modeli
- AES-256-GCM envelope encryption
- HKDF/KMS-Vault tabanlı key yönetimi
- PII plaintext’in kalıcı depoda tutulmaması

## 12.5 Rate-limit sınıfları
- auth, market read, trade, PII, feedback, logs için ayrı limiter sınıfları
- abuse alanları endpoint semantiğine göre ayrıştırılır
- Hassas yüzeylerde (özellikle auth/PII) Redis yokken in-memory fallback koruması uygulanır.
- Genel/public yüzeylerde erişilebilirlik için kontrollü fail-open tercih edilen yerler bulunur.

## 12.6 Client error logging boundary
- Frontend hata telemetrisi kontrollü endpoint’e gider (`/api/logs/client-error`)
- Hassas veri sızıntısını azaltan scrub/noise politikaları önemlidir

## 12.7 Trust boundary özeti
- Contract: economic/state authority
- Backend: coordination + projection
- Frontend: guardrail UX
- Off-chain veri: operasyonel kolaylık, authority değil

---

## 13) Veri modelleri (Mongo read-model katmanı)

> Mongo canonical protocol authority değildir; ama yüksek performanslı read-model ve operasyonel observability için kritik katmandır.

## 13.1 User modeli

### Authoritative olmayan ama kritik alanlar
- `wallet_address` kimlik anahtarı
- `payout_profile` (rail/country/contact/details encrypted)
- `reputation_cache` (on-chain mirror amaçlı)
- ban mirror alanları
- `profileVersion`, `lastBankChangeAt`, `bankChangeCount7d`, `bankChangeCount30d`, `bank_change_history`

### Gizlilik ve güvenlik
- Şifreli payout alanları
- Public profile projection’da hassas alanların dışarıda bırakılması
- bank değişim metadata’sının risk sinyali olarak saklanması
- `toPublicProfile()` sadece allowlist alanları döndürür; PII sızıntı riski sınırlandırılır.

### Operasyonel not
- `profileVersion`, 7d/30d değişim sayaçları, lock-time snapshot kıyaslamaları için kullanılır.

## 13.2 Order modeli

### Kimlik ve state
- `onchain_order_id` (string id)
- owner, side, status, tier, token
- amount/reserve/fee snapshot alanları
- `refs.order_ref` ve order-level timer alanları
- `stats.*` alanları child-trade türevi read-model yardımcılarıdır

### Mirror sınırı
- Remaining amount ve reserve hesapları backend authority’si değildir; kontrat aynasıdır.

## 13.3 Trade modeli

### Kimlik ilişkisi
- child-trade kimliği: `onchain_escrow_id`
- parent bağ: `parent_order_id`
- parent side: `parent_order_side`

### Finansal alanlar
- BigInt-safe string alanları (`crypto_amount`, bond alanları, decayed totals)
- number cache alanları yalnız query/UI kolaylığı içindir
- `trade_origin`, `fill_metadata`, `fee_snapshot`, `canonical_refs` gibi alanlar linkage/forensics amaçlı tutulur

### PII / receipt / snapshot
- lock-time payout snapshot
- encrypted receipt payload + hash
- cancel proposal / chargeback ack audit alanları

### Retention
- terminal state sonrası TTL/cleanup stratejileri
- receipt ve snapshot cleanup işleriyle veri minimizasyonu
- trade belgesi için terminal durumlarda TTL, receipt/snapshot için ayrı retention alanları birlikte çalışır

## 13.4 Feedback / stats/snapshot katmanı
- Feedback modeli ürün geri bildirimi için ayrı operational yüzeydir.
- Daily/aggregated stats endpoint’leri operasyonel görünürlük sağlar, protocol authority üretmez.

---

## 14) Backend route surface ve coordination semantiği

## 14.1 Orders routes
- Parent order read/config yüzeyi
- Owner-scope child-trade listesi

## 14.2 Trades routes
- active/history/by-escrow kimlikli okuma
- cancel signature coordination
- chargeback ack audit surface

## 14.3 Auth routes
- nonce/verify/refresh/logout/me/profile
- session-wallet mismatch guard

## 14.4 PII routes
- `/my`, `taker-name`, request-token, trade-scoped retrieve
- snapshot-first ve role-bound access

## 14.5 Receipts routes
- file validation + encryption + hash
- yalnız taker + `LOCKED` state kabulü

## 14.6 Logs/stats/feedback
- client error logs
- protocol stats read surface
- feedback intake

---

## 15) Frontend UX guardrail katmanı

## 15.1 `useArafContract` rolü
- Contract write/read çağrı orkestrasyonu
- chain/address preflight guard’ları
- tx receipt takibi
- `OrderFilled` event decode ile tradeId çıkarımı

## 15.2 `usePII` rolü
- trade-scoped PII token akışı
- canonical API path çözümlemesi
- authenticated fetch entegrasyonu
- request race cancellation (AbortController)
- unmount sonrası hassas state temizliği

## 15.3 Session/auth UX guardrails
- auth me/refresh akışları
- session-wallet mismatch durumunda güvenli logout/recovery
- yanlış ağ/yanlış adres durumunda kullanıcıya fail-fast uyarı

## 15.4 Frontend enforcement sınırı
Frontend kontratın yerine geçmez; enforcement kontrattadır. Frontend yalnız doğru yolu kolaylaştırır, yanlış yolu erken yakalar.

---

## 16) Saldırı vektörleri ve bilinen sınırlamalar

## 16.1 Giderilmiş veya azaltılmış riskler
- legacy listing authority confusion
- hardcoded API path drift riskinin azaltılması
- session mismatch ile sessiz account confusion azaltımı
- PII erişiminde state/role/token üçlü sınırı

## 16.2 Kalan risk yüzeyi
- off-chain ödeme kanıtı semantik belirsizliği (fake receipt / chargeback gerçekliği)
- governance key risk surface (owner mutable config)
- backend mirror authority’nin yanlış yorumlanması riski
- frontend yanlış ağ/yanlış adres konfigurasyon riski
- operator dokümantasyon yanlış okuma riski

## 16.3 Bilinçli sınırlamalar
- Oracle-free model gereği fiat transferin “gerçekliği” kontrat içinde doğrulanmaz.
- Sistem oyun-teorik baskıyla yanlış davranışı pahalılaştırır; mutlak hakemlik iddiası yoktur.

---

## 17) Legacy concepts (historical / deprecated / non-canonical)

Aşağıdakiler canlı V3 mimarinin canonical yüzeyi değildir:
- createEscrow/lockEscrow merkezli anlatı
- listing-first market primitive
- fixed fee/fixed cooldown varsayımları
- maker=seller, taker=buyer mutlaklığı
- old single-dimension token support dili

Legacy içerik yalnız tarihsel bağlam için tutulmalı; operasyonel kararlar bu doküman + source-of-truth kod üzerinden verilmelidir.

---

## 18) Sonuç: bu dokümanın rolü

Bu metin iki rolü aynı anda taşır:
1. V3 canonical modelin kısa ve net çerçevesi
2. Ekip içi operasyonel/teknik referans (security, data model, runtime reliability, guardrails, attack surface)

Dolayısıyla doküman ne yalnız “özet”, ne de stale legacy metin kopyasıdır; güncel V3 gerçekliğe hizalanmış kapsamlı teknik referanstır.
