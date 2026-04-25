# Araf Protokol — Faz 2.1 Ürün Planlaması

**Tarih:** 25 Nisan 2026  
**Baz alınan durum:** Faz 2 ana geliştirme hattı `main` üzerinde tamamlandı. PR #70, #71, #72, #73 ve #74 merge edildi.  
**Son merge:** PR #74 — `9648c489dd8a92a1638cfb8e85b836b6d519bcb2`

---

## 1. Yönetici Özeti

Faz 2 ile Araf Protokol; off-chain personel doğrulaması kullanmadan, tarafların on-chain mutabakatı ve kontrat-authoritative settlement akışıyla çalışan daha ayrışmış bir escrow ürününe dönüştü.

Tamamlanan ana parçalar:

- On-chain partial settlement lifecycle
- Settlement proposal backend mirror ve frontend UX
- Terminal trade guardrails
- Payment Risk Class on-chain snapshot
- Resolution outcome analytics
- Disputed release outcome düzeltmesi
- Admin observability genişlemesi

Faz 2.1’in amacı artık yeni büyük özellik eklemekten çok, Faz 2’nin üretime daha güvenli, ölçülebilir ve abuse-resistant çıkmasını sağlamaktır.

**Faz 2.1 ana teması:**

> Araf’ın taraf-mutabakatlı, non-custodial ve backend-authority üretmeyen escrow modelini koruyarak; abuse guardrail, analytics doğruluğu, migration/backfill ve ürün anlatısını güçlendirmek.

---

## 2. Faz 2 Sonrası Ürün Durumu

### 2.1 Partial Settlement

Durum: **Tamamlandı**

Kullanıcılar aktif trade odasında settlement teklifi oluşturabilir, karşı taraf kabul edebilir, reddedebilir, geri çekebilir veya süre dolduğunda expire edebilir.

Ürün değeri:

- “Ya tamamen release ya da dispute/burn” ikilemini azaltır.
- Tarafların kısmi uzlaşmasını protokol içine alır.
- Off-chain hakemlik yaratmadan uyuşmazlık çözüm yolu sunar.

Korunan ilke:

- Backend settlement sonucu üretmez.
- Admin settlement sonucu üretmez.
- Health score settlement sonucu üretmez.
- Ekonomik sonuç on-chain işlem ve taraf consent’i ile oluşur.

### 2.2 Payment Risk Class

Durum: **Tamamlandı**

Order oluşturulurken ödeme rail/jurisdiction karmaşıklığı coarse bir risk class olarak on-chain snapshot edilir.

Risk seviyeleri:

- `LOW`
- `MEDIUM`
- `HIGH`
- `RESTRICTED`

Ürün dili:

> Payment risk sınıfı kullanıcı güveni değil, ödeme yönteminin operasyonel karmaşıklığıdır.

Bu ayrım kritik. Çünkü Araf’ın modeli kullanıcıları “personel doğrulamalı güven skoru” ile yargılamıyor; ödeme yönteminin chargeback/operasyonel risk profilini görünür kılıyor.

### 2.3 Resolution Type Analytics

Durum: **Tamamlandı**

Terminal trade’ler artık sadece `RESOLVED / CANCELED / BURNED` olarak değil, outcome taxonomy ile ayrışıyor:

- `MANUAL_RELEASE`
- `AUTO_RELEASE`
- `PARTIAL_SETTLEMENT`
- `MUTUAL_CANCEL`
- `BURNED`
- `DISPUTED_RESOLUTION`
- `UNKNOWN`

PR #74 ile iki önemli doğruluk düzeltmesi yapıldı:

- `unknownResolvedCount`, `resolution_type: null` veya missing terminal kayıtları da sayıyor.
- `CHALLENGED -> EscrowReleased` akışı `DISPUTED_RESOLUTION` olarak sınıflanıyor.

---

## 3. Faz 2.1 Hedefleri

Faz 2.1 beş ana iş paketinden oluşmalı:

1. Settlement proposal anti-spam guardrails
2. Resolution analytics backfill ve data migration
3. Release outcome semantiği için kontrat event iyileştirmesi
4. Settlement analytics dashboard genişletmesi
5. Ürün anlatısı ve kullanıcı eğitim katmanı

---

## 4. İş Paketi A — Settlement Proposal Anti-Spam Guardrails

### Problem

Şu an tek aktif settlement proposal kuralı var. Ancak bir teklif reddedildikten, geri çekildikten veya expire olduktan sonra aynı kullanıcı hemen tekrar teklif açabilir.

Örnek abuse döngüsü:

1. Maker settlement teklif eder.
2. Taker reddeder.
3. Maker tekrar teklif eder.
4. Taker tekrar reddeder.
5. Trade room bildirim/aksiyon baskısı oluşur.

Bu ekonomik güvenliği bozmaz ama UX abuse yaratır.

### Ürün Hedefi

Settlement teklifini tarafların uzlaşma aracı olarak korurken spam/pressure aracına dönüşmesini engellemek.

### Kapsam

#### Contract

- `SETTLEMENT_PROPOSAL_COOLDOWN = 10 minutes`
- `mapping(uint256 => mapping(address => uint256)) public lastSettlementProposalAt`
- `SettlementProposalCooldownActive(uint256 nextAllowedAt)` custom error

Kural:

- Aynı proposer, aynı trade için cooldown süresi içinde tekrar teklif açamaz.
- Karşı tarafın teklif açması engellenmez.
- Tek aktif proposal kuralı aynen korunur.

#### Frontend

Cooldown revert durumunda kullanıcı dostu copy:

TR:

> Bu işlem için yakın zamanda settlement teklifi gönderdiniz. Tekrar teklif vermeden önce bekleyin.

EN:

> You recently proposed a settlement for this trade. Please wait before proposing again.

#### Backend/Admin

- Admin settlement-proposals görünümünde proposal age zaten var.
- Ek olarak repeated proposal context sadece güvenli biçimde derive edilebiliyorsa eklenmeli.
- Backend hiçbir şekilde settlement outcome authority kazanmamalı.

### Öncelik

**P1 — Faz 2.1’in ilk PR’ı olmalı.**

### Kabul Kriterleri

- Aynı proposer reject sonrası 10 dakika içinde tekrar teklif açamaz.
- Karşı taraf aktif proposal yoksa kendi teklifini açabilir.
- Cooldown bitince tekrar teklif açılabilir.
- Existing active proposal guard bozulmaz.
- Settlement payout logic değişmez.

---

## 5. İş Paketi B — Data Migration ve Backfill

### Problem

Faz 2’de yeni alanlar eklendi:

- `settlement_proposal`
- `payment_risk_level`
- `payment_risk_level_snapshot`
- `resolution_type`
- `partial_settlement_count`

Yeni eventlerden sonra düzgün dolarlar. Ancak mevcut eski kayıtlar için bazı alanlar `null` kalabilir.

PR #74 admin analytics tarafında null resolution kayıtları unknown bucket’a dahil etti. Bu doğru ama migration/backfill yine de ürün ve admin deneyimi için gerekli.

### Ürün Hedefi

Admin dashboard ve trade history yüzeylerinde eski kayıtlar yüzünden eksik/yanıltıcı veri göstermemek.

### Kapsam

#### Backend Script

Yeni script önerisi:

```text
backend/scripts/jobs/backfillPhase2ReadModels.js
```

Backfill stratejisi:

- Terminal `RESOLVED` ve `resolution_type` null ise `UNKNOWN`
- `CANCELED` ve `resolution_type` null ise, eğer event/mirror semantiği güvenliyse `MUTUAL_CANCEL`; emin değilse `UNKNOWN`
- `BURNED` ve `resolution_type` null ise `BURNED`
- `settlement_proposal.state === FINALIZED` ise `PARTIAL_SETTLEMENT`
- Eski order/trade payment risk snapshot için otomatik `MEDIUM` yazılmamalı; bilinmiyorsa `null` kalmalı veya `legacy_unknown` flag kullanılmalı

#### Admin

Backfill status endpoint’i:

```text
GET /api/admin/backfill/phase2/status
```

Read-only summary:

- kaç terminal trade null resolution_type taşıyor
- kaç order null payment_risk_level taşıyor
- kaç trade null payment_risk_level_snapshot taşıyor
- backfill çalıştı mı / son çalışma zamanı

### Öncelik

**P1.5 — Anti-spam’den sonra yapılmalı.**

### Kabul Kriterleri

- Backfill dry-run moduna sahip olmalı.
- Production’da irreversible update öncesi count raporu vermeli.
- Null resolution terminal kayıtlar yönetilebilir hale gelmeli.
- Payment risk için bilinmeyen değerler uydurulmamalı.

---

## 6. İş Paketi C — Release Outcome Event Semantiği

### Problem

`EscrowReleased` event’i manual release ile auto-release ayrımını tek başına taşımıyor. Bu yüzden non-dispute release path’lerinde backend doğru biçimde `UNKNOWN` yazıyor.

Bu Faz 2 için kabul edilebilir ama uzun vadeli analytics için eksik.

### Ürün Hedefi

Manual release ve auto-release outcome’larını backend heuristiğine ihtiyaç bırakmadan on-chain event semantiğiyle ayrıştırmak.

### Kapsam

Kontrat seviyesinde iki seçenek var:

#### Seçenek 1 — Ayrı Event

```solidity
event ManualReleased(uint256 indexed tradeId, address indexed maker, address indexed taker, uint256 takerFee, uint256 makerFee);
event AutoReleased(uint256 indexed tradeId, address indexed maker, address indexed taker, uint256 takerFee, uint256 makerFee);
```

#### Seçenek 2 — ReleaseType Parametresi

```solidity
enum ReleaseType {
    MANUAL,
    AUTO,
    DISPUTED
}

event EscrowReleased(
    uint256 indexed tradeId,
    address indexed maker,
    address indexed taker,
    uint256 takerFee,
    uint256 makerFee,
    ReleaseType releaseType
);
```

### Öneri

Mevcut event consumer’ları bozmamak için **ayrı additive event** daha güvenli:

- Eski `EscrowReleased` kalır.
- Yeni `ManualReleased` / `AutoReleased` sadece analytics mirror için eklenir.
- Backend yeni eventleri dinleyerek `resolution_type` günceller.

### Öncelik

**P2 — Üretim analytics doğruluğu için önemli ama Faz 2.1 ilk işi değil.**

### Kabul Kriterleri

- Manual release ve auto-release net ayrışır.
- Eski event consumer’lar kırılmaz.
- Backend artık non-dispute release için `UNKNOWN` yerine doğru outcome yazabilir.
- Contract tests event emission ayrımını kapsar.

---

## 7. İş Paketi D — Settlement Analytics Dashboard Genişletmesi

### Problem

Admin tarafında temel settlement analytics var ama ürün kararları için yeterince granular değil.

### Ürün Hedefi

Settlement mekanizmasının gerçekten tarafları dispute/burn yerine uzlaşmaya yönlendirip yönlendirmediğini ölçmek.

### Yeni Metrikler

Admin summary veya ayrı endpoint:

```text
GET /api/admin/settlement-analytics
```

Önerilen metrikler:

- totalProposalCount
- activeProposalCount
- finalizedProposalCount
- rejectedProposalCount
- withdrawnProposalCount
- expiredProposalCount
- finalizationRate
- rejectionRate
- expiryRate
- withdrawalRate
- avgMakerShareBps
- medianMakerShareBps
- avgProposalResponseSeconds
- avgFinalizedProposalResponseSeconds
- settlementRateByPaymentRiskLevel
- challengeToSettlementConversionRate
- challengedSettlementFinalizationRate
- repeatedProposalCount
```

### Ürün Yorumlama

Bu metrikler şunu gösterir:

- Kullanıcılar settlement teklifini gerçekten kullanıyor mu?
- Teklifler kabul mü ediliyor, yoksa spam/red aracı mı oluyor?
- Yüksek payment risk rail’lerinde settlement daha mı sık oluyor?
- Challenge sonrası settlement, burn/dispute maliyetini azaltıyor mu?

### Öncelik

**P2**

### Kabul Kriterleri

- Endpoint read-only olmalı.
- Backend settlement outcome authority üretmemeli.
- Metrikler raw Mongo mirror’dan türetilmeli.
- Dashboard metrikleri “informational-only” olarak etiketlenmeli.

---

## 8. İş Paketi E — Ürün Anlatısı ve Kullanıcı Eğitim Katmanı

### Problem

Araf’ın farkı teknik olarak doğru kuruldu ama kullanıcıya iyi anlatılmazsa şu riskler var:

- Payment risk class kullanıcı güven skoru zannedilebilir.
- Settlement proposal hakemlik gibi algılanabilir.
- Partial settlement “Araf karar verdi” gibi anlaşılabilir.
- Restricted payment risk “yasak kullanıcı” gibi yanlış okunabilir.

### Ürün Hedefi

Kullanıcının her kritik aksiyon öncesi protokol felsefesini doğru anlaması.

### UI Copy İlkeleri

#### Settlement

TR:

> Araf kimin haklı olduğuna karar vermez. Bu teklif yalnızca iki tarafın on-chain mutabakatıyla geçerli olur.

EN:

> Araf does not decide who is right. This proposal only becomes valid through on-chain agreement by both parties.

#### Payment Risk

TR:

> Payment risk sınıfı kullanıcı güveni değil, ödeme yönteminin operasyonel karmaşıklığıdır.

EN:

> Payment risk class describes payment-method complexity, not user trust.

#### Resolution Type

TR:

> Sonuç tipi, zincirde gerçekleşen olayların read-model yansımasıdır; admin veya backend kararı değildir.

EN:

> Outcome type is a read-model reflection of on-chain events; it is not decided by admin or backend.

### UX Alanları

- Maker order modal
- Trade room settlement card
- Trade history terminal labels
- Admin dashboard tooltips
- PaymentRiskBadge tooltip
- SettlementPreviewModal

### Öncelik

**P2.5**

### Kabul Kriterleri

- TR/EN copy tutarlı olmalı.
- “trust score” ifadesi payment risk için kullanılmamalı.
- Settlement UI’da “Araf decides” izlenimi yaratılmamalı.
- Admin panelde read-only/non-authoritative badge’ler görünmeli.

---

## 9. Faz 2.1 Önerilen PR Sırası

### PR 75 — Settlement Proposal Cooldown

Kapsam:

- Contract cooldown
- Frontend error copy
- Contract tests
- Regression tests

Risk: Orta  
Öncelik: P1

### PR 76 — Phase 2 Read-Model Backfill

Kapsam:

- Dry-run backfill script
- Admin backfill status endpoint
- Null/missing field audit

Risk: Orta  
Öncelik: P1.5

### PR 77 — Settlement Analytics Dashboard Expansion

Kapsam:

- New admin analytics endpoint
- Rate/ratio metrics
- Payment risk segmented settlement stats

Risk: Düşük-Orta  
Öncelik: P2

### PR 78 — Release Outcome Event Semantics

Kapsam:

- Additive contract events for manual/auto release
- Backend listener mapping
- Contract tests

Risk: Orta-Yüksek  
Öncelik: P2

### PR 79 — Product Copy and Education Layer

Kapsam:

- UI tooltip/copy cleanup
- TR/EN consistency
- Non-authoritative badges

Risk: Düşük  
Öncelik: P2.5

---

## 10. Faz 2.1 Başarı Metrikleri

### Ürün Metrikleri

- Settlement proposal finalization rate
- Settlement rejection rate
- Settlement expiry rate
- Challenge-to-settlement conversion rate
- Burn rate before/after settlement adoption
- Partial settlement count per 100 trades
- Average time to settlement response

### Risk/Abuse Metrikleri

- Repeated proposal attempts per trade
- Cooldown reverts per day
- Settlement proposals per challenged trade
- Rejected proposals per user
- High payment risk rail settlement rate

### Güvenlik Metrikleri

- Backend/admin initiated settlement outcome count: should remain zero
- Unknown resolution rate over time
- Null read-model field count after backfill
- Event listener DLQ count for settlement/payment risk/resolution events

---

## 11. Non-Goals

Faz 2.1’de yapılmaması gerekenler:

- Backend/admin settlement kararı üretmek
- Health score ile payout/release/cancel engellemek
- Payment risk’i kullanıcı reputation score’a dönüştürmek
- Off-chain personel doğrulaması eklemek
- Manual dispute arbitration eklemek
- Contract payout math’i genişletmek
- Settlement’i tek taraflı force-close mekanizmasına dönüştürmek

---

## 12. Nihai Değerlendirme

Faz 2 ana hatlarıyla tamamlandı. Ürün artık teknik olarak şu pozisyona gelmiş durumda:

> Araf, off-chain doğrulama personeli olmadan, tarafların on-chain mutabakatı ve kontrat-authoritative escrow mantığıyla çalışan; payment-method riskini görünür kılan; partial settlement ve outcome analytics ile uyuşmazlık yönetimini ölçülebilir hale getiren bir P2P escrow protokolüdür.

Faz 2.1, bu temeli üretime hazırlayacak kalite katmanıdır. En kritik ilk adım settlement proposal cooldown’dır. Ardından backfill ve analytics genişlemesi gelmelidir.

