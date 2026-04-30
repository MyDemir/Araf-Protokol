# Backend File Audit — routes: admin / logs / feedback (14)

## 1. Scope
İncelenen dosyalar:
- backend/scripts/routes/admin.js
- backend/scripts/routes/logs.js
- backend/scripts/routes/feedback.js

İlişkili dosyalar:
- backend/scripts/middleware/auth.js
- backend/scripts/middleware/rateLimiter.js
- backend/scripts/utils/logger.js
- backend/scripts/models/Feedback.js
- frontend/src/AdminPanel.jsx

İlişkili testler:
- backend/test/admin.routes.resilience.test.js
- backend/test/stats.logs.rateLimiter.route.test.js

## 2. Method
- Route’lar authz/authn zinciri, role/allowlist kontrolü, veri minimizasyonu ve rate-limit katmanı açısından satır bazlı okundu.
- `auth.js` session-wallet guard davranışı admin/feedback route erişimiyle çapraz doğrulandı.
- Logs route scrub fonksiyonu, payload length cap ve logger sink davranışı sızıntı yüzeyi açısından değerlendirildi.
- AdminPanel fetch/error/403-401-409 handling akışı backend contractıyla hizalanma açısından incelendi.
- Verilen testlerin admin/logs failure ve auth edge-case kapsamı kontrol edildi.

## 3. Function / Section Notes
- **Admin backend guard**: admin route yalnız UI guard’a dayanmıyor; `requireAuth + requireSessionWalletMatch + requireAdminWallet + adminReadLimiter` zinciri var.
- **Admin allowlist**: `ADMIN_WALLETS` env’den normalize edilen wallet allowlist ile backend role kapısı uygulanıyor.
- **Logs redaction**: `/client-error` endpoint’i IBAN/cüzdan/email/bearer/JWT patternlerini scrub ediyor ve alanları uzunluk sınırlı kaydediyor.
- **Feedback auth boundary**: feedback create endpoint’i auth+session-wallet match+feedbackLimiter ile korunuyor.
- **Logger sink isolation**: logger varsayılan olarak `backend/logs/araf.log` altında yazıyor; web-root dışında.
- **AdminPanel uyumu**: frontend 403’te unauthorized state’e düşüyor, 401/409’da polling durdurup yeniden login mesajı veriyor.

## 4. Findings

| ID | Severity | Category | File / Function | Finding | Risk | Evidence | Suggested Action |
|---|---|---|---|---|---|---|---|
| B14-F01 | MEDIUM (uncertain) | privilege-hardening | backend/scripts/routes/admin.js (`requireAdminWallet`) | Admin yetkisi tek faktörlü wallet allowlist’e bağlı; RBAC/denylist/audit reason kodları sınırlı. | Yanlış env yönetimi veya compromised admin wallet senaryosunda geniş observability surface açılabilir. | `ADMIN_WALLETS` string allowlist kontrolü tek kapı olarak kullanılıyor. | Allowlist yanında role metadata/audit trail ve rotasyon prosedürü operasyonel olarak güçlendirilmeli. |
| B14-F02 | MEDIUM | pii-log-hygiene | backend/scripts/routes/feedback.js | Feedback submit sonrası logger satırında tam wallet adresi loglanıyor. Route auth güvenli olsa da log retention yüzeyinde gereksiz identifiability artışı var. | Log sızıntısı durumunda kullanıcı aktiviteleri adres bazında kolay korele edilebilir. | `[Feedback] ${req.wallet} → ...` formatında tam adres yazılıyor. | Feedback loglarında wallet kısaltma/hash kullanımı önerilir. |
| B14-F03 | LOW | abuse-control | backend/scripts/routes/logs.js + middleware/rateLimiter.js | Logs endpoint `clientLogLimiter` ile korunuyor ve payload cap var; ancak endpoint auth’suz olduğu için spam flood denemeleri tamamen limiter kalitesine bağlı. | DDoS-benzeri log gürültüsü ve depolama maliyeti artışı. | Route auth’suz, limiter zorunlu. | Limiter metrik alarmı + sampling/drop policy ile gürültü kontrolü güçlendirilmeli. |
| B14-F04 | LOW | input-sanitization | backend/scripts/routes/feedback.js + models/Feedback.js | Feedback validation uzunluk/enum açısından yeterli; fakat `comment` için içerik normalizasyon/sanitization policy explicit değil. | Downstream admin render/export zincirinde injection/PII taşıma riski (model seviyesinde değil tüketim seviyesinde). | Joi max=1000 var, sanitize katmanı yok. | Persist öncesi control-char strip ve admin render’da strict escaping standardı önerilir. |
| B14-F05 | INFO | backend-authz | admin route + AdminPanel | Admin route backend’de zorunlu authz uyguluyor; frontend yalnız UX katmanı. | Pozitif not: UI-only guard’a düşülmemiş, backend authority net. | Router-level middleware chain + frontend 403/401/409 handling uyumu. | Mevcut yaklaşım korunmalı; testlere unauthorized wallet senaryoları eklenmeye devam edilmeli. |
| B14-F06 | INFO | resilience-tests | admin/logs tests | Admin resilience testleri degrade/fallback/pagination scope gibi failure akışlarını kapsıyor; logs testi limiter wiring doğruluyor. | Pozitif not: operasyonel dayanıklılık davranışı için regresyon koruması var. | `admin.routes.resilience` ve `stats.logs.rateLimiter.route` test kapsamı mevcut. | Auth edge-case’leri için özellikle “admin olmayan ama authenticated wallet” entegrasyon testi genişletilebilir. |

## 5. No-Finding Notes
- Admin route ekonomik authority üretmiyor; read-only observability yüzeyi olarak kalıyor.
- Logs route stack/message alanlarını sınırlı uzunlukta tutuyor ve scrub uyguluyor.
- Feedback route’da wallet body’den değil session’dan alınıyor; spoof yüzeyi azaltılmış.
- Session-wallet mismatch koruması feedback ve admin erişim modeline doğru entegre.

## 6. Cross-File Risks
- **Operational secret drift riski**: logs scrub patternleri statik; yeni token/secret formatları çıktıkça güncellenmezse kaçak olabilir.
- **Allowlist yönetim riski**: admin wallet lifecycle (rotate/revoke) süreçleri kod dışı disipline bağımlı.
- **Feedback data lifecycle riski**: TTL var ama admin/export kullanımında sanitize policy dokümantasyonu zayıf.

## 7. Follow-up
Sonraki inceleme için önerilen dosyalar:
- backend/scripts/routes/admin.js (unauthorized telemetry & deny reason taxonomy)
- backend/scripts/routes/logs.js (scrub pattern test coverage genişletme)
- backend/scripts/routes/feedback.js + admin UI render yüzeyi (comment sanitization policy)
- backend/test/* (admin non-allowlisted wallet entegrasyon testleri)
