# Phase 07 — Contracts: Revenue Vault / Rewards / Deployment Tooling

## Scope
İncelenen dosyalar:
- contracts/src/ArafRevenueVault.sol
- contracts/src/ArafRewards.sol
- contracts/src/MockEscrowRewardView.sol
- contracts/scripts/configureRewards.js
- contracts/scripts/deploy.js
- contracts/scripts/deployRewards.js
- contracts/scripts/smokeRewards.js
- contracts/scripts/switchRewardsTreasury.js
- contracts/scripts/verifyRewardsDeployment.js
- contracts/hardhat.config.js
- contracts/package.json
- contracts/.env.example

İlişkili testler:
- contracts/test/ArafRevenueVault.test.js
- contracts/test/ArafRewards.test.js
- contracts/test/deploy.script.test.js
- contracts/test/hardhat.rpcEnvRequired.test.js
- contracts/test/rewards.deploy.scripts.test.js
- contracts/test/rewards.goLive.readiness.test.js
- contracts/test/rewards.rollout.e2e.test.js

## Method
- Vault ve Rewards kontratları fonksiyon/state invariant odaklı satır bazlı okundu.
- Deployment/config/smoke/verify scriptleri env fail-closed davranışı açısından incelendi.
- Hardhat config ve package scripts test kapsamı ile çaprazlandı.

## File-by-File Notes
| Dosya | Durum | İnceleme derinliği | Not |
|---|---|---|---|
| ArafRevenueVault.sol | İncelendi | Fonksiyon bazlı | Reserve split, liability ve allocation transfer akışları incelendi. |
| ArafRewards.sol | İncelendi | Fonksiyon bazlı | Record/allocate/finalize/claim lifecycle ve weight math incelendi. |
| MockEscrowRewardView.sol | İncelendi | Satır bazlı | Rewardable view test mock semantiği doğrulandı. |
| scripts/* rewards/deploy | İncelendi | Script bazlı | Env guard, owner/treasury wiring, smoke readiness kontrol edildi. |
| hardhat.config.js | İncelendi | Satır bazlı | RPC env zorunluluk/fallback davranışı değerlendirildi. |
| package.json | İncelendi | Script/deps | Coverage/invariant/static-analysis script boşlukları kontrol edildi. |
| .env.example | İncelendi | Satır bazlı | Script-consumed canonical env isimleri kontrol edildi. |
| İlişkili testler | İncelendi | Test-by-test | Revenue/reward lifecycle ve deploy guard coverage genel olarak güçlü. |

## Findings
| ID | Severity | Category | File / Function | Finding | Risk | Evidence | Suggested Action |
|---|---|---|---|---|---|---|---|
| P07-001 | HIGH | accounting-math | contracts/src/ArafRewards.sol / `claim` | `claim` fonksiyonu kullanıcı payını `floor(pool*uWeight/tWeight)` ile verir; kullanıcılar sırayla claim ettikçe rounding dust sözleşmede kalır ve otomatik sweep path görünmüyor. | Epoch kapanışında residual token kontratta birikerek muhasebe drift/operasyonel belirsizlik yaratabilir. | `claim` transferi integer division; residue yönetimi için ayrı fonksiyon görülmüyor. | Unclaimed residue policy (rollover/sweep) ve eventlenmiş kapanış prosedürü eklenmeli (veya dokümante edilip testlenmeli). |
| P07-002 | MEDIUM | state-machine | contracts/src/ArafRewards.sol / finalize-claim lifecycle | `finalizeEpochToken` epoch sonundan sonra yapılabiliyor; allocation/finalization sıralaması kontrollü olsa da “finalize sonrası ek allocation yasak” davranışı var ve operasyonel olarak geri dönüşsüz. | Yanlış finalize zamanlamasıyla fon dağıtımı gecikebilir/manuel müdahale gerektirebilir. | `allocateEpochRewards` finalize edilmiş epoch/token’da revert ediyor. | Go-live runbook’ta finalize gate checklist + dry-run adımı zorunlu olmalı. |
| P07-003 | MEDIUM | deployment-env | contracts/scripts/smokeRewards.js & verify scripts | Smoke/readiness scriptleri güçlü guard içeriyor; fakat gerçek readiness’in bir kısmı source-string veya env-assert odaklı testleniyor, zincir üstü ekonomik conservation doğrulaması sınırlı. | “Smoke geçti” algısı ekonomik güvenceyle karıştırılabilir. | Testler script source guardlarını ve wiring’i doğruluyor; kapsamlı economic invariant smoke sınırlı. | Smoke çıktısına explicit “not economic-invariant complete” uyarısı ve ayrı conservation smoke adımı eklenmeli. |
| P07-004 | LOW | testing-gap | contracts/package.json + test strategy | Unit/e2e testler iyi; ancak package script yüzeyinde invariant/fuzz/static-analysis komutlarının zorunlu pipeline parçası net değil (uncertain). | Uzun vadede karmaşık edge-case regresyonları geç fark edilebilir. | Test dosyaları mevcut, fakat pipeline standardı script seviyesinde sınırlı görünüyor. | **uncertain**: invariant/fuzz (echidna/foundry style) ve static analysis komutları CI’de zorunlu hale getirilmeli. |

## No-Finding Notes
- `ArafRevenueVault` tarafında `rewardReserve + treasuryReserve` liability kontrolü ve exact-in transfer varsayımı güvenlik açısından doğru yönde.
- `transferEpochAllocation` sıralaması (önce external funding, kalan reward reserve) muhasebe modeline uygun.
- Rewards tarafında `recordedTrade` ile double-record önleniyor.
- `Tier0` ve `DirectEscrow` ödül dışı bırakma semantiği açık.
- Hardhat config’te public RPC fallback kaldırma guardı testle doğrulanmış.
- Deploy/reconfigure/switch/verify scriptleri yanlış treasury/owner/wiring risklerine karşı güçlü fail-closed kontroller içeriyor.

## Cross-File Observations
- Vault ve Rewards arasındaki sorumluluk sınırı net: vault reserve/muhasebe, rewards allocation/claim.
- Script ve test katmanında “treasury switch ayrı akış” ilkesi tutarlı ve güvenlik açısından olumlu.
- Ekonomik conservation (özellikle rounding residue) için kontrat düzeyi explicit kapanış politikası henüz net değil.

## Follow-up Needed
- Rounding residue/unclaimed token için net product+ops policy tanımlanmalı (rollover vs sweep).
- Rewards finalize/allocate operasyonu için runbook’ta sequence lock ve rollback planı yazılmalı.
- CI’ye invariant/fuzz/static-analysis zorunlu kapılar eklenmeli.

---

## Phase 07 — Ek Faz 1 (2026-04-30, yeni bulgu keşfi)

### Ek Faz 1 Method
- Phase 07 kapsamı ikinci kez satır/fonksiyon bazlı tarandı.
- Bu turda önceki bulgulardan bağımsız yeni bulgu üretmeye odaklanıldı:
  - reserve/liability conservation edge-case’leri
  - epoch finalize/claim zamanlama uçları
  - deploy/verify scriptlerinde yanlış ağ/yanlış owner/yanlış treasury guardları
  - tooling ve test pipeline boşlukları

### Ek Faz 1 Notes
- `ArafRevenueVault` tarafında exact-in ve reserve ayrımı güçlü; external funding + reward reserve karışımı `transferEpochAllocation` ile deterministik sırada ele alınıyor.
- `ArafRewards` tarafında record/allocate/finalize/claim akışı net; recordedTrade guardı double-record’ı engelliyor.
- `claim` dağıtımında integer division kaynaklı residue doğası korunuyor (bilinçli politika gerektiriyor).
- Script/test katmanında yanlış wiring risklerine karşı önemli fail-closed guardlar mevcut.

### Ek Faz 1 Findings
| ID | Severity | Category | File / Function | Finding | Risk | Evidence | Suggested Action |
|---|---|---|---|---|---|---|---|
| P07-E1-001 | MEDIUM | accounting-math | contracts/src/ArafRewards.sol / `claim`, `claimable` | Epoch pool üzerinde pro-rata integer division nedeniyle kullanıcı toplam claim’leri pool’un altında kalabilir; residue için kontrat içi explicit rollover/sweep politikası yok. | Uzun vadede contract balance’ta “unclaimed dust” birikimi ve operasyonda belirsizlik yaratır. | `amount = pool * uWeight / tWeight`, residue handling fonksiyonu görünmüyor. | Residue policy (rollover/sweep/treasury redirect) açık bir stateful mekanizma + event ile eklenmeli veya kesin dokümante edilmeli. |
| P07-E1-002 | MEDIUM | deployment-env | contracts/scripts/smokeRewards.js | Smoke script guardları var ancak ekonomik conservation ve residual davranışını zincir üstü doğrulayan kapsamlı assertion seti sınırlı. | “smoke geçti” algısı production readiness’i olduğundan güçlü gösterebilir. | Testler çoğunlukla wiring/env/source guard; full economic conservation smoke sınırlı. | Go-live smoke’a economic invariant check adımları eklenmeli (allocation=sum(claims)+residue policy). |
| P07-E1-003 | LOW | testing-gap | contracts/package.json / test strategy | Mevcut test seti güçlü olsa da package script yüzeyinde fuzz/invariant/static-analysis kapıları zorunlu CI standardı olarak görünmüyor (uncertain). | Edge-case regressions geç yakalanabilir. | Test dosyaları mevcut; pipeline enforcement scriptleri sınırlı görünüyor. | **uncertain**: invariant/fuzz/static analysis komutları CI’de required gate yapılmalı. |

### Ek Faz 1 No-Finding
- Vault owner’ın reward reserve’i doğrudan çekememesi (treasury reserve ile sınır) modeli korunuyor.
- Supported token policy ve exact-in varsayımları testlerle desteklenmiş.
- Hardhat RPC env fail-closed guardı public fallback riskini düşürüyor.

---

## Phase 07 — Ek Faz 2 (2026-04-30, yeni bulgu keşfi)

### Ek Faz 2 Method
- Phase 07 kapsamı üçüncü kez gözden geçirildi.
- Ek Faz 1 bulgularından bağımsız yeni risk adayları için özellikle şu kırılımlar tarandı:
  - `transferEpochAllocation` + `epochRewardPool` + `claim` muhasebe geçişleri
  - finalize zamanlama ve geç finalize/erken finalize operasyonel riski
  - deploy/verify script zincir/owner/treasury doğrulama sınırları
  - test paketinde conservation/fuzz/invariant pratiği

### Ek Faz 2 Findings
| ID | Severity | Category | File / Function | Finding | Risk | Evidence | Suggested Action |
|---|---|---|---|---|---|---|---|
| P07-E2-001 | MEDIUM | accounting-math | contracts/src/ArafRevenueVault.sol / `transferEpochAllocation` + `ArafRewards.claim` | Epoch allocation external funding + reward reserve karışımında muhasebe doğru görünüyor; ancak epoch kapanışında claim edilmemiş bakiyenin lifecycle politikası (freeze/rollover/sweep) kontrat seviyesinde explicit değil. | Operasyonel olarak “hangi bakiye neden kaldı” sorusu zorlaşır; governance/manual süreçlere bağımlılık artar. | Allocation ve claim ayrı kontratlarda yürütülüyor; explicit epoch residue finalization policy fonksiyonu görünmüyor. | Epoch residue yönetimi için explicit finalization policy + event önerilir. |
| P07-E2-002 | MEDIUM | deployment-env | contracts/scripts/verifyRewardsDeployment.js + smoke/rollout scripts | Script guardları kapsamlı olsa da yanlış chain üzerinde “kısmi doğru wiring” senaryosunda insan hatasına karşı defense-in-depth sınırlı kalabilir (ör. manifest/env tutarlı ama beklenmeyen hedef ağ). | Yanlış ağda doğru görünen konfigürasyon ile false-ready riski. | Chain/env kontrolleri var; ancak tam go-live sürecinde çoklu doğrulama adımı operasyona bırakılıyor. | Verify/smoke çıktısına chain fingerprint + contract bytecode hash eşlemesi zorunlu check eklenmesi önerilir. |
| P07-E2-003 | LOW | testing-gap | contracts/test/* + contracts/package.json | Testler işlevsel olarak güçlü; fakat fuzz/invariant regression kapıları script seviyesinde standartlaştırılmış zorunlu profile olarak görünmüyor (uncertain). | Edge-case ekonomik regressions geç tespit edilebilir. | E2E ve unit kapsam var; pipeline-level invariant standardı belirsiz. | **uncertain**: CI’de invariant/fuzz profili required check yapılmalı. |

### Ek Faz 2 No-Finding
- `recordedTrade` guardı double-record riskini etkin biçimde sınırlıyor.
- `supportedToken` + exact-in kontrolleri vault funding path’lerinde güvenlik çizgisini koruyor.
- Owner-only yüzeylerde doğrudan reward reserve drain açığına dair yeni bağımsız bulgu üretilmedi.
