# Proof of Peace Rewards — Rollout Planı (TR)

Bu doküman, Proof of Peace Rewards açılışını **güvenli, aşamalı ve oyun teorisiyle uyumlu** biçimde yönetmek için hazırlanmıştır.

Proof of Peace, dispute sisteminin pozitif teşvik ayağıdır. Bleeding Escrow kötü stratejiyi pahalılaştırırken, Proof of Peace hızlı ve temiz çözümü gelecekteki reward epoch'larında daha değerli hale getirir.

> Kanonik ilke: **Rewards cashback değildir; hızlı clean resolution için pro-rata barış primidir.**

## 1) Ekonomik ve Authority Sınırları (Net Kurallar)

- Rewards, **trade cashback değildir**; kullanıcıya işlem ücreti iadesi/vergi indirimi mekanizması değildir.
- Eligibility yalnızca **ArafEscrow terminal outcome** verisinden üretilir.
- Backend yalnızca **mirror/read-model** katmanıdır; reward recipient, eligibility, weight veya claimable amount üretemez.
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

## 2) Oyun Teorisi Guardrail'leri

Reward sistemi yalnız pozitif teşvik değildir; aynı zamanda farming ve kötü stratejilere karşı sınırlı bir ekonomik savunma katmanıdır.

| Davranış | Reward duruşu | Neden |
|---|---|---|
| Hızlı clean release | En yüksek pozitif weight | En iyi iş birliği dengesini teşvik eder |
| Yavaş clean release | Daha düşük pozitif weight | Gecikmeyi opportunity cost ile fiyatlandırır |
| Partial settlement | Düşük pozitif weight | Dispute içi barışı ödüllendirir ama dispute'u kârlı hale getirmez |
| Auto-release | Zero weight | Maker inaktivitesi ödüllendirilmez |
| Mutual cancel | Zero weight | Cancel-loop farming yüzeyi açılmaz |
| Disputed release | Zero weight | Challenge-sonra-release farming engellenir |
| Burn | Zero weight | Deadlock hiçbir koşulda rewardable değildir |

Operasyonel kural:

> **Beklenen reward, sentetik hacim / wash trading maliyetinden düşük kalmalıdır.**

Bu nedenle sponsor kampanyaları, external funding ve `rewardBps` artışları küçük adımlarla, gözlemlenebilir metrikler eşliğinde yapılmalıdır.

## 3) Aşamalı Rollout (Staged)

### Phase A — Read-only reward analytics
- Yalnız gözlem dashboard'ları / raporlar açılır.
- On-chain claim veya treasury switch yapılmaz.
- Outcome dağılımı, clean release hızı, partial settlement oranı, zero-weight outcome oranı ve olası wash-trade kümeleri izlenir.

### Phase B — External funding enabled, claim disabled
- `fundGlobalRewards`/`fundProductRewards` akışı açılır.
- Claim/finalize süreçleri kullanıcıya açılmaz.
- Sponsor/funder'ın recipient, weight veya multiplier seçemediği doğrulanır.

### Phase C — Revenue split enabled, recordTradeOutcome enabled
- Escrow gelir bölüşümü (vault reserve accounting) aktif edilir.
- `recordTradeOutcome` izniyle outcome kayıt akışı aktif edilir.
- Kayıt akışının yalnız `ArafEscrow.getRewardableTrade` kaynağına dayandığı doğrulanır.

### Phase D — Claim enabled
- Epoch finalize + claim süreci kontrollü şekilde açılır.
- Operasyonel monitoring ve reserve-liability kontrolleri sıklaştırılır.
- Claim penceresi, claimDelay ve dust sweep kuralları kullanıcıya açık anlatılır.

### Phase E — Product pool enabled
- Ürün/kampanya bazlı pool metadata + funding yüzeyi açılır.
- Recipient seçimi yine kontrat formülüne bağlıdır; sponsor/admin seçimi yoktur.
- Product pool, eligibility üretmez; yalnız funding/metadata bucket olarak kalır.

## 4) Operasyonel Güvenlik Notları

- Public ağda production adresleri **env üzerinden** verilir; hardcode yapılmaz.
- Treasury switch deployment adımından ayrıdır; tek başına ve onaylı bakım penceresinde yapılır.
- Oracle-free dispute modeli ve settlement authority daima kontratta kalır.
- Reward bütçesi hiçbir zaman kullanıcıyı riskli release yapmaya ekonomik olarak teşvik edecek büyüklüğe taşınmamalıdır.
- Reward dili kullanıcıya "getiri garantisi" veya "işlem başına cashback" olarak sunulmamalıdır.

## 5) Go-Live Öncesi Kısa Kontrol

- Vault ve Rewards kontrat adresleri doğrulandı.
- Supported token seti (USDT/USDC) doğrulandı.
- `rewardBps == 4000` başlangıcı doğrulandı.
- Backend/frontend yalnız read-only/mirror rolünde kaldı.
- Treasury switch henüz yapılmadı (ayrı adım).
- Fast clean release / partial settlement / zero-weight outcome kayıtları staging'de doğrulandı.
- Sponsor/funder recipient seçemiyor.
- Admin reward reserve'i treasury gibi çekemiyor.

## Go-Live Öncesi Doğrulama
- Vault kontrat adresi deployment manifest/config üzerinden doğrulanmalıdır.
- Rewards kontrat adresi deployment manifest/config üzerinden doğrulanmalıdır.
- Supported token seti USDT/USDC olmalıdır.
- `rewardBps` başlangıcı 4000 olmalıdır.
- Backend/frontend read-only / mirror-only kalmalıdır.
- Backend/frontend reward eligibility, weight, outcome, recipient veya claimable authority tanımlamamalıdır.
- Treasury switch deployment sürecinin parçası değildir.
- Treasury switch doğrulama sonrası ayrı ve açık bir operasyon olarak yürütülmelidir.
- Production adresleri hardcode edilmemelidir.
- Treasury switch öncesi smoke ve verify komutları başarılı olmalıdır.
