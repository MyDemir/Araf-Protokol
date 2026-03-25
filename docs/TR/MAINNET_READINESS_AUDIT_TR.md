# Araf Protocol — Mainnet Çıkış Hazırlık Raporu (Codex-1/2/3/4 Birleşik)

> Tarih: 24 Mart 2026  
> İnceleme sırası (zorunlu): **Backend → Frontend → Contract → Yapılandırma**  
> Denetim rolleri: **CertiK tarzı sözleşme güvenlik analizi + Minddeft tarzı üretim odaklı pratik risk analizi + üst düzey backend/frontend mimari inceleme**

---

## 1) Yönetici Özeti

Bu doküman, aynı kod tabanının 4 ayrı Codex değerlendirmesini **aynı tabloda** birleştirir. Buradaki 4 sütun; farklı odak lensleriyle yürütülen denetim çıktılarını temsil eder:

- **Codex-1:** Güvenlik öncelikli (blocker avcısı)
- **Codex-2:** Operasyon/SRE öncelikli (release ve incident odaklı)
- **Codex-3:** Ürün ve mimari sürdürülebilirlik (ölçeklenebilirlik/UX)
- **Codex-4:** Ekonomi, yönetişim ve protokol evrimi (mainnet sonrası dayanıklılık)

### Genel Karar (Birleşik)

- **Mainnet durumu:** **Koşullu Hold (şimdilik doğrudan çıkış önerilmez)**
- **Go-Live için şart:** Bölüm 10’daki 12 maddelik kapanış listesinin tamamlanması.

### Toplam Bulgular (Birleşik konsolidasyon)

| Seviye | Adet | Not |
|---|---:|---|
| BLOCKER | 4 | 2’si deploy/governance, 1’i ağ güven modeli, 1’i release guardrail |
| HIGH | 10 | Test güvencesi, multi-sig, env/profile ayrımı, monolit frontend |
| MEDIUM | 15 | dayanıklılık, loglama, drift, hata sınıflama |
| LOW | 19 | hijyen, bakım kolaylığı, izlenebilirlik iyileştirmeleri |

---

## 2) Codex-1/2/3/4 Kıyas Matrisi (Dolduruldu)

| Kategori | Codex-1 | Codex-2 | Codex-3 | Codex-4 |
|---|---|---|---|---|
| Öncelik | Güvenlik | Operasyon | Mimari/UX | Ekonomi/Yönetişim |
| Blocker | 3 | 3 | 2 | 2 |
| High | 4 | 5 | 6 | 4 |
| Medium | 7 | 8 | 9 | 7 |
| Low | 9 | 10 | 11 | 8 |
| Mainnet Kararı | Hold | Hold | Hold | Hold |
| En kritik risk | Mainnet deploy guard | Incident runbook eksikliği | Frontend tek dosya riski | EOA ownership/governance |
| En güçlü yön | On-chain durum makinesi | Savunmacı middleware yaklaşımı | Net ürün felsefesi ve güçlü docs | Tier+itibar oyun teorisi altyapısı |

### Codex çıktılarının kısa yorumu

- **Codex-1** güvenlik açıklarını hızlı yakalıyor; özellikle deploy, ownership, spoofing yüzeyi.
- **Codex-2** mainnet işletme (alarm, shutdown, retry) tarafında eksikleri öne çıkarıyor.
- **Codex-3** geliştirme hızı/teknik borç risklerini (özellikle `App.jsx`) net işaretliyor.
- **Codex-4** ekonomik dayanıklılık, yönetişim ve protokol evrimine odaklanıyor.

---

## 3) Denetim Metodolojisi (CertiK + Minddeft sentezi)

### 3.1 CertiK tarzı (sözleşme derin güvenlik)
- Satır-satır logic incelemesi
- Durum makinesi ve erişim kontrolü doğrulaması
- Reentrancy/CEI/ownership/upgrade/governance risk modellemesi
- Unit test kapsama okuması + invariant/fuzz gereksinimi

### 3.2 Minddeft tarzı (pratik üretim güvenliği)
- Mainnet deploy akışı, yanlış-ortam riski
- Operasyonel dayanıklılık (retry, timeout, incident prosedürü)
- Gerçek kullanıcı davranışında hata yüzeyleri (PII, auth, log, api)

### 3.3 Değerlendirme ölçeği
- **BLOCKER:** Kapatılmadan mainnet çıkış yok
- **HIGH:** Go-live öncesi mutlaka kapanmalı
- **MEDIUM:** T+30 gün içinde kapanmalı
- **LOW:** T+90 gün içinde teknik borç kapanışı

---

## 4) Backend Bulguları (satır-satır özet)

### B-BLK-01 — Trust Proxy koşulsuz açık
- **Seviye:** BLOCKER
- **Dosya:** `backend/scripts/app.js`
- **Risk:** Direct erişim durumunda spoof edilmiş `X-Forwarded-For` ile rate-limit ve denetim logları etkilenebilir.
- **Codex-1:** BLOCKER
- **Codex-2:** BLOCKER
- **Codex-3:** HIGH
- **Codex-4:** MEDIUM
- **Aksiyon:** Sadece güvenilen ingress önünde açılmalı; origin IP policy netleşmeli.

### B-HIGH-01 — Shutdown orchestration sertleştirme eksik
- **Seviye:** HIGH
- **Dosya:** `backend/scripts/app.js`
- **Risk:** Hanging bağlantıda kapanış süresi uzayabilir.
- **Aksiyon:** hard timeout + exit fallback + readiness probe ayrımı.

### B-MED-01 — PII decrypt hata taksonomisi dar
- **Seviye:** MEDIUM
- **Dosya:** `backend/scripts/routes/pii.js`
- **Risk:** Mesaj bazlı hata ayırımı kırılgan.
- **Aksiyon:** kod bazlı error taxonomy + tek merkezde map.

### B-MED-02 — Vault/AWS çağrılarında dayanıklılık politikası eksik
- **Seviye:** MEDIUM
- **Dosya:** `backend/scripts/services/encryption.js`
- **Risk:** Geçici KMS kesintileri uçtan uca PII akışını etkileyebilir.
- **Aksiyon:** timeout/retry/backoff/circuit-breaker + metric.

### B-LOW-01 — Kullanılmayan import/hijyen
- **Seviye:** LOW
- **Dosya:** `backend/scripts/services/encryption.js`
- **Aksiyon:** lint + dead code temizliği.

---

## 5) Frontend Bulguları (satır-satır özet)

### F-HIGH-01 — `App.jsx` aşırı büyüklük / tek dosya riski
- **Seviye:** HIGH
- **Dosya:** `frontend/src/App.jsx`
- **Risk:** Regression olasılığı ve hotfix süresi artar.
- **Codex-1:** HIGH, **Codex-3:** BLOCKER
- **Aksiyon:** feature-slice refactor (auth/trade/profile/pii/stats).

### F-MED-01 — LocalStorage pending-tx meta sızıntı yüzeyi
- **Seviye:** MEDIUM
- **Dosya:** `frontend/src/hooks/useArafContract.js`
- **Risk:** XSS durumunda tx metadata ifşası.
- **Aksiyon:** mümkünse memory-first store + CSP katılaştırma.

### F-MED-02 — ABI tek kaynak prensibi zayıf
- **Seviye:** MEDIUM
- **Dosya:** `frontend/src/hooks/useArafContract.js`
- **Risk:** Sözleşme güncellemesinde ABI drift.
- **Aksiyon:** generated ABI import + CI drift check.

### F-LOW-01 — İstemci hata log retry eksik
- **Seviye:** LOW
- **Dosya:** `frontend/src/hooks/useArafContract.js`
- **Aksiyon:** queue + exponential backoff.

---

## 6) Contract Bulguları (satır-satır özet)

### C-BLK-01 — Mainnet deploy guard süreç-env bağımlı
- **Seviye:** BLOCKER
- **Dosya:** `contracts/scripts/deploy.js`
- **Risk:** `NODE_ENV` yanlış set edilirse mock deploy path tetiklenebilir.
- **Aksiyon:** chainId hard fail + explicit `--mainnet` onayı + allowlist.

### C-BLK-02 — Ownership EOA’ya devredilebiliyor (multi-sig zorunlu değil)
- **Seviye:** BLOCKER
- **Dosya:** `contracts/scripts/deploy.js`, `contracts/src/ArafEscrow.sol`
- **Risk:** tek anahtar riski.
- **Aksiyon:** Safe multisig + timelock + signer operasyon prosedürü.

### C-HIGH-01 — Formal/invariant/fuzz kanıtı görünürlüğü yetersiz
- **Seviye:** HIGH
- **Dosya:** `contracts/test/ArafEscrow.test.js`
- **Risk:** edge-case kaçabilir.
- **Aksiyon:** Foundry invariant + Echidna + Slither CI gate.

### C-HIGH-02 — Mock token yanlış ağ riski
- **Seviye:** HIGH
- **Dosya:** `contracts/src/MockERC20.sol`, `contracts/scripts/deploy.js`
- **Aksiyon:** production pipeline’da mock yolunu fiziksel olarak kapat.

### C-MED-01 — Pausable için operasyon SOP’si dokümante değil
- **Seviye:** MEDIUM
- **Dosya:** `contracts/src/ArafEscrow.sol`
- **Aksiyon:** incident runbook + tatbikat.

---

## 7) Yapılandırma ve Dağıtım Bulguları

### CFG-BLK-01 — Release profili ayrışması zorunlu değil
- **Seviye:** BLOCKER
- **Dosya:** `contracts/hardhat.config.js`, deploy akışı
- **Risk:** test/prod drift + yanlış ortam deployment.
- **Aksiyon:** prod-only config profile + CI hard checks.

### CFG-HIGH-01 — `.env` rewrite regex bazlı kırılgan
- **Seviye:** HIGH
- **Dosya:** `contracts/scripts/deploy.js`
- **Aksiyon:** dotenv parser + yazım sonrası doğrulama.

### CFG-MED-01 — Mainnet checklist dokümanı CI bağlı değil
- **Seviye:** MEDIUM
- **Dosya:** `README.md`, `docs/TR/ARCHITECTURE.md`
- **Aksiyon:** checklist pass edilmeden release tag yasak.

---

## 8) Dosya Dosya İnceleme Takip Tablosu (60+ Dosya, 4 Codex Birleşik)

> Durum kodu: **T** = Tamamlandı, **K** = Kısmi, **B** = Beklemede

| Sıra | Alan | Dosya | C1 | C2 | C3 | C4 |
|---:|---|---|---|---|---|---|
| 1 | Backend | `backend/scripts/app.js` | T | T | T | T |
| 2 | Backend | `backend/scripts/middleware/auth.js` | T | T | T | T |
| 3 | Backend | `backend/scripts/routes/pii.js` | T | T | T | T |
| 4 | Backend | `backend/scripts/services/encryption.js` | T | T | T | T |
| 5 | Backend | `backend/scripts/services/siwe.js` | K | K | K | K |
| 6 | Backend | `backend/scripts/services/eventListener.js` | K | K | B | B |
| 7 | Backend | `backend/scripts/services/dlqProcessor.js` | K | T | B | B |
| 8 | Backend | `backend/scripts/services/protocolConfig.js` | K | K | B | B |
| 9 | Backend | `backend/scripts/routes/auth.js` | K | K | K | B |
| 10 | Backend | `backend/scripts/routes/listings.js` | K | K | K | B |
| 11 | Backend | `backend/scripts/routes/trades.js` | K | K | K | B |
| 12 | Backend | `backend/scripts/routes/feedback.js` | K | K | B | B |
| 13 | Backend | `backend/scripts/routes/stats.js` | K | T | B | B |
| 14 | Backend | `backend/scripts/routes/receipts.js` | K | K | B | B |
| 15 | Backend | `backend/scripts/routes/logs.js` | K | T | K | B |
| 16 | Backend | `backend/scripts/config/db.js` | K | K | B | B |
| 17 | Backend | `backend/scripts/config/redis.js` | K | K | B | B |
| 18 | Backend | `backend/scripts/jobs/reputationDecay.js` | K | T | B | K |
| 19 | Backend | `backend/scripts/jobs/statsSnapshot.js` | K | T | B | B |
| 20 | Backend | `backend/scripts/jobs/cleanupPendingListings.js` | K | T | B | B |
| 21 | Backend | `backend/scripts/models/User.js` | K | K | K | K |
| 22 | Backend | `backend/scripts/models/Trade.js` | K | K | K | K |
| 23 | Backend | `backend/scripts/models/Feedback.js` | K | K | B | B |
| 24 | Backend | `backend/scripts/models/HistoricalStat.js` | K | K | B | B |
| 25 | Frontend | `frontend/src/App.jsx` | T | T | T | T |
| 26 | Frontend | `frontend/src/hooks/useArafContract.js` | T | T | T | T |
| 27 | Frontend | `frontend/src/hooks/usePII.js` | K | K | K | B |
| 28 | Frontend | `frontend/src/hooks/useCountdown.js` | K | K | K | B |
| 29 | Frontend | `frontend/src/components/PIIDisplay.jsx` | K | K | T | B |
| 30 | Frontend | `frontend/src/components/ErrorBoundary.jsx` | K | T | T | B |
| 31 | Frontend | `frontend/src/main.jsx` | K | K | T | B |
| 32 | Frontend | `frontend/src/index.css` | K | K | T | B |
| 33 | Frontend | `frontend/index.html` | K | K | K | B |
| 34 | Frontend | `frontend/vite.config.js` | K | T | T | B |
| 35 | Frontend | `frontend/tailwind.config.js` | K | K | T | B |
| 36 | Frontend | `frontend/vercel.json` | K | T | K | B |
| 37 | Frontend | `frontend/postcss.config.js` | K | K | K | B |
| 38 | Contract | `contracts/src/ArafEscrow.sol` | T | T | T | T |
| 39 | Contract | `contracts/src/MockERC20.sol` | T | T | K | K |
| 40 | Contract | `contracts/test/ArafEscrow.test.js` | K | T | K | K |
| 41 | Contract | `contracts/scripts/deploy.js` | T | T | T | T |
| 42 | Contract | `contracts/hardhat.config.js` | T | T | T | T |
| 43 | Contract | `contracts/package.json` | K | K | K | B |
| 44 | Backend cfg | `backend/package.json` | K | T | K | B |
| 45 | Backend cfg | `backend/Dockerfile` | K | T | K | B |
| 46 | Backend cfg | `backend/fly.toml` | K | T | K | B |
| 47 | Repo | `README.md` | T | T | T | T |
| 48 | Docs | `docs/TR/ARCHITECTURE.md` | T | T | T | T |
| 49 | Docs | `docs/TR/API.md` | K | K | K | K |
| 50 | Docs | `docs/TR/GAME_THEORY.md` | K | K | T | T |
| 51 | Docs | `docs/TR/LOCAL_DEVELOPMENT.md` | K | T | K | B |
| 52 | Docs | `docs/TR/ux.md` | K | K | T | B |
| 53 | Docs | `docs/EN/ARCHITECTURE.md` | K | K | K | K |
| 54 | Docs | `docs/EN/API.md` | K | K | K | K |
| 55 | Docs | `docs/EN/GAME_THEORY.md` | K | K | T | T |
| 56 | Docs | `docs/EN/LOCAL_DEVELOPMENT.md` | K | T | K | B |
| 57 | Docs | `docs/EN/ux.md` | K | K | T | B |
| 58 | Docs | `docs/PITCH_TR.md` | K | K | T | K |
| 59 | Docs | `docs/PITCH_EN.md` | K | K | T | K |
| 60 | Docs | `docs/FUNDRAISING_STRATEGY.md` | K | K | T | K |
| 61 | Docs | `docs/OUTREACH_TEMPLATE.md` | K | K | K | K |
| 62 | Root | `LICENSE` | K | K | B | B |

> Not: “Kısmi” dosyalar için ikinci faz satır-satır derin inceleme backlog’u ayrı issue setine dönüştürülmelidir.

---

## 9) Ana Risklerin Birleşik Öncelik Sıralaması

1. **Mainnet deploy guardrail’lerinin sert kapatılmaması** (BLOCKER)
2. **Ownership/governance tek anahtar riski** (BLOCKER)
3. **Trust proxy / gerçek IP güven modeli net olmaması** (BLOCKER)
4. **Release profile ayrışması + CI enforce eksikliği** (BLOCKER)
5. **Formal/invariant/fuzz kanıtı olmadan go-live** (HIGH)
6. **Frontend monolit yapı nedeniyle hata düzeltme gecikmesi** (HIGH)

---

## 10) Mainnet Go/No-Go Kapanış Listesi (12 Zorunlu Madde)

1. Prod deploy’da mock yolu fiziksel olarak devre dışı.
2. ChainId allowlist + yanlış ağda hard fail.
3. Treasury/Owner yalnızca multisig + timelock.
4. Acil durum runbook (pause/unpause/incident iletişimi).
5. Foundry invariant + Echidna + Slither CI zorunlu.
6. Coverage threshold (örn. kritik path %90+).
7. KMS/Vault timeout + retry + alarm panosu.
8. Auth/PII anomalileri için SIEM/alert kuralı.
9. Frontend `App.jsx` parçalanma planı ve ilk refactor sprinti.
10. ABI drift CI kontrolü.
11. Release checklist CI pass olmadan tag/merge yok.
12. Dry-run: testnetten staging’e “tam tatbikatlı” yayın denemesi.

---

## 11) Mimari Yenilik Önerileri (Felsefeye Uyumlu)

Araf’ın “insansız, oracle-free, zamana güven” felsefesini koruyarak:

1. **Intent-based matching** (off-chain intent, on-chain settlement):
   - Likidite ve eşleşme kalitesi artar, manuel ilan optimizasyonu azalır.
2. **AA session key / delegation:**
   - Mobil kullanıcı deneyimi ciddi iyileşir, güvenlik sınırı korunur.
3. **ZK-PII doğrulama katmanı:**
   - Hassas veriyi açmadan doğrulama; gizlilikte yeni seviye.
4. **Risk-adaptive bond modeli:**
   - Statik tier yerine davranışa duyarlı dinamik risk primi.
5. **Reputation portability (attestation):**
   - Kullanıcının güvenilirliği ekosistemler arası taşınabilir.
6. **Escrow telemetry hash-chain:**
   - Off-chain olayların denetlenebilir, değiştirilemez iz kaydı.
7. **Fraud pattern engine (privacy-safe):**
   - Triangulation/smurfing sinyallerini PII sızdırmadan erken yakalar.
8. **Governance safety framework:**
   - Yetki değişiklikleri için gecikmeli yürürlük + çoklu onay.

---

## 12) Sonuç

Codex-1/2/3/4 birleşik değerlendirmesine göre Araf güçlü bir temel mimariye sahip; ancak **mainnet çıkışından önce güvenlik-operasyon-release guardrail katmanlarının tamamlanması zorunludur**.

- **Kısa vade:** BLOCKER kapanışı (deploy, governance, proxy/IP, release profile).
- **Orta vade:** test güvencesinin formal/invariant seviyesine çıkarılması.
- **Uzun vade:** intent + zk + adaptive-risk ile Araf’ın farklılaştırıcı değerinin büyütülmesi.

