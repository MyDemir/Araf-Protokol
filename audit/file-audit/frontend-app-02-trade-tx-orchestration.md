# Audit — `frontend/src/App.jsx` (Trade TX Orchestration Slice 02)

Tarih: 2026-04-30  
Kapsam (bu tur):
- create sell/buy order
- fill order
- cancel order
- report payment
- release funds
- challenge trade
- burn expired (surface coverage)
- settlement actions
- pending tx yönetimi
- tx sonrası backend sync
- activeTrade/order selection logic

İlişkili dosyalar:
- `frontend/src/hooks/useArafContract.js`
- `frontend/src/app/fillAmountPolicy.js`
- `frontend/src/app/orderUiModel.js`
- `backend/scripts/routes/orders.js`
- `backend/scripts/routes/trades.js`
- `contracts/src/ArafEscrow.sol`
- `frontend/src/components/SettlementPreviewModal.jsx`
- `frontend/src/components/SettlementProposalCard.jsx`
- `frontend/src/test/AppSmoke.test.jsx`
- `frontend/src/test/AppRouting.test.js`

---

## Sonuç Özeti

- App katmanı çoğu akışta contract authority üretmiyor; side-aware fonksiyon seçimi ve on-chain getter/event kullanımına dayanıyor.
- Child trade ID, fill akışında yalnız `OrderFilled` decode sonucundan alınıyor; decode başarısızsa fail-closed.
- Backend sync gecikmesi için “pending backend sync” ara-state var; yanlış fallback trade ID üretilmiyor.
- `isContractLoading` ile duplicate submit engeli çoğu tx aksiyonunda mevcut.
- Settlement preview açıkça informational-only olarak etiketlenmiş; final outcome’un kontratta olduğu doğru anlatılıyor.

---

## Bulgular

### HIGH — `OrderFilled` event kaynağı address ile filtrelenmediği için child trade id yanlış logdan gelebilir

**Nerede**:
- `useArafContract.extractEventArgs`
- App `handleStartTrade` akışı (fill sonucu `tradeId` tüketimi)

**Detay**:
- Decode, receipt loglarında event adına göre ilk eşleşmeyi alıyor.
- Log `address` alanı `ESCROW_ADDRESS` ile doğrulanmıyor.
- Çoklu çağrı/aggregator benzeri senaryolarda teorik yanlış event eşleşmesi riski var.

**Etkisi**:
- Yanlış child trade id ile backend sync/trade room açılışı tetiklenebilir.

**Öneri**:
- Event decode sırasında contract-address filtresi zorunlu olmalı.
- Mümkünse `orderId` de beklenen parent order ile çapraz doğrulanmalı.

---

### MEDIUM — Rejected/revert sonrası pending tx localStorage kaydı stale kalabilir

**Nerede**:
- `useArafContract.writeContract`

**Detay**:
- Hash yazıldıktan sonra success receipt’te temizleniyor.
- Hata yolunda (`catch`) temizlenmiyor.
- App tarafındaki recovery akışı bu kaydı tekrar okuyup kullanıcıya “pending tx bulundu” toast’ı gösterebilir.

**Etkisi**:
- Yanlış işlem durumu algısı / UX güven kaybı.

**Öneri**:
- Catch path’te pending kaydını temizleme veya `failed` state’e taşıma uygulanmalı.

---

### LOW — `burnExpired` hook’ta var, App orchestration yüzeyinde doğrudan handler görünmüyor

**Detay**:
- Hook `burnExpired` export ediyor.
- İncelenen App slice’ta `burnExpired` için explicit handler/button wiring görünürlüğü sınırlı.

**Etkisi**:
- Özellik erişimi view-layer/başka modül üstünden geliyorsa sorun yok; aksi halde UX görünürlüğü eksik kalabilir.

**Öneri**:
- Burn aksiyonu kullanıcı yolunun hangi view’de olduğu audit trail’de netleştirilmeli.

---

## Hedef Bazlı Değerlendirme

1. **Frontend contract authority üretmeye çalışıyor mu?**  
   Hayır. Create/fill/cancel/release/challenge/settlement aksiyonları contract call ile yürütülüyor; backend read/coordination katmanı.

2. **Child trade id yalnız contract event’inden mi geliyor?**  
   Evet. Fill sonrası `OrderFilled` decode’dan alınıyor; yoksa fail-closed hata veriliyor.

3. **Backend sync gecikmesinde yanlış trade/order state oluşuyor mu?**  
   Yanlış fake ID üretilmiyor. `realTradeId` yoksa `_pendingBackendSync` ile tradeRoom’a geçiliyor; bu yaklaşım kontrollü.

4. **Pending tx duplicate submit engeli var mı?**  
   Evet, `isContractLoading` guardları create/fill/cancel/report/release/challenge vb. akışlarda tekrar submit’i azaltıyor.

5. **Rejected tx sonrası state temizleniyor mu?**  
   UI loading state temizleniyor; ancak hook pending-tx localStorage kaydı hata yolunda stale kalabiliyor.

6. **Settlement preview informational-only mı?**  
   Evet. Modal ve card metinleri preview’un non-authoritative olduğunu açıkça belirtiyor.

7. **Amount parse/format hatası var mı?**  
   Fill tarafında `resolveValidatedFillAmountRaw` fail-closed; create tarafında `getTokenDecimals + parseUnits` kullanımı doğru. Format yolları display-only tutulmuş.

8. **Button guard’ları contract state ile uyumlu mu?**  
   Büyük ölçüde uyumlu: role/session/loading/state guardları var. Nihai enforcement kontratta kalıyor.

9. **User rolü maker/taker yanlış hesaplanabilir mi?**  
   Settlement card’da role hem `userRole` hem adres eşleşmesiyle normalize ediliyor; yanlışlık riski düşük, ancak upstream `activeTrade` doğruluğuna bağımlı.

10. **Finality/reorg gecikmesi kullanıcıya doğru anlatılıyor mu?**  
    Kısmen. “backend kaydı henüz hazır değil” mesajı var; ancak chain finality/reorg riski açıkça anlatılmıyor (operasyonel iyileştirme alanı).

---

## Kapanış

Bu slice’ta tx orchestration genel olarak contract-authoritative prensibe bağlıdır; ana iyileştirme alanları event-source kesinliği ve pending-tx hata yolu temizliğidir.
