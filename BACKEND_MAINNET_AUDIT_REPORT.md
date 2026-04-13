# BACKEND_MAINNET_AUDIT_REPORT

## Executive summary
Bu inceleme yalnız backend kod tabanı üzerinde statik analiz + yerel test çalıştırması ile yapılmıştır.

Confirmed olarak iki risk bulundu ve minimal patch ile kapatıldı:
1. **PII token/session wallet boundary bypass** (high)
2. **Readiness threshold env parse drift (NaN fallback yok)** (medium)

Bu iki alan patch'lendi ve testle koruma altına alındı.

---

## Confirmed blockers
- None.

## High risks

### HR-01 — PII token wallet, session wallet ile zorunlu eşleşmiyordu
- **severity:** high  
- **status:** confirmed  
- **file(s):** `backend/scripts/middleware/auth.js`  
- **exact function / middleware:** `requirePIIToken`  
- **root cause:** Middleware, `requireAuth` sonrası mevcut `req.wallet` değerini `payload.sub` ile overwrite ediyordu; `payload.sub === req.wallet` zorunluluğu yoktu.  
- **exploit / production impact:** Çalınmış/ele geçirilmiş geçerli bir PII bearer token, başka bir aktif cookie session bağlamında kullanılabilir; session-boundary zayıflar ve PII erişim güvenlik sınırı token’a kayar.  
- **minimal fix strategy:** `requirePIIToken` içinde token wallet ile session wallet birebir eşleşmesini zorunlu kıl; mismatch durumunda `403` dön. `req.wallet` overwrite etme; ayrı `req.piiWallet` alanı kullan.

## Medium risks

### MR-01 — WORKER_MAX_LAG_BLOCKS geçersiz değerinde readiness hesabı deterministik değildi
- **severity:** medium  
- **status:** confirmed  
- **file(s):** `backend/scripts/services/health.js`  
- **exact function:** module-level `MAX_WORKER_LAG_BLOCKS` hesaplaması (`getReadiness` tarafından kullanılıyor)  
- **root cause:** `Number(process.env.WORKER_MAX_LAG_BLOCKS || 25)` ile parse yapılıyor; env değeri numerik değilse `NaN` üretilebiliyor.  
- **exploit / production impact:** Worker lag karşılaştırması (`<= MAX_WORKER_LAG_BLOCKS`) `NaN` ile güvenilir çalışmaz; readiness sinyalinde yanlış-negatif/kararsız davranış üretebilir, operasyonel health gating bozulur.  
- **minimal fix strategy:** Pozitif integer parse helper ekle; invalid durumda güvenli default `25` kullan.

## Low risks
- None confirmed.

---

## Unresolved / runtime verification needed

1. **RPC/WS gerçek dayanıklılık**
   - Kodda WS->HTTP fallback mevcut (`eventListener._connect`), fakat gerçek provider kesinti, rate-limit ve reconnect davranışının production’da nasıl gerçekleştiği runtime/log düzeyinde doğrulanmalı.
2. **Mongo/Redis failover semantiği**
   - Kod tarafında fail-fast ve readiness kontrolleri var; fakat gerçek managed service failover senaryolarında (connection flap, DNS rotate) orchestration davranışı runtime doğrulaması gerektiriyor.
3. **DLQ replay throughput/backoff under stress**
   - Mantık koddan doğrulanabilir; ancak kuyruk büyümesi ve poison event davranışı için yük testi/runbook doğrulaması gerekli.

---

## Patches applied
1. `backend/scripts/middleware/auth.js`
   - `requirePIIToken` artık `payload.sub` ile `req.wallet` eşleşmesini zorunlu kılıyor.
   - Mismatch durumunda `403` döndürüyor.
   - `req.wallet` overwrite edilmiyor; `req.piiWallet` set ediliyor.

2. `backend/scripts/services/health.js`
   - `_parseMaxWorkerLag` helper eklendi.
   - `WORKER_MAX_LAG_BLOCKS` geçersiz ise default `25` kullanılıyor.

---

## Tests added/updated
Yeni testler:
- `backend/scripts/__tests__/auth.middleware.test.js`
  - PII token/session wallet mismatch -> `403`
  - Match durumda middleware pass + `req.piiWallet` set
- `backend/scripts/__tests__/health.test.js`
  - Geçersiz `WORKER_MAX_LAG_BLOCKS` değerinde fallback `25` doğrulaması

Çalıştırılan test komutu:
- `cd backend && npm test -- --runInBand`

Sonuç:
- 2 test suite, 3 test geçti.

---

## Migration / rollout notes
- Bu patch backward-compatible; route contract’ını bozmaz.
- `requirePIIToken` artık daha sıkı session-token eşleşmesi uygular; token replay yüzeyini daraltır.
- Health parse değişikliği yalnız invalid env değerlerini güvenli default’a sabitler.

## Residual risks
- Runtime altyapı kesintileri (RPC/Redis/Mongo failover) için yalnız kod analizi yeterli değildir; staging/prod gözlem doğrulaması gerekir.
- PII akışlarında short-lived token politikası uygulanıyor; token taşıma/loglama pratikleri operasyonel olarak izlenmeye devam edilmelidir.

---

## Ship / no-ship

### Ship only if...
- Yukarıdaki testler CI’de tekrar geçerse,
- Runtime readiness ve worker lag metrikleri staging’de doğrulanırsa,
- Session-wallet header politikası client tarafında tutarlı uygulanıyorsa.

### Do not ship if...
- PII token/session eşleşme kuralı client akışında kırılıyorsa,
- `WORKER_MAX_LAG_BLOCKS` gibi kritik env’ler doğrulanmadan deploy yapılıyorsa,
- Readiness sinyaline bağlı orchestration kararları gözlemlenmeden mainnet cutover planlanıyorsa.
