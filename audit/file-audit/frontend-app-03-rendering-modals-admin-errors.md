# Audit — `frontend/src/App.jsx` (Rendering / Modals / Admin / Errors Slice 03)

Tarih: 2026-04-30  
Kapsam (bu tur):
- route/view selection
- modal state
- toast/error handling
- admin panel erişimi
- rewards view geçişleri
- PII display trigger’ları
- reference ticker display
- global loading/error state yüzeyi

İlişkili dosyalar:
- `frontend/src/app/AppViews.jsx`
- `frontend/src/app/AppModals.jsx`
- `frontend/src/AdminPanel.jsx`
- `frontend/src/components/ErrorBoundary.jsx`
- `frontend/src/components/PIIDisplay.jsx`
- `frontend/src/components/ReferenceRateTicker.jsx`
- `frontend/src/components/RewardsDashboard.jsx`
- `frontend/src/test/AppViews.test.jsx`
- `frontend/src/test/AppModals.test.jsx`
- `frontend/src/test/AdminPanelPolling.test.jsx`

---

## Sonuç Özeti

- Route/view kompozisyonu `App` içinde deterministik: `home/market/admin/tradeRoom` seçimi açık.
- Admin girişi frontend’de görünürlük katmanında geniş tutulsa da backend yetki kontrolüyle (403/401/409 handling) fail-closed davranış korunuyor.
- ErrorBoundary log kanalında PII scrub uygulanıyor; plaintext IBAN/telefon gibi pattern’ler redakte ediliyor.
- Reference ticker ve settlement/rewards copy metinleri “informational-only / non-authoritative” semantiğini net veriyor.
- PII display yalnız aktif trade bağlamından tetikleniyor ancak stale activeTrade geçişlerinde yanlış trade modal açılışına karşı ek UX guard alanı mevcut.

---

## Bulgular

### MEDIUM — Admin entry görünürlüğü UX katmanında geniş; yanlış “admin yetkisi var” algısı üretebilir

**Nerede**: `AppViews` slim-rail admin butonu (`canSeeAdminEntry` = authenticated kullanıcı).

**Detay**:
- Buton authenticated kullanıcıya gösteriliyor; VITE allowlist yalnız “hint” olarak kullanılıyor.
- Gerçek yetki backend’de olsa da bazı kullanıcılar UI’daki admin ikonunu yetki varmış gibi yorumlayabilir.

**Etkisi**:
- Güvenlik bypass değil (backend koruyor), fakat UX beklenti/yanlış algı riski.

**Öneri**:
- Admin entry label’ında “server-authorized only” ibaresi daha baskınlaştırılabilir veya allowlist dışı kullanıcıda gizlenebilir.

---

### MEDIUM — Rewards dashboard `claimableAmount ?? '0'` fallback’i stale/read-failure ile gerçek 0’ı ayıramayabilir

**Nerede**: `RewardsDashboard`.

**Detay**:
- Claimable okunamazsa upstream null/undefined senaryolarında UI bunu 0 gibi gösterebilir.
- Daha önce hook auditinde de not edilen “error vs zero” ayrımı burada görünür.

**Etkisi**:
- Kullanıcı, claim hakkı yok sanabilir (özellikle RPC/read hata anlarında).

**Öneri**:
- Tri-state render (`loading`, `error`, `value`) zorunlu hale getirilmeli.

---

### LOW — Toast metinleri genelde güvenli; ancak ham `err.message` geçişleri operasyonel detay taşıyabilir

**Nerede**: App genel `showToast(errorMessage)` pattern’i.

**Detay**:
- Çoğu yerde kullanıcı-dostu mesaj var; bazı akışlar ham hata metnini gösteriyor.
- Tx hash/PII doğrudan toast’a basılmıyor; yine de backend’den gelen teknik hata metni gereğinden fazla iç detay taşıyabilir.

**Etkisi**:
- Operasyonel bilgi sızıntısı (düşük).

**Öneri**:
- Kullanıcı mesajları code-based map ile normalize edilmeli; ham detay log kanalına bırakılmalı.

---

## Hedef Bazlı Değerlendirme

1. **Protected view auth olmadan açılıyor mu?**  
   Kritik yüzeylerde guard var. AdminPanel kendi içinde `isAuthenticated/authChecked` ve response-status handling ile korunuyor.

2. **Admin UI sadece UI guard’a mı dayanıyor?**  
   Hayır. UI girişi geniş olsa da backend auth/authorization cevabı belirleyici; polling 401/403/409’da duruyor.

3. **Modal stale data gösterebilir mi?**  
   Bazı durumlarda kısa süreli stale görünüm mümkün (özellikle activeTrade değişimi anları). Ancak birçok modal state reset ve explicit close akışı kullanıyor.

4. **ErrorBoundary secret/PII sızdırıyor mu?**  
   Bilinen PII pattern’leri scrub ediliyor; component stack de sınırlı gönderiliyor. Bu yüzeyde iyi hardening var.

5. **Reference ticker settlement authority gibi algılanabilir mi?**  
   Metinlerde “informational only” açık; authority algısı minimize edilmiş.

6. **Rewards view stale claimable gösterebilir mi?**  
   Evet, null->0 fallback nedeniyle mümkün.

7. **PII modal yanlış trade/user için açılabilir mi?**  
   Tetikleme activeTrade.id üzerinden; backend side trade-scoped token + session-wallet guard uyguluyor. Frontend stale activeTrade taşıyorsa yanlış bağlam denemesi olabilir ama backend engeller.

8. **Toast/error mesajlarında tx hash dışında hassas bilgi var mı?**  
   Tx hash/PII görünmüyor; fakat ham error message pass-through operasyonel detay taşıyabilir.

---

## Kapanış

Render/UI orchestration yüzeyi genel olarak contract-authoritative prensiple uyumlu ve backend guardlarla destekli; ana iyileştirme alanları admin UX netliği, rewards tri-state gösterimi ve error-message normalizasyonudur.
