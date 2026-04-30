# Proof of Peace Rewards — Rollout Planı (TR)

Bu doküman, Proof of Peace Rewards açılışını **güvenli ve aşamalı** biçimde yönetmek için hazırlanmıştır.

## 1) Ekonomik ve Authority Sınırları (Net Kurallar)

- Rewards, **trade cashback değildir**; kullanıcıya işlem ücreti iadesi/vergi indirimi mekanizması değildir.
- Eligibility yalnızca **ArafEscrow terminal outcome** verisinden üretilir.
- Backend yalnızca **mirror/read-model** katmanıdır; reward recipient seçemez.
- Admin paneli reward recipient seçemez; yalnız gözlem/operasyonel doğrulama yapar.
- Sponsor/funder recipient seçemez; sadece global/epoch veya product pool fonlaması yapar.
- `paymentRiskLevel` bir **reward multiplier değildir**.
- MVP'de aşağıdaki terminal outcome sınıfları **zero-weight** kabul edilir:
  - auto-release
  - burn
  - mutual cancel
  - disputed release
- MVP'de **Tier 0 reward eligibility dışıdır**.
- `rewardBps` başlangıç değeri **4000**'dir ve yalnız **4000–7000** aralığında değiştirilebilir.

## 2) Aşamalı Rollout (Staged)

### Phase A — Read-only reward analytics
- Yalnız gözlem dashboard'ları / raporlar açılır.
- On-chain claim veya treasury switch yapılmaz.

### Phase B — External funding enabled, claim disabled
- `fundGlobalRewards`/`fundProductRewards` akışı açılır.
- Claim/finalize süreçleri kullanıcıya açılmaz.

### Phase C — Revenue split enabled, recordTradeOutcome enabled
- Escrow gelir bölüşümü (vault reserve accounting) aktif edilir.
- `recordTradeOutcome` izniyle outcome kayıt akışı aktif edilir.

### Phase D — Claim enabled
- Epoch finalize + claim süreci kontrollü şekilde açılır.
- Operasyonel monitoring ve reserve-liability kontrolleri sıklaştırılır.

### Phase E — Product pool enabled
- Ürün/kampanya bazlı pool metadata + funding yüzeyi açılır.
- Recipient seçimi yine kontrat formülüne bağlıdır; sponsor/admin seçimi yoktur.

## 3) Operasyonel Güvenlik Notları

- Public ağda production adresleri **env üzerinden** verilir; hardcode yapılmaz.
- Treasury switch deployment adımından ayrıdır; tek başına ve onaylı bakım penceresinde yapılır.
- Oracle-free dispute modeli ve settlement authority daima kontratta kalır.

## 4) Go-Live Öncesi Kısa Kontrol

- Vault ve Rewards kontrat adresleri doğrulandı.
- Supported token seti (USDT/USDC) doğrulandı.
- `rewardBps == 4000` başlangıcı doğrulandı.
- Backend/frontend yalnız read-only/mirror rolünde kaldı.
- Treasury switch henüz yapılmadı (ayrı adım).
