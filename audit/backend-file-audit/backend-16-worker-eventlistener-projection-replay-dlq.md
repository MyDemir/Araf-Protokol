# Backend Audit 16 — Worker EventListener (Projection, Replay, Finality, DLQ)

Date: 2026-04-30  
Auditor: Codex (GPT-5.3-Codex)

## Scope
- Primary: `backend/scripts/services/eventListener.js`
- Related: `backend/scripts/services/dlqProcessor.js`, `backend/scripts/services/health.js`, `backend/scripts/models/Order.js`, `backend/scripts/models/Trade.js`, `backend/scripts/models/RevenueEvent.js`, `backend/scripts/models/RewardEpochAllocationEvent.js`, `contracts/src/ArafEscrow.sol`
- Tests: `eventListener.finalityDepth`, `eventListener.escrowReleasedOrder`, `eventListener.reputationAuthorityMirror`, `eventListener.rpcEnvRequired`, `eventListener.orderFilledMirror`

## Executive summary
Bu tur kapsamındaki worker mimarisi genel olarak güvenli ve fail-safe:
- Finality-depth + safe checkpoint ayrımı var; canlı bloklar hemen “safe” işaretlenmiyor.
- Replay/live akışlarında partial failure checkpoint’i yanlış ileri taşımama prensibi uygulanmış.
- İdempotency, özellikle terminal state ve bazı projection güncellemelerinde güçlü şekilde düşünülmüş.
- DLQ + retry/backoff zinciri worker’ı kilitlemeden başarısız eventleri ayırıyor.

Buna rağmen bazı operasyonel ve veri-bütünlüğü riskleri sürüyor:
1. Replay batch’te tek event failure olduğunda batch checkpoint ilerlemiyor; güvenli ama backlog büyütebilir.
2. Bazı handler’larda “silent no-op” (query filter eşleşmezse) olduğu için drift’in tespiti gecikebilir.
3. Drift detection explicit reconciliation job olarak değil, replay + finality ack semantiğiyle dolaylı yapılıyor.

## Findings by target question

### 1) Checkpoint partial failure sonrası yanlış ilerliyor mu?
**Sonuç: Güvenli (fail-closed eğilimli).**
- Replay batch içinde herhangi bir event hata verirse `batchSuccess=false` oluyor ve o batch için safe checkpoint güncellenmiyor.
- Live poll tarafında per-event ack/unsafe takip ediliyor; başarısız event blok güvenliğini engelliyor.
- `LAST_SAFE_BLOCK_KEY` ve `CHECKPOINT_KEY` birlikte güncelleniyor; safe progression tek yönlü (higher-only).

**Risk notu:** Bu yaklaşım doğruluk lehine konservatif; fakat uzun süreli tekil poison event, safe checkpoint ilerleyişini yavaşlatabilir.

### 2) Reorg/finality depth davranışı güvenli mi?
**Sonuç: Evet, genel olarak güvenli.**
- `finalizedUpTo = head - WORKER_FINALITY_DEPTH` ile güvenli blok penceresi belirleniyor.
- Safe checkpoint advance sadece `seen==acked` ve `unsafe=false` bloklar için yapılıyor.
- Bu sayede non-finalized bloklardan gelen geçici olaylar doğrudan safe checkpoint’e yansımıyor.

### 3) Duplicate event processing idempotent mi?
**Sonuç: Büyük ölçüde evet, ama handler’a göre farklı seviyede.**
- Revenue/funding/claim/allocation event’lerinde `tx_hash + log_index` upsert anahtarı güçlü idempotency sağlıyor.
- Trade/order projection akışlarında terminal-state guard ve insert-check (`tradeUpsert.inserted`) ile double-count riski azaltılmış.
- `BleedingDecayed` tarafında event-id array guard (`decay_tx_hashes`) mevcut.

**Kalan risk:** Bazı update path’leri idempotent no-op’a dayanıyor; indeks/constraint dışı drift durumlarında sessiz veri sapması gözden kaçabilir.

### 4) Mongo state regression engelleniyor mu? Terminal trade state geriye düşer mi?
**Sonuç: Çoğunlukla engelleniyor.**
- `EscrowLocked` yalnız `OPEN/LOCKED` üzerinde etkili; ileri state’leri geriye çekmiyor.
- `EscrowReleased`, `EscrowCanceled`, `EscrowBurned`, `SettlementFinalized` terminal geçişlerde state filtresiyle çalışıyor.
- `SettlementFinalized` replay/idempotent senaryosunda order stats’i ikinci kez düşmüyor.

**Kalan risk:** `PaymentReported` / `DisputeOpened` gibi ara-state geçişlerinde no-op filter yaklaşımı var; beklenmeyen sıra sapmaları explicit drift alarmı üretmiyor.

### 5) DLQ poison event worker’ı kilitler mi?
**Sonuç: Doğrudan kilitleme yok, fakat throughput baskısı oluşturabilir.**
- Worker tarafında `MAX_RETRIES` sonrası DLQ push var.
- `dlqProcessor` exponential backoff, attempt sayacı, poison logging ve queue trimming/archival yapıyor.
- Ready olmayan entry’ler skip ediliyor; tüm queue tek giriş yüzünden hard-block olmuyor.

**Risk notu:** Yüksek poison oranında sürekli re-drive denemeleri operasyonel gürültü ve gecikme yaratır; metrik/alarmlar bunu yönetmek için kritik.

### 6) Replay missed events gap bırakabilir mi?
**Sonuç: Düşük-orta risk, tasarım kontrollü ama tamamen sıfır değil.**
- Replay aralığı checkpoint+1’den finalized block’a kadar taranıyor.
- Her event adı için queryFilter yapılıp birleşik sıralama işleniyor.
- Live poll + per-block ack modeli replay ile tamamlayıcı.

**Kalan risk:** RPC provider geçici tutarsızlığı / query hata pencerelerinde bazı event adları için batch içinde warning ile geçiş olabilir; sonraki replay döngüleri bunu telafi etmeye çalışsa da anlık gap mümkündür.

### 7) Worker lag/readiness health’e yansıyor mu?
**Sonuç: Evet.**
- `health.getReadiness` worker state, running flag, lastSeen/safeBlock, provider block ve lag hesaplarını raporluyor.
- `WORKER_MAX_LAG_BLOCKS` eşiği ile readiness kararına doğrudan etki var.
- replay durumu (`workerReplayHealthy`) readiness’i düşürebiliyor; bu doğru konservatif davranış.

### 8) On-chain state ile read-model drift nasıl fark ediliyor?
**Sonuç: Dolaylı tespit var, explicit reconciliation sınırlı.**
- Drift azaltımı: event replay, chain getter’dan fresh fetch (`getTrade/getOrder/getReputation`) ve idempotent upsert.
- `TokenConfigUpdated` sonrası full refresh denemesi de drift azaltıcı.
- Ancak event/projection sapması için ayrı per-record reconciliation veya checksum audit job görünmüyor.

### 9) Exception logging secret/PII sızdırıyor mu?
**Sonuç: Bu kapsamda yüksek riskli doğrudan sızıntı gözlenmedi; düşük-orta dikkat alanı mevcut.**
- Loglar çoğunlukla event adı, tx hash, trade id, error message seviyesinde.
- Payout snapshot içeriği loglanmıyor; bu iyi.
- Yine de upstream error message içeriği dış bağımlılıklardan gelebileceği için merkezi scrubber politikası kritik kalmaya devam eder.

## Test coverage observations (requested set)
- `eventListener.finalityDepth`: finality/safe-block semantiği doğrulanıyor.
- `eventListener.escrowReleasedOrder`: release sonrası order stats/state projection doğrulaması var.
- `eventListener.reputationAuthorityMirror`: reputation alanlarının on-chain mirror mantığı kapsanıyor.
- `eventListener.rpcEnvRequired`: RPC/env fail-closed davranışı kontrol ediliyor.
- `eventListener.orderFilledMirror`: child trade + order fill projection/idempotency çekirdeği kapsanıyor.

**Gap önerileri:**
1. Replay batch içinde tek event poison iken checkpoint’in beklenen blokta kaldığını doğrulayan test.
2. `PaymentReported` ve `DisputeOpened` out-of-order replay’de state regression/no-op davranışı.
3. `_advanceSafeCheckpointFromAcks` için mixed block ack/unsafe senaryoları.
4. DLQ re-drive sırasında aynı txHash farklı eventName sentetik key ayrışması.

## Authority boundary check
- Oracle-free dispute modeli korunuyor.
- Release/cancel/burn/payout/settlement authority kontratta kalıyor.
- Worker/read-model on-chain sonucu değiştirmiyor; mirror katmanı olarak kalıyor.
