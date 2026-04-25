# 🌀 Araf Protocol API (Güncel Backend Surface)

> Base URL: `/api`  
> Kanonik model: **V3 order-first** (parent order + child trade)

Bu doküman, `backend/scripts/app.js` içinde mount edilen güncel endpoint yüzeyini anlatır.

---

## 1) Kimlik doğrulama modeli

Kimlik modeli SIWE + cookie oturumuna dayanır:
- `araf_jwt` (kısa ömürlü auth cookie)
- `araf_refresh` (refresh cookie, `/api/auth` path)
- hassas PII erişimi için trade-scoped token (`Authorization: Bearer ...`)

Korunan route’larda session-wallet eşleşmesi (`requireSessionWalletMatch`) zorunludur.

---

## 2) Mount edilen route grupları

- `/api/auth`
- `/api/orders`
- `/api/trades`
- `/api/pii`
- `/api/feedback`
- `/api/stats`
- `/api/receipts`
- `/api/logs`
- `/health` (liveness)
- `/ready` (readiness)

`/api/listings`, `app.js` içindeki kanonik mount yüzeyinin parçası değildir.

---

## 3) Auth rotaları (`/api/auth`)

### `GET /api/auth/nonce?wallet=<address>`
SIWE için nonce üretir (Redis TTL).

### `POST /api/auth/verify`
SIWE imzasını doğrular ve auth/refresh cookie’lerini set eder.

İstek:
```json
{ "message": "EIP-4361 message", "signature": "0x..." }
```

### `GET /api/auth/me`
Geçerli session cookie için `{ wallet, authenticated: true }` döner.

### `POST /api/auth/refresh`
Refresh oturumunu çevirir, yeni cookie çifti üretir.

İstek:
```json
{ "wallet": "0x..." }
```

### `POST /api/auth/logout`
Refresh token family kaydını iptal eder ve cookie’leri temizler.

### `PUT /api/auth/profile`
Rail-aware payout profilini `User.payout_profile` altında şifreli günceller.

Kilit davranışlar:
- Aktif trade (`LOCKED/PAID/CHALLENGED`) varken banka profil değişimi engellenir.
- Bank profile version/sayaçları risk sinyali için güncellenir.

Kabul edilen request body:
```json
{
  "payoutProfile": {
    "rail": "TR_IBAN | US_ACH | SEPA_IBAN",
    "country": "TR | US | DE | ...",
    "contact": {
      "channel": "telegram | email | phone | null",
      "value": "string | null"
    },
    "fields": {
      "account_holder_name": "string",
      "iban": "string | null",
      "routing_number": "string | null",
      "account_number": "string | null",
      "account_type": "checking | savings | null",
      "bic": "string | null",
      "bank_name": "string | null"
    }
  }
}
```

Rail-country kuralları (zorunlu):
- `TR_IBAN` -> `TR`
- `US_ACH` -> `US`
- `SEPA_IBAN` -> `DE, FR, NL, BE, ES, IT, AT, PT, IE, LU, FI, GR`

Contact canonicalization:
- `telegram`: baştaki `@` storage öncesi temizlenir
- `email`: temel e-mail pattern doğrulaması yapılır
- `phone`: boşluklar temizlenir, ardından `+` opsiyonlu numerik pattern doğrulanır
- `channel/value` birlikte gelir veya birlikte `null` olur

Rail-specific field set:
- `TR_IBAN`: `account_holder_name`, `iban`, opsiyonel `bank_name`
- `SEPA_IBAN`: `account_holder_name`, `iban`, opsiyonel `bic`, opsiyonel `bank_name`
- `US_ACH`: `account_holder_name`, `routing_number`, `account_number`, `account_type`, opsiyonel `bank_name`

Geçersiz kombinasyon örneği (400):
```json
{ "payoutProfile": { "rail": "US_ACH", "country": "TR", "contact": { "channel": null, "value": null }, "fields": { "account_holder_name": "John Doe", "iban": null, "routing_number": "021000021", "account_number": "1234567890", "account_type": "checking", "bic": null, "bank_name": null } } }
```

Legacy flat alanlar artık kabul edilmez: `bankOwner`, `iban`, `telegram`, `contactChannel`, `contactValue`.

---

## 4) Order rotaları (`/api/orders`)

Order rotaları parent-order state’in read-layer mirror yüzeyidir.
State-changing order aksiyonları on-chain yapılır.

### `GET /api/orders/config`
Mirror protocol config snapshot döner:
- bond map
- fee config
- cooldown config
- token map

### `GET /api/orders`
Public order feed + filtreler:
- `side`: `SELL_CRYPTO | BUY_CRYPTO`
- `status`: `OPEN | PARTIALLY_FILLED | FILLED | CANCELED`
- `tier`
- `token_address`
- `owner_address`
- sayfalama (`page`, `limit`)

### `GET /api/orders/my`
Session wallet’a ait order’ların sayfalı listesi.

### `GET /api/orders/:id`
On-chain order kimliğine göre tek parent order döner.

### `GET /api/orders/:id/trades`
Order owner için child trade listesi (owner-only).

---

## 5) Trade rotaları (`/api/trades`)

Trade rotaları child-trade read/coordination yüzeyidir.
Settlement outcome tarafında backend **non-authoritative** kalır:
- backend/admin settlement finalize edemez,
- backend/admin release/cancel/burn/payout override yapamaz,
- nihai ekonomik sonuç yalnız tarafların kabul ettiği on-chain tx ile oluşur.

### Partial settlement semantiği
- **Nedir:** tek bir child trade için tarafların anlaşmalı split payout akışıdır.
- **Lifecycle:** `NONE -> PROPOSED -> REJECTED/WITHDRAWN/EXPIRED/FINALIZED`.
- **Teklifi kim oluşturabilir:** yalnız o trade’in iki tarafından biri (`maker` veya `taker`).
- **Kabul/red kimde:** aktif teklifi yalnız **karşı taraf** kabul veya reddedebilir.
- **Withdraw kimde:** aktif teklifi yalnız teklifi oluşturan taraf geri çekebilir.
- **Expire kim tetikler:** deadline geçince expire çağrısını herkes tetikleyebilir; doğrulama yine kontrattadır.

### Settlement akışında backend rolü
- bilgilendirme amaçlı preview (`POST /api/trades/:id/settlement-proposal/preview`)
- kontrat event mirror
- query/UX için read-model projection
- operasyonel audit/observability (admin read-only analytics dahil)

### Backend’in rolü OLMAYAN alanlar
- outcome belirleme
- `release/cancel/burn` veya payout authority override
- reputation authority state yazımı
- fon transferi

### `GET /api/trades/my`
Kullanıcının aktif trade listesi.

### `GET /api/trades/history`
Terminal trade listesi (`RESOLVED/CANCELED/BURNED`) + sayfalama.

### `GET /api/trades/by-escrow/:onchainId`
On-chain child-trade kimliği (`onchain_escrow_id`) ile trade döner.

### `GET /api/trades/:id`
Mongo `_id` ile trade döner (party-restricted).

### `POST /api/trades/propose-cancel`
On-chain submit öncesi EIP-712 cancel imza koordinasyonunu tutar.

İstek:
```json
{
  "tradeId": "mongodb_object_id",
  "signature": "0x...",
  "deadline": 1735000000
}
```

### `POST /api/trades/:id/chargeback-ack`
Maker’ın `PAID/CHALLENGED` durumlarında risk/yasal acknowledgement kaydı.

### `GET /api/trades/:id/settlement-proposal`
Trade’e bağlı partial-settlement mirror payload döner (yalnız trade tarafları erişebilir).
Read-model amaçlıdır; authoritative değildir.

### `POST /api/trades/:id/settlement-proposal/preview`
Mirror trade tutarlarından bilgilendirme amaçlı split preview hesaplar.

İstek:
```json
{ "makerShareBps": 7000 }
```

Yanıt alanları:
- `informationalOnly: true`
- `nonAuthoritative: true`
- `makerShareBps`, `takerShareBps`
- `pool`, `makerPayout`, `takerPayout` (BigInt-safe string)
- nihai sonucun yalnız on-chain kabul edilen tx ile belirlendiğini söyleyen uyarı

---

## 5.1) Admin settlement gözlem yüzeyi (`/api/admin`)

### `GET /api/admin/settlement-proposals`
Mirror settlement proposal kayıtlarını read-only izleme endpoint’i.

Query:
- `state=ALL|PROPOSED|EXPIRED|FINALIZED|REJECTED|WITHDRAWN`
- `page`
- `limit`

Sayfalı `{ proposals, total, page, limit }` döner.
Bu endpoint write/override aksiyonu içermez.

### Payment risk semantiği (`PaymentRiskLevel`)
- `PaymentRiskLevel`, kullanıcı güven/reputation puanı **değildir**.
- Payment rail complexity/availability sinyalidir; UX/read-model amaçlıdır.
- On-chain outcome veya settlement finalization authority’sine dönüşemez.

---

## 6) PII rotaları (`/api/pii`)

PII rotaları child-trade scoped ve yüksek güvenlikli katmandır.

### `GET /api/pii/my`
Kullanıcının kendi payout profilini çözülmüş döner.

### `GET /api/pii/taker-name/:onchainId`
State uygunsa maker, snapshot’tan taker hesap sahibi adını okur.

### `POST /api/pii/request-token/:tradeId`
Uygun taker için kısa ömürlü trade-scoped PII token üretir.

### `GET /api/pii/:tradeId`
Geçerli PII token + session kontrolleri ile maker payout bilgisini döner.

Güvenlik karakteristikleri:
- hassas yanıtlar için no-store cache politikası
- trade tutarlılığı için snapshot-first davranış
- role + state bazlı erişim sınırı

---

## 7) Dekont rotası (`/api/receipts`)

### `POST /api/receipts/upload`
Child trade için şifreli dekont yükler.

Beklenen multipart alanları:
- `receipt` dosyası (JPEG/PNG/WebP/GIF/PDF, max 5 MB)
- `onchainEscrowId` (pozitif sayısal trade ID)

Davranış:
- MIME magic bytes doğrulaması
- payload şifreleme
- hash + şifreli blob kaydı
- yalnız taker ve `LOCKED` state için izin

---

## 8) Feedback ve stats

### `POST /api/feedback`
Auth gerektiren kullanıcı geri bildirim endpoint’i.

### `GET /api/stats`
Public protokol istatistik endpoint’i.

### `POST /api/logs/client-error`
Frontend runtime tarafından kullanılan, non-blocking istemci hata telemetri endpoint’i.
Payload seviye/mesaj/bağlam alanları içerir; endpoint rate-limit altındadır.

---

## 9) Sağlık endpoint’leri

### `GET /health`
Liveness probe (process-up).

### `GET /ready`
Readiness probe (Mongo/Redis/worker/provider/config kontrolleri).

---

## 10) Terminoloji notları

- Kanonik market primitive **listing değil parent order**’dır.
- Kanonik escrow lifecycle **child trade** tarafında yaşar.
- `onchain_escrow_id`, backend modelindeki child-trade on-chain kimliğidir.
- Backend authority değildir; mirror/coordination katmanıdır.
