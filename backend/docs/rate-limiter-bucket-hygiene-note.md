# Rate Limiter Bucket Hygiene (Backend)

Bu not, route semantiği ile limiter semantiğini hizalamak için yapılan bucket hijyenini özetler.

## Route -> Bucket taşıma özeti

- `GET /api/orders/:id/trades`
  - Eski: `ordersWriteLimiter`
  - Yeni: `ordersReadLimiter`
  - Gerekçe: endpoint state-changing değil; parent order altındaki child trade listesini read-only döner.

- `POST /api/receipts/upload`
  - Eski: `tradesLimiter` (generic room/trade surface)
  - Yeni: `receiptUploadLimiter`
  - Gerekçe: receipt upload write-adjacent koordinasyon yüzeyi; room read bucket’ından ayrıldı.

- `/api/admin/*`
  - Yeni: `adminReadLimiter`
  - Gerekçe: admin observability public değildir; read-only olsa da hassas operasyonel yüzeydir.

- `GET /api/stats`
  - Yeni: `statsReadLimiter`
  - Gerekçe: public stats için market feed’den bağımsız hafif bucket.

- `POST /api/logs/client-error`
  - Eski: route içinde inline `logRateLimiter`
  - Yeni: shared middleware’den `clientLogLimiter`
  - Gerekçe: limiter tanımlarını merkezileştirip bucket yönetimini tek yerde toplamak.

## Fallback semantiği

- Public/read availability-first yüzeyler (`marketReadLimiter`, `statsReadLimiter`, `clientLogLimiter`) Redis down olduğunda fail-open yaklaşımını koruyabilir.
- Sensitive / write-adjacent yüzeyler (`ordersWriteLimiter`, `ordersReadLimiter`, `roomReadLimiter`, `receiptUploadLimiter`, `feedbackLimiter`, `adminReadLimiter`, auth/nonce/pii) Redis down durumunda in-memory fallback ile korunur.

## Authority sınırı

Bu refactor yalnız abuse/fair-use katmanını temizler.
Limiter girişleri economic outcome üretmez; settlement/release/cancel/burn/dispute sonucunu belirlemez ve contract authority alanına müdahale etmez.
