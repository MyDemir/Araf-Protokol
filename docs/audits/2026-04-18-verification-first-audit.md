# Executive Summary

- **High:** Backend `propose-cancel` koordinasyon endpoint'i trade state kontrolü yapmıyor; kontratta iptal edilemeyecek durumlar için bile iki imza toplayıp “Kontrata gönderilebilir” mesajı üretebiliyor. Bu, kullanıcıya yanlış başarı hissi veriyor ve frontend-backend-contract authority drift yaratıyor.
- **High:** Event mirror worker’da `EscrowLocked` işleyicisi, non-terminal tüm statülerde `status=LOCKED` yazabildiği için (örn. `PAID/CHALLENGED`) gecikmiş/DLQ replay senaryolarında state regression üretebilir; bu da PII erişimi, trade odası aksiyonları ve UI kararlarını yanlış hale getirebilir.
- **Medium:** Auth cookie’leri `SameSite=Lax` olarak sabit. Frontend ise `VITE_API_URL` ile farklı origin API kullanımını destekliyor. Cross-origin XHR + credential akışında cookie taşınamadığı için SIWE/JWT/refresh akışı prod’da kırılabilir.
- **Low:** Production’da `ALLOWED_ORIGINS` boş bırakıldığında default `http://localhost:5173` kullanılmaya devam ediyor. Bu fail-closed değil; backend ayağa kalkıyor ama gerçek origin’ler CORS nedeniyle bloklanıyor (sessiz deploy kırığı).

**Genel risk profili:** Kontrat tarafında temel erişim ve state geçişleri iyi korunmuş; ancak backend mirror/idempotency ve frontend-backend-session/deploy hizasında gerçek kullanıcı akışlarını bozabilecek yüksek etkili mantıksal kırıklar mevcut.

---

# Scope Mapped

## İncelenen ana klasörler
- `frontend/`
- `backend/`
- `contracts/`

## Kritik entrypoint ve modüller
- Frontend: `src/app/useAppSessionData.jsx`, `src/app/apiConfig.js`, `src/hooks/useArafContract.js`
- Backend: `scripts/app.js`, `scripts/routes/auth.js`, `scripts/routes/trades.js`, `scripts/routes/pii.js`, `scripts/services/eventListener.js`, `scripts/services/siwe.js`
- Contracts: `src/ArafEscrow.sol`

## Frontend → Backend → Contract akış haritası (özet)
1. **Connect / Sign-in**: Frontend `auth/nonce` + SIWE verify -> backend JWT/refresh cookie.
2. **Session restore**: Frontend `auth/me`, 401’de `auth/refresh`, mismatch’te local + backend logout.
3. **Order lifecycle**: Frontend kontrata write (`create/fill/cancel`), backend event worker `Order*` + `Trade*` mirror.
4. **Trade lifecycle**: `LOCKED/PAID/CHALLENGED/RESOLVED/CANCELED/BURNED` state’leri chain event’leriyle backend mirror ve UI’a taşınıyor.
5. **PII access**: Trade-scoped token + session wallet match + active state gating.

## Yüksek riskli görülen modüller
- `backend/scripts/services/eventListener.js` (event ordering, replay, state regression riski)
- `backend/scripts/routes/trades.js` (`propose-cancel` contract/DB status alignment)
- `backend/scripts/routes/auth.js` + `frontend/src/app/apiConfig.js` (cookie/session + deploy-origin alignment)

---

# Journey Invariants & Kırılma Noktaları

## 1) Bağlan / sign-in / sign-out
**Beklenen invariant:** Session cookie wallet = aktif bağlı wallet; refresh rotasyonu bu eşleşmeyi korumalı.

**Kırılma noktaları:**
- Cross-origin deploy’da cookie taşınamazsa auth döngüsü (signin başarılı gibi görünür ama sonraki çağrılar 401).
- `ALLOWED_ORIGINS` yanlış default ile prod’da sessizce kırılabilir.

## 2) Order oluştur / fill / cancel
**Beklenen invariant:** Authority kontratta; backend yalnız mirror/read.

**Kırılma noktaları:**
- Event ordering/replay sonrası backend mirror status regression (LOCKED geri yazımı) ile frontend aksiyonları yanlış açılabilir/kapanabilir.

## 3) Trade state geçişleri
**Beklenen invariant:** state monotonic ilerlemeli (terminal hariç geriye dönmemeli).

**Kırılma noktaları:**
- `EscrowLocked` geç işlenirse `PAID/CHALLENGED` trade tekrar `LOCKED` yapılabiliyor.

## 4) Cancel journey (off-chain imza koordinasyonu + on-chain finalize)
**Beklenen invariant:** Backend’in “bothSigned / kontrata gönderilebilir” mesajı kontrat state koşullarıyla uyumlu olmalı.

**Kırılma noktaları:**
- Backend route trade state doğrulamadığı için kontratta revert edecek işlemlere başarılı koordinasyon cevabı dönebiliyor.

## 5) PII fetch
**Beklenen invariant:** yalnız aktif trade + session wallet + trade-scoped token.

**Kırılma noktaları:**
- Mirror state drift varsa aktif/aktif değil kararı yanlış olabilir.

## 6) Session restore / failure recovery
**Beklenen invariant:** network/auth failure’da kullanıcı güvenli biçimde signed-out olur, yanlış başarı hissi oluşmaz.

**Kırılma noktaları:**
- Cookie/origin drift nedeniyle sürekli refresh denemeleri ve sign-in loop.

---

# Confirmed Findings

## [HIGH] `propose-cancel` state doğrulaması yok, kontratla authority drift ve false-success üretiyor
- Category: business logic
- Affected files:
  - `backend/scripts/routes/trades.js`
  - `contracts/src/ArafEscrow.sol`
- Affected functions/modules:
  - `POST /api/trades/propose-cancel`
  - `proposeOrApproveCancel(...)`
- Impact:
  - Backend, kontratta geçersiz state’te olan trade için de imza kabul edip `bothSigned=true` ve “Kontrata gönderilebilir” mesajı dönebiliyor.
  - Kullanıcı akışı yanlış yönleniyor; UI’da yanlış başarı hissi oluşuyor.
- Exploit / failure scenario:
  1. Trade `RESOLVED` veya `CANCELED` durumda.
  2. Taraflar backend `/propose-cancel` endpoint’ine geçerli EIP-712 imza gönderiyor.
  3. Backend state kontrolü yapmadığı için imzaları kaydediyor ve iki imza toplanınca başarı mesajı dönüyor.
  4. On-chain `proposeOrApproveCancel` çağrısı kontratta state guard nedeniyle revert ediyor.
- Root cause:
  - Backend route’ta trade state için allowlist kontrolü yok.
  - Kontrat tarafında ise açıkça yalnız `LOCKED/PAID/CHALLENGED` kabul ediliyor.
- Why this is real:
  - Backend route’ta party/deadline/sig doğrulaması var ama status check yok.
  - Kontrat fonksiyonunda status guard net şekilde mevcut.
- Minimal fix:
  - Backend route’a `trade.status ∈ {LOCKED, PAID, CHALLENGED}` kontrolü eklenmeli.
  - Başarı mesajı “contract precheck passed” semantiğine çekilmeli.
- Regression tests to add:
  - Trade status `RESOLVED/CANCELED/BURNED` iken `/propose-cancel` -> `409`/`400` beklenmeli.
  - Sadece aktif state’lerde `bothSigned` akışının geçtiği test.

## [HIGH] Event mirror’da `EscrowLocked` replay/out-of-order durumunda state regression mümkün
- Category: reliability
- Affected files:
  - `backend/scripts/services/eventListener.js`
- Affected functions/modules:
  - `_onEscrowLocked(...)`
  - `_captureLockedTradeSnapshot(...)`
- Impact:
  - `PAID`/`CHALLENGED` gibi ilerlemiş trade, geç gelen `EscrowLocked` işlenince tekrar `LOCKED`’a düşebilir.
  - Bu drift, PII erişim kapıları, UI aksiyon butonları ve kullanıcı kararlarını bozabilir.
- Exploit / failure scenario:
  1. Trade normalde `LOCKED -> PAID` ilerliyor.
  2. `EscrowLocked` event’i gecikmeli (retry/DLQ/redrive) işleniyor.
  3. Handler yalnız terminal state’leri engelliyor, non-terminal state’lerde devam ediyor.
  4. Snapshot helper `status: LOCKED` yazarak state’i geri sarıyor.
- Root cause:
  - Monotonic state guard eksik; yalnız terminal state bloklanıyor.
  - Update filtresi de non-terminal tüm statülere açık.
- Why this is real:
  - Kod doğrudan `status: "LOCKED"` set ediyor ve filtre `status: {$nin:[RESOLVED,CANCELED,BURNED]}`.
- Minimal fix:
  - `_onEscrowLocked` içinde yalnız `OPEN/LOCKED` kabul edilmeli; `PAID/CHALLENGED` görüldüğünde no-op.
  - `findOneAndUpdate` filtresi `status: {$in:["OPEN","LOCKED"]}` ile daraltılmalı.
- Regression tests to add:
  - Sentetik sıra: `PaymentReported` sonrası `EscrowLocked` replay -> status `PAID` kalmalı.
  - DLQ redrive senaryosunda state monotonicliği testi.

## [MEDIUM] Cookie `SameSite=Lax` + cross-origin API desteği birlikte auth/session akışını kırabiliyor
- Category: deploy/config
- Affected files:
  - `backend/scripts/routes/auth.js`
  - `frontend/src/app/apiConfig.js`
  - `frontend/src/app/useAppSessionData.jsx`
- Affected functions/modules:
  - Cookie option helpers (`_getJwtCookieOptions`, `_getRefreshCookieOptions`)
  - `resolveApiBaseUrl(...)`
  - `authenticatedFetch(...)`
- Impact:
  - Frontend farklı origin API kullanacak şekilde konfigüre edilirse (`VITE_API_URL=https://api...`), credentialed fetch’te auth/refresh cookie taşınmayabilir.
  - Kullanıcı login sonrası 401/refresh loop yaşayabilir.
- Exploit / failure scenario:
  1. Prod deploy’da frontend ve backend farklı origin.
  2. Frontend `credentials: include` ile auth çağrısı yapıyor.
  3. Cookie `SameSite=Lax` olduğundan cross-site XHR’da cookie gönderimi kısıtlanıyor.
  4. `auth/me` ve devamındaki protected endpoint’ler başarısız.
- Root cause:
  - Backend cookie politikası cross-site kullanım senaryosuna göre dinamik değil.
  - Frontend config resolver farklı origin API’yi açıkça destekliyor.
- Why this is real:
  - Kodda `sameSite: "lax"` sabit.
  - Frontend raw `VITE_API_URL` değerini doğrudan `https://.../api` şekline normalize ediyor.
- Minimal fix:
  - Cross-origin prod senaryosu desteklenecekse `SameSite=None; Secure` (yalnız production + explicit allowlist) seçeneği eklenmeli.
  - Aksi durumda external origin kullanımı build-time’da reddedilmeli.
- Regression tests to add:
  - Env matrix testi: same-origin vs cross-origin deploy modlarında cookie policy doğrulama.
  - E2E: signin -> `auth/me` -> protected endpoint zinciri.

## [LOW] Production’da `ALLOWED_ORIGINS` yokken localhost default’u ile sunucu açılıyor (sessiz deploy kırığı)
- Category: deploy/config
- Affected files:
  - `backend/scripts/app.js`
- Affected functions/modules:
  - CORS bootstrap (`allowedOrigins` hesaplama + production kontrolleri)
- Impact:
  - Prod’da env eksikse backend fail etmiyor; yalnızca `http://localhost:5173` izinli kalıyor.
  - Gerçek frontend origin’i CORS tarafından bloklanıyor; runtime’da “neden çalışmıyor” tipi sessiz kırık oluşuyor.
- Exploit / failure scenario:
  1. Prod deploy’da `ALLOWED_ORIGINS` set edilmemiş.
  2. Backend default localhost origin ile başlıyor.
  3. Gerçek client origin’den credentialed istekler CORS hatası alıyor.
- Root cause:
  - Production guard boş/wildcard kontrolü yapıyor ama localhost default kullanımını engellemiyor.
- Why this is real:
  - `allowedOrigins` hesaplamasında default localhost var.
  - Production branch’te localhost’a özel yasak yok.
- Minimal fix:
  - Production’da `ALLOWED_ORIGINS` zorunlu hale getirilmeli; default fallback kaldırılmalı.
- Regression tests to add:
  - `NODE_ENV=production` ve `ALLOWED_ORIGINS` unset iken process’in fail etmesini doğrulayan test.

---

# Watchlist / Needs Verification

- **Order/trade id Number sınırı:** Event worker kimliklerde `Number(...)` kullanıyor. Çok büyük on-chain id’lerde precision drift ihtimali var. Pratikte kısa vadede düşük olasılık, ama uzun ömürlü protokol için BigInt-first storage stratejisi değerlendirilmeli.
- **Cancel imza UX senkronu:** Backend nonce doğrulaması anlık on-chain nonce’a bağlı. Kullanıcı aynı nonce ile başka kanaldan işlem yaptıysa backend’de toplanmış imzalar stale hale gelebilir; UX tarafında “imza eskidi / yeniden imzala” mesajı netleştirilmeli.
- **Hardhat compiler fetch bağımlılığı:** Test/compile çevrimdışı/proxy kısıtlı ortamlarda kırılıyor; CI determinism için solc binary/cache stratejisi incelenmeli.

---

# Missing Tests / Coverage Gaps

- **Mirror monotonicity testleri eksik:** `EscrowLocked` geç replay edildiğinde state regression olmaması testlenmiyor.
- **Cancel route state-alignment testi eksik:** Backend `/propose-cancel` ile kontrat allowed state’lerinin birebir hizası testlenmiyor.
- **Deploy matrix testi eksik:**
  - Same-origin rewrite (Vercel) akışı,
  - Cross-origin API akışı,
  - Cookie SameSite/secure davranışı.
- **Auth recovery e2e eksik:** `auth/me -> refresh -> retry` zinciri wallet switch sırasında yarış koşullarında doğrulanmıyor.
- **PII gating under drift eksik:** Backend trade state drift olduğunda PII route kararlarının doğru kaldığını doğrulayan test yok.

---

# Suggested Next Fix Order

1. **[HIGH] `propose-cancel` state guard**
   - Kullanıcıyı yanlış başarı hissine sokuyor; kontratla doğrudan çelişkili.
2. **[HIGH] Event mirror LOCKED regression düzeltmesi**
   - Data/state drift tüm katmanlara yayılan sistemik bir kırık.
3. **[MEDIUM] Cookie/origin deploy alignment**
   - Prod ortamında login/session akışını tamamen kilitleyebilir.
4. **[LOW] Production CORS env fail-closed**
   - Operasyonel hata maliyetini düşürür, sessiz kırıkları önler.
5. **Coverage genişletme (regression + deploy matrix + e2e)**
   - Yukarıdaki düzeltmelerin kalıcılığını sağlar.

---

# Verification Notes (Executed Checks)

- `npm --prefix frontend test` → **PASS**
- `npm --prefix frontend run build` → **PASS**
- `npm --prefix backend test` → **PASS**
- `npm --prefix contracts test` → **FAILED (env/proxy kaynaklı compiler download hatası)**
- `npm --prefix contracts run compile` → **FAILED (env/proxy kaynaklı compiler download hatası)**

