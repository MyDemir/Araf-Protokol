# Repo Cleanup Planı — Test Dosyaları ve Hedef Yerleşim

> Amaç: Dosya taşımadan önce mevcut test yerleşimini, gerekli config/import etkilerini ve önerilen PR sırasını netleştirmek.
>
> Bu PR **dosya taşımaz**, runtime/test davranışı değiştirmez ve package internals üzerinde değişiklik önerisini yalnız plan seviyesinde tutar.

## 1) Mevcut test envanteri

### 1.1 `contracts/test/**` — 16 dosya

Mevcut Hardhat config `paths.tests = "./test"` kullandığı için bu klasör zaten hedef yapıda kabul edilmelidir.

- `contracts/test/ArafEscrow.test.js`
- `contracts/test/ArafRevenueVault.test.js`
- `contracts/test/ArafRewards.dustSweepWindow.test.js`
- `contracts/test/ArafRewards.test.js`
- `contracts/test/deploy.script.test.js`
- `contracts/test/hardhat.rpcEnvRequired.test.js`
- `contracts/test/partialSettlement.core.test.js`
- `contracts/test/paymentRiskLevel.snapshot.test.js`
- `contracts/test/protocolRevenue.classification.test.js`
- `contracts/test/reputationV3.authority.test.js`
- `contracts/test/rewardableTradeView.test.js`
- `contracts/test/rewards.deploy.scripts.test.js`
- `contracts/test/rewards.goLive.readiness.test.js`
- `contracts/test/rewards.rollout.e2e.test.js`
- `contracts/test/tokenDecimals.tierLimit.test.js`
- `contracts/test/transferExactIn.security.test.js`

### 1.2 `backend/test/**` — 60 dosya

Backend paketinde ayrı `jest.config.*` bulunmuyor; `backend/package.json` içindeki `jest --forceExit` varsayılan Jest discovery davranışını kullanıyor. Bu klasör zaten hedef yapıda kabul edilmelidir.

- `backend/test/admin.routes.resilience.test.js`
- `backend/test/app.corsFailClosed.test.js`
- `backend/test/auth.cookiePolicy.test.js`
- `backend/test/auth.profileRailsValidation.test.js`
- `backend/test/auth.refreshNonceHardening.test.js`
- `backend/test/auth.sessionWalletMismatch.test.js`
- `backend/test/authz.matrix.routes.test.js`
- `backend/test/cleanupSensitiveData.test.js`
- `backend/test/db.disconnectPolicy.test.js`
- `backend/test/deploy.hardening.static.test.js`
- `backend/test/deployAlignment.test.js`
- `backend/test/encryption.awsKms.test.js`
- `backend/test/eventListener.epochAllocationMirror.test.js`
- `backend/test/eventListener.escrowReleasedOrder.test.js`
- `backend/test/eventListener.finalityDepth.test.js`
- `backend/test/eventListener.identityEnv.test.js`
- `backend/test/eventListener.orderFilledMirror.test.js`
- `backend/test/eventListener.replayDurability.test.js`
- `backend/test/eventListener.reputationAuthorityMirror.test.js`
- `backend/test/eventListener.rpcEnvRequired.test.js`
- `backend/test/eventListener.settlementProposalMirror.test.js`
- `backend/test/eventListener.tokenConfigRefresh.test.js`
- `backend/test/expectedChain.guard.test.js`
- `backend/test/health.readinessCorsConfig.test.js`
- `backend/test/identityGuard.defaultMode.test.js`
- `backend/test/identityGuard.modeValidation.test.js`
- `backend/test/identityLookup.noExpr.test.js`
- `backend/test/identityMigration.test.js`
- `backend/test/logger.redaction.test.js`
- `backend/test/orderListing.sortSemantics.test.js`
- `backend/test/orders.config.test.js`
- `backend/test/orders.marketTrustVisibility.route.test.js`
- `backend/test/ordersTrades.paginationBigId.test.js`
- `backend/test/paymentRailRiskConfig.validation.test.js`
- `backend/test/pii.takerName.guard.test.js`
- `backend/test/protocolConfig.failclosed.test.js`
- `backend/test/protocolConfig.tokenConfig.test.js`
- `backend/test/rateLimiter.aliasCleanup.test.js`
- `backend/test/rateLimiter.tierOverlay.test.js`
- `backend/test/rateLimiter.writeFallback.test.js`
- `backend/test/redis.connectReadiness.test.js`
- `backend/test/referenceRates.route.test.js`
- `backend/test/referenceTicker.nonAuthorityCoupling.test.js`
- `backend/test/referenceTicker.service.test.js`
- `backend/test/reputationDecay.job.test.js`
- `backend/test/rewards.authority.readonly.regression.test.js`
- `backend/test/rewards.currentEpoch.route.test.js`
- `backend/test/rewards.mirrorAuthority.route.test.js`
- `backend/test/route.mounts.test.js`
- `backend/test/scheduler.successContract.test.js`
- `backend/test/scrubbers.test.js`
- `backend/test/sessionWalletGuard.routes.test.js`
- `backend/test/stats.logs.rateLimiter.route.test.js`
- `backend/test/timeEnv.parser.test.js`
- `backend/test/tokenEnv.chainAware.test.js`
- `backend/test/tradeRisk.readModel.test.js`
- `backend/test/trades.cancelSignature.test.js`
- `backend/test/trades.offchainHealthScoreInput.route.test.js`
- `backend/test/trades.settlementProposal.route.test.js`
- `backend/test/user.publicProfile.reputationBreakdown.test.js`

### 1.3 `frontend/src/test/**` — 55 dosya

Frontend testleri şu anda `frontend/src/test` altında toplanmış durumda. `frontend/vite.config.js` içinde `setupFiles: './src/test/setupTests.js'` kullanıldığı ve birçok test `../app/...`, `../hooks/...` gibi `src/test` konumuna göre relative import yaptığı için en az disruptive hedef `frontend/src/test/**` olarak kalmalıdır.

- `frontend/src/test/AdminPanelPolling.test.jsx`
- `frontend/src/test/AppDevAdminScenario.test.jsx`
- `frontend/src/test/AppDevTradeRoomScenario.test.jsx`
- `frontend/src/test/AppModals.test.jsx`
- `frontend/src/test/AppRouting.test.js`
- `frontend/src/test/AppSmoke.test.jsx`
- `frontend/src/test/AppViews.referenceTicker.test.jsx`
- `frontend/src/test/AppViews.test.jsx`
- `frontend/src/test/ContextRegistry.test.js`
- `frontend/src/test/CopyDictionary.test.js`
- `frontend/src/test/OperationTradeCard.test.jsx`
- `frontend/src/test/OrderSideCopy.test.jsx`
- `frontend/src/test/PIIDisplay.test.jsx`
- `frontend/src/test/PIIDisplayRoleAware.test.jsx`
- `frontend/src/test/PaymentRiskBadge.test.jsx`
- `frontend/src/test/PaymentRiskDisclosure.test.jsx`
- `frontend/src/test/ProfileContext.test.jsx`
- `frontend/src/test/ReferenceRateTicker.test.jsx`
- `frontend/src/test/RewardsDashboard.test.jsx`
- `frontend/src/test/SessionProvider.test.jsx`
- `frontend/src/test/SettlementProposalCard.test.js`
- `frontend/src/test/SystemStatusBar.test.jsx`
- `frontend/src/test/ThemeBootstrap.test.js`
- `frontend/src/test/UiLab.test.jsx`
- `frontend/src/test/apiConfig.test.js`
- `frontend/src/test/apiPathAlignment.test.js`
- `frontend/src/test/bootstrapState.test.js`
- `frontend/src/test/chainPolicy.security.test.js`
- `frontend/src/test/contractLifecycleActions.test.js`
- `frontend/src/test/deploy.hardening.static.test.js`
- `frontend/src/test/deployEnvResolution.test.js`
- `frontend/src/test/fillAmountPolicy.test.js`
- `frontend/src/test/frontendMigrationBaseline.static.test.js`
- `frontend/src/test/frontendTransitionRegression.test.jsx`
- `frontend/src/test/operationsContextModel.test.js`
- `frontend/src/test/orderCreationActions.test.js`
- `frontend/src/test/orderUiModel.test.js`
- `frontend/src/test/rewards.authority.readonly.regression.test.js`
- `frontend/src/test/sessionGuardRegression.test.js`
- `frontend/src/test/sessionMapping.test.js`
- `frontend/src/test/settlementActions.test.js`
- `frontend/src/test/setupTests.js`
- `frontend/src/test/startTradeAction.test.js`
- `frontend/src/test/tradeDecisionModel.test.js`
- `frontend/src/test/tradeNavigationActions.test.js`
- `frontend/src/test/useAppSessionData.reputationMapping.test.js`
- `frontend/src/test/useAppSessionDataAuthChecked.test.jsx`
- `frontend/src/test/useAppSessionDataAuthToastDedup.test.jsx`
- `frontend/src/test/useAppSessionDataPagination.test.jsx`
- `frontend/src/test/useArafContract.abiSource.test.js`
- `frontend/src/test/useArafContract.orderFilledDecode.test.js`
- `frontend/src/test/useArafContract.reputationV3.test.js`
- `frontend/src/test/usePII.test.jsx`
- `frontend/src/test/useRewardsContract.abiSource.test.js`
- `frontend/src/test/useRewardsContract.chainGuard.test.js`

### 1.4 Test dosyaları dışında kalan test-benzeri dosyalar

- `frontend/scripts/run-vitest.js`: Test dosyası değil; frontend test runner wrapper'ı. Taşınmamalı.
- `test/testarea.md`: Repo root altında boş/placeholder test alanı. Çalışan test değil; cleanup PR'ında silinmesi veya `docs/Plan` altına not olarak taşınması değerlendirilebilir.

## 2) Önerilen hedef layout

Önerilen hedef, package-local sınırları ve mevcut runner davranışını korur:

```text
contracts/test/**        # Hardhat tests; mevcut konum korunur
backend/test/**          # Jest tests; mevcut konum korunur
frontend/src/test/**     # Vitest tests; en az disruptive seçenek
```

Alternatif `frontend/test/**` daha temiz görünse de bu repo için daha risklidir; çünkü `vite.config.js` setup path'i, testlerin `../app` / `../hooks` relative import'ları ve bazı `process.cwd()` temelli static guard testleri güncellenmek zorunda kalır. Bu nedenle ilk cleanup dalgasında `frontend/src/test/**` korunmalıdır.

## 3) Gerekli import/path değişiklikleri

| Alan | Mevcut örnek | `frontend/src/test` korunursa | `frontend/test` seçilirse |
|---|---|---|---|
| Frontend component imports | `frontend/src/test/AppViews.test.jsx` içinde `../app/AppViews` | Değişiklik yok | `../src/app/AppViews` olarak güncellenir |
| Frontend hook imports | `frontend/src/test/useArafContract.*.test.js` dosyaları | Değişiklik yok | `../src/hooks/...` path'leri gerekir |
| Frontend setup file | `frontend/src/test/setupTests.js` | Değişiklik yok | `frontend/vite.config.js` içinde `setupFiles: './test/setupTests.js'` gerekir |
| Frontend static `process.cwd()` kontrolleri | `src/hooks/useArafContract.js`, `src/abi/ArafEscrow.json` | Değişiklik yok | Muhtemelen değişiklik yok; fakat taşınan testlerin helper path varsayımları ayrıca kontrol edilmeli |
| Backend tests | `backend/test/route.mounts.test.js` içinde `../scripts/app.js` | Değişiklik yok | Backend hedef değişmediği için gerekmez |
| Contracts tests | Hardhat `paths.tests = './test'` | Değişiklik yok | Contracts hedef değişmediği için gerekmez |
| Root test runner | `package.json` `npm --prefix ...` scriptleri | Değişiklik yok | Değişiklik yok |

## 4) Config değişiklik ihtiyaçları

| Config | Mevcut durum | Hedef `frontend/src/test` ile ihtiyaç | `frontend/test` gibi alternatifte ihtiyaç |
|---|---|---|---|
| `frontend/vite.config.js` | Vitest config burada; `setupFiles: './src/test/setupTests.js'` | Yok | `setupFiles` ve gerekirse include/exclude ayarı değişir |
| Vitest setup | `frontend/src/test/setupTests.js` | Yok | Dosya taşınırsa setup path ve import referansları değişir |
| `contracts/hardhat.config.js` | `paths.tests: './test'` | Yok | Contracts testleri farklı yere taşınırsa `paths.tests` değişir; önerilmez |
| Jest config | Ayrı config yok; `backend/package.json` `jest --forceExit` | Yok | Backend test kökü değişirse Jest discovery veya script değişir; önerilmez |
| `.github/workflows/ci.yml` | Package-local `working-directory` ile `npm test` / `npm run test:abi-drift` | Yok | Paket scriptleri değişirse CI değişebilir; bu cleanup'ta gerekmemeli |
| Root `package.json` | Root test runner package-local komutlara delegate eder | Yok | Package-local scriptler korunursa yok |

## 5) Cleanup sınıflandırması

| Cleanup | Dosyalar/kapsam | Sınıf | Not |
|---|---|---|---|
| Root `test/testarea.md` kaldırma veya dokümante etme | `test/testarea.md` | Safe mechanical move / delete adayı | Boş placeholder; test runner tarafından kullanılmıyor. Silme için ayrı küçük PR önerilir. |
| Frontend testleri `src/test` altında domain alt klasörlerine ayırma | Örn. `App*.test.*`, `use*.test.*`, `rewards*.test.*` | Requires import update | Aynı `src/test` kökü içinde bile relative helper import'ları ve snapshot/static guard varsayımları kontrol edilmeli. |
| Frontend testlerini `frontend/test/**` altına taşıma | Tüm `frontend/src/test/**` | Risky, defer | Çok sayıda `../app`, `../hooks`, setup path ve tooling varsayımı değişir. İlk cleanup PR'ı için önerilmez. |
| Backend testleri alt klasörlere ayırma | Tüm `backend/test/*.test.js` | Requires import update | `../scripts/...` importları alt klasörde `../../scripts/...` olur. Büyük ama mekanik; küçük gruplarla yapılmalı. |
| Contracts testleri alt klasörlere ayırma | Tüm `contracts/test/*.test.js` | Requires import update | Hardhat discovery devam eder; helper path yoksa düşük riskli, fakat fixture paylaşımı ve grep isimleri korunmalı. |
| Contracts testlerini `contracts/tests` veya root `test` altına taşıma | `contracts/test/**` | Risky, defer | `hardhat.config.js paths.tests` ve CI mental modeli değişir; önerilmez. |
| Backend testlerini root `test` altına taşıma | `backend/test/**` | Risky, defer | Package-local Jest boundary bozulur; CI ve relative importlar fazla etkilenir. |
| Frontend `setupTests.js` yerini değiştirme | `frontend/src/test/setupTests.js` | Requires import update | Ancak `frontend/test/**` hedefi seçilirse yapılmalı; şimdilik gerek yok. |

## 6) Önerilen PR sırası

1. **PR-1 — Plan only (bu PR)**
   - Sadece bu dokümanı ekle.
   - Dosya taşıma, config değişikliği ve test davranışı değişikliği yapma.

2. **PR-2 — Root placeholder cleanup**
   - `test/testarea.md` gerçekten kullanılmıyorsa sil.
   - `find ... '*test*'` envanterini güncelle.
   - `npm run test:backend`, `npm run test:frontend`, `npm run test:contracts`, `npm run test:abi-drift` çalıştır.

3. **PR-3 — Contracts test taxonomy (opsiyonel, küçük batch)**
   - `contracts/test/rewards/*.test.js`, `contracts/test/escrow/*.test.js`, `contracts/test/deploy/*.test.js` gibi alt klasör önerisi değerlendir.
   - Hardhat `paths.tests` aynı kalmalı.
   - Grep edilen test isimleri ve ABI drift gate korunmalı.

4. **PR-4 — Backend test taxonomy (küçük batch'ler)**
   - Önce statik/config testlerini taşı: `deploy*.test.js`, `*.config.test.js`, `*.static.test.js`.
   - Sonra route testleri, event listener testleri, rewards testleri ayrı PR'lara bölünsün.
   - Her batch'te relative importlar güncellenip package-local Jest çalıştırılsın.

5. **PR-5 — Frontend test taxonomy yalnız `frontend/src/test` içinde**
   - `frontend/src/test/components`, `frontend/src/test/hooks`, `frontend/src/test/app`, `frontend/src/test/static` gibi alt klasörler denenebilir.
   - `frontend/test/**` hedefi bu aşamada hâlâ önerilmez.
   - `setupTests.js` mümkünse `frontend/src/test/setupTests.js` konumunda kalsın.

6. **PR-6 — Frontend root test klasörü değerlendirmesi (defer)**
   - Ancak önceki PR'lar stabilse `frontend/test/**` için ayrı RFC/PR aç.
   - `vite.config.js`, setup path, relative import codemod ve CI smoke aynı PR'da planlanmalı.

## 7) Kabul kriterleri / guardrail'ler

- Her cleanup PR'ı package-local runner'ları kullanmalı; mevcut CI working-directory modeli korunmalı.
- Dosya taşıma PR'ları davranış değişikliği içermemeli.
- Büyük rename/move PR'larında `git mv` kullanılmalı; içerik değişikliği ayrı commit veya ayrı PR olmalı.
- Frontend test root'u değiştirilirse `vite.config.js` ve `setupTests.js` değişiklikleri aynı PR'da yer almalı.
- Backend ve contracts için package sınırları korunmalı; root-level tek `test/**` klasörüne konsolidasyon önerilmez.
