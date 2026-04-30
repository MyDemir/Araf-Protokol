# Phase 06 — Contracts Deep Audit: `ArafEscrow.sol`

## Scope
Ana dosya:
- contracts/src/ArafEscrow.sol

İlişkili dosyalar:
- contracts/test/ArafEscrow.test.js
- contracts/test/partialSettlement.core.test.js
- contracts/test/paymentRiskLevel.snapshot.test.js
- contracts/test/protocolRevenue.classification.test.js
- contracts/test/reputationV3.authority.test.js
- contracts/test/rewardableTradeView.test.js
- contracts/test/tokenDecimals.tierLimit.test.js
- contracts/test/transferExactIn.security.test.js
- contracts/src/MockERC20.sol
- contracts/src/MockERC20FalseTransfer.sol
- contracts/src/MockFeeOnTransferERC20.sol
- contracts/src/MockRevenueReceiver.sol
- contracts/src/MockRevenueReceiverReverter.sol

## Method
- `ArafEscrow.sol` satır/fonksiyon bazlı okundu.
- Büyük dosya için aşağıdaki 10 bölümde ayrı notlandırma yapıldı.
- İlgili testler fonksiyon kapsaması ve güvenlik regresyonları açısından çapraz okundu.

## Section Notes (zorunlu bölümleme)

### 1) errors / enums / structs / constants / state
- Trade ve Order state enum’ları net ayrılmış; terminal outcome/revenue kind semantiği ayrıca tanımlı.
- Custom error seti geniş ve kritik akışlar için kapsamlı.
- `TokenConfig` + `tierMaxAmountsBaseUnit` ile chain-token-specific limit modeli var.
- `SettlementProposal` state modeli explicit (NONE→PROPOSED→REJECTED/WITHDRAWN/EXPIRED/FINALIZED).

### 2) constructor / config / token setup
- Mutable fee/cooldown ve token config owner yüzeyleri mevcut.
- `InvalidDecimals`, `AmountExceedsTierLimit`, token direction guardlarına dair testler (`tokenDecimals.tierLimit.test.js`) mevcut.
- Revenue receiver hook için ayrı test doubles var.

### 3) order creation / fill / cancel
- Parent order ↔ child trade ayrımı net.
- `OrderCreated/OrderFilled/OrderCanceled` event akışı ve child linkage testlerde işlenmiş.
- Fill amount / minFill / remaining akışlarına yönelik guard ve test coverage mevcut.

### 4) trade lifecycle
- OPEN/LOCKED/PAID/CHALLENGED/RESOLVED/CANCELED/BURNED akışı fonksiyon ve test seviyesinde görünür.
- `reportPayment`, `releaseFunds`, `autoRelease`, `challengeTrade` geçişleri test setinde yer alıyor.

### 5) dispute / bleeding / burn
- Grace period + bleeding decay + burn akışı state-machine olarak ayrılmış.
- `getCurrentAmounts` ve decay davranışı ile terminal burn semantiği rewardable view testlerinde de dolaylı doğrulanıyor.

### 6) cancel EIP-712
- `CANCEL_TYPEHASH` + `sigNonces` + `deadline` doğrulama yüzeyi mevcut.
- Signature domain/nonce/deadline güvenliği testlerde ele alınıyor (`trades.cancelSignature` backend mirror tarafı, contract testleriyle birlikte).

### 7) settlement
- Proposal lifecycle (propose/accept/reject/withdraw/expire/finalize) event’lerle açık.
- BPS split sınırı ve payout/fee snapshot semantiği mevcut.
- Partial settlement core testleri önemli pathleri kapsıyor.

### 8) reputation
- Authority kontratta tutuluyor; outcome-temelli reputation sayaçları zengin.
- clean-slate/decay mekanizması ayrı policy alanlarıyla yapılandırılabilir.
- `reputationV3.authority.test.js` authority sınırı açısından kritik doğrulama sağlıyor.

### 9) views / getters / internal helpers
- `getRewardableTrade` ve terminal snapshot semantiklerinin test kapsamı iyi (`rewardableTradeView.test.js`).
- Read-model ve indexer senkronu için event + getter birlikte tasarlanmış.

### 10) revenue transfer helpers
- `ProtocolRevenueSent`/`EscrowRevenueReceived` ve hook davranışları mevcut.
- Hook revert durumuna ilişkin test doubles bulunuyor (`MockRevenueReceiverReverter`).

## Findings
| ID | Severity | Category | File / Function | Finding | Risk | Evidence | Suggested Action |
|---|---|---|---|---|---|---|---|
| P06-001 | MEDIUM | testing-gap | contracts/src/ArafEscrow.sol + tests | Çok geniş state-machine ve ekonomi yüzeyi için testler güçlü olsa da, kombinatoryel geçişlerin tamamı için exhaustive state transition matrix görünmüyor. | Nadir state kombinasyonları (özellikle settlement + dispute + cancel etkileşimi) regresyonda kaçabilir. | Birçok kritik test var; ancak tüm geçiş çiftleri/üçlüleri için sistematik matrix görünmüyor. | State transition matrix tabanlı property/invariant test seti eklenmesi önerilir. |
| P06-002 | MEDIUM | accounting-math | contracts/src/ArafEscrow.sol / fee+bps+decay paths | BPS/decay/fee hesapları çoklu terminal path’te dağılmış; rounding residual/dust davranışı genel tasarımda ele alınsa da her path için explicit invariant testi sınırlı olabilir. | Uzun vadede küçük residual farkları path’e göre değişebilir ve muhasebe/izleme drifti yaratabilir. | `DUST_LIMIT`, fee/decay sabitleri ve çoklu terminal outcome var; testler önemli örnekleri kapsıyor ama tam invariant seti belirsiz. | Per-path “sum conservation” invariant testleri (maker+taker+treasury+burned) genişletilmeli. |
| P06-003 | LOW | testing-gap | contracts/src/ArafEscrow.sol / revenue hook fallback | Revenue hook revert senaryosu için mock mevcut; ancak hook başarısızlığı altında tüm terminal path’lerde event/ordering/rollback etkisinin tam matrisi **uncertain**. | Beklenmedik hook hata davranışında observability/rollback beklentisi ile farklılık olabilir. | `MockRevenueReceiverReverter` var; fakat tüm revenue-emitting akışlara eşit kapsam net değil. | **uncertain**: protocolRevenue + settlement + burn pathlerinde hook-failure matrix testleri artırılmalı. |

## No-Finding Notes
- State machine omurgası (trade/order/settlement) tasarım olarak net ve role-authority sınırları oracle-free model ile uyumlu.
- Parent order ↔ child trade linkage modeli belirgin; backend authority üretimine alan bırakmıyor.
- Fee-on-transfer token rejection güvenlik testi (`transferExactIn.security.test.js`) mevcut ve önemli bir riski kapatıyor.
- Token decimals/tier limit doğrulaması contract + testte açık biçimde ele alınmış.
- Reputation authority’nin kontratta kalması ve read-modellere doğru event yayılımı testlerle destekleniyor.

## Cross-File Observations
- Contract event semantiği backend worker mirror beklentileriyle uyumlu olacak şekilde zengin tasarlanmış (Order/Settlement/Revenue/Reputation event seti).
- Test seti derin ve geniş; yine de birleşik state-path patlaması nedeniyle invariant/property yaklaşımı daha da değerli olacaktır.

## Follow-up Needed
- Phase 07+’de deploy/script ve backend event ABI tüketimi ile contract ABI drift riski ayrıca doğrulanmalı.
- Settlement + dispute + cancel üçlü etkileşimi için formal state invariant checklist çıkarılmalı.

---

## Phase 06 — Ek Faz 1 (2026-04-30)

### Ek Method Notu
- Aynı kapsam dosyaları yeniden gözden geçirildi; bu turda özellikle state transition ve ekonomi akışları (fee/bond/decay/settlement) tekrar odaklandı.
- Event emission ↔ indexer correctness ve test kapsaması ikinci geçişte tekrar çaprazlandı.

### Ek Bölüm Notları (1–10)
1. **errors/enums/structs/constants/state**
   - `TradeState`, `OrderState`, `SettlementProposalState`, `TerminalOutcome` ayrımları açık; terminal immutability semantiği event+snapshot yapısıyla destekleniyor.
2. **constructor/config/token setup**
   - Token config, fee config, cooldown config owner yüzeyleri ayrı event’lerle yayınlanıyor; yönetim değişiklikleri indexlenebilir.
3. **order creation/fill/cancel**
   - Parent order rezervleri ve fill sonrası child trade doğumu ayrık; order side/amount/minFill guard’ları state machine ile uyumlu.
4. **trade lifecycle**
   - `reportPayment→release/autoRelease/challenge` çatalları net; terminal state’e geçişten sonra tekrar ödeme/çözümleme girişimleri guard’larla engelleniyor.
5. **dispute/bleeding/burn**
   - Ping/response windows ve bleeding zaman akışı, burn path’i ile birlikte non-custodial anlaşmazlık modelini koruyor.
6. **cancel EIP-712**
   - Nonce + deadline + imza doğrulaması bulunuyor; replay yüzeyi nonce tüketimiyle daraltılmış.
7. **settlement**
   - Proposal lifecycle tam; `PROPOSED/REJECTED/WITHDRAWN/EXPIRED/FINALIZED` event zinciri indexer tarafında izlenebilir.
8. **reputation**
   - Outcome tabanlı reputation güncellemesi kontrat authority’sinde; backend’e ekonomik hüküm devri yok.
9. **views/getters/internal helpers**
   - `getCurrentAmounts` ve `getRewardableTrade` gibi view’lar read-model için yeterli semantik taşıyor; authority üretmiyor.
10. **revenue transfer helpers**
   - Revenue sınıflandırması (`RevenueKind`) açık; hook failure path’i ayrı ele alınmış.

### Ek Findings
| ID | Severity | Category | File / Function | Finding | Risk | Evidence | Suggested Action |
|---|---|---|---|---|---|---|---|
| P06-E1-001 | MEDIUM | testing-gap | contracts/test/* (state-path combinatorics) | Fonksiyon bazlı testler güçlü olsa da tüm lifecycle kombinasyonları için sistematik transition table/invariant testleri hâlâ sınırlı. | Karmaşık path etkileşimlerinde edge regression riski. | Çok sayıda senaryo testi var; ancak tam geçiş matrisi/property seti görünmüyor. | Transition-matrix + invariant harness (state monotonicity, conservation) önerilir. |
| P06-E1-002 | LOW | docs-mismatch | contracts/src/ArafEscrow.sol + backend mirror expectations | Event payload’ları zengin; backend indexer bağımlılığı yüksek olduğundan event arg/index düzeninin değişmesi yüksek kırılganlık yaratır. | ABI drift durumunda backend mirror sessiz bozulabilir. | Contract event seti geniş, backend eventListener bu eventlere sıkı bağlı. | ABI drift checklist + release gate (contract ABI diff CI) önerilir. |

### Ek No-Finding
- Pause/Reentrancy/CEI yaklaşımında bu turda yeni kritik ihlal bulgusu üretilmedi.
- Fee-on-transfer token rejection ve decimals-tier guard testleri beklentiyle uyumlu kaldı.

---

## Phase 06 — Ek Faz 2 (2026-04-30)

### Ek Faz 2 Method
- `ArafEscrow.sol` yeniden satır/fonksiyon odaklı tarandı; bu turda özellikle aşağıdaki alanlara ikinci geçiş yapıldı:
  - terminal state immutability
  - settlement/cancel etkileşimi
  - fee+bond+revenue conservation semantiği
  - event completeness / indexer coupling
- İlişkili contract test dosyaları tekrar çaprazlandı.

### Ek Faz 2 — 10 Bölüm Notları
1. **errors/enums/structs/constants/state**
   - Hata seti ve enum ayrımları state-machine branch’lerini netleştiriyor; yanlış state çağrılarında fail-closed yaklaşım baskın.
2. **constructor/config/token setup**
   - Owner config yüzeyi ekonomik parametreleri ayarlıyor ancak model authority’sini backend’e devretmiyor; kontrat merkezli kalıyor.
3. **order creation/fill/cancel**
   - Parent order reserve mantığı ile child trade üretimi ayrık; self-trade ve min/max fill guardları tutarlı.
4. **trade lifecycle**
   - `reportPayment`, `releaseFunds`, `autoRelease` akışları terminal outcome üretimiyle bağlanmış; çift çözümleme önlemleri mevcut.
5. **dispute/bleeding/burn**
   - Ping/challenge/bleeding/burn sıralaması state-guard’larla korunuyor; süre tabanlı akış oracle-free prensiple uyumlu.
6. **cancel EIP-712**
   - Nonce/deadline/signature doğrulaması sözleşme içinde; replay riskini azaltan nonce tüketim semantiği korunuyor.
7. **settlement**
   - Proposal lifecycle ve event seti tamamlayıcı; finalize sonrası tekrar finalize/çelişkili işlem guardları bulunuyor.
8. **reputation**
   - Reputation güncellemesi terminal outcome’a bağlı; clean-slate/decay logic kontrat authority’sinde.
9. **views/getters/internal helpers**
   - `getCurrentAmounts` ve rewardable view, backend’e authority vermeden explainability/read-model desteği sağlıyor.
10. **revenue transfer helpers**
   - Revenue kind sınıflandırması açık; treasury/hook davranışı ayrılmış.

### Ek Faz 2 Findings
| ID | Severity | Category | File / Function | Finding | Risk | Evidence | Suggested Action |
|---|---|---|---|---|---|---|---|
| P06-E2-001 | MEDIUM | state-machine | contracts/src/ArafEscrow.sol (settlement + cancel + dispute kesişimleri) | Tekil path testleri güçlü olsa da settlement/cancel/dispute üçlü etkileşiminde tüm state-permutation’lar için formal exhaustive geçiş haritası testte görünmüyor. | Nadir edge-pathlerde state regression riski kalabilir. | Çok sayıda senaryo testi var; ancak kombinatoryel exhaustive matrix açıkça görünmüyor. | Geçiş matrisi + forbidden transition property testleri önerilir. |
| P06-E2-002 | MEDIUM | accounting-math | contracts/src/ArafEscrow.sol (fees/bonds/bleeding/revenue) | Fee, bond, decay, treasury/hook dağılımı çoklu terminal pathlerde hesaplanıyor; tüm pathlerde “value conservation” invariant’ı sistematik ispat/testlenmiş görünmüyor. | Rounding/dust path farklılıklarında küçük muhasebe drift’leri operasyonel olarak zor izlenebilir. | `DUST_LIMIT` ve farklı terminal outcome/revenue türleri mevcut; testler önemli örnekleri kapsasa da tam conservation matrix belirsiz. | Her terminal outcome için `maker+taker+treasury+burned = expected pool` invariant testi önerilir. |
| P06-E2-003 | LOW | ABI-drift | contracts/src/ArafEscrow.sol + backend event consumer | Event kapsamı geniş; backend mirror katmanı event alanlarına sıkı bağlı. Event arg/index düzeni değişimlerinde drift riski yüksek kalır. | Indexer/mirror sessiz bozulma riski (özellikle deploy sonrası). | Order/Settlement/Reputation/Revenue eventleri backend worker tarafından aktif tüketiliyor. | ABI diff gate ve event schema compatibility checklist release sürecine zorunlu eklenmeli. |

### Ek Faz 2 No-Finding
- Fee-on-transfer token rejection için security testleri contract varsayımlarını destekliyor.
- Token decimals/tier limit kontrolleri expected guard davranışıyla uyumlu.
- Reentrancy/CEI/pause alanında bu turda yeni kritik ihlal bulgusu üretilmedi.

---

## Phase 06 — Ek Faz 3 (2026-04-30, 2443 satır full-pass)

### Ek Faz 3 Method
- `contracts/src/ArafEscrow.sol` dosyasının tamamı (toplam **2443 satır**) üç blok halinde tekrar okundu (1–900, 901–1800, 1801–2443).
- Bu geçişte özellikle state-machine edge-path, terminal immutability, payout conservation ve event-indexer doğruluğuna odaklanıldı.
- İlişkili test dosyaları yeniden çapraz okunarak coverage boşlukları tekrar değerlendirildi.

### Ek Faz 3 — Bölüm Bazlı Notlar (1–10)
1. **errors/enums/structs/constants/state**
   - Hata/enum ayrımı state geçiş kontrollerini açık hale getiriyor; invalid-state pathleri fail-closed.
2. **constructor/config/token setup**
   - Token support/direction/decimals/tier-limit yüzeyi owner-konfigürasyonlu ama enforcement kontratta; backend authority sızıntısı yok.
3. **order creation/fill/cancel**
   - Parent order reservleri ile child trade doğumu ayrık tutulmuş; min-fill ve remaining hesaplarıyla tutarlı akış var.
4. **trade lifecycle**
   - `OPEN→LOCKED→PAID→(RESOLVED|CHALLENGED)` ve terminal geçişlerde guardlar belirgin; çift terminalleşme riskine karşı kontroller mevcut.
5. **dispute/bleeding/burn**
   - Ping zorunlulukları, grace/bleeding süreleri ve burn trigger sıralaması oracle-free modelle uyumlu.
6. **cancel EIP-712**
   - EIP-712 domain/typed-data + nonce/deadline doğrulaması replay riskini düşürüyor; taraf imza semantiği iki taraflı onay modelinde kalıyor.
7. **settlement**
   - Proposal state lifecycle ve finalize hesapları kontratta; backend yalnız gözlemci kalacak şekilde eventlenmiş.
8. **reputation**
   - Outcome-driven reputation update ve clean-slate/decay authority’si on-chain kalıyor.
9. **views/getters/internal helpers**
   - `getCurrentAmounts`, `getRewardableTrade` ve yardımcılar read-model için güçlü; enforcement üretmiyor.
10. **revenue transfer helpers**
   - Revenue class ayrımı (`RevenueKind`) ile treasury/hook akışı semantik olarak ayrıştırılmış.

### Ek Faz 3 Findings
| ID | Severity | Category | File / Function | Finding | Risk | Evidence | Suggested Action |
|---|---|---|---|---|---|---|---|
| P06-E3-001 | MEDIUM | testing-gap | contracts/test/* vs `ArafEscrow.sol` | 2443 satırlık geniş yüzeyde fonksiyonel testler kapsamlı olsa da “forbidden transitions” için otomatik üretilmiş state-machine property testleri görünmüyor. | Nadir state kombinasyonlarında (özellikle dispute+settlement+cancel) regresyon riski sürebilir. | Senaryo testleri güçlü; fakat formal transition property harness açıkça görülmüyor. | Foundry/Hardhat property fuzz ile transition graph invariant’ları eklenmeli. |
| P06-E3-002 | MEDIUM | accounting-math | `ArafEscrow.sol` payout/fee/decay/revenue branches | Çoklu terminal path’te (manual/auto/disputed/partial/burn) değer dağılımı farklılaşıyor; tüm pathler için tek çatı conservation invariant testi sınırlı. | Rounding/dust kaynaklı path-spesifik residual sapmalarının gözden kaçma riski. | `DUST_LIMIT` ve farklı revenue kind/outcome kombinasyonları mevcut. | Her terminal outcome için “pool decomposition” invariant test matrisi önerilir. |
| P06-E3-003 | LOW | ABI-drift | `ArafEscrow.sol` events + backend indexer coupling | Event seti çok zengin ve backend mirror bu alanlara güçlü bağlı; ABI/event arg düzeni değişiminde kırılganlık yüksek. | Deploy sonrası sessiz indexer drift riski. | Order/Settlement/Reputation/Revenue eventleri backend worker tarafından aktif tüketiliyor. | ABI diff CI gate + versioned event schema belgesi zorunlulaştırılmalı. |

### Ek Faz 3 No-Finding
- Fee-on-transfer reddi, decimals/tier-limit guardları ve exact-in transfer varsayımı testlerle desteklenmiş.
- Reentrancy/CEI/pause alanında bu turda yeni bir kritik ihlal bulgusu çıkarılmadı.
- Stuck funds / double payout / terminal immutability için mevcut guardlar tasarımsal olarak tutarlı bulundu (yine de invariant test önerileri geçerlidir).

---

## Phase 06 — Ek Final (2026-04-30, mevcut bulgular harici tarama)

### Ek Final Method
- Önceki Phase 06 / Ek Faz 1 / Ek Faz 2 / Ek Faz 3 bulgularından bağımsız, ek satır-bazlı “harici bulgu” taraması yapıldı.
- Tarama odağı: mevcut bulgular dışında kalabilecek yeni state-machine kırılımları, ödeme/fee/bond muhasebesi edge-pathleri, event-indexer uyumu ve terminal immutability.

### Ek Final — Bölüm Bazlı Notlar (1–10)
1. **errors/enums/structs/constants/state**
   - Enum/state modelinde önceki bulgular dışında yeni bir geçiş kırığına işaret eden doğrudan satır-bazlı ihlal tespit edilmedi.
2. **constructor/config/token setup**
   - Config yüzeyi owner-gated ve fail-closed guard’larla ilerliyor; mevcut bulgular dışında yeni kritik bulgu çıkmadı.
3. **order creation/fill/cancel**
   - Order↔trade linkage ve fill/cancel guardlarında önceki bulgular haricinde yeni high/critical risk gözlenmedi.
4. **trade lifecycle**
   - OPEN→terminal lifecycle pathlerinde double payout/stuck funds yönünde ek yeni somut bulgu tespit edilmedi.
5. **dispute/bleeding/burn**
   - Ping/challenge/bleeding/burn sıralaması önceki bulguların ötesinde yeni state contradiction üretmiyor.
6. **cancel EIP-712**
   - Nonce/deadline/signature tarafında önceki coverage-gap bulgularının dışında ek yeni somut açık tespit edilmedi.
7. **settlement**
   - Proposal lifecycle event/state uyumu korunuyor; mevcut bulgular harici yeni kritik bulgu gözlenmedi.
8. **reputation**
   - Reputation authority on-chain kalıyor; backend’e hüküm devri yaratacak ek bulgu bulunmadı.
9. **views/getters/internal helpers**
   - Read-only helper yüzeyinde authority üretimi veya açık yeni sapma tespit edilmedi.
10. **revenue transfer helpers**
   - Revenue hook/treasury transfer semantiğinde mevcut bulgu seti dışında yeni bağımsız kritik bulgu üretilmedi.

### Ek Final Findings
| ID | Severity | Category | File / Function | Finding | Risk | Evidence | Suggested Action |
|---|---|---|---|---|---|---|---|
| P06-EF-001 | INFO | testing-gap | contracts/test/* + `ArafEscrow.sol` | Ek final taramada, önceki fazlarda raporlanan test/invariant genişletme ihtiyaçları dışında **yeni bağımsız** high/critical bulgu üretilmedi. | Yeni bağımsız kritik risk bulunmaması olumlu; ancak mevcut önerilerin uygulanmaması residual riski sürdürür. | Ek final satır-bazlı tarama mevcut bulgu seti dışında yeni kritik sapma üretmedi. | Önceki P06-E1/E2/E3 invariant/property önerileri uygulanarak residual risk azaltılmalı. |

### Ek Final No-Finding
- Bu turda önceki Phase 06 bulgularından bağımsız, yeni bir MAINNET-BLOCKER/CRITICAL/HIGH bulgu çıkmadı.
- Önceki bulgular geçerliliğini koruyor; ek final turu bunları invalid etmedi.
