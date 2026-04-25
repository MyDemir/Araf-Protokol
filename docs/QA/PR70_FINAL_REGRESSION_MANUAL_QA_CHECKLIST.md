# PR #70 sonrası final regression manual QA checklist

Aşağıdaki adımlar, oracle-free dispute modelini ve on-chain authority sınırlarını bozmadan
partial settlement + observability + payment-risk UX kapsamını elle doğrulamak için kullanılır.

- [ ] LOCKED trade’de settlement proposal oluştur.
- [ ] Taker proposal’ı kabul etsin.
- [ ] Maker proposal’ı geri çeksin.
- [ ] Counterparty proposal’ı reddetsin.
- [ ] Expired proposal expire edilsin.
- [ ] Settlement finalized trade RESOLVED görünsün.
- [ ] Trade history partial settlement olarak görünsün.
- [ ] Admin settlement tab read-only görünsün.
- [ ] Payment risk badge order create modalda görünsün.
- [ ] Rail/country yoksa market card sahte risk göstermesin.

## Ürün dili guardrail'ı
- Araf kimin haklı olduğuna karar vermez; iki tarafın imzasıyla kontrollü settlement sağlar.
- Araf does not decide who is right; it enables counterparty-signed settlement.
