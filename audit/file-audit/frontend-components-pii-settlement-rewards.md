# Frontend Components Audit — PII / Settlement / Rewards / Risk / Error

Tarih: 2026-04-30

## Kapsam
Bileşenler:
- `frontend/src/components/PIIDisplay.jsx`
- `frontend/src/components/SettlementPreviewModal.jsx`
- `frontend/src/components/SettlementProposalCard.jsx`
- `frontend/src/components/RewardsDashboard.jsx`
- `frontend/src/components/PaymentRiskBadge.jsx`
- `frontend/src/components/ReferenceRateTicker.jsx`
- `frontend/src/components/ErrorBoundary.jsx`

İlişkili yüzeyler:
- `frontend/src/hooks/usePII.js`
- `frontend/src/hooks/useRewardsContract.js`
- `frontend/src/hooks/useArafContract.js`
- `backend/scripts/routes/pii.js`
- `backend/scripts/routes/trades.js`
- `backend/scripts/routes/rewards.js`
- `contracts/src/ArafEscrow.sol`
- `contracts/src/ArafRewards.sol`

İlişkili testler:
- `frontend/src/test/PIIDisplay.test.jsx`
- `frontend/src/test/SettlementProposalCard.test.js`
- `frontend/src/test/RewardsDashboard.test.jsx`
- `frontend/src/test/PaymentRiskBadge.test.jsx`
- `frontend/src/test/ReferenceRateTicker.test.jsx`

---

## Executive Summary

- Oracle-free dispute modelini frontend’in bozduğuna dair bulgu yok.
- Settlement/release/burn/payout authority’nin kontratta kaldığı yönünde UI copy ve guardlar güçlü.
- Ancak aşağıdaki güvenlik/uyum riskleri mevcut:

1. **MEDIUM — PIIDisplay: reveal sonrası PII DOM’da kullanıcı aksiyonuna kadar kalıyor.**
2. **MEDIUM — SettlementProposalCard: `activeTrade` snapshot gecikmesinde stale proposal kısa süre gösterilebilir.**
3. **MEDIUM — RewardsDashboard: `claimableAmount ?? '0'` fallback’i read-failure ile gerçek 0 ayrımını net vermiyor.**
4. **LOW — ErrorBoundary: message/stack scrub var; `url` query-string üzerinden PII gelebilir.**

---

## Hedef Bazlı Değerlendirme

### 1) PII yanlış role/state için gösterilebilir mi?
- `PIIDisplay` doğrudan role gate yapmıyor; gate backend token + endpoint auth ile sağlanıyor (`usePII` iki adımlı token akışı).
- Frontend tarafında bu model kabul edilebilir; authority backend+session’da.
- **Risk:** LOW (frontend tek başına yetki veremez).

### 2) Sensitive data DOM’da gereksiz uzun kalıyor mu?
- Reveal sonrası `pii` state’te ve DOM’da kalır; temizleme kullanıcı `Hide` yapınca veya trade scope değişince/unmount’ta olur.
- Background tab senaryosu veya route geçişlerinde kısa süreli görünürlük penceresi var.
- **Risk:** MEDIUM.

### 3) Settlement preview contract authority gibi gösteriliyor mu?
- `SettlementPreviewModal` net “informational only/non-authoritative” metni veriyor.
- `SettlementProposalCard` tarafında da neutrality copy bulunuyor.
- **Risk:** LOW (copy güçlü).

### 4) Settlement proposal card stale proposal gösterebilir mi?
- Kart `activeTrade?.settlementProposal` snapshot’ına bağlı; tx sonrası `fetchMyTrades` çağrısı var.
- Network gecikmesi / eventual consistency penceresinde kısa süre stale render mümkün.
- **Risk:** MEDIUM (UX/state drift).

### 5) RewardsDashboard yanlış claimable/finalized state gösterebilir mi?
- `My Claimable: {String(claimableAmount ?? '0')}` fallback’i read-error/null ile real-zero ayrımını göstermiyor.
- Buton disable guard’ı iyi (`!claimableAmount || BigInt(claimableAmount)===0n`) fakat kullanıcıya “yüklenemedi” sinyali yok.
- **Risk:** MEDIUM.

### 6) PaymentRiskBadge kullanıcıyı yanlış yönlendiriyor mu?
- Bileşen açıkça “non-authoritative/config signal” diyor.
- Counterparty hakkında hüküm vermediği vurgulanıyor.
- **Risk:** LOW.

### 7) ReferenceRateTicker fiyat/oran authority’si gibi davranıyor mu?
- Bilgilendirici olduğuna dair copy var; `informationalOnly` flag false ise amber uyarı gösteriliyor.
- Settlement etkisi olmadığı copy ile belirtilmiş.
- **Risk:** LOW.

### 8) ErrorBoundary hata objesinden secret/PII basıyor mu?
- `message` ve `stack` scrub mevcut; componentStack satır limiti var.
- Ancak `url: window.location.href` ham gönderiliyor; query-string’te kullanıcı datası varsa loglanabilir.
- **Risk:** LOW.

### 9) Component testleri gerçek edge-case’leri kapsıyor mu?
- Mevcut testler non-authoritative copy, chain/state gating, preview guards ve temel PII akışlarını kapsıyor.
- Eklenmesi önerilenler:
  - PIIDisplay: trade switch sırasında stale DOM PII regression testi.
  - RewardsDashboard: read-failure/null ve zero ayrımı UI testi.
  - ErrorBoundary: query-string redaction politikası için unit testi.

---

## Sonuç

Belirtilen component seti içinde, ekonomik karar yetkisini frontend/backend’e kaydıran bir implementasyon gözlenmedi; authority kontrat merkezli kalıyor. Kritik açık bulunmadı. Ana iyileştirme alanları PII yaşam süresi (DOM/state), settlement snapshot tazeliği ve rewards read-failure ayrıştırmasıdır.
