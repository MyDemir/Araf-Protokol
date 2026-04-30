# Backend File Audit — core Mongo models: User / Order / Trade (09)

## 1. Scope
İncelenen dosyalar:
- backend/scripts/models/User.js
- backend/scripts/models/Order.js
- backend/scripts/models/Trade.js

İlişkili dosyalar:
- backend/scripts/services/eventListener.js
- backend/scripts/routes/auth.js
- backend/scripts/routes/orders.js
- backend/scripts/routes/trades.js
- backend/scripts/routes/pii.js
- contracts/src/ArafEscrow.sol
- frontend/src/app/orderUiModel.js
- frontend/src/App.jsx

İlişkili testler:
- backend/test/ordersTrades.paginationBigId.test.js
- backend/test/orderListing.sortSemantics.test.js
- backend/test/orders.marketTrustVisibility.route.test.js
- backend/test/trades.settlementProposal.route.test.js
- backend/test/user.publicProfile.reputationBreakdown.test.js
- backend/test/tradeRisk.readModel.test.js

## 2. Method
- User/Order/Trade model dosyaları satır bazlı ve alan alan okundu.
- Event worker mapping semantiği (id normalize/state enum/risk snapshot) model alanlarıyla karşılaştırıldı.
- Orders/Trades/PII route projection + sort + lookup desenleri model indexleri ile çapraz değerlendirildi.
- Kontrat enum/struct semantiği ile backend model enum/alan isimleri hizası kontrol edildi.
- İlişkili testler BigId/sort/read-model drift risklerini ne kadar kapsadığı açısından incelendi.

## 3. Function / Section Notes
- **On-chain ID tipi**: `Order.onchain_order_id`, `Trade.onchain_escrow_id`, `Trade.parent_order_id` string tutuluyor; route parse fonksiyonları pozitif numeric string bekliyor.
- **BigInt taşıma**: Financial authority alanları (`crypto_amount`, `maker_bond`, `taker_bond`, `total_decayed`, settlement payouts/fees) string olarak saklanmış.
- **Number cache alanları**: `*_num` alanları mevcut ve read-model enrichment amaçlı; eventListener’da `_toSafeNum` overflow’da `null` döndürecek şekilde güvenli dönüşüm uygulanıyor.
- **Sort semantiği**: Routes tie-break için `_id` kullanıyor; lexicographic `onchain_*` sort drift’i bilinçli engellenmiş.
- **PII snapshot ayrımı**: `payout_snapshot` maker/taker ayrımı ve encrypted payload alanları ayrıştırılmış; response projection’larda bu alanlar minimize ediliyor.
- **Settlement proposal**: Trade schema’daki `settlement_proposal.state` enum’ı kontrat lifecycle’ı (NONE/PROPOSED/REJECTED/WITHDRAWN/EXPIRED/FINALIZED) ile uyumlu.
- **Reputation mirror**: User ve Trade snapshot alanlarında authority değil mirror olduğuna dair yorum/dokümantasyon açık.

## 4. Findings

| ID | Severity | Category | File / Function | Finding | Risk | Evidence | Suggested Action |
|---|---|---|---|---|---|---|---|
| B09-F01 | MEDIUM | accounting-math | backend/scripts/models/Order.js & Trade.js | Authority alanları string tutulsa da çok sayıda `*_num` Number cache alanı mevcut; bu alanların yanlışlıkla enforcement kararlarında kullanılması gelecekte precision/logic drift riski taşır. | Büyük değerlerde Number precision kaybı, yanlış sıralama veya yanlış threshold kararları üretilebilir (özellikle yeni route/feature eklerinde). | Modelde `*_num` alanları yaygın; eventListener sadece kısmen güvenli dönüşüm uyguluyor. | `*_num` alanlarının read-only analytics amaçlı olduğunu kod seviyesinde linter/contract-test ile garanti altına alınmalı. |
| B09-F02 | MEDIUM | data-model | backend/scripts/models/Trade.js | `onchain_escrow_id` unique+sparse; null/eksik dokümanlar birden fazla olabilir. Bu tasarım bilinçli olabilir ancak ingestion hatalarında “kimliksiz” trade birikimi riski var. (uncertain) | Kimliksiz mirror kayıtları query/projection katmanında gürültü ve operasyonel takip zorluğu yaratabilir. | `onchain_escrow_id` alanı `unique: true, sparse: true`, `required` değil. | Worker/write-path’te onchain_escrow_id zorunluluk kontrolleri ve orphan-trade izleme metriği eklenmeli. |
| B09-F03 | LOW | data-model | backend/scripts/models/Trade.js | `parent_order_id` regex `^\d+$` + default null; semantik doğru, ancak invalid string legacy kayıtları için ayrı DB-level constraint yok (Mongoose validation bypass senaryoları hariç). | Ham DB yazımları/manuel müdahaleler model kontratını bozabilir. | Şema seviyesinde match var, fakat DB native check constraint yok. | Ops tarafı için periodic integrity audit job düşünülebilir. |
| B09-F04 | LOW | testing-gap | backend/test/user.publicProfile.reputationBreakdown.test.js | Public profile testinde `disputed_but_resolved_count` kullanılıyor; modelde canonical alan `disputed_resolved_count`. Testin niyeti doğru ama alan adı drift sinyali var. | Gelecekte isimlendirme karmaşası explainability katmanında bug üretme riski taşır. | Test fixture’da canonical olmayan alan adı geçiyor. | Test fixture alan adları model canonical isimleriyle hizalanmalı. |
| B09-F05 | INFO | state-machine | contracts/src/ArafEscrow.sol + backend model/routes | TradeState/OrderState/SettlementProposalState semantiği backend model ve route katmanında tutarlı şekilde mirror ediliyor. | Pozitif not: enum drift riski düşük. | Kontrat enumları ve model route state stringleri hizalı. | Bu hizanın CI’da snapshot testleriyle korunması önerilir. |
| B09-F06 | INFO | performance | backend/routes + tests | Big ID lookup ve lexicographic sort riskleri için route düzeyinde parse + `_id` tie-break deseni uygulanmış ve testlenmiş. | Pozitif not: string id kaynaklı yanlış sıralama/lookup riski azaltılmış. | `ordersTrades.paginationBigId` ve `orderListing.sortSemantics` testleri mevcut. | Mevcut deseni koruyun; yeni query’lerde aynı yaklaşımı zorunlu kılın. |

## 5. No-Finding Notes
- On-chain identity alanlarının string tutulması BigInt güvenliği açısından doğru.
- Order/trade id karışıklığını azaltmak için route tarafında ayrı parse/lookup pathleri kullanılıyor (`order id` vs `escrow id`).
- Trade payout snapshot alanları maker/taker ayrımıyla düzgün bölünmüş.
- Settlement proposal read-model endpointleri informational-only/non-authoritative contractını açıkça taşıyor.
- User public profile allowlist yaklaşımı reputation breakdown ve PII sızıntısını engelliyor.

## 6. Cross-File Risks
- **Authority boundary riski**: `*_num` cache alanlarının ileride yanlış business logicte kullanılması en kritik model katmanı riski.
- **Sparse unique operasyonel riski**: `onchain_escrow_id` null kayıtlarının artması mirror kalite metrikleri gerektirir.
- **Naming drift riski**: reputation breakdown alan adlarında route/test/helper katmanları arasında terminoloji kayması oluşabiliyor.
- **Projection maintenance riski**: SAFE projections çok uzun; model alanı değişimlerinde projection güncelleme atlanırsa drift oluşabilir.

## 7. Follow-up
Sonraki inceleme için önerilen dosyalar:
- backend/scripts/routes/tradeRisk.js (reputation semantics naming consistency)
- backend/scripts/services/eventListener.js (write-path required field guarantees)
- backend/scripts/routes/listings.js (order model projection/sort parity)
- backend/test/* (model-field naming consistency + authority-boundary regression tests)
