# Backend File Audit — eventListener ABI / event decode surface (15)

## 1. Scope
İncelenen ana dosya:
- backend/scripts/services/eventListener.js

İlişkili dosyalar:
- contracts/src/ArafEscrow.sol
- contracts/src/ArafRevenueVault.sol
- contracts/src/ArafRewards.sol
- frontend/src/hooks/useArafContract.js
- frontend/src/hooks/useRewardsContract.js
- backend/scripts/models/Order.js
- backend/scripts/models/Trade.js

İlişkili testler:
- backend/test/eventListener.orderFilledMirror.test.js
- backend/test/eventListener.epochAllocationMirror.test.js
- backend/test/eventListener.settlementProposalMirror.test.js
- backend/test/eventListener.tokenConfigRefresh.test.js
- backend/test/eventListener.identityEnv.test.js

## 2. Method
- `eventListener.js` içinde yalnız istenen kapsam okundu: imports/constants/inline ABI/event signatures/getter tuples/decode helpers/provider setup/token refresh/event handlers.
- ArafEscrow/ArafRevenueVault/ArafRewards event ve getter imzaları worker inline ABI ile karşılaştırıldı.
- Frontend hook ABIs (`useArafContract`, `useRewardsContract`) tuple/event uyumu açısından çapraz kontrol edildi.
- Order/Trade model alanları ile event decode sonucu yazılan payloadlar hizalanma açısından değerlendirildi.
- Mevcut testlerin ABI drift/idempotency/token refresh/identity parsing kapsamı incelendi.

## 3. Function / Section Notes
- **Inline ABI kapsamı**: OrderCreated/OrderFilled/Settlement*/Revenue*/Reward* eventleri ile `getTrade/getOrder/getReputation` getter imzaları worker içinde açık tanımlı.
- **Event arg mapping**: `EVENT_ARG_KEYS` DLQ re-drive için deterministic key eşlemesi sağlıyor.
- **Provider chain guard**: `_connect()` içinde `assertProviderExpectedChainOrThrow` zorunlu; yanlış RPC-chain eşleşmesi fail-closed.
- **OrderFilled decode**: `orderId`, `tradeId`, `fillAmount`, `remainingAmount`, `childListingRef` doğrudan event args’dan alınıp child-trade mirror’a yazılıyor.
- **Token config refresh**: `TokenConfigUpdated` eventinde payload eksik alan içerdiği için tam `refreshProtocolConfig()` tercih ediliyor; sadece hata durumunda partial patch fallback var.
- **Revenue/rewards decode**: RevenueEvent/RewardFunding/RewardEpoch/RewardClaim yazımlarında amount/weight string tutuluyor ve address alanları lowercase normalize ediliyor.

## 4. Findings

| ID | Severity | Category | File / Function | Finding | Risk | Evidence | Suggested Action |
|---|---|---|---|---|---|---|---|
| B15-F01 | MEDIUM (uncertain) | abi-drift-maintenance | backend/scripts/services/eventListener.js (`ARAF_ABI`) | Inline ABI stringleri contract’tan bağımsız manuel taşınıyor. Şu an uyumlu görünse de contract event/getter imzası değişimlerinde worker drift riski yapısal olarak devam ediyor. | Event decode sessiz bozulabilir veya yanlış alan eşleşmesiyle mirror kalitesi düşebilir. | ABI tanımı dosya içinde hardcoded; auto-generated artifact bağlılığı yok. | ABI snapshot/contract hash bazlı CI guard eklenerek drift tespiti otomatikleştirilmeli. |
| B15-F02 | MEDIUM | data-observability | backend/scripts/services/eventListener.js (`_onEpochRewardAllocated`) | `RewardEpochAllocationEvent` mirror kaydında `block_number` persist edilmiyor (tx_hash+log_index var). | Reorg/replay forensics ve block-range audit kalitesi sınırlanır. | Handler insert payloadında block_number alanı yok. | Allocation event modeline `block_number` eklenip mirror yazımı güncellenmeli. |
| B15-F03 | LOW | address-normalization | event handlers + token refresh fallback | Çoğu address normalize ediliyor; ancak bazı fallback patch akışlarında normalize sorumluluğu alt katmana bırakılmış. Şu an model/service bunu tolere ediyor, fakat ileride katman ayrışması olursa drift riski doğabilir. | Çapraz katman normalize beklentisi kırılırsa duplicate key/lookup sapması yaşanabilir. | Event handler ve protocolConfig arasında normalize dağıtık. | Normalize sözleşmesini tek katmanda (service boundary) dokümante edip testle sabitlemek önerilir. |
| B15-F04 | LOW | numeric-conversion | helper seti (`_toNum`, `_toSafeNum`, `_toStr`) | `_toNum` Number cast’i bazı sayaçlarda bilinçli, financial/ID alanlarda ise string-safe yaklaşım doğru. Ancak yeni handler ekleyenlerde yanlış helper seçimi latent risk. | Büyük sayılarda precision kaybı veya null cache üretimi yanlış yorumlanabilir. | Financial/ID path’lerde string kullanım baskın, cache path’lerde Number. | Helper kullanım kuralları için contributor checklist/test guard eklenmeli. |
| B15-F05 | INFO | event-order-compat | OrderCreated/OrderFilled/Settlement/Revenue/Rewards handlers | Event arg sıraları contract imzalarıyla genel olarak uyumlu; OrderFilled child trade ID doğru decode edilip `onchain_escrow_id` olarak mirrorlanıyor. | Pozitif not: child trade identity karışma riski düşük. | Handler arg destructure + model field mapping + ilgili testler uyumlu. | ABI uyum snapshot testleri düzenli sürdürülmeli. |
| B15-F06 | INFO | token-config-safety | `_onTokenConfigUpdated` + tests | TokenConfigUpdated event payloadı eksik metadata taşıdığı için full refresh-first stratejisi doğru; refresh fail olursa limited fallback patch var. | Pozitif not: stale/partial token config drift riski azaltılmış. | `eventListener.tokenConfigRefresh` testleri refresh-first + fallback davranışını doğruluyor. | Refresh başarısızlık oranı için operasyonel alarm/metrik eklenmesi önerilir. |

## 5. No-Finding Notes
- Getter tuple mapping (`getTrade/getOrder/getReputation`) worker ve frontend hooklarda uyumlu görünüyor.
- Settlement event mirrorları FINALIZED state overwrite koruması ve idempotent replay davranışıyla güvenli.
- Revenue/reward eventlerinde base-unit amount string tutulması BigInt güvenliği açısından doğru.
- Provider/chain setup fail-closed ve prod/dev davranış ayrımı net.

## 6. Cross-File Risks
- **Manual ABI maintenance riski**: contract/hook/worker üçlüsünde tek bir signature değişikliği çoklu güncelleme gerektiriyor.
- **Observability riski**: bazı mirror event kayıtlarında block-level metadata eksikliği incident triage’ı zorlaştırabilir.
- **Helper misuse riski**: yeni event handler’larda yanlış numeric helper seçimi sessiz precision drift üretebilir.

## 7. Follow-up
Sonraki inceleme için önerilen dosyalar:
- backend/scripts/services/eventListener.js (ABI snapshot guards + helper usage lint)
- backend/scripts/models/RewardEpochAllocationEvent.js (block metadata genişletmesi)
- frontend/src/hooks/useArafContract.js ve useRewardsContract.js (shared ABI source strategy)
- backend/test/eventListener*.test.js (contract signature drift regression matrix)
