# Audit — Frontend App Policy/Helper Surfaces

Tarih: 2026-04-30  
Kapsam:
- `frontend/src/app/apiConfig.js`
- `frontend/src/app/chainPolicy.js`
- `frontend/src/app/fillAmountPolicy.js`
- `frontend/src/app/orderUiModel.js`
- `frontend/src/app/bootstrapState.js`
- `frontend/src/app/useAppSessionData.jsx`
- `frontend/src/app/AppViews.jsx`
- `frontend/src/app/AppModals.jsx`

İlişkili testler:
- `frontend/src/test/apiConfig.test.js`
- `frontend/src/test/apiPathAlignment.test.js`
- `frontend/src/test/chainPolicy.security.test.js`
- `frontend/src/test/deployEnvResolution.test.js`
- `frontend/src/test/fillAmountPolicy.test.js`
- `frontend/src/test/orderUiModel.test.js`
- `frontend/src/test/bootstrapState.test.js`
- `frontend/src/test/AppViews.test.jsx`
- `frontend/src/test/AppModals.test.jsx`
- `frontend/src/test/useAppSessionData.reputationMapping.test.js`

---

## Sonuç Özeti

- `apiConfig` production’da external absolute API base’i reddediyor (fail-closed), same-origin `/api` modeli korunuyor.
- `chainPolicy` production için yalnız Base Mainnet (8453) destekli; dev ortamı kontrollü geniş.
- `fillAmountPolicy` partial-fill validasyonunda fail-closed; invalid input’ta sessiz fallback yok.
- `orderUiModel` side/status mapping ve action resolution tarafında invalid side için non-actionable/throw davranışıyla güvenli.
- `useAppSessionData` session-wallet mismatch, auth refresh, pending tx recovery, reputation/settlement mapping katmanlarında güçlü guard içeriyor.
- `AppViews` ve `AppModals` çoğu alanda authority üretmeyen UI semantiği taşıyor; backend/contract authority notları açık.

---

## Bulgular

### MEDIUM — `mapReputationToSessionView` BigInt→Number dönüşümü safe-range guard içermiyor

**Nerede**: `useAppSessionData.mapReputationToSessionView`.

**Detay**:
- V3 reputation alanları `Number(...)` ile normalize ediliyor.
- Bugünkü ölçeklerde pratikte sorun görünmese de teorik olarak `MAX_SAFE_INTEGER` üstü değerlerde precision-loss oluşabilir.

**Etkisi**:
- UI sayaçlarında ileri dönemde yuvarlama/taşma kaynaklı yanlış görselleştirme.

**Öneri**:
- `toSafeNum` benzeri guard ile büyük değerlerde `null`/string fallback veya BigInt-safe format uygulanmalı.

---

### MEDIUM — `bootstrapState` localStorage’daki terms/lang değerleri için TTL/versiyonlama yok

**Nerede**: `bootstrapState.js`.

**Detay**:
- `APP_LANG_STORAGE_KEY` ve `TERMS_ACCEPTED_STORAGE_KEY` doğrudan hydrate ediliyor.
- Terms metni değiştiğinde yeniden onay gerektiren versiyonlama alanı bulunmuyor.

**Etkisi**:
- Hukuki/UX tutarlılığı açısından stale consent riski.

**Öneri**:
- `terms_version` anahtarı ile semantik versiyon kontrolü eklenmeli.

---

### LOW — Admin entry görünürlüğü AppViews’te UX-only, yetki algısı yaratabilir

**Nerede**: `AppViews` `canSeeAdminEntry`.

**Detay**:
- Authenticated wallet’lara admin entry gösteriliyor; allowlist yalnız hint.
- Backend yetkisi nihai karar veriyor (iyi), ancak kullanıcı beklentisi yanlış oluşabilir.

**Etkisi**:
- Güvenlik bypass değil; beklenti yönetimi riski.

**Öneri**:
- Non-admin wallet için daha belirgin “observability only / server-authorized” rozet/metni.

---

## Hedef Bazlı Değerlendirme

1. **API base URL production’da güvenli mi?**  
   Evet. Production’da external absolute `VITE_API_URL` fail-closed hata veriyor; canonical same-origin `/api` kullanılıyor.

2. **Chain policy fail-closed mu?**  
   Evet. Prod’da yalnız `8453`; desteklenmeyen chain false dönüyor.

3. **Wrong chain/wrong contract durumunda işlem engelleniyor mu?**  
   Hook/write path’te büyük ölçüde evet (chain + address guard). Read path’te bazı yerlerde soft-fail (`null/0`) stratejisi var.

4. **Fill amount min/max/decimal validation doğru mu?**  
   Evet. `fillAmountPolicy` >0, <=remaining, minFill kuralı ve parse fail-closed uyguluyor. Token decimals validasyonu ilgili hooklarda ayrı kontrol ediliyor.

5. **Order side/status UI mapping contract/backend ile uyumlu mu?**  
   Evet. `SELL_CRYPTO/BUY_CRYPTO` side-aware action routing doğru; invalid side non-actionable.

6. **Bootstrap state stale data üretebilir mi?**  
   Dil/terms için evet, özellikle terms versiyon değişimlerinde stale acceptance mümkün.

7. **useAppSessionData reputation/identity mapping doğru mu?**  
   Genel olarak doğru ve fail-closed; session-wallet mismatch ve auth revalidation güçlü. Reputation counter mapping doğru alanları taşıyor, fakat Number precision guard eksik.

8. **AppViews auth/session guard doğru mu?**  
   Evet. Auth checked/session koşulları ve UX-only/admin-authority ayrımı çoğunlukla doğru uygulanmış.

9. **AppModals stale prop veya yanlış trade riski taşıyor mu?**  
   Düşük-orta düzeyde UX riski olabilir (hızlı context değişimi). Ancak çoğu aksiyon explicit guardlar ve parent state resetleriyle korunuyor.

---

## Kapanış

Policy/helper katmanları genel olarak fail-closed ve contract-authoritative tasarımla uyumludur; ana iyileştirme alanları reputation numeric safety, terms-versioning ve admin UX netliğidir.
