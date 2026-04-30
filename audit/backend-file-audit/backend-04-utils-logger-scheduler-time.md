# Backend File Audit — utils/logger + schedulerSuccess + timeEnv (04)

## 1. Scope
İncelenen dosyalar:
- backend/scripts/utils/logger.js
- backend/scripts/utils/schedulerSuccess.js
- backend/scripts/utils/timeEnv.js

İlişkili testler:
- backend/test/scheduler.successContract.test.js
- backend/test/timeEnv.parser.test.js
- backend/test/scrubbers.test.js

## 2. Method
- Her utility dosyası baştan sona satır bazlı okundu.
- logger format/transports akışı, metadata stringify davranışı ve stack yazımı incelendi.
- schedulerSuccess dönüş kontratı app scheduler kullanım şekliyle (önceki incelemede görülen app.js çağrıları) eşleştirildi.
- timeEnv parser sınır değerleri Node timer limitleri bağlamında değerlendirildi.
- İlişkili testler edge-case kapsamı açısından satır bazında doğrulandı.

## 3. Function / Section Notes
- **logger.js**: Winston logger JSON+printf birleşimi kullanıyor; `meta` doğrudan `JSON.stringify(meta)` ile loglanıyor. Bu utility katmanında anahtar bazlı scrub yok.
- **logger.js**: `format.errors({ stack: true })` stack’i loga dahil ediyor; üretimde stack meta kaynaklı hassas veri taşıyabilir.
- **logger.js**: `LOG_DIR` env’siyle path override mümkün; path traversal değil ama yanlış operasyonel konfigürasyonda hassas lokasyona yazım riski var.
- **schedulerSuccess.js**: başarısızlık yalnız `false` veya `{ success:false }` ile ifade ediliyor; diğer tüm değerler success kabul ediliyor.
- **timeEnv.js**: positive integer + MAX_TIMER_MS üst sınırı doğru uygulanmış; 0/negatif/floating/NaN/Infinity fallback’e düşüyor.

## 4. Findings

| ID | Severity | Category | File / Function | Finding | Risk | Evidence | Suggested Action |
|---|---|---|---|---|---|---|---|
| B04-F01 | HIGH | PII-data-protection | backend/scripts/utils/logger.js (format.printf) | Logger `meta` objesini olduğu gibi `JSON.stringify` ile yazıyor; utility seviyesinde secret/token/PII scrub uygulanmıyor. | Uygulama katmanında yanlışlıkla `req.body`, token, cookie, private key veya provider credential meta’ya eklenirse log sızıntısı oluşur. | `metaString = Object.keys(meta).length ? JSON.stringify(meta) : ""` satırı doğrudan ham meta yazıyor. | Logger katmanında merkezi redaction (key-pattern + value-pattern) eklenmeli; en azından `token`, `authorization`, `privateKey`, `secret`, `cookie`, `iban` vb. alanlar maskelenmeli. |
| B04-F02 | MEDIUM | PII-data-protection | backend/scripts/utils/logger.js (format.errors stack) | Stack trace loglanıyor; bazı hata yollarında stack içine env değerleri veya request kaynaklı hassas parçalar girebilir. (uncertain) | Production loglarında hassas bağlam sızıntısı ve forensic yüzeyde gereksiz veri birikimi. | `format.errors({ stack: true })` + printf’de `\n${stack}` ekleniyor. | Production’da stack logging politika bazlı daraltılmalı (ör. sadece error code + trace id). |
| B04-F03 | HIGH | state-machine | backend/scripts/utils/schedulerSuccess.js::didScheduledJobSucceed | Yardımcı fonksiyon “fail closed” değil; `undefined/null/0/''/Error instance` gibi sonuçları success sayıyor. | Job exception swallow edilen veya hatalı dönüş kontratı olan yerlerde başarısız job yanlışlıkla başarılı raporlanabilir, `LastRunAt` güncellenip gözlemde false-positive yaratabilir. | Sadece `false` ve `{ success:false }` failed; diğer tüm değerler true. | Success kontratı stricter yapılmalı: yalnız `true` veya `{success:true}` başarılı sayılsın; geri kalan durumlar başarısız kabul edilsin. |
| B04-F04 | MEDIUM | testing-gap | backend/test/scheduler.successContract.test.js | Test kapsamı sadece 4 senaryoyu doğruluyor; `null`, `0`, `""`, `{}`, `{success:"false"}`, `Error` gibi kritik ambiguity vakaları yok. | Helper drift’inde yanlış başarı sınıflandırması CI’da kaçabilir. | Mevcut test iki case ile sınırlı. | Negatif ambiguity testleri eklenmeli; sözleşme explicit hale getirilmeli. |
| B04-F05 | LOW | testing-gap | backend/test/timeEnv.parser.test.js + backend/scripts/utils/timeEnv.js | Parser için overflow ve invalid değer testleri iyi; fakat fallback’in kendisinin güvenli aralıkta olup olmadığı doğrulanmıyor. (uncertain) | Caller yanlış fallback verirse (0/negatif/çok büyük) parser onu geri döndürebilir ve timer davranışı bozulabilir. | Fonksiyon fallback’i validasyon yapmadan return ediyor. | İsterseniz fallback için de ikinci seviye clamp/validate uygulanmalı veya caller kontratı testlerle zorunlu kılınmalı. |
| B04-F06 | LOW | PII-data-protection | backend/test/scrubbers.test.js | Scrubber testleri errorHandler/logs route üzerinde; logger.js için doğrudan redaction testi yok. | Logger transport/format değişimlerinde scrub garantisi bağımsız testlenemez. | Test dosyası `scrubBody` ve `scrubClientErrorText` odaklı; logger utility yok. | Logger seviyesinde redaction eklenecekse ona özel unit test seti oluşturulmalı. |

## 5. No-Finding Notes
- `timeEnv.parsePositiveTimerMs` Node timer upper bound (`2_147_483_647`) ve pozitif integer kontratını doğru uyguluyor.
- `timeEnv.parser.test.js` invalid/unsafe değerlerde fallback davranışını ve sınır değeri (`MAX_TIMER_MS`) doğruluyor.
- `logger.js` log dosyasını backend/logs altına alarak web-root exposure riskini azaltıyor.

## 6. Cross-File Risks
- **Logger vs scrubber ayrışması**: scrub mantığı `errorHandler` ve `logs` route katmanlarında; `logger` utility ham meta logladığı için katmanlar arası politika boşluğu var.
- **Scheduler observability drift**: `didScheduledJobSucceed` geniş success yorumu nedeniyle app scheduler `LastRunAt` alanlarını olduğundan iyi gösterebilir.
- **Time parser caller dependence**: parser güvenli, fakat fallback değeri caller disiplinine bırakılmış; merkezi fail-closed politika tam değil.

## 7. Follow-up
Sonraki inceleme için önerilen dosyalar:
- backend/scripts/routes/logs.js (client error ingest + scrub pipeline)
- backend/scripts/jobs/*.js (scheduler dönüş kontratı tutarlılığı)
- backend/scripts/app.js (`runScheduledJob` + `didScheduledJobSucceed` kullanım desenleri)
- backend/scripts/middleware/errorHandler.js (scrub kapsamı ve logger meta kullanımı)
