# Audit — `frontend/src/hooks/useRewardsContract.js`

Tarih: 2026-04-30  
Kapsam: Hook'un baştan sona satır-bazlı incelemesi + ilişkili backend/UI/test ve Solidity doğrulaması.

İlişkili dosyalar:
- `contracts/src/ArafRewards.sol`
- `contracts/src/ArafRevenueVault.sol`
- `backend/scripts/routes/rewards.js`
- `frontend/src/components/RewardsDashboard.jsx`
- `frontend/src/test/useRewardsContract.abiSource.test.js`
- `frontend/src/test/RewardsDashboard.test.jsx`

---

## Sonuç Özeti

- Inline rewards/vault ABI tanımı kontrat fonksiyon imzalarıyla **uyumlu**.
- Claimable hesaplama hook içinde yeniden yapılmıyor; doğrudan on-chain `claimable` getter okunuyor (authority doğru yerde).
- Hook seviyesinde **wrong chain fail-closed yok**; bu güvenlikte değil fakat operasyonel olarak yanlış ağda sessiz başarısızlık/yanlış UX riski doğuruyor.
- Read failure'larda `null` dönülmesi, UI katmanında `claimableAmount ?? '0'` fallback’iyle birleşince kullanıcıya yanlışlıkla “0 claimable” gösterimi verebilir.

---

## Bulgular

### MEDIUM — Chain doğrulama eksikliği (hook write/read path)

**Nerede**: `readRewards`, `readVault`, `writeRewards`, `writeVault`.

**Detay**:
- Hook, `useChainId`/supported-chain policy kullanmıyor.
- `REWARDS_ADDRESS` ve `VAULT_ADDRESS` yalnız null/zero-address için kontrol ediliyor.
- Kullanıcı yanlış chain'de ise çağrılar node/contract durumuna göre revert veya sessiz read-fail üretebilir.

**Etkisi**:
- Fail-closed user message yerine belirsiz hata/boş sonuç.
- UI katmanında on-chain authority bozulmaz; ancak kullanım güvenilirliği düşer.

**Öneri**:
- `chainPolicy` ile açık chain guard eklenmeli (write öncesi kesin throw; read için en azından deterministic “unsupported chain” state).

---

### MEDIUM — Read failure + UI fallback kombinasyonu “0 claimable” illüzyonu üretebilir

**Nerede**:
- Hook read fonksiyonları (`readRewards/readVault`) exception yakalamıyor; upstream'e throw ediyor.
- `RewardsDashboard` görseli `claimableAmount ?? '0'` gösteriyor.

**Detay**:
- Contract read hata verdiğinde üst katman state yönetimine bağlı olarak `null/undefined` kalırsa dashboard bunu `0` gibi gösterebilir.
- Bu durum “claim yok” ile “read failed” ayrımını kullanıcıdan gizler.

**Etkisi**:
- Kullanıcı yanlış yönlendirilebilir (özellikle claim beklerken 0 görme).

**Öneri**:
- Claimable için tri-state (`loading/error/value`) ayrımı zorunlu olmalı.
- `error` durumunda “on-chain read failed” mesajı gösterilmeli; `0` ile karıştırılmamalı.

---

### LOW — Contract address doğrulaması şekilsel, checksum/format fail-fast değil

**Detay**:
- `_isValid` sadece non-empty + non-zero kontrolü yapıyor.
- Geçersiz format, ancak çağrı anında `getAddress(...)` ile patlıyor.

**Etkisi**:
- Başlangıçta net konfigürasyon hatası yerine runtime hatası.

**Öneri**:
- Uygulama boot aşamasında adresler `getAddress` ile validate edilip fail-fast yapılmalı.

---

## Hedef Bazlı Değerlendirme

1. **Inline rewards ABI contract ile uyumlu mu?**  
   Evet. `epochDuration`, `claimDelay`, `totalWeight`, `userWeight`, `epochRewardPool`, `claimable`, `claim`, `recordTradeOutcome` imzaları `ArafRewards.sol` ile uyumlu.

2. **Claimable amount parse doğru mu?**  
   Hook parse yapmıyor; on-chain `claimable` sonucu olduğu gibi dönüyor (doğru yaklaşım). Ancak UI format/decimals katmanı ayrıca ele alınmalı.

3. **Epoch/finalized/claimDelay bilgisi doğru yorumlanıyor mu?**  
   Hook yalnız `epochDuration/claimDelay` okuyor; finalized bilgisini okumuyor. Finalize/claim-delay enforcement kontratta olduğu için ekonomi authority korunuyor, fakat UI ön-bilgilendirme eksik kalabilir.

4. **Contract read failure durumunda UI yanlış claimable gösterir mi?**  
   Evet, potansiyel var. Dashboard fallback metni `0` gösterdiğinden read-failure ile gerçek zero ayrımı görünür değil.

5. **Token decimals/formatting hatası var mı?**  
   Hook token `decimals()` okumuyor; claimable ham base-unit olarak dönüyor. Eğer çağıran UI bunu yanlış decimals ile formatlarsa yanlış görsel miktar riski oluşur.

6. **Claim tx lifecycle doğru mu?**  
   Temel akış doğru: `writeContract` → `waitForTransactionReceipt`. Ancak pending/rejected özel state yönetimi hook içinde yok.

7. **Wrong chain / wrong contract address durumunda fail-closed mu?**  
   Kısmi. Zero-address için kapalı; wrong chain için explicit fail-closed guard yok.

8. **Backend rewards mirror ile contract read çelişirse ne oluyor?**  
   Mimari olarak doğru: backend `/claimable` endpoint'i authority iddiasında bulunmuyor ve boş estimate döndürüyor; hook on-chain read'i esas alıyor. Çelişki durumunda ekonomik authority kontratta kalıyor.

---

## Kapanış

Bu inceleme yalnız dokümantasyon üretir; oracle-free ve contract-authoritative model korunur.
