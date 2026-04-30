# Frontend Root/Config Security & Deployment Audit

Tarih: 2026-04-30
Kapsam:
- `frontend/package.json`
- `frontend/.env.example`
- `frontend/index.html`
- `frontend/vite.config.js`
- `frontend/vercel.json`
- `frontend/postcss.config.js`
- `frontend/tailwind.config.js`
- `frontend/src/main.jsx`
- `frontend/src/index.css`

İlişkili testler:
- `frontend/src/test/deployEnvResolution.test.js`
- `frontend/src/test/apiConfig.test.js`
- `frontend/src/test/chainPolicy.security.test.js`

---

## Executive Summary

Bu yüzeyde **kritik** bulgu yok. Oracle-free dispute modelini veya ekonomik otoriteyi frontend/backend'e kaydıran bir desen bu scope içinde gözlenmedi.

Ancak production hardening açısından aşağıdaki bulgular öne çıkıyor:

1. **MEDIUM — `vite.config.js` production sourcemap politikası explicit değil**
   - Vite default'ta production sourcemap üretmez; fakat policy explicit olmadığı için ileride config drift ile debug exposure riski oluşabilir.
2. **MEDIUM — `vercel.json` güvenlik header seti eksik (CSP/HSTS/Permissions-Policy yok)**
   - Mevcut `X-Frame-Options`, `nosniff`, `Referrer-Policy` iyi; ancak modern tarayıcı hardening için ek headerlar önerilir.
3. **LOW — `package.json` script setinde security/lint gate kapsamı sınırlı**
   - `lint` ve testler var; ama dependency audit / secrets scan / SAST tarzı scriptler yok.

---

## Dosya Bazlı Bulgular

### 1) `frontend/package.json`

**Gözlem**
- Scriptler: `dev`, `build`, `lint`, `test`, `test:coverage` mevcut.
- Güvenlik odaklı komutlar (örn. `npm audit --production`, lockfile policy check, secrets scan) tanımlı değil.

**Risk Seviyesi: LOW**
- CI/CD'de minimum güvenlik kapıları eksik olabilir; dependency kaynaklı regresyonlar daha geç yakalanır.

**Öneri**
- `security:audit`, `security:deps`, `ci:check` gibi scriptlerle minimum güvenlik pipeline'ı eklenmeli.
- Dependabot/Renovate + lockfile review policy önerilir.

---

### 2) `frontend/.env.example`

**Gözlem**
- `VITE_` prefixli değişkenler kullanılıyor; bu değişkenlerin client bundle'a girdiği doğru şekilde ima edilmiş.
- Production'da boş `VITE_API_URL` ile same-origin `/api` policy'si testlerle doğrulanmış yapıya uyumlu.

**Risk Seviyesi: LOW (bilgilendirici)**
- `VITE_` prefix doğası gereği secret taşınmaması gerektiği ekipçe netleştirilmeli.

**Öneri**
- Dosya üstüne kısa bir güvenlik notu: "`VITE_*` değişkenlerine secret koymayın".

---

### 3) `frontend/index.html`

**Gözlem**
- Minimal shell; inline script yok.
- Güvenlik için meta seviyesinde CSP yok; Vercel header policy ile yönetiliyor.

**Risk Seviyesi: LOW**
- Header seviyesinde CSP yoksa ileride üçüncü parti script eklemelerinde risk artabilir.

---

### 4) `frontend/vite.config.js`

**Gözlem**
- Test config tanımlı, fakat production `build` hardening ayarları explicit değil (`sourcemap`, `minify`, `target` vb.).

**Risk Seviyesi: MEDIUM**
- Şu an immediate exploit değil; ancak config drift olduğunda source map yayınlanması ile kod yüzeyi ifşa olabilir.

**Öneri**
- `build.sourcemap = false` explicit eklenmeli.
- İhtiyaca göre `build.target` ve chunk warning policy netleştirilmeli.

---

### 5) `frontend/vercel.json`

**Gözlem**
- `/api/*` rewrite backend'e gidiyor; SPA fallback mevcut.
- `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy` headerları var.
- **Eksik**: `Content-Security-Policy`, `Strict-Transport-Security`, `Permissions-Policy`.

**Risk Seviyesi: MEDIUM**
- Özellikle CSP yokluğu XSS impact'ini azaltma katmanını zayıflatır.

**Öneri**
- Nonce/hash tabanlı CSP (en azından başlangıçta `default-src 'self'`) planlanmalı.
- HSTS ve Permissions-Policy eklenmeli.

---

### 6) `frontend/postcss.config.js` / `frontend/tailwind.config.js`

**Gözlem**
- Standart yapı. Güvenlik kritik bir anti-pattern gözlenmedi.

**Risk Seviyesi: INFO**
- Tailwind `content` scope'u makul ve sınırlı.

---

### 7) `frontend/src/main.jsx`

**Gözlem**
- `ErrorBoundary`, `WagmiProvider`, `QueryClientProvider` sarmalama sırası mantıklı.
- Chain policy `getSupportedChainIds()` ile türetiliyor; prod/dev ayrımı chain policy modülüne delegasyonlu.
- Hardhat transport yalnız `!import.meta.env.PROD` koşulunda aktif.

**Risk Seviyesi: LOW**
- Provider setup doğru; ekonomik otorite frontend'e taşınmıyor.

**Not**
- Codespaces RPC helper'ı yalnız development bağlamında kullanılıyor; yorumlarda bu risk açıkça belirtilmiş.

---

### 8) `frontend/src/index.css`

**Gözlem**
- Güvenlik değil; UX açısından animasyonlar ve scrollbar gizleme var.
- `prefers-reduced-motion` için ticker'da kısmi destek mevcut.

**Risk Seviyesi: LOW (UX)**
- Global CSS'de bloklayıcı bir reset/overflow anti-pattern'i gözlenmedi.

---

## Test Durumu (İlişkili Güvenlik Senaryoları)

İlgili testler root/config hedefleriyle uyumlu güvenlik politikalarını doğruluyor:

1. `deployEnvResolution.test.js`
   - API resolver'ın canonical kullanımı ve production warning gate.
2. `apiConfig.test.js`
   - Production'da external `VITE_API_URL` için fail-closed davranış.
3. `chainPolicy.security.test.js`
   - Production chain allowlist'in Base mainnet ile sınırlı olması.

Bu test seti, "API URL ve chain env yanlışsa fail-closed mi?" sorusuna genel olarak **evet** yanıtı veriyor.

---

## Sonuç

- Production env validation / API policy: **genel olarak yeterli ve fail-closed** (özellikle external API URL bloklama ve chain allowlist testleri sayesinde).
- Vercel deploy security posture: **iyileştirilmeli** (CSP/HSTS/Permissions-Policy eksikleri).
- Source map/debug exposure: **explicit policy eksiği var** (`vite.config.js` içine açık `sourcemap: false` önerilir).
- Dependency & script hardening: **temel seviye mevcut**, security scan kapıları genişletilmeli.

## Takip Aksiyonları

1. `vite.config.js` için explicit production build hardening (özellikle sourcemap kapatma) değişikliği aç.
2. `vercel.json` header setini CSP + HSTS + Permissions-Policy ile güçlendir.
3. `package.json` içerisine security scan scriptleri ve CI gate ekle.
4. `.env.example` içine "`VITE_*` secret değildir" uyarısını standartlaştır.
