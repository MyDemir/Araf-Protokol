# Backend File Audit — identity normalization migration + guard (08)

## 1. Scope
İncelenen dosyalar:
- backend/scripts/migrations/normalizeIdentityFields.js
- backend/scripts/services/identityNormalizationGuard.js

İlişkili dosyalar:
- backend/scripts/models/User.js
- backend/scripts/models/Order.js
- backend/scripts/models/Trade.js
- backend/scripts/routes/auth.js
- backend/scripts/routes/orders.js
- backend/scripts/routes/trades.js

İlişkili testler:
- backend/test/identityMigration.test.js
- backend/test/identityGuard.defaultMode.test.js
- backend/test/identityGuard.modeValidation.test.js
- backend/test/identityLookup.noExpr.test.js

## 2. Method
- Migration ve guard dosyaları satır bazında, fonksiyon fonksiyon okundu.
- Order/Trade/User şema identity alanları migration hedefleriyle karşılaştırıldı.
- Route lookup desenleri (`_parsePositiveOnchainId`, `_buildIdentityLookup`) ile normalize string identity kontratı karşılaştırıldı.
- Test dosyaları idempotency, mode safety ve `$expr` cleanup kapsamı açısından incelendi.

## 3. Function / Section Notes
- **Migration idempotency**: `buildBulkOps` normalized string ile eşitse update üretmiyor; tekrar çalıştırmada no-op davranışına uygun.
- **Chunked processing**: cursor + batch size ile bounded bellek kullanımı var; full collection materialization yok.
- **Collision preflight**: normalize sonrası aynı ID’ye düşecek kayıtlar migration’dan önce fail ediyor.
- **Guard modes**: `off|warn|enforce` dışı değerler explicit reject; silent downgrade yok.
- **Production default mode**: app bootstrap’ta production için enforce default olduğu testle doğrulanmış.
- **Identity lookup**: orders/trades route’ları numeric string parse edip direkt field equality kullanıyor; `$expr/$toString` fallback kaldırılmış.

## 4. Findings

| ID | Severity | Category | File / Function | Finding | Risk | Evidence | Suggested Action |
|---|---|---|---|---|---|---|---|
| B08-F01 | MEDIUM | state-machine | backend/scripts/migrations/normalizeIdentityFields.js::normalizeIdentityValue | Migration yalnız numeric BSON type kayıtları dönüştürüyor; string ama malformed legacy değerleri (`"001"`, `" 1 "`, `"1.0"` string vb.) migration kapsamında doğrudan ele alınmıyor. | Karışık string biçimleri kalırsa route parse/lookup ile read-model drift sürebilir. | findFilter `$type: NUMERIC_BSON_TYPES`; string alanlar migration update setine girmiyor. | İkinci faz string-canonicalization migration (trim/leading-zero policy) değerlendirilmeli. |
| B08-F02 | MEDIUM | data-model | backend/scripts/models/Order.js + Trade.js + migration | Şema `match: /^\d+$/` olsa da existing DB’de string-format drift (ör. leading zeros) unique collision üretebilir; preflight yalnız normalize edilmiş mantıksal çakışmayı numeric/string numeric üzerinden sayıyor. (uncertain) | Yanlış normalize edilmiş eski string’ler route lookup ve uniqueness davranışında sürpriz yaratabilir. | detectLogicalCollisions numeric/string numeric normalize ederek sayıyor; full string policy denetimi sınırlı. | Migration sonrası ek audit query ile non-canonical digit strings (leading zero, boşluk) raporlanmalı. |
| B08-F03 | LOW | testing-gap | backend/test/identityMigration.test.js | Testler temel normalize/idempotent/chunk/collision davranışını iyi kapsıyor; ancak malformed string legacy dataset (ör. `"001"`, `"+1"`, whitespace) için policy testleri yok. | Kenar veri setlerinde davranış belirsizliği CI’da görünmeyebilir. | Mevcut test matrisi çoğunlukla numeric ve decimal-zero normalizasyonuna odaklı. | String-canonical edge-case testleri eklenmeli. |
| B08-F04 | LOW | testing-gap | backend/test/identityLookup.noExpr.test.js | `$expr` removal testi source-string kontrolü yapıyor; runtime query plan/perf etkisini doğrudan ölçmüyor. | Refactor sonrası query performans regresyonu testte yakalanmayabilir. | `fs.readFileSync` ile string contains assertions. | Route-level integration/perf smoke testleri (explain stats) eklenmeli. |
| B08-F05 | INFO | deployment-env | identity guard default + mode validation | Guard default’un production’da `enforce` olması ve invalid mode reject davranışı fail-safe yönde güçlü. | Pozitif not: migration yarım kalırsa production boot’ta sessiz geçiş yerine durdurma mümkün. | `identityGuard.defaultMode` ve `modeValidation` testleri bu davranışı doğruluyor. | Bu fail-safe yaklaşım korunmalı. |

## 5. No-Finding Notes
- Migration chunked/batched stratejisi büyük koleksiyonlarda bellek güvenliği açısından doğru.
- Collision preflight fail-fast yaklaşımı yanlış kullanıcı eşleşmesi riskini azaltıyor.
- Parent order `0` değerinin null’a normalize edilmesi (allowZero+toNullOnZero) legacy semantics açısından bilinçli.
- Orders/Trades identity lookup’ta `$expr/$toString` kaldırılması query performansı için doğru yönde.
- Guard mode typo’larında reject edilmesi production güvenliği için olumlu.

## 6. Cross-File Risks
- **Migration coverage sınırı**: numeric BSON dönüşümü güçlü, fakat canonical olmayan string legacy değerler ayrı temizlik gerektirebilir.
- **Route strict parse bağımlılığı**: routes yalnız pozitif numeric string kabul ediyor; DB’de non-canonical string kalırsa erişim tutarsızlıkları görülebilir.
- **Half-migrated environment**: production enforce ile boot fail olur (güvenli), ancak operasyonel rollout’ta migration sequencing kritik.
- **Test realism gap**: bazı testler source-text düzeyi; runtime query plan/latency doğrulaması sınırlı.

## 7. Follow-up
Sonraki inceleme için önerilen dosyalar:
- backend/scripts/services/eventListener.js (identity write-path canonicalization doğrulaması)
- backend/scripts/routes/receipts.js ve backend/scripts/routes/pii.js (onchain id parse/lookup consistency)
- backend/scripts/jobs/* (legacy identity alanlarına dolaylı yazım riskleri)
- backend/test/* (string-canonical migration edge-case + route lookup integration)
