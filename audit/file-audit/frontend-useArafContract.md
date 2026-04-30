# Audit — `frontend/src/hooks/useArafContract.js`

Tarih: 2026-04-30
Kapsam: `useArafContract.js` satır-bazlı inceleme + ilişkili kaynak doğrulaması

İlişkili doğrulanan dosyalar:
- `contracts/src/ArafEscrow.sol`
- `backend/scripts/services/eventListener.js`
- `frontend/src/App.jsx`
- `frontend/src/app/chainPolicy.js`
- `frontend/src/app/fillAmountPolicy.js`
- `frontend/src/app/orderUiModel.js`
- `frontend/src/test/useArafContract.abiSource.test.js`
- `frontend/src/test/useArafContract.reputationV3.test.js`

---

## Sonuç Özeti

- Inline ABI yüzeyi, denetlenen fonksiyon/event seti için kontratla **genel olarak uyumlu**.
- `getTrade/getOrder/getReputation` tuple dizilimleri, backend worker ABI ile lock-step ve kontrat imzasıyla uyumlu.
- EIP-712 domain alanları (`name/version/chainId/verifyingContract`) kontrat semantiğiyle uyumlu tasarlanmış.
- Zincir doğrulama write-path’te fail-closed.
- **Kritik bulgu yok**, ancak event/receipt ayrıştırma ve pending-tx state yönetiminde iyileştirme gerektiren noktalar var.

---

## Bulgular

### HIGH — `OrderFilled` event decode, yanlış logdan `tradeId` çekebilir

**Nerede**: `extractEventArgs(receipt, "OrderFilled")` çağrıları (`fillSellOrder`, `fillBuyOrder`).

**Detay**:
- `extractEventArgs` fonksiyonu receipt içindeki her logu `ArafEscrowABI` ile decode etmeye çalışıyor, eşleşen ilk `eventName` sonucunu dönüyor.
- Ancak logun `address` alanı ile `ESCROW_ADDRESS` eşlemesi yapılmıyor.
- Multi-call/router/proxy/aggregator benzeri senaryolarda aynı event signature’ını taşıyan başka loglar teorik olarak bulunursa, child `tradeId` yanlış kaynaktan alınabilir.

**Etkisi**:
- UI tarafında yanlış trade detayı açılması / yanlış trade üzerinde takip aksiyonu riski.
- Ekonomik authority kontratta kalır; fakat kullanıcı yönlendirmesi bozulabilir.

**Öneri**:
- `extractEventArgs` içinde `if (getAddress(log.address) !== getAddress(ESCROW_ADDRESS)) continue;` tarzı adres filtresi eklenmeli.
- Ayrıca `OrderFilled` için `orderId` argümanı beklenen order ile çapraz doğrulanmalı.

---

### MEDIUM — `writeContract` pending tx kaydı, reject/revert senaryosunda temizlenmiyor

**Nerede**: `writeContract`.

**Detay**:
- Tx hash alındıktan sonra `localStorage.araf_pending_tx` set ediliyor.
- Başarılı receipt sonrası temizleniyor.
- Ancak `waitForTransactionReceipt` throw ederse veya sonraki aşamalarda hata oluşursa catch bloğunda temizleme yok.

**Etkisi**:
- UI, eski hash’i “hala pending” gibi yorumlayabilir.
- Kullanıcıya yanlış işlem durumu güveni verebilir.

**Öneri**:
- catch içinde, ilgili hash’e ait pending kaydı kontrollü temizlenmeli.
- Alternatif: kayıt yapısına `status` alanı (pending/failed/confirmed) eklenmeli.

---

### LOW — `approveToken` guard tekrarı ve allowance stratejisi

**Detay**:
- `_isValidAddress` kontrolü hem genel `writeContract` hem `approveToken` gibi yolarda benzer pattern ile tekrarlı.
- `approveToken` doğrudan istenen `amount` kadar approve ediyor; “infinite approval” yok (iyi), ancak UI katmanında gerektiğinden büyük amount geçirilirse aşırı izin verilebilir.

**Etkisi**:
- Mimari olarak güvenli tarafta, ama UX kaynaklı geniş allowance mümkün.

**Öneri**:
- `getAllowance` ile “exact-need” stratejisi default tutulmalı (App katmanında zaten kullanılmalı).
- İsteğe bağlı `approve(0)` + `approve(amount)` pattern’i bazı tokenlar için değerlendirilebilir.

---

## Hedef Bazlı Değerlendirme

1. **Inline ABI contract ile birebir uyumlu mu?**  
   Denetlenen yüzeyde evet; `getTrade/getOrder/getReputation`, `OrderFilled`, settlement ve cancel fonksiyon imzaları kontrat + backend worker ABI ile tutarlı.

2. **getTrade/getOrder/getReputation tuple mapping doğru mu?**  
   Evet. Frontend ABI sırası backend worker ile aynı; `normalizeV3Reputation` named+tuple fallback ile fail-closed (`null`) dönüyor.

3. **OrderFilled event decode child trade id için doğru kaynak mı?**  
   Kısmen. Event adı doğru; fakat log address filtresi olmadığı için kaynak kesinliği eksik.

4. **EIP-712 cancel domain contract ile uyumlu mu?**  
   Evet; domain `ArafEscrow`, `1`, aktif `chainId`, `verifyingContract=ESCROW_ADDRESS`.

5. **Chain validation fail-closed mu?**  
   Write path’te evet (`_validateChain` throw). Read path’te çoğunlukla soft-fail (`null/0n`) tasarımı var.

6. **Contract address validation güvenli mi?**  
   Kısmi. Zero-address guard var; fakat env’de checksum dışı/bozuk address doğrulaması guard seviyesinde değil, çağrı anında `getAddress` ile patlıyor.

7. **Token decimals ve amount parse logic güvenli mi?**  
   Güçlü. `normalizeTokenDecimalsOrThrow` ile 1..18 dışında reject.

8. **BigInt/Number dönüşüm hatası var mı?**  
   Hook içinde kritik bir precision-loss görünmüyor; önemli yollar BigInt tabanlı.

9. **Approve allowance stratejisi fazla geniş mi?**  
   Infinite approve yok; ancak çağıran katman büyük `amount` gönderirse geniş allowance oluşabilir.

10. **Receipt parsing yanlış event yakalayabilir mi?**  
    Evet, address filtresi eksikliğinden teorik risk var (HIGH bulgu).

11. **Pending tx veya rejected tx durumunda UI yanlış state’e düşer mi?**  
    Evet, stale `araf_pending_tx` riski mevcut (MEDIUM bulgu).

12. **Error handling kullanıcıya yanlış güven verebilir mi?**  
    Kısmen: hata tekrar fırlatılıyor (iyi), ancak read tarafındaki sessiz fallback (`0n/null`) bazı ekranlarda “gerçek değer 0” gibi algılanabilir.

---

## Kapanış

Bu inceleme yalnız dokümantasyon bulgusu üretir; oracle-free model, authority sınırları ve on-chain karar mekanizması korunmuştur.
