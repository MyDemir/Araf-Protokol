# Phase 08 — Frontend Contract Hooks / Chain-Env Policy / PII-Rewards Access

## Scope
İncelenen dosyalar:
- frontend/src/hooks/useArafContract.js
- frontend/src/hooks/useRewardsContract.js
- frontend/src/hooks/usePII.js
- frontend/src/hooks/useCountdown.js
- frontend/src/app/apiConfig.js
- frontend/src/app/chainPolicy.js
- frontend/src/app/fillAmountPolicy.js
- frontend/src/app/orderUiModel.js
- frontend/src/app/bootstrapState.js

İlişkili testler:
- frontend/src/test/useArafContract.abiSource.test.js
- frontend/src/test/useArafContract.reputationV3.test.js
- frontend/src/test/useRewardsContract.abiSource.test.js
- frontend/src/test/usePII.test.jsx
- frontend/src/test/apiConfig.test.js
- frontend/src/test/apiPathAlignment.test.js
- frontend/src/test/chainPolicy.security.test.js
- frontend/src/test/deployEnvResolution.test.js
- frontend/src/test/fillAmountPolicy.test.js
- frontend/src/test/orderUiModel.test.js
- frontend/src/test/bootstrapState.test.js

## Method
- Hook ve policy dosyaları satır/fonksiyon bazlı okundu.
- ABI source, tuple mapping, chain/env fail-closed ve BigInt parse path’leri testlerle çaprazlandı.
- PII ve API policy davranışları auth/cache/no-store semantiğiyle değerlendirildi.

## File-by-File Notes
| Dosya | Durum | İnceleme derinliği | Not |
|---|---|---|---|
| useArafContract.js | İncelendi | Fonksiyon bazlı | Inline ABI, chain check, normalize helpers, mint gate incelendi. |
| useRewardsContract.js | İncelendi | Fonksiyon bazlı | Rewards ABI source ve lifecycle call surface incelendi. |
| usePII.js | İncelendi | Hook bazlı | Token request/fetch/clear davranışı testlerle birlikte kontrol edildi. |
| useCountdown.js | İncelendi | Hook bazlı | Timer edge ve cleanup davranışı değerlendirildi. |
| apiConfig.js | İncelendi | Fonksiyon bazlı | Prod same-origin fail-closed policy doğrulandı. |
| chainPolicy.js | İncelendi | Fonksiyon bazlı | Supported chain ve mint policy guardları incelendi. |
| fillAmountPolicy.js | İncelendi | Fonksiyon bazlı | Fail-closed amount parse/validation akışı incelendi. |
| orderUiModel.js | İncelendi | Fonksiyon bazlı | Side mapping, trust signal read-only semantiği, payment risk mapping incelendi. |
| bootstrapState.js | İncelendi | Fonksiyon bazlı | Local storage hydration helperları incelendi. |
| İlişkili testler | İncelendi | Test-by-test | ABI drift/policy/fill/order/PII kapsamı genel olarak güçlü. |

## Findings
| ID | Severity | Category | File / Function | Finding | Risk | Evidence | Suggested Action |
|---|---|---|---|---|---|---|---|
| P08-001 | HIGH | ABI-drift | frontend/src/hooks/useArafContract.js | Frontend kontrat entegrasyonu inline `parseAbi` stringlerine bağlı; backend/contract release’de ABI değişimi olduğunda runtime kırılma riski yüksek. | ABI drift sessizce UX kırabilir veya yanlış decode/tuple map doğurabilir. | Hook içi geniş inline ABI tanımı ve event decode buna bağlı. | ABI compatibility gate (contract ABI diff + frontend ABI snapshot test) release pipeline’a zorunlu eklenmeli. |
| P08-002 | MEDIUM | frontend-tx-orchestration | frontend/src/hooks/useArafContract.js / error logging fetch | Contract revert/log yolunda `fetch(logUrl, ...)` çağrısı yapılıyor; ağ gecikmesi/başarısızlıkta sessiz catch var, fakat client-side log queue/backoff görünmüyor. | Yoğun hata döneminde diagnostik kaybı olabilir, incident triage zorlaşır. | `.catch(() => {})` ile swallow edilen log post path’i mevcut. | Non-blocking ama buffered retry/backoff + rate cap telemetry katmanı önerilir. |
| P08-003 | MEDIUM | accounting-math | frontend/src/app/orderUiModel.js + fillAmountPolicy.js | Fill/amount tarafı fail-closed iyi olsa da UI katmanında Number tabanlı gösterim/hesap alanları mevcut; büyük değerlerde precision drift riski read-modelde kalır. | Yanlış görsel/preview değerleri kullanıcı kararını etkileyebilir (on-chain authority değişmez). | Policy BigInt ile parse ediyor; UI modelde Number tabanlı bazı hesaplar var. | Büyük değerlerde BigInt-safe formatter ve gösterim katmanında explicit precision uyarısı önerilir. |
| P08-004 | LOW | testing-gap | frontend/src/test/* | Test kapsamı güçlü; ancak hook-level timer/network race (useCountdown + concurrent PII fetch cancel) için daha fazla edge test yararlı olabilir (uncertain). | Nadir UI race bugları geç yakalanabilir. | Mevcut testler ana davranışları kapsıyor, concurrency edge matrisi sınırlı. | **uncertain**: fake timers + abortable fetch race senaryoları genişletilmeli. |

## No-Finding Notes
- Chain policy production’da fail-closed (yalnız Base mainnet) yaklaşımı testlerle doğrulanıyor.
- Mint/faucet production’da kapalı tutulmuş.
- API base URL policy production’da external absolute URL’i reddediyor (same-origin /api zorunluluğu).
- fill amount parse/validation fail-closed ve min/remaining kurallarıyla uyumlu.
- `normalizeV3Reputation` tuple/named field mapping’te eksik alanda null dönerek stale/malformed veriyi reddediyor.
- order side mapping invalid durumda non-actionable’a düşüyor (fail-closed UI semantics).

## Cross-File Observations
- Frontend policy katmanı (apiConfig + chainPolicy + fillAmountPolicy) güvenlik açısından fail-closed çizgi izliyor.
- ABI drift riski teknik borç olarak sürüyor; testlerde kaynak doğrulaması var ama release gate seviyesi kritik.
- UI tarafı authority üretmiyor; on-chain outcome değiştiren bir yol gözlenmedi.

## Follow-up Needed
- ABI drift için contract release pipeline’a frontend uyumluluk kapısı eklenmeli.
- PII/auth error telemetry için non-blocking güvenilir log aktarım stratejisi belirlenmeli.
- High-value amount gösterimlerinde BigInt-safe UI formatlama standardı genişletilmeli.
