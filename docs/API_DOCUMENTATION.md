# 🌀 Araf Protocol: API Documentation

> **Versiyon:** 1.0 | **Base URL:** `/api` | **Son Güncelleme:** Mart 2026

Bu doküman, Araf Protokolü'nün backend API endpoint'leri için detaylı bir referans sunar.

---

## Kimlik Doğrulama (Authentication)

API, güvenlik için iki katmanlı bir token sistemi kullanır:

1.  **Auth JWT (JSON Web Token):** SIWE (Sign-In with Ethereum) akışı ile elde edilen, kısa ömürlü (15 dk) bir token. Çoğu endpoint için gereklidir.
2.  **PII Token:** IBAN gibi hassas PII verilerine erişmek için özel olarak gereken, daha da kısa ömürlü (15 dk) ve işlem bazlı (trade-scoped) bir token.

### Auth Akışı (SIWE + JWT)

1.  `GET /auth/nonce?wallet=<address>`: Tek kullanımlık, benzersiz bir nonce alın.
2.  **Client-Side:** Alınan nonce ile EIP-4361 mesajını imzalayın.
3.  `POST /auth/verify`: Mesajı ve imzayı göndererek bir JWT ve bir Refresh Token alın.
4.  **Sonraki İstekler:** JWT'yi `Authorization: Bearer <token>` başlığına ekleyin.
5.  `POST /auth/refresh`: JWT'nin süresi dolduğunda, kullanıcıdan tekrar imza istemeden yeni bir token çifti almak için Refresh Token'ı kullanın.

---

## Endpoints

### Auth Rotaları (`/api/auth`)

#### `GET /auth/nonce`
*   **Açıklama:** SIWE imza süreci için tek kullanımlık bir nonce üretir.
*   **Yetkilendirme:** Herkese Açık
*   **Query Parametreleri:** `wallet` (kullanıcının cüzdan adresi)
*   **Başarılı Yanıt (200 OK):**
    ```json
    {
      "nonce": "a1b2c3d4e5f6...",
      "siweDomain": "araf.protocol"
    }
    ```

#### `POST /auth/verify`
*   **Açıklama:** SIWE imzasını doğrular ve geçerliyse JWT + Refresh Token döndürür.
*   **Yetkilendirme:** Herkese Açık
*   **İstek Body:**
    ```json
    {
      "message": "EIP-4361 formatında tam SIWE mesajı",
      "signature": "0x..."
    }
    ```
*   **Başarılı Yanıt (200 OK):**
    ```json
    {
      "token": "ey...",
      "refreshToken": "abc..."
    }
    ```

#### `POST /auth/refresh`
*   **Açıklama:** Süresi dolmuş bir JWT'yi yenilemek için kullanılır.
*   **Yetkilendirme:** Herkese Açık
*   **İstek Body:**
    ```json
    {
      "wallet": "0x...",
      "refreshToken": "abc..."
    }
    ```
*   **Başarılı Yanıt (200 OK):** Yeni bir token çifti döndürür.

---

### İlan Rotaları (`/api/listings`)

#### `GET /api/listings`
*   **Açıklama:** Pazar yerindeki açık ilanları listeler. Filtreleme ve sayfalama destekler.
*   **Yetkilendirme:** Herkese Açık
*   **Query Parametreleri:** `fiat`, `amount`, `tier`, `page`, `limit`
*   **Başarılı Yanıt (200 OK):**
    ```json
    {
      "listings": [ { "_id": "...", "maker_address": "...", ... } ],
      "total": 15,
      "page": 1,
      "limit": 10
    }
    ```

#### `POST /api/listings`
*   **Açıklama:** Yeni bir P2P ilanı oluşturur.
*   **Yetkilendirme:** Auth JWT Gerekli
*   **İstek Body:**
    ```json
    {
      "crypto_asset": "USDT",
      "fiat_currency": "TRY",
      "exchange_rate": 33.50,
      "limits": { "min": 500, "max": 2500 },
      "tier": 1,
      "token_address": "0x..."
    }
    ```
*   **Başarılı Yanıt (201 Created):** Oluşturulan ilanın tam nesnesini döndürür.

#### `DELETE /api/listings/:id`
*   **Açıklama:** Bir ilanı pazar yerinden kaldırır (soft delete).
*   **Yetkilendirme:** Auth JWT Gerekli (Sadece ilan sahibi silebilir)
*   **Başarılı Yanıt (200 OK):**
    ```json
    { "success": true }
    ```
*   **Hata Yanıtları:** `403 Forbidden` (ilan sahibi değilse), `409 Conflict` (ilana bağlı aktif bir işlem varsa).

---

### İşlem Rotaları (`/api/trades`)

#### `GET /api/trades/my`
*   **Açıklama:** Kullanıcının aktif (çözülmemiş) işlemlerini listeler.
*   **Yetkilendirme:** Auth JWT Gerekli
*   **Başarılı Yanıt (200 OK):** `{ "trades": [ ... ] }`

#### `GET /api/trades/history`
*   **Açıklama:** Kullanıcının tamamlanmış işlem geçmişini listeler.
*   **Yetkilendirme:** Auth JWT Gerekli
*   **Query Parametreleri:** `page`, `limit`
*   **Başarılı Yanıt (200 OK):** `{ "trades": [ ... ], "total": 5, ... }`

#### `POST /api/trades/:id/chargeback-ack`
*   **Açıklama:** Maker'ın, fonları serbest bırakmadan önce "Ters İbraz" riskini anladığını onaylamasını sağlar.
*   **Yetkilendirme:** Auth JWT Gerekli (Sadece Maker çağırabilir)
*   **Başarılı Yanıt (201 Created):** `{ "success": true, "acknowledged_at": "..." }`

---

### PII Rotaları (`/api/pii`)

Bu rotalar, en yüksek güvenlik seviyesine sahip endpoint'lerdir.

#### `POST /api/pii/request-token/:tradeId`
*   **Açıklama:** **Adım 1:** IBAN verisine erişmek için kısa ömürlü, işlem bazlı bir PII token'ı talep eder.
*   **Yetkilendirme:** Auth JWT Gerekli (Sadece işlemin Taker'ı çağırabilir)
*   **Başarılı Yanıt (200 OK):**
    ```json
    { "piiToken": "ey..." }
    ```

#### `GET /api/pii/:tradeId`
*   **Açıklama:** **Adım 2:** Geçerli bir PII token'ı ile satıcının şifresi çözülmüş PII verisini (IBAN, Ad, Telegram) çeker.
*   **Yetkilendirme:** PII Token Gerekli
*   **Başarılı Yanıt (200 OK):**
    ```json
    {
      "bankOwner": "Ahmet Yılmaz",
      "iban": "TR...",
      "telegram": "ahmet_tr"
    }
    ```

#### `PUT /api/pii`
*   **Açıklama:** Kullanıcının kendi PII verilerini (Banka Sahibi, IBAN, Telegram) güncellemesini sağlar. Veriler veritabanına yazılmadan önce şifrelenir.
*   **Yetkilendirme:** Auth JWT Gerekli
*   **İstek Body:**
    ```json
    {
      "bankOwner": "Yeni Ad Soyad",
      "iban": "TR...",
      "telegram": "yeni_kullanici_adi"
    }
    ```
*   **Başarılı Yanıt (200 OK):** `{ "success": true, "message": "Bilgileriniz başarıyla güncellendi." }`

---

### Diğer Rotalar

#### `GET /api/stats`
*   **Açıklama:** Protokolün genel istatistiklerini (toplam hacim, işlem sayısı vb.) döndürür.
*   **Yetkilendirme:** Herkese Açık
*   **Başarılı Yanıt (200 OK):** `{ "stats": { "total_volume_usdt": 123456, ... } }`

#### `POST /api/feedback`
*   **Açıklama:** Kullanıcıların geri bildirimlerini (puanlama ve yorum) gönderir.
*   **Yetkilendirme:** Auth JWT Gerekli
*   **İstek Body:**
    ```json
    {
      "rating": 5, // 1-5 arası tam sayı (zorunlu)
      "comment": "Harika bir platform!", // String (opsiyonel)
      "category": "suggestion" // 'bug', 'suggestion', 'ui/ux', 'other' (zorunlu)
    }
    ```
*   **Başarılı Yanıt (201 Created):** `{ "success": true }`

#### `GET /health`
*   **Açıklama:** Backend servisinin ve altyapı bileşenlerinin (worker vb.) sağlıklı çalışıp çalışmadığını kontrol eder.
*   **Yetkilendirme:** Herkese Açık
*   **Başarılı Yanıt (200 OK):** `{ "status": "ok", "worker": "active", ... }`