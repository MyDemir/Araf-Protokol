# Frontend ↔ Contract Cross-Layer Audit

## 1. Executive Verdict
**READY AFTER FIXES**

Kontrat authority modeli (release/cancel/burn/payout/settlement on-chain) korunuyor; ancak mainnet öncesi cross-layer drift ve orchestration riskleri için zorunlu düzeltmeler gerekiyor.

## 2. Mainnet Blockers

| ID | Severity | Area | Files | Finding | Required Fix |
|---|---|---|---|---|---|
| CLA-B01 | CRITICAL | Revenue accounting invariant | `contracts-arafrevenuevault.md`, `frontend-useRewardsContract.md` | `onArafRevenue` muhasebe doğrulaması fresh transferi kesin bağlamıyor; reserve/reward state’i yanlış sınıflanabilir. | Kontratta exact-in kanıtı zorunlu kıl (balance-delta + transferFrom outcome) ve negatif testleri ekle; UI yalnız read-only kalmalı. |
| CLA-B02 | HIGH | Event decode / ID binding | `contracts-arafescrow-02-order-lifecycle.md`, `frontend-useArafContract.md`, `frontend-app-02-trade-tx-orchestration.md` | `OrderFilled` decode akışında contract-address filtre zayıfsa yanlış logdan `tradeId` bağlanma riski var. | Receipt log decode’da **event + emitting address + topic schema** birlikte doğrulansın; yanlış eşleşme fail-closed olsun. |
| CLA-B03 | HIGH | Dispute semantics vs UX expectations | `contracts-arafescrow-03-trade-lifecycle-release-challenge-burn.md`, `frontend-app-02-trade-tx-orchestration.md`, `frontend-components-pii-settlement-rewards.md` | CHALLENGED sonrası erken `releaseFunds` semantiği UX’te “dispute açıkken finalize olmaz” beklentisiyle çakışabiliyor. | UX copy + testler kontrat semantiğini birebir yansıtmalı; yanlış yönlendirici copy kaldırılmalı ve challenged-path integration testleri zorunlu. |

## 3. High Risk Findings

| ID | Severity | Area | Files | Finding | Risk | Suggested Fix |
|---|---|---|---|---|---|---|
| CLA-H01 | HIGH | ABI drift | `contracts-arafescrow-01-state-config.md`, `frontend-useArafContract.md` | Enum/struct/event alanlarında sürüm kayması frontend parser’ı sessiz bozabilir. | Yanlış state/action render, hatalı tx parametresi. | ABI conformance CI: canonical ABI hash + generated typings + runtime guard. |
| CLA-H02 | HIGH | Getter tuple mapping drift | `contracts-arafescrow-05-eip712-reputation-views.md`, `frontend-useArafContract.md` | Reputation tuple sırası değişirse named/positional çözümleme silent drift üretebilir. | Risk puanı/tier görselleştirmesi yanlış karar destek sinyali verir. | Tuple field-count strict check + versiyonlu mapping + fail-closed null handling. |
| CLA-H03 | HIGH | EIP-712 domain drift | `contracts-arafescrow-05-eip712-reputation-views.md`, `frontend-app-01-session-wallet-bootstrap.md`, `frontend-app-policy-helpers.md` | Chain/domain separator bağlamı frontend-backend-rpc arasında kayarsa cancel imza akışı hatalı/kararsız olur. | Kullanıcı işlemi tamamlayamaz, yanlış ağda imza denemeleri artar. | Domain snapshot testleri + yanlış chain/env’de kesin blok + kullanıcıya deterministic hata metni. |
| CLA-H04 | HIGH | Order ID / Trade ID confusion | `contracts-arafescrow-02-order-lifecycle.md`, `frontend-app-02-trade-tx-orchestration.md`, `frontend-useArafContract.md` | Order/Trade kimliklerinin frontend/backend taşıma katmanında karışma riski sürüyor. | Yanlış trade ekranına bağlanma, yanlış action denemesi. | Tip-seviye ayrım (`orderId`, `tradeId`, `backendTradeId`) + adapter normalizasyon testi. |

## 4. ABI / Event / Tuple Drift

- **ABI drift:** Kontrat fonksiyon overloading ve event payload değişimleri frontend parse katmanını kırabilir.
- **Event decode drift:** `OrderFilled`, `MakerPinged` gibi eventlerde tek kaynaktan doğrulama yerine çoklu guard şart.
- **Tuple drift:** `getReputation` ve benzeri tuple dönüşlerinde indeks temelli okuma için field sayısı/sırası assert edilmezse silent corruption olur.
- **Öneri:** mainnet öncesi zorunlu “ABI + event schema + tuple mapping” golden test paketi.

## 5. Transaction Orchestration Risks

- Frontend tx-orchestration doğru yönde fail-closed guardlar içeriyor; ancak backend refresh gecikmesinde kısa süre stale state render görülebilir.
- Proposal/preview akışında optimistic UX, chain receipt sonrası backend reconciliation tamamlanmadan karar ekranı gösterebilir.
- Cüzdan/chain mismatch durumunda hata metinleri doğru fakat kullanıcı akışı birden çok retry ile karışabiliyor.

## 6. Amount / Decimal / BigInt Risks

- `Number` dönüşümleri ile `BigInt` değerlerin karıştığı sınırlarda overflow/rounding riski var (özellikle preview/format katmanında).
- Token decimal kaynakları ve formatting yardımcıları için tek canonical normalizasyon zorunlu.
- Rewards claimable/read dönüşlerinde `null/0/error` ayrımı UI’da yeterince belirgin değil.

## 7. Settlement / Rewards / PII UI Authority Risks

- **Settlement preview:** “informational-only” copy mevcut; authority kontratta. Bu çizgi korunmalı.
- **Rewards UI:** sponsor veya backend’in recipient/outcome belirleyemediği copy doğru; fakat claimability read-failure ile zero ayrımı güçlendirilmeli.
- **PII display:** role/state authority backend token akışında; ancak reveal sonrası DOM’da kalış süresi minimize edilmeli.
- **Payment risk / reference ticker:** doğru şekilde non-authoritative sinyal olarak sunuluyor; on-chain sonucu değiştirmiyor.

## 8. Test Gaps

Mainnet öncesi eklenmesi gereken testler:
1. `security_event_decode_filters_by_contract_address_and_signature`
2. `security_order_trade_id_binding_rejects_cross_log_mismatch`
3. `security_reputation_tuple_schema_change_fails_closed`
4. `security_eip712_domain_chain_mismatch_blocks_sign_flow`
5. `security_settlement_preview_never_claims_contract_authority`
6. `security_rewards_claimable_null_vs_zero_state_is_explicit`
7. `security_pii_reveal_clears_dom_on_trade_switch_and_unmount`
8. `security_bigint_amount_formatting_never_uses_scientific_notation`
9. `security_external_api_env_in_prod_fails_closed`
10. `security_challenged_release_semantics_match_contract_truth`

## 9. Recommended Fix Order

1. `onArafRevenue` muhasebe invariant fix + test.
2. Event decode address/topic strict filter.
3. Order/Trade ID typed binding ve adapter testleri.
4. EIP-712 domain/chain drift guardları.
5. Tuple mapping strict schema doğrulaması.
6. BigInt/decimal canonical formatter katmanı.
7. Rewards claimable null/zero/error ayrımı UI.
8. PII DOM lifecycle hardening.
9. Settlement preview copy + integration test senkronizasyonu.
10. Mainnet CI gate: ABI/event/tuple regression paketi.

## 10. Suggested Codex Fix Prompts

- **CLA-B01 Prompt:** “`ArafRevenueVault.onArafRevenue` için exact-in accounting invariant ekle; surplus balance’in yanlış revenue sayılmasını engelle. Negatif/pozitif unit testleri ekle.”
- **CLA-B02 Prompt:** “`useArafContract` receipt event decode akışına emitting contract address + event signature strict filtresi ekle, mismatch’te fail-closed dön.”
- **CLA-B03 Prompt:** “CHALLENGED → release semantiğini frontend copy/testlerde kontratla birebir hizala; dispute açıkken kullanıcıyı yanlış yönlendiren metinleri kaldır.”
- **CLA-H01 Prompt:** “Contract ABI conformance için CI testi ekle: canonical ABI hash karşılaştır, drift olursa build fail et.”
- **CLA-H02 Prompt:** “`getReputation` tuple mapping’de field-count ve sıra doğrulaması zorunlu olsun; mismatch’te null + kullanıcıya güvenli hata göster.”
- **CLA-H03 Prompt:** “EIP-712 cancel imza akışına domain/chain guard ekle; yanlış env/chain’de imza başlatma ve net hata mesajı ver.”
- **CLA-H04 Prompt:** “Order ID / Trade ID / BackendTradeID için tip ayrımı ve normalizasyon helper’ı oluştur; cross-binding testleri ekle.”
