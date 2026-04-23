# Rate Limiter Bucket Hygiene + Tier-aware Overlay (Backend)

Bu not, route semantiği ile limiter semantiğini hizalamak için yapılan bucket hijyenini ve tier-aware overlay ekini özetler.

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
- Sensitive / write-adjacent yüzeyler (`ordersWriteLimiter`, `ordersReadLimiter`, `roomReadLimiter`, `receiptUploadLimiter`, `coordinationWriteLimiter`, `feedbackLimiter`, `adminReadLimiter`, auth/nonce/pii) Redis down durumunda in-memory fallback ile korunur.

## Tier-aware kapsamı

- Tier-aware yapılan canonical wallet-bound bucket’lar:
  - `ordersReadLimiter`
  - `roomReadLimiter`
  - `receiptUploadLimiter`
  - `coordinationWriteLimiter`
  - `feedbackLimiter`

- Fixed kalan bucket’lar:
  - `authLimiter`, `nonceLimiter`, `piiLimiter`
  - `marketReadLimiter`, `statsReadLimiter`, `clientLogLimiter`
  - `adminReadLimiter`, `ordersWriteLimiter`

## Tier source + cache çözümü

- Tier kaynağı yalnız backend mirror + cache:
  - `reputation_cache.effective_tier`
  - `max_allowed_tier`
- Cache key: `ratelimit:tier:<wallet>`
- Çözümleme:
  - wallet yoksa anonymous tier `0`
  - Redis cache hit varsa direkt kullan
  - cache miss’te Mongo dar projection ile oku
  - aynı request içinde duplicate DB read’i önlemek için request-scope promise cache kullan
  - `effective_tier || 0`, ardından `max_allowed_tier` üst sınırı uygula
  - final tier `0..4` clamp edilir
  - kısa TTL ile tekrar cache’e yazılır

## Alias cleanup

- `tradesLimiter` alias export kaldırıldı; trades route canonical `roomReadLimiter` kullanır.
- `coordinationWriteLimiter` artık ölü export değil; trade coordination write endpoint’lerinde (`propose-cancel`, `chargeback-ack`) aktif kullanılır.
- `listingsReadLimiter` / `listingsWriteLimiter` compatibility alias exportları da kaldırıldı; export yüzeyi canonical bucket adlarına indirildi.

## Authority sınırı

Bu refactor yalnız abuse/fair-use katmanını temizler.
Limiter girişleri economic outcome üretmez; settlement/release/cancel/burn/dispute sonucunu belirlemez ve contract authority alanına müdahale etmez.

## Frontend etkisi

Repo inspection sonucunda bu değişiklikler için zorunlu frontend kod değişikliği gerekmemiştir:
- API path contract’ları (`/api/trades`, `/api/receipts`, `/api/feedback`, `/api/stats`, `/api/logs/client-error`) korunmuştur.
- Limiter adları backend içi implementation detayıdır; frontend bu export isimlerine bağlı değildir.
- Bu nedenle “mandatory frontend change” yoktur.
