# Audit — `frontend/src/hooks/usePII.js`

Tarih: 2026-04-30  
Kapsam: `usePII` hook satır-bazlı inceleme + ilişkili backend route/auth/encryption ve UI test yüzeyi doğrulaması.

İlişkili dosyalar:
- `backend/scripts/routes/pii.js`
- `backend/scripts/routes/auth.js`
- `backend/scripts/services/encryption.js`
- `frontend/src/components/PIIDisplay.jsx`
- `frontend/src/app/useAppSessionData.jsx`
- `frontend/src/test/usePII.test.jsx`
- `frontend/src/test/PIIDisplay.test.jsx`

---

## Sonuç Özeti

- `usePII`, 2-adımlı trade-scoped token + cookie-session guard modeline uygun çalışıyor; backend guard zinciriyle uyumlu.
- Hook tarafında localStorage/sessionStorage/cache yazımı yok; PII yalnız React state içinde tutuluyor ve `clearPII` ile silinebiliyor.
- AbortController ile yarış durumu (race) kontrolü var; en son istek dışındaki sonuçlar state'e yazılmıyor.
- Kritik ekonomik authority devri yok; PII erişim kapısı backend policy ile sınırlı.
- Ancak unmount cleanup içinde state set edilmesi ve hata mesajı yansıtımı gibi alanlarda iyileştirme notları var.

---

## Bulgular

### MEDIUM — Hata mesajı backend kaynaklı metni doğrudan UI'a taşıyabilir

**Nerede**: `fetchPII` catch bloğu -> `setError(err.message)`.

**Detay**:
- Hook, backend’den dönen `body.error` metnini hata olarak yukarı taşıyor.
- `PIIDisplay` bu mesajı kullanıcıya doğrudan basıyor.
- Mevcut backend route’ları kontrollü/temiz metin döndürüyor; ancak prensipte bu kanal, gelecekte fazla detaylı sunucu hata metinlerinin UI’ya taşınmasına açık.

**Etkisi**:
- PII içeriği sızmıyor, fakat operasyonel/iç hata detayları yanlışlıkla dışa vurulabilir.

**Öneri**:
- Frontend’de allowlist error-code -> kullanıcı mesajı eşlemesi.
- Geliştirici detayları yalnız telemetry/log kanalına düşmeli.

---

### LOW — `useEffect` cleanup içinde `setPii(null)` React warning riski

**Nerede**: `useEffect` cleanup (tradeId değişimi/unmount).

**Detay**:
- Cleanup içinde `mountedRef.current = false` sonrasında `setPii(null)` çağrılıyor.
- Modern React’te çoğu durumda güvenli olsa da strict mode/test koşullarında “unmounted component state update” uyarısı üretme riski var.

**Etkisi**:
- Güvenlik açığı değil; bakım/test gürültüsü riski.

**Öneri**:
- Unmount cleanup’ta state update yerine yalnız abort + referans temizliği; state resetini mount yaşam döngüsünde deterministik noktaya taşıma.

---

## Hedef Bazlı Değerlendirme

1. **PII token/session handling güvenli mi?**  
   Evet, mimari doğru: `request-token/:tradeId` + `/:tradeId` çağrıları cookie auth, wallet-session match ve trade-scoped bearer token zincirini kullanıyor.

2. **Cache veya localStorage’a hassas veri yazılıyor mu?**  
   İncelenen hook/bileşen akışında hayır. PII state bellekte tutuluyor, persistent storage kullanılmıyor.

3. **Response no-store mantığı frontend’de bozuluyor mu?**  
   Frontend tarafında özel cache katmanı yok; backend `Cache-Control: no-store` + `Pragma: no-cache` gönderiyor. Hook bunu bozan bir davranış eklemiyor.

4. **Role/state guard backend ile uyumlu mu?**  
   Evet. Backend yalnız taker + aktif trade state (`LOCKED|PAID|CHALLENGED`) + snapshot-complete şartlarında PII döndürüyor; hook yalnız istemci olarak tüketiyor.

5. **Wallet switch sonrası PII state temizleniyor mu?**  
   TradeId değişimi/unmount’ta temizleniyor. Ayrıca session mismatch durumunda `authenticatedFetch` üst katmanda oturumu düşürüyor. Ancak component açık kalırken wallet değişiminde anlık UI temizliği tradeId bağımlı.

6. **Error state PII sızdırıyor mu?**  
   Doğrudan PII sızıntısı görünmüyor. Yine de backend error message passthrough nedeniyle fazla teknik hata metni gösterimi riski var.

7. **Retry/refetch yanlış trade için PII çekebilir mi?**  
   Düşük olasılık: AbortController ile önceki istek iptal ediliyor, signal-aborted kontrolü var; yanlış trade overwrite riski büyük ölçüde azaltılmış.

8. **Component unmount sonrası stale PII görüntülenebilir mi?**  
   Hook cleanup + `clearPII` sayesinde pratikte düşük. Yine de cleanup-state-update paterni yerine daha katı teardown yaklaşımı önerilir.

---

## Kapanış

İnceleme sonucunda PII erişim modelinin contract-authority sınırlarını ihlal etmediği, backend guard zinciriyle uyumlu olduğu görülmüştür; öneriler çoğunlukla UX-hardening ve hata yüzeyi daraltma odaklıdır.
