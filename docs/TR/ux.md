# Araf V3 UX Notları

Bu doküman güncel V3 mimarisinde frontend UX rolünü açıklar. Bilerek repo ağacı değildir.

## Kanonik terminoloji

- **Parent order**, market/order yüzeylerinde gösterilen kamusal pazar primitive’idir.
- **Child trade**, parent order fill edildiğinde oluşan escrow yaşam döngüsüdür.
- **Order-first**, kullanıcının önce order oluşturması veya fill etmesi; kontratın child trade’i fill üzerinden üretmesi demektir.
- **Contract authority** `ArafEscrow.sol` içindedir.
- **Backend mirror/read-model** yüzeyleri UI sorgu, koordinasyon ve audit için vardır; protokol outcome’u belirlemez.

## UX sınırları

Frontend bileşenleri şunları yapabilir:

- wallet, network, allowance, tier, amount ve pause kontrollerini önceden göstermek;
- parent order side/risk/cost önizlemeleri sunmak;
- kanonik order ve child-trade fonksiyonlarıyla kontrat write işlemi başlatmak;
- backend mirror/read-model verisini göstermek ama chain state’i authoritative kabul etmek.

Frontend bileşenleri şunları yapmamalıdır:

- Listing’i V3 market primitive’i olarak anlatmak;
- backend read-model verisini settlement/reputation authority gibi göstermek;
- `createEscrow`/`lockEscrow` akışlarını kanonik kullanıcı akışı olarak geri getirmek.

## Deprecated compatibility dili

`listing` kelimesi yalnız tarihsel veya compatibility yüzeyleri adlandırırken kullanılmalıdır; örneğin deprecated read-only `/api/listings` alias’ı veya kontrat/API kırılmadan değiştirilemeyen ABI field isimleri.
