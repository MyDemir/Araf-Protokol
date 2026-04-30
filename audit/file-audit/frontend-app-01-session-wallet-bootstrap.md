# Audit — `frontend/src/App.jsx` (Session/Wallet/Bootstrap Slice 01)

Tarih: 2026-04-30  
Kapsam (bu tur):
- imports
- top-level constants
- wallet connection state
- SIWE login/session logic
- authenticated wallet vs connected wallet ayrımı
- bootstrap/initial load
- localStorage/sessionStorage kullanımı
- wallet switch handling
- logout/session invalidation

İlişkili dosyalar:
- `frontend/src/app/useAppSessionData.jsx`
- `frontend/src/app/bootstrapState.js`
- `frontend/src/app/apiConfig.js`
- `frontend/src/app/chainPolicy.js`
- `backend/scripts/routes/auth.js`
- `backend/scripts/middleware/auth.js`
- `frontend/src/test/sessionGuardRegression.test.js`
- `frontend/src/test/sessionMapping.test.js`
- `frontend/src/test/useAppSessionDataAuthChecked.test.jsx`

---

## Sonuç Özeti

- Connected wallet (`connectedWallet`) ile authenticated wallet (`authenticatedWallet`) ayrımı açık ve çok katmanlı guard ile korunuyor.
- `authChecked` kapısı, session doğrulaması tamamlanmadan korumalı akışların tetiklenmesini engelliyor (flash-close race mitigasyonu mevcut).
- Wallet switch sonrası hem frontend state temizliği hem backend session invalidation/revoke akışları uygulanıyor.
- localStorage kullanımı sınırlı: dil/terms/pendingTx; doğrudan PII/JWT saklanmıyor.
- Kritik ekonomi authority devri yok; session katmanı yalnız erişim kontrolü yapıyor.

---

## Bulgular

### MEDIUM — SIWE verify sonrası eşleşme kontrolü `connectedWallet` state’ine bağımlı (zamanlama penceresi)

**Nerede**: `loginWithSIWE` içinde verify yanıtı sonrası `verifiedWallet !== connectedWallet` kontrolü.

**Detay**:
- React state güncellemeleri asenkron olduğu için `connectedWallet` değeri, hızlı wallet switch senaryolarında çok kısa bir pencerede stale kalabilir.
- Mevcut mimaride bu risk büyük ölçüde `useAppSessionData` içindeki `/auth/me` revalidation + mismatch logout katmanlarıyla telafi ediliyor.

**Etkisi**:
- Kısa süreli yanlış toast/message veya geçici auth state dalgalanması olabilir.
- Kalıcı yanlış session kalması düşük olasılık; sonraki guard katmanları temizliyor.

**Öneri**:
- Verify anında doğrudan `address?.toLowerCase()` ile karşılaştırma veya immutable login-attempt wallet snapshot kullanımı daha deterministik olur.

---

### LOW — Pending tx recovery kaydı wallet-bound değil

**Nerede**: `localStorage.araf_pending_tx` okuma/yeniden-hidratasyon akışı.

**Detay**:
- Kayıt `hash/functionName/chainId/escrow/createdAt` içeriyor; wallet adresiyle açık bağ yok.
- `isAuthenticated` guard’ı ve trade fetch akışlarıyla pratik risk sınırlı; yine de shared browser profili / hızlı hesap geçişinde yanlış kullanıcıya “pending tx bulundu” toast’ı görülebilir.

**Etkisi**:
- Güvenlik authority ihlali değil; UX karmaşası.

**Öneri**:
- Pending tx kaydına `wallet` eklenip recovery sırasında `connectedWallet` ile eşleştirme yapılmalı.

---

## Hedef Bazlı Değerlendirme

1. **Connected wallet ile authenticated wallet karışıyor mu?**  
   Genel olarak hayır. Ayrım explicit tutuluyor; `hasSignedSessionForActiveWallet` ve mismatch efektleri ile korunuyor.

2. **Wallet switch sonrası eski session kullanılabilir mi?**  
   Düşük ihtimal. Backend `requireSessionWalletMatch` + `/auth/me` mismatch 409 + frontend `bestEffortBackendLogout + clearLocalSessionState` katmanları eski session’ı düşürüyor.

3. **Auth checked olmadan protected data render ediliyor mu?**  
   Çekirdek akışta gate mevcut. `requireSignedSessionForActiveWallet` önce `authChecked` kontrol ediyor; testte de regression guard doğrulanmış.

4. **localStorage’da hassas veri var mı?**  
   Doğrudan PII/JWT yok. Sadece dil, terms ve pending tx meta bilgisi var.

5. **Pending tx/session data yanlış kullanıcıya taşınabilir mi?**  
   Kısmen UX seviyesinde mümkün (wallet-bound olmayan pending tx kaydı). Session authority backend guardlarıyla korunuyor.

6. **Logout tüm hassas state’i temizliyor mu?**  
   Evet; backend logout çağrısı + local state reset + pending tx silme + disconnect akışı var.

7. **Race condition: login devam ederken wallet değişirse ne olur?**  
   Ön kontrolde mismatch yakalanıyor; kaçan senaryolar `/auth/me` revalidation ve runtime wallet event guardlarıyla kapanıyor.

8. **Error/toast kullanıcıya yanlış bilgi veriyor mu?**  
   Büyük ölçüde doğru ve fail-closed odaklı. Ancak çok katmanlı mismatch durumlarında art arda bilgi toast’ları görülebilir (noise riski).

---

## Kapanış

Bu slice incelemesinde session-wallet güvenlik modeli backend ile uyumlu ve çok katmanlı fail-closed davranış gösteriyor; öneriler deterministiklik ve UX-noise azaltımı odaklıdır.
