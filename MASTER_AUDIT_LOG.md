# MASTER AUDIT LOG

- 2026-04-30 — `contracts/src/ArafEscrow.sol` (state/config surface 01) tamamlandı. Öne çıkanlar: (1) owner-merkezli anlık config yetkileri için mainnet governance riski (HIGH), (2) `TokenConfigUpdated` event payload'ının decimals+tier limits taşımaması nedeniyle worker/frontend drift riski (MEDIUM), (3) enum ordinal hardcode nedeniyle geleceğe dönük ABI drift riski (LOW). Ayrıntı rapor: `audit/file-audit/contracts-arafescrow-01-state-config.md`.

- 2026-04-30 — `contracts/src/ArafEscrow.sol` (order lifecycle surface 02) tamamlandı. Öne çıkanlar: (1) frontend `OrderFilled` log ayıklamasında contract-address filtresi yokluğu nedeniyle child trade ID yanlış bağlanma riski (HIGH), (2) backend order stats alanları için mirror drift riski `uncertain` (MEDIUM), (3) OrderCanceled/OrderCancelled terminoloji drift riski (LOW). Ayrıntı rapor: `audit/file-audit/contracts-arafescrow-02-order-lifecycle.md`.

- 2026-04-30 — `contracts/src/ArafEscrow.sol` (trade lifecycle surface 03) tamamlandı. Öne çıkanlar: (1) CHALLENGED durumunda maker tarafından erken `releaseFunds` ile dispute yolunun kısa devre edilebilmesi (HIGH), (2) tek `MakerPinged` event üzerinden iki farklı ping yolunun worker tarafından çıkarımsal ayrıştırılması kaynaklı mirror drift riski `uncertain` (MEDIUM), (3) getCurrentAmounts preview değerlerinin zamanla değişebilirliğinin UX tarafında daha görünür anlatılma ihtiyacı (LOW). Ayrıntı rapor: `audit/file-audit/contracts-arafescrow-03-trade-lifecycle-release-challenge-burn.md`.

- 2026-04-30 — `contracts/src/ArafEscrow.sol` (settlement proposal surface 04) tamamlandı. Öne çıkanlar: (1) settlement proposal kayıtlarının trade başına tek-slot overwrite modeli nedeniyle geçmişin yalnız event/mirror katmanında korunması riski (MEDIUM), (2) `withdrawSettlement` / `expireSettlement` isimlerinin bazı doküman adlandırmalarıyla uyuşmaması kaynaklı entegrasyon riski (LOW). Ayrıntı rapor: `audit/file-audit/contracts-arafescrow-04-settlement.md`.

- 2026-04-30 — `contracts/src/ArafEscrow.sol` (EIP-712/reputation/views surface 05) tamamlandı. Öne çıkanlar: (1) frontend imza domain contexti ile backend RPC chain contexti arasında çevresel uyumsuzluk olduğunda cancel imza akışında fail-closed UX riski (MEDIUM), (2) frontend yorumunda deadline cap kontrolünün kontratta yokmuş gibi anlatılması nedeniyle dokümantasyon drift riski (LOW). Ayrıntı rapor: `audit/file-audit/contracts-arafescrow-05-eip712-reputation-views.md`.

- 2026-04-30 — `contracts/src/ArafRevenueVault.sol` tam inceleme tamamlandı. Öne çıkan bulgular: (1) `onArafRevenue` fonksiyonunda fresh escrow transferini kesin bağlamayan muhasebe kontrolü nedeniyle mevcut surplus bakiyenin yanlışlıkla escrow revenue olarak sınıflandırılabilmesi (CRITICAL), (2) bu senaryo için test kapsamı eksikliği (MEDIUM). Ayrıntı rapor: `audit/file-audit/contracts-arafrevenuevault.md`.

- 2026-04-30 — `contracts/src/ArafRewards.sol` tam inceleme tamamlandı. Öne çıkan bulgular: (1) claim pro-rata floor rounding nedeniyle epoch-token bazında dust birikimi için açık lifecycle/payout politikası eksikliği (MEDIUM), (2) allocation yapılmadan finalize edilebilmesi nedeniyle finalize-empty durumlarının UX/state belirsizliği (LOW). Ayrıntı rapor: `audit/file-audit/contracts-arafrewards.md`.

- 2026-04-30 — contracts mock/script/config dosyaları incelemesi tamamlandı. Öne çıkan bulgular: (1) `MockERC20FalseTransfer` yalnız `transfer` override ettiği için `transferFrom` false-return senaryosunu modellememe kaynaklı test kapsamı boşluğu (MEDIUM), (2) `smokeRewards` public onay modunda dahi mock deploy + write tx çalıştırdığı için operasyonel yanlış kullanım riski (MEDIUM), (3) package script setinde slither/fuzz/invariant komutlarının bulunmaması (LOW). Ayrıntı rapor: `audit/file-audit/contracts-mocks-scripts-config.md`.

- 2026-04-30: `frontend/src/hooks/useArafContract.js` satır-bazlı güvenlik/uyum audit raporu eklendi (`audit/file-audit/frontend-useArafContract.md`).

- 2026-04-30: `frontend/src/hooks/useRewardsContract.js` satır-bazlı güvenlik/uyum audit raporu eklendi (`audit/file-audit/frontend-useRewardsContract.md`).

- 2026-04-30: `frontend/src/hooks/usePII.js` satır-bazlı güvenlik/uyum audit raporu eklendi (`audit/file-audit/frontend-usePII.md`).

- 2026-04-30: `frontend/src/App.jsx` session/wallet/bootstrap slice-01 audit raporu eklendi (`audit/file-audit/frontend-app-01-session-wallet-bootstrap.md`).

- 2026-04-30: `frontend/src/App.jsx` trade-tx orchestration slice-02 audit raporu eklendi (`audit/file-audit/frontend-app-02-trade-tx-orchestration.md`).

- 2026-04-30: `frontend/src/App.jsx` rendering/modals/admin/errors slice-03 audit raporu eklendi (`audit/file-audit/frontend-app-03-rendering-modals-admin-errors.md`).

- 2026-04-30: frontend app policy/helper dosyaları için konsolide audit raporu eklendi (`audit/file-audit/frontend-app-policy-helpers.md`).

- 2026-04-30: frontend root/config/deploy yüzeyi için audit raporu eklendi (`audit/file-audit/frontend-root-config-deploy.md`).

- 2026-04-30: frontend component seti (PII/settlement/rewards/risk/error) için audit raporu eklendi (`audit/file-audit/frontend-components-pii-settlement-rewards.md`).
