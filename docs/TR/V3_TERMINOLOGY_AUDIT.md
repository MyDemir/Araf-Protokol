# V3 Terminoloji Denetimi

Bu denetim kalan `listing`, `createEscrow`, `lockEscrow` ve `legacy` referanslarını sınıflandırır.

## Kanonik güncel davranış

- Kanonik terimler: `Order`, `parent order`, `child trade`, `order-first`, `backend mirror/read-model`, `contract authority`.
- `childListingRef` gibi kontrat ABI isimleri değiştirilemeyen ABI alanları olarak değerlendirilir; ürün anlamı Listing primitive’i değil child-trade trace referansıdır.
- Backend `Order` route/model yüzeyleri parent order için kanonik read-model yüzeyleridir.

## Compatibility/deprecated davranış

- `backend/scripts/routes/listings.js`, `Order` dokümanları üzerinde deprecated read-only compatibility alias’tır. Kanonik `app.js` mount yüzeyinde yoktur; write route’ları 410 döner.
- `backend/scripts/jobs/cleanupPendingListings.js`, scheduler/app wiring stabilitesi için tutulan deprecated no-op compatibility job’dır.
- `Trade.trade_origin = DIRECT_ESCROW` ve direct escrow event handler’ları tarihsel/deployment compatibility mirror değerleridir; kanonik V3 authority değildir.
- Legacy environment alias’ları ve legacy profil alanları V3 market primitive’iyle ilgili olmayan compatibility konularıdır.

## Bu değişiklikte düzeltilen stale/incorrect terminoloji

- Frontend kullanıcı metinleri listing/listing owner yerine parent order/order owner kullanıyor.
- Backend yorumları ve testleri `/api/listings` yüzeyini kanonik listing route’u değil deprecated compatibility alias olarak adlandırıyor.
