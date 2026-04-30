# Backend File Audit — trades.js deep line-by-line review (12)

## 1. Scope
İncelenen ana dosya:
- backend/scripts/routes/trades.js

İlişkili dosyalar:
- backend/scripts/models/Trade.js
- backend/scripts/models/Order.js
- backend/scripts/models/User.js
- backend/scripts/middleware/auth.js
- backend/scripts/routes/pii.js
- backend/scripts/services/protocolConfig.js
- backend/scripts/services/eventListener.js
- contracts/src/ArafEscrow.sol
- frontend/src/App.jsx
- frontend/src/hooks/useArafContract.js
- frontend/src/components/SettlementPreviewModal.jsx
- frontend/src/components/SettlementProposalCard.jsx

İlişkili testler:
- backend/test/trades.cancelSignature.test.js
- backend/test/trades.settlementProposal.route.test.js
- backend/test/trades.offchainHealthScoreInput.route.test.js
- backend/test/sessionWalletGuard.routes.test.js
- backend/test/tradeRisk.readModel.test.js

## 2. Method
- `trades.js` tüm endpointleri auth/session/role/state/ID-parse akışı açısından satır bazlı takip edildi.
- Cancel EIP-712 doğrulama (domain, nonce, signer recovery) kontrat yüzeyi ile karşılaştırıldı.
- Settlement preview hesapları (pool/fee/payout) kontrattaki state ve frontend gösterimiyle hizalandı.
- PII/trust alanlarının projection + enrichment sırasında boundary ihlali üretip üretmediği değerlendirildi.
- İlişkili testlerin session mismatch, stale state, replay, preview fail-closed kapsamı kontrol edildi.

## 3. Function / Section Notes
- **Auth coverage**: Hassas trade endpointlerinin tamamında `requireAuth` + `requireSessionWalletMatch` var.
- **ID ayrımı**: `/by-escrow/:onchainId` child trade ID’sini, `/:id` Mongo ObjectId’yi kullanıyor; route sıralaması çakışmayı engelliyor.
- **Cancel signature verify**: `sigNonces(wallet, tradeId)` + domainSeparator eşleşmesi + `verifyTypedData` ile fail-closed doğrulama uygulanıyor.
- **Settlement preview**: Sadece `CHALLENGED` state’de ve on-chain `getCurrentAmounts` ile hesaplanıyor; response explicit informational/non-authoritative.
- **Trust boundary**: `offchain_health_score_input` ve `bank_profile_risk` read-only/non-blocking semantiğini taşıyor.
- **PII ayrımı**: trades route payout snapshot’ın hassas encrypted alanlarını açmıyor; PII çözümleme ayrı `pii.js` ve token-scoped gate’te.

## 4. Findings

| ID | Severity | Category | File / Function | Finding | Risk | Evidence | Suggested Action |
|---|---|---|---|---|---|---|---|
| B12-F01 | MEDIUM | data-consistency | backend/scripts/routes/trades.js (`SAFE_TRADE_PROJECTION`) | Projection listesinde `reputation_context_at_lock.disputed_but_resolved_count` alanı seçiliyor; modelde canonical alan `disputed_resolved_count`. | Naming drift nedeniyle explainability payload’larında boş/null alan veya farklı isimli çift semantik görülebilir. | Trade schema canonical isim `disputed_resolved_count`; projection’da legacy isim de geçiyor. | Projection ve helper katmanlarında tek canonical isim standardize edilmeli; backward-compat alias yalnız mapping katmanında tutulmalı. |
| B12-F02 | MEDIUM (uncertain) | stale-precheck | backend/scripts/routes/trades.js (`/propose-cancel`) | Cancel coordination’da backend state precheck (LOCKED/PAID/CHALLENGED) doğru fakat DB mirror gecikirse false-negative/false-positive kullanıcı deneyimi üretme riski var. | Kullanıcı backend’den 409 alıp kontratta aslında farklı state görebilir (ya da tersi). Authority ihlali değil, UX/ops drift riski. | Precheck DB `trade.status` üzerinden yapılıyor; authority yine kontratta. | Hata mesajına “on-chain state authoritative” yönlendirmesi eklenebilir; ops için mirror freshness metriği izlenmeli. |
| B12-F03 | LOW | info-leak | backend/scripts/routes/trades.js (`chargeback-ack`) | Idempotent ack durumunda `acknowledged_at` döndürülüyor. Bu veri hassas değil ama unauthorized probing’de zaman bilgisi çıkarımı yapılabilir. | Düşük düzey zaman korelasyonu/aktivite izi. | 409 response’da `acknowledged_at` alanı mevcut. | Bu alan yalnız taraflara döndüğü için risk düşük; yine de gerekirse coarse-grained timestamp veya message-only response tercih edilebilir. |
| B12-F04 | LOW | bigint-safety | backend/scripts/routes/trades.js (`_toBigIntStringSafe`) | BigInt parse helper invalid değerleri sessizce `"0"`’a çeviriyor. Şu an yalnız safe payload extraction için kullanılıyor, fakat ileride enforcement yolu yanlışlıkla bu helper’ı kullanırsa veri maskelenebilir. | Sessiz normalize, kalite/debug zorlaştırabilir. | Helper parse fail’de `"0"` dönüyor. | Enforcement olmayan kullanım alanı yorumla netleştirilmeli; mümkünse parse-fail telemetry eklenmeli. |
| B12-F05 | INFO | auth-session-boundary | trades routes + auth middleware | Hassas endpointlerde `requireAuth + requireSessionWalletMatch` birlikte uygulanmış; mismatch durumunda session invalidation yaklaşımı güçlü. | Pozitif not: session hijack/mismatch yüzeyi daraltılmış. | Route dizilimi ve auth middleware davranışı tutarlı. | Bu pattern yeni trade endpointlerinde zorunlu standart olarak korunmalı. |
| B12-F06 | INFO | contract-authority | settlement/cancel surfaces + frontend | Settlement preview ve cancel signature coordination backend’de economic authority üretmiyor; final karar kontrat çağrısında. Frontend kopyası da non-authoritative dili koruyor. | Pozitif not: oracle-free dispute modeli ve on-chain authority sınırı korunuyor. | Preview response bayrakları + modal/card metinleri + on-chain tx akışları. | Regression test seti (preview non-authoritative + cancel domain/nonce checks) genişletilerek sürdürülmeli. |

## 5. No-Finding Notes
- Trade ID parsing child trade ID semantiğiyle uyumlu; parent order ID ile karışmayı engelleyen route ayrımı net.
- Cancel signature payload bileşenleri (`tradeId`, `proposer`, `nonce`, `deadline`) ve domain doğrulaması EIP-712 güvenlik beklentisiyle uyumlu.
- Maker/taker role kontrolü hassas endpointlerde doğru uygulanmış (party-restricted access).
- Settlement preview hesabı BigInt ile yapılıyor; Number precision kaybı oluşmuyor.
- Error response’larda private key/PII/ham kripto materyali sızmıyor.

## 6. Cross-File Risks
- **Naming drift riski**: legacy/canonical reputation alan adları birlikte yaşadığı için helper/test/route katmanında semantik kayma oluşabilir.
- **Mirror freshness riski**: cancel/state precheck’ler DB mirror’a bağlı; worker gecikmelerinde kullanıcıya görünen durum kontrat anlık durumundan sapabilir.
- **Read-model authority algısı riski**: `offchain_health_score_input` alanı doğru işaretlenmiş olsa da tüketici katmanında yanlış yorumlanırsa davranışsal önyargı oluşturabilir.

## 7. Follow-up
Sonraki inceleme için önerilen dosyalar:
- backend/scripts/routes/tradeRisk.js (field naming canonicalization + drift guard)
- backend/scripts/services/eventListener.js (trade state freshness observability)
- backend/test/trades.* (replay/stale mirror senaryoları için ek regression)
- frontend trade room bileşenleri (non-authoritative labeling consistency)
