# Mainnet Readiness Report

## Executive Summary

Bu inceleme yalnız repodaki mevcut kod ve testler üzerinden yürütüldü. Aşağıdaki bulguların `confirmed` olanları için patch uygulandı ve test eklendi. Koddan doğrulanamayan başlıklar `unresolved` olarak bırakıldı ve otomatik düzeltme yapılmadı.

## Confirmed Blockers

### Finding B1
- severity: blocker
- status: confirmed
- file: `contracts/src/ArafEscrow.sol`
- exact function / route / state variable: `setFeeConfig(uint256,uint256)`
- root cause: Fee değerleri için `uint16` snapshot cast sınırı ve ekonomik `10000 bps` sınırı doğrulanmıyordu.
- exploit / production impact: Owner `setFeeConfig` ile 10000 üstü veya uint16 üstü değer ayarlayabiliyor; yeni trade/order snapshot cast ve payout hesapları arası tutarsızlık riski oluşuyor.
- fix implemented: `FeeBpsExceedsUint16` ve `FeeBpsExceedsEconomicLimit` custom error’ları eklendi; `setFeeConfig` içine açık sınır kontrolleri eklendi.
- residual risk: Owner yanlış ama sınır içi (ekonomik olarak agresif) değerleri yine ayarlayabilir; bu governance operasyon riskidir.

### Finding B2
- severity: blocker
- status: confirmed
- file: `backend/scripts/services/eventListener.js`
- exact function / route / state variable: `_onEscrowLocked`, `payout_snapshot.*`
- root cause: LOCKED anında maker snapshot için `rail/country` sahte fallback (`TR_IBAN`/`TR`) yazılıyordu; snapshot eksik olsa bile trade `LOCKED` mirror ediliyordu.
- exploit / production impact: Snapshot-only PII sınırı ile event mirror arasında invariants kırılıyor; yanlış rail-country ile kullanıcıya sahte ödeme kanalı gösterilebiliyor.
- fix implemented: Fallback yazımı kaldırıldı; gerçek profil yoksa null yazılıyor. Ayrıca `payout_snapshot.is_complete` ve `payout_snapshot.incomplete_reason` alanları eklenerek quarantine flag üretildi, log’da kritik uyarı eklendi.
- residual risk: Zincirde trade zaten LOCKED olabildiği için backend bunu reddedemez; uygulama katmanı bu incomplete flag’i aktif olarak gate etmelidir.

## High Risks

### Finding H1
- severity: high
- status: confirmed
- file: `backend/scripts/routes/auth.js`
- exact function / route / state variable: `_normalizeProfileBody`, `PUT /api/auth/profile`
- root cause: Boş `rail` girildiğinde legacy IBAN’dan otomatik `TR_IBAN` fallback üretiliyordu.
- exploit / production impact: Kullanıcı açıkça rail seçmeden profile write yapılabiliyor; multi-rail migration’da hatalı rail snapshot üretiliyor.
- fix implemented: Boş rail fallback kaldırıldı.
- residual risk: Eski veride rail boş olan kayıtlar migration ile temizlenmezse snapshot completeness false üretebilir.

### Finding H2
- severity: high
- status: confirmed
- file: `backend/scripts/models/User.js`, `backend/scripts/routes/auth.js`
- exact function / route / state variable: `User.payout_profile.rail enum`, `PROFILE_SCHEMA`
- root cause: Model enum `UK_FPS/SWIFT` içeriyor; route schema bu rail’leri kabul etmiyor.
- exploit / production impact: Veri modeli ve API validation ayrışıyor; yazılamayan ama modelde “destekli görünen” rail’ler operasyonel belirsizlik yaratıyor.
- fix implemented: Model enum, fiilen desteklenen rail setine (`TR_IBAN`,`US_ACH`,`SEPA_IBAN`) daraltıldı.
- residual risk: DB’de mevcut `UK_FPS/SWIFT` kayıtları migration gerektirir.

### Finding H3
- severity: high
- status: confirmed
- file: `backend/scripts/routes/trades.js`, `backend/scripts/services/eventListener.js`
- exact function / route / state variable: `_buildBankProfileRisk`, `_onEscrowLocked`
- root cause: `frequentRecentChanges` sabit `false` idi; snapshot rolling bank-change sinyali response’a taşınmıyordu.
- exploit / production impact: Risk response yanlış negatif üretiyor; yüksek frekanslı banka değişimi UI’da görünmüyor.
- fix implemented: Lock anında `bank_change_count_7d/30d` ve `last_bank_change_at` snapshot’a yazıldı; risk hesaplaması bu alanları kullanır hale getirildi.
- residual risk: Eski trade kayıtlarında bu snapshot alanları null kalır.

### Finding H4
- severity: high
- status: confirmed
- file: `backend/scripts/services/eventListener.js`, `contracts/src/ArafEscrow.sol`
- exact function / route / state variable: `_onPaymentReported`, `reportPayment`
- root cause: Kontrat non-empty string kabul ederken backend CID regex’e uymayan hash’i null’a indiriyordu.
- exploit / production impact: On-chain/off-chain receipt hash divergence oluşuyordu.
- fix implemented: Event mirror artık zincirdeki değeri canonical string olarak aynalıyor.
- residual risk: Backend’de regex-tabanlı kalite kontrol artık yok; istenirse ayrı doğrulama alanı eklenebilir.

## Medium Risks

### Finding M1
- severity: medium
- status: confirmed
- file: `backend/scripts/routes/auth.js`
- exact function / route / state variable: `PUT /api/auth/profile` active-trade lock mesajı
- root cause: Mesaj yalnız bankOwner/IBAN değişimini söylüyordu; fiili lock rail/country/details değişimini de kapsıyordu.
- exploit / production impact: Operasyon ve kullanıcı desteği sırasında yanlış beklenti oluşuyor.
- fix implemented: Hata mesajı payout-profile geneline hizalandı.
- residual risk: Yok.

## Unresolved Items

### Finding U1
- severity: medium
- status: unresolved
- file: `backend/scripts/routes/pii.js`, `backend/scripts/services/eventListener.js`
- exact function / route / state variable: snapshot-only reveal gate ve `payout_snapshot.is_complete`
- root cause: `pii.js` şu an `is_complete` flag’ini zorlamıyor; yalnız `payout_details_enc` varlığına bakıyor.
- exploit / production impact: Kısmi snapshot senaryolarında behavior farkı oluşabilir.
- fix implemented: Otomatik fix uygulanmadı (ürün kararına bağlı gate davranışı net değil).
- residual risk: API consumer’ları incomplete snapshot’ı ayrıca yorumlamalıdır.

### Finding U2
- severity: medium
- status: unresolved
- file: `contracts/src/ArafEscrow.sol`, `backend/scripts/services/eventListener.js`
- exact function / route / state variable: direct escrow / child trade / backend mirror uyumu
- root cause: Kod yolları mevcut; ancak tüm geçmiş migrasyon durumlarını kapsayan deterministik fixture bu repoda yok.
- exploit / production impact: Legacy veride edge-case mirror tutarsızlığı olabilir.
- fix implemented: Otomatik fix uygulanmadı.
- residual risk: Replay/smoke senaryoları ile ayrıca doğrulanmalı.

## Patches Applied

- Backend rail fallback kaldırıldı, profile encryption write-path default rail/country kaldırıldı.
- Event listener snapshot fallback kaldırıldı, snapshot completeness quarantine flag’i eklendi.
- User model rail enum route schema ile hizalandı (desteklenmeyen rail’ler çıkarıldı).
- Trade risk hesaplaması lock-time bank-change snapshot verisini kullanacak şekilde düzeltildi.
- PaymentReported mirror canonical hash ile hizalandı.
- Contract `setFeeConfig` bounds eklendi (`uint16` + `<=10000 bps`).

## Tests Added

- Contracts Hardhat:
  - `setFeeConfig` için economic cap revert testi.
  - `setFeeConfig` için uint16 range revert testi.
  - `10000 bps` snapshot ile release path stuck olmama testi.

## Migration / Deployment Notes

1. DB migration: `User.payout_profile.rail` alanında `UK_FPS`/`SWIFT` bulunan kayıtlar desteklenen rail setine map edilmeli veya null’a çekilmelidir.
2. Trade geçmişinde `payout_snapshot.is_complete` olmayan/eski kayıtlar için rollout sırasında izleme dashboard’u eklenmelidir.
3. Uygulama katmanı `payout_snapshot.is_complete=false` trade’lerde PII reveal ve release UX’i için açık uyarı/gate uygulamalıdır.

## Residual Risks

- Owner yetkili config değişimleri ekonomik olarak 10000 bps altında kalsa da kötü parametreleme riski taşır.
- Eski trade/user verileri migration yapılmazsa yeni risk sinyalleri null kalabilir.
