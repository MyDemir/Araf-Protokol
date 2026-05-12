# Rewards Abuse Observability Planı — Read-Only

> Kapsam: Proof of Peace reward sisteminde wash trading, Sybil-benzeri koordinasyon ve sponsor/product concentration gözlemi.
>
> Bu plan **yalnız observability** içindir. Backend/admin authority eklemez ve on-chain outcome, reward recipient, multiplier, weight, epoch pool veya claimable amount yeniden yazmak için kullanılmamalıdır.

## 1) Authority sınırı

Bu doküman `ARCHITECTURE_INCENTIVES.md` içindeki teşvik mimarisini takip eder:

- Proof of Peace bir barış primidir, **cashback değildir**.
- Eligibility yalnız `ArafEscrow` terminal outcome verisinden gelir.
- `ArafRewards` outcome-derived weight, epoch accounting ve pro-rata claim math otoritesidir.
- Backend/admin/sponsor dashboard'ları risk gözleyebilir; fakat **recipient, weight veya multiplier seçemez**.
- Buradaki sinyaller investigation, budget review, product-policy review veya ileride governance tartışması başlatabilir; zaten türetilmiş reward accounting'i mutate edemez.

## 2) Data source kuralları

Yalnız operasyon ve analytics için zaten var olan mirror/read-model data kullanılmalıdır:

- child trade id'leri, parent order id'leri, maker/taker wallet adresleri, terminal outcome, status, token, amount, timestamp'ler, epoch id ve duration metrikleri;
- `OrderFilled`, terminal resolution event'leri, reward outcome recording, allocation, funding ve claim event mirror alanları;
- yalnız privacy policy ve access control izin verdiğinde `payout_snapshot` metadata'sı için aggregate/hashed analiz;
- `ArafRevenueVault` event'lerinden product/sponsor funding read model'leri: product id, token, amount, epoch ve varsa funder/sponsor adresi.

Plaintext PII, decrypted payout details, receipt contents, private support notes veya manual admin label'ları reward-authority input'u olarak kullanılmamalıdır. Payout fingerprint veya rail metadata kullanılacaksa aggregate, access-controlled ve non-public kalmalıdır.

## 3) Read-only abuse metrikleri

| Metrik | Önerilen hesaplama | Neden önemli? | Sadece dashboard aksiyonu |
|---|---|---|---|
| Repeated counterparties | Maker/taker çift tekrarlarını epoch ve rolling 7/30 günlük pencerelerde say; direction-flipped çiftleri dahil et | Wash trading çoğu zaman aynı counterparty veya stabil çiftleri yeniden kullanır | Pair cluster'ları review için flag'le; weight sıfırlama yok |
| Counterparty graph density | Wallet cluster içi trade oranını external trade oranıyla karşılaştır | Sybil ring'leri çoğunlukla cluster içinde trade eder | Cluster risk tier'ı yalnız analytics'te işaretle |
| Epoch concentration | Kullanıcı veya wallet-cluster'ın epoch içindeki `userWeight`, trade count, clean-release count veya rewardable volume payı | Küçük bir grubun epoch'u domine etmesi farming veya kötü budget sizing gösterebilir | Epoch pool size ve gelecekteki sponsor budget review |
| Same token/amount patterns | Kısa pencerelerde pair/cluster bazında tekrarlayan exact veya near-exact token + amount kombinasyonları | Sentetik hacim çoğu zaman template amount kullanır | Pattern flag; organic order dağılımıyla karşılaştır |
| Short-cycle clean release clustering | Özellikle repeated pair'lerde çok kısa `LOCKED -> PAID -> RESOLVED` süreli fast clean release kümeleri | Proof of Peace fast clean resolution'ı ödüllendirir; abuse hızlı iş birliği taklidi yapabilir | Velocity normal cohort baseline'ını aşarsa alert üret |
| Payout fingerprint repetition | Policy izin verdiğinde birden fazla wallet'ta aynı payout fingerprint hash tekrarı | Birden fazla wallet aynı payout beneficiary'ye işaret edebilir | Yalnız aggregate/private risk sinyali; plaintext reveal yok |
| Rail metadata concentration | Policy izin verdiğinde wallet cluster içinde aynı rail/country/channel pattern yoğunluğu | PII açmadan diğer sinyalleri destekleyebilir | Secondary correlation olarak kullan; tek başına abuse kanıtı değil |
| Sponsor/product funding concentration | Sponsor, product id, token veya epoch bazında external funding payı | Sponsor kampanyaları yanlışlıkla farming'i kârlı hale getirebilir | Gelecekteki funding cap ve campaign design review |
| Funding-to-weight overlap | En çok fonlanan product/epoch ile en yüksek user/cluster weight recipient'larını karşılaştır | Sponsor/product pool'un tekrar tekrar tek cluster tarafından capture edilmesini yakalar | Yalnız sponsor ops review için escalate et |
| Zero-weight outcome ratio | Pair/cluster bazında auto-release, mutual cancel, disputed release, burn ve diğer zero-weight outcome oranı | Reward farming denemeleri kenarlarda başarısız loop bırakabilir | Risk analytics'e besle; reward rewrite yok |

## 4) Dashboard field önerileri

Dashboard yalnız read-model field'ları ve derived aggregate'leri göstermelidir. Önerilen field'lar:

### Epoch summary

- `epoch_id`
- `epoch_start_at`, `epoch_end_at`
- `token`
- `epoch_reward_pool`
- `external_funding_amount`
- `reward_reserve_allocation_amount`
- `total_weight`
- `rewardable_trade_count`
- `zero_weight_trade_count`
- `top_wallet_weight_share_percent`
- `top_cluster_weight_share_percent`
- `clean_release_median_seconds`
- `clean_release_p10_seconds`
- `clean_release_p90_seconds`

### Wallet / cluster risk summary

- `wallet_address` veya internal `cluster_id`
- `epoch_id`
- `rewardable_trade_count`
- `clean_release_count`
- `partial_settlement_count`
- `zero_weight_outcome_count`
- `user_weight`
- `user_weight_share_percent`
- `unique_counterparty_count`
- `repeated_counterparty_count`
- `top_counterparty_share_percent`
- `same_token_amount_pattern_count`
- `short_cycle_clean_release_count`
- `payout_fingerprint_reuse_count` policy izin verdiğinde
- `rail_metadata_pattern_count` policy izin verdiğinde
- `risk_observability_score` yalnız analytics label'ı; contract input'u değildir

### Pair / pattern summary

- `maker_address`
- `taker_address`
- `epoch_id`
- `trade_count`
- `direction_flipped_trade_count`
- `token`
- `amount_bucket`
- `exact_amount_repeat_count`
- `median_resolution_seconds`
- `clean_release_count`
- `zero_weight_outcome_count`
- `latest_trade_id`

### Sponsor / product funding summary

- `epoch_id`
- `product_id`
- `sponsor_or_funder_address` read model'de varsa
- `token`
- `funded_amount`
- `funding_share_percent`
- `top_wallet_weight_share_percent`
- `top_cluster_weight_share_percent`
- `funding_to_weight_overlap_score`

## 5) Alert threshold ve review flow

İlk threshold'lar conservative ve environment-specific olmalıdır. Örnekler:

- bir wallet/cluster epoch weight içinde konfigüre edilen payı aşar;
- maker/taker pair bir epoch içinde konfigüre edilen sayının üzerinde tekrar eder;
- short-cycle clean release sayısı cohort baseline'ını konfigüre edilen multiplier ile aşar;
- exact token/amount tekrarları threshold üstünde cluster oluşturur;
- tek sponsor/product pool tekrar tekrar aynı wallet cluster tarafından capture edilir.

Review flow:

1. Dashboard read-only alert üretir.
2. Operations aggregate metrics ve public/mirror event trace'lerini inceler.
3. Gerekirse sponsor/product owner'ları **gelecekteki** campaign budget, epoch allocation size veya rollout rules değerlerini governance/runbook süreçleriyle ayarlar.
4. Hiçbir backend/admin süreci terminal outcome, reward recipient, multiplier, weight, claimable amount veya finalized epoch accounting'i değiştirmez.

## 6) Privacy ve logging constraints

- Rewards-abuse dashboard'unda plaintext payout details, isim, banka hesabı, contact value veya receipt contents gösterilmemelidir.
- Observability metric hesaplanırken decrypted PII loglanmamalıdır.
- Payout fingerprint ve rail metadata analizi aggregate, access-controlled ve privacy policy review'a tabi kalmalıdır.
- Public raporlar coarse aggregate kullanmalı ve zaten public chain datası dışında wallet doxxing riskini artırmamalıdır.

## 7) Non-goals

Bu plan şunları yapmaz:

- off-chain fiat truth ispatlamak;
- dispute içinde kimin haklı olduğuna karar vermek;
- reward eligibility üretmek;
- on-chain terminal outcome değiştirmek;
- reward recipient seçmek;
- multiplier, weight, epoch pool veya claimable amount değiştirmek;
- Proof of Peace'i cashback veya fixed rebate programına dönüştürmek.
