# Phase 09 — Frontend App Flow / Session State / Trade Room Components

## Scope
İncelenen dosyalar:
- frontend/src/App.jsx
- frontend/src/AdminPanel.jsx
- frontend/src/app/AppModals.jsx
- frontend/src/app/AppViews.jsx
- frontend/src/app/useAppSessionData.jsx
- frontend/src/components/ErrorBoundary.jsx
- frontend/src/components/PaymentRiskBadge.jsx
- frontend/src/components/PIIDisplay.jsx
- frontend/src/components/ReferenceRateTicker.jsx
- frontend/src/components/RewardsDashboard.jsx
- frontend/src/components/SettlementPreviewModal.jsx
- frontend/src/components/SettlementProposalCard.jsx
- frontend/src/main.jsx
- frontend/src/index.css

İlişkili testler:
- frontend/src/test/AppSmoke.test.jsx
- frontend/src/test/AppRouting.test.js
- frontend/src/test/AppViews.test.jsx
- frontend/src/test/AppViews.referenceTicker.test.jsx
- frontend/src/test/AppModals.test.jsx
- frontend/src/test/AdminPanelPolling.test.jsx
- frontend/src/test/PIIDisplay.test.jsx
- frontend/src/test/PaymentRiskBadge.test.jsx
- frontend/src/test/ReferenceRateTicker.test.jsx
- frontend/src/test/RewardsDashboard.test.jsx
- frontend/src/test/SettlementProposalCard.test.js
- frontend/src/test/sessionGuardRegression.test.js
- frontend/src/test/sessionMapping.test.js
- frontend/src/test/useAppSessionData.reputationMapping.test.js
- frontend/src/test/useAppSessionDataAuthChecked.test.jsx
- frontend/src/test/useAppSessionDataAuthToastDedup.test.jsx

## Method
- App-level auth/session, wallet binding, trade-room action path’leri fonksiyon bazlı incelendi.
- Settlement/rewards/PII/admin bileşenlerinde authority boundary (informational-only vs enforceable) doğrulandı.
- İlgili test dosyaları edge-case kapsamı açısından satır bazlı gözden geçirildi.

## File-by-File Notes
| Dosya | Durum | İnceleme derinliği | Not |
|---|---|---|---|
| App.jsx | İncelendi | Fonksiyon bazlı | SIWE/session state, activeTrade kurulum akışı, action guard’lar ve localStorage yan etkileri kontrol edildi. |
| AdminPanel.jsx | İncelendi | Fonksiyon bazlı | Auth guard, polling stop policy ve admin data exposure sınırları incelendi. |
| AppModals.jsx | İncelendi | Bileşen bazlı | Modal action entrypoint’leri ve UX guard davranışları kontrol edildi. |
| AppViews.jsx | İncelendi | Bileşen bazlı | View routing, trade-room render gating ve reference ticker etkisi değerlendirildi. |
| useAppSessionData.jsx | İncelendi | Hook bazlı | Connected/authenticated wallet ayrımı, session invalidation ve authChecked lifecycle incelendi. |
| ErrorBoundary.jsx | İncelendi | Bileşen bazlı | Hata fallback’inde secret/PII leak riski kontrol edildi. |
| PaymentRiskBadge.jsx | İncelendi | Bileşen bazlı | Risk skorunun informational kullanım sınırı ve action authority’ye etkisizliği doğrulandı. |
| PIIDisplay.jsx | İncelendi | Bileşen bazlı | PII görünürlüğü role/state ve explicit reveal akışlarıyla incelendi. |
| ReferenceRateTicker.jsx | İncelendi | Bileşen bazlı | Reference verinin yalnız bilgi amaçlı sunumu ve settlement authority’den ayrımı kontrol edildi. |
| RewardsDashboard.jsx | İncelendi | Bileşen bazlı | Claim/allocation UI semantiği ve on-chain authority ayrımı değerlendirildi. |
| SettlementPreviewModal.jsx | İncelendi | Bileşen bazlı | Preview’nin non-authoritative copy/gating semantiği kontrol edildi. |
| SettlementProposalCard.jsx | İncelendi | Fonksiyon bazlı | CHALLENGED-only settlement gating, proposer/counterparty guardları, preview->tx akışı doğrulandı. |
| main.jsx | İncelendi | Bootstrap bazlı | Provider + ErrorBoundary yerleşimi ve connector crash isolation davranışı incelendi. |
| index.css | İncelendi | Stil bazlı | Güvenlik açısından authority etkisi yok; yalnız görsel davranış tanımları içeriyor. |
| İlişkili testler | İncelendi | Test-by-test | Session/auth dedup/routing/settlement/rewards/PII davranışlarının kapsamı değerlendirildi. |

## Findings
| ID | Severity | Category | File / Function | Finding | Risk | Evidence | Suggested Action |
|---|---|---|---|---|---|---|---|
| P09-001 | MEDIUM | session-consistency | frontend/src/App.jsx + frontend/src/app/useAppSessionData.jsx | Connected wallet ile authenticated wallet ayrımı mevcut olsa da wallet switch anındaki backend sync gecikmesinde kısa süreli stale activeTrade/render penceresi oluşabilir (read-model race). | Kullanıcı kısa bir pencerede eski trade kartını görebilir; ekonomik authority yine kontratta kaldığı için zincir sonucu değişmez, ancak UX/confusion riski vardır. | Session mapping ve authChecked akışı testleniyor; ancak wallet switch + in-flight trade refresh yarışı için kapsama sınırlı. | Wallet switch olduğunda trade-room state resetinin atomikliği için ek guard + explicit loading gate testi eklenmeli (uncertain). |
| P09-002 | LOW | localstorage-lifecycle | frontend/src/App.jsx | Pending tx / bootstrap localStorage anahtarlarında TTL/garbage-collection davranışı sınırlı; uzun süreli stale client metadata birikebilir. | On-chain authority etkilenmez; ancak kullanıcıya stale pending göstergesi yansıyabilir. | Uygulama localStorage üzerinden dil/terms/pending benzeri client-side state taşıyor. | Pending tx kayıtları için version+timestamp temelli cleanup politikasını netleştirin ve testleyin. |
| P09-003 | LOW | testing-gap | frontend/src/test/* | Test seti güçlü; fakat “order fill sonrası child trade id authority + backend sync gecikmesi + yanlış activeTrade ID seçimi” birleşik race senaryosu için explicit entegrasyon testi görünmüyor. | Nadir koşullarda UI reconciliation gecikmesi kullanıcı güvenini azaltabilir. | Ayrı ayrı guard testleri var; birleşik çok-adımlı edge case matrisi sınırlı. | Multi-step scenario testleri (wallet switch + fill + delayed sync + action button guard) eklenmeli. |

## No-Finding Notes
- Settlement preview bileşeni açık biçimde informational-only olduğunu belirtiyor; authority üretmiyor.
- SettlementProposalCard aksiyonları CHALLENGED safhası ve taraf doğrulama guard’larıyla sınırlandırılmış.
- Payment risk ve reference ticker read-only/informational; release/cancel/burn/payout/settlement authority’ye müdahale etmiyor.
- Admin panel, auth başarısızlığında polling’i durdurarak tekrar eden auth-refresh/toast döngülerini sınırlıyor.
- ErrorBoundary provider yerleşimi tüm uygulama altyapısını düşürmeden UI-level crash containment sağlıyor; secret/PII dump eden bir fallback davranışı gözlenmedi.

## Cross-File Observations
- Frontend katmanı genel olarak ekonomik hüküm üretmiyor; karar yetkisi kontrat + backend authoritative kaynaktan ayrılmamış.
- Session ve trade-room correctness tarafında ana risk alanı authority değil, reconciliation timing/race pencereleri.
- PII/rewards/settlement metinlerinde non-authoritative iletişim dili büyük oranda doğru ve kullanıcıyı zincir dışı “kesin hüküm” algısına itmeyen çizgide.

## Follow-up Needed
- Wallet switch ve backend sync gecikmesini birleştiren deterministik integration test matrisi eklenmeli.
- Pending tx localStorage lifecycle (TTL, schema version, cleanup trigger) policy’si açıklaştırılmalı.
- Active trade seçiminde canonical backend ID/onchain ID drift durumlarını assert eden ek testler yazılmalı.

## Ek Faz 1 — Yeni Bulgu Keşfi (2026-04-30)

### Ek Method
- Aynı kapsam dosyaları ikinci geçişte “yeni bulgu keşfi” odaklı tekrar okundu.
- Özellikle session invalidation, child trade authority, activeTrade ID seçimi ve settlement/release aksiyon guard’larında edge-path taraması yapıldı.
- İlişkili testlerde gerçek kullanıcı akışına yakın birleşik (multi-step) senaryolar yeniden değerlendirildi.

### Ek Findings
| ID | Severity | Category | File / Function | Finding | Risk | Evidence | Suggested Action |
|---|---|---|---|---|---|---|---|
| P09-E1-001 | MEDIUM | authority-binding | frontend/src/App.jsx + frontend/src/app/AppViews.jsx | activeTrade seçimi backend/on-chain kimlik eşleşmesi gecikmeli geldiğinde kısa süreli “yanlış trade odası renderı”na açık olabilir; action guard’lar çoğunlukla korusa da kullanıcı yanlış odada bilgi görebilir. | Ekonomik hüküm yine kontratta kalır; ancak yanlış odada PII/reconciliation metni görmek kullanıcı güvenini düşürebilir. | İlk faz bulgularında race konusu vardı; ikinci geçişte özellikle activeTrade ID kurulumu ile view geçişi arasındaki pencere risk olarak ayrıştı. | activeTrade kurulumunda canonical backend trade id + onchain id eşleşmesini zorunlu kılan ek fail-closed gate ve entegrasyon testi eklenmeli (uncertain). |
| P09-E1-002 | LOW | ux-correctness | frontend/src/components/RewardsDashboard.jsx | Claim/allocation metrikleri authoritative olmayan backend snapshot gecikmesiyle kısa süre stale kalabiliyor; copy genel olarak doğru ama “anlık kesin değer” algısı oluşabilir. | On-chain claim authority değişmez; kullanıcı beklentisi/şikayet riski artabilir. | Rewards UI bilgilendirici amaçta; ancak stale snapshot etiketlemesi tüm state’lerde eşit görünür değil. | Snapshot timestamp/staleness indicator görünürlüğü güçlendirilmeli; testte gecikmeli sync senaryosu eklenmeli. |

### Ek No-Finding Notes
- Settlement preview modal hâlâ informational-only çizgide; on-chain outcome belirleme iddiası üretmiyor.
- ReferenceRateTicker yalnız referans veri sunuyor, settlement/release/challenge authority’ye karışmıyor.
- Admin panel auth guard/polling stop davranışı ikinci geçişte de güvenli çizgide doğrulandı.

### Ek Follow-up
- activeTrade yanlış ID render penceresini hedefleyen “wallet switch + fill + delayed backend sync” birleşik test eklenmeli.
- rewards snapshot staleness copy’si için UX acceptance testi (TR/EN) genişletilmeli.
