# Backend File Audit — orders / listings / reference-rates routes (11)

## 1. Scope
İncelenen dosyalar:
- backend/scripts/routes/orders.js
- backend/scripts/routes/listings.js
- backend/scripts/routes/referenceRates.js

İlişkili dosyalar:
- backend/scripts/models/Order.js
- backend/scripts/models/Trade.js
- backend/scripts/services/protocolConfig.js
- backend/scripts/services/referenceTicker.js
- frontend/src/App.jsx
- frontend/src/app/orderUiModel.js
- frontend/src/app/fillAmountPolicy.js
- contracts/src/ArafEscrow.sol

İlişkili testler:
- backend/test/orders.config.test.js
- backend/test/orders.marketTrustVisibility.route.test.js
- backend/test/orderListing.sortSemantics.test.js
- backend/test/ordersTrades.paginationBigId.test.js
- backend/test/referenceRates.route.test.js
- backend/test/referenceTicker.nonAuthorityCoupling.test.js

## 2. Method
- Route query validation, projection ve response shaping kalıpları satır bazlı incelendi.
- Order/trade/model enum ve on-chain enum semantiği karşılaştırıldı.
- Pagination/sort düzeni (string ID lexicographic drift riski) route ve test seviyesinde doğrulandı.
- Reference ticker payload’ının authority sınırı ve enforcement yüzeylerinden izolasyonu kontrol edildi.
- Frontend order adapter/fill policy ile route payload uyumu gözden geçirildi.

## 3. Function / Section Notes
- **Sensitive projection disiplini**: `orders` route public feed için `SAFE_ORDER_PROJECTION` kullanıyor; trade-side PII/signed payload alanları public response’a girmiyor.
- **Big ID güvenliği**: `/:id` ve `/:id/trades` lookup’larında positive numeric string parse kullanılıyor; Number cast yapılmıyor.
- **Sort semantiği**: orders/listings route’larında `_id` tie-break kullanımı lexicographic `onchain_order_id` drift riskini azaltıyor.
- **Compatibility layer sınırı**: `listings` POST/DELETE 410 dönerek write authority’yi açık biçimde kontrat akışına itiyor.
- **Reference ticker contractı**: `/reference-rates/ticker` informationalOnly/nonAuthoritative/canAffectSettlement=false taşıyor.
- **Protocol config fail-closed**: config yüklenmemişse route 503 döndürüyor; backend fallback ekonomik kural üretmiyor.

## 4. Findings

| ID | Severity | Category | File / Function | Finding | Risk | Evidence | Suggested Action |
|---|---|---|---|---|---|---|---|
| B11-F01 | MEDIUM | privacy-minimization | backend/scripts/routes/orders.js (`SAFE_ORDER_PROJECTION`) | Public `/api/orders` çıktısı `refs.order_ref` döndürüyor. Bu alan ham kimlik olmasa da external correlation yüzeyini artırabilir ve gereksiz linkability doğurabilir. | Cross-surface correlation (analytics/log/scraper) ile maker davranış izi çıkarımı kolaylaşabilir. | Public projection listesinde `refs.order_ref` mevcut. | Public feed’de `order_ref` alanını default kapatıp sadece debug/admin surface’e taşımak değerlendirilmeli. |
| B11-F02 | MEDIUM (uncertain) | freshness/config-staleness | backend/scripts/services/protocolConfig.js + routes/orders.js,listings.js | Config Redis TTL ile cacheleniyor ve event-driven patch yapılıyor; fakat uzun süre event worker kopukluğu veya missed patch durumunda route config endpoint’leri stale parametre gösterebilir. | UI yanlış fee/cooldown/token-limit gösterebilir; kullanıcı deneyimi ve preflight hesapları sapabilir. | `getConfig()` read-model cache’den dönüyor, strict freshness attestation yok. | Response’a `loaded_at` freshness görünürlüğü ve max staleness guard (örn. warning bit) eklenmesi önerilir. |
| B11-F03 | LOW | query-hardening | backend/scripts/routes/orders.js + listings.js | Joi allowlist yaklaşımı güçlü; regex veya serbest query operator enjeksiyonu görünmüyor. Ancak `owner_address`/`token_address` için canonical lower-case normalize yapılıyor olsa da rate-limit + anomaly alert entegrasyonu görünür değil. | Aşırı parametre varyasyonu ile scrape/abuse maliyeti düşebilir (security değil, ops riski). | Query alanları sabit allowlist ve strict pattern. | Abuse telemetry (high-cardinality query pattern alarmı) eklenmesi önerilir. |
| B11-F04 | LOW | market-signal-correctness | backend/scripts/routes/orders.js (`_attachMarketTrustVisibilitySummary`) | Trust visibility özeti privacy-conscious ve compact; raw reason leak engellenmiş. Ancak sinyal “latest trade with lock/snapshot” üzerinden kurulduğu için maker özelindeki tarihsel skew durumlarında temsil gücü sınırlı olabilir. | Yanlış güven algısı (false calm/false concern) yaratabilir; authoritative değildir. | Aggregate pipeline tek latest trade seçiyor, compact summary dönüyor. | UI’da zaten bulunan “readOnly/nonBlocking” bayrakları korunmalı; ek olarak “sampled_from_latest_trade” gibi explainability meta eklenebilir. |
| B11-F05 | INFO | pagination-sort | orders/listings routes + tests | Big numeric string kimlikler Number’a çevrilmeden string olarak parse/lookup ediliyor; sort tie-break `_id` ile deterministic. | Pozitif not: lexicographic sort ve precision drift riski azaltılmış. | `ordersTrades.paginationBigId` + `orderListing.sortSemantics` testleri bunu doğruluyor. | Yeni route’larda da aynı parse+_id tie-break standardı zorunlu tutulmalı. |
| B11-F06 | INFO | authority-boundary | referenceRates route + referenceTicker + tests | Referans kur yüzeyi settlement authority üretmiyor; payload explicit non-authoritative. Enforcement surface’lerde reference ticker coupling regression testi var. | Pozitif not: oracle-free dispute modeli korunuyor. | `informationalOnly/nonAuthoritative/canAffectSettlement=false` + nonAuthority coupling testi. | Bu guard testi yeni enforcement modülleri eklendikçe genişletilmeli. |

## 5. No-Finding Notes
- Query filter injection/regex abuse açısından route’larda strict Joi validation deseni yeterli.
- Order status/side mapping backend model ve kontrat enumlarıyla hizalı (`OPEN/PARTIALLY_FILLED/FILLED/CANCELED`, `SELL_CRYPTO/BUY_CRYPTO`).
- Listings write-path’in deprecated (410) tutulması authority sızıntısını önlüyor.
- Frontend order UI adapter (`orderUiModel`, `fillAmountPolicy`) route payload semantiğiyle genel olarak uyumlu; min-fill kuralı fail-closed korunmuş.

## 6. Cross-File Risks
- **Config freshness riski**: protocol config stale görünürlüğü yetersizse UI karar desteği yanlış güncelik algısı yaratabilir.
- **Public correlation riski**: public order feed’de teknik referans alanlarının varlığı davranış korelasyonunu kolaylaştırabilir.
- **Trust summary yorum riski**: non-authoritative sinyalin kullanıcı tarafından ekonomik/settlement belirleyici sanılması UX katmanında yanlış anlamaya açık.

## 7. Follow-up
Sonraki inceleme için önerilen dosyalar:
- backend/scripts/routes/trades.js (benzer projection/minimization ve big-id lookup parity)
- backend/scripts/services/protocolConfig.js (freshness attestation & stale guard policy)
- frontend/src/app/useAppSessionData.js (config stale warning render davranışı)
- backend/test/* (public payload minimization + correlation surface regression testleri)
