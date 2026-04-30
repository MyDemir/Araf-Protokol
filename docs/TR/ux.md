
Araf-Protokol/
├── backend/
│   ├── scripts/
│   │   ├── config/
│   │   │   ├── db.js
│   │   │   ├── paymentRailRiskConfig.js
│   │   │   └── redis.js
│   │   ├── jobs/
│   │   │   ├── cleanupPendingListings.js
│   │   │   ├── cleanupSensitiveData.js
│   │   │   ├── cleanupUserBankRiskMetadata.js
│   │   │   ├── reputationDecay.js
│   │   │   └── statsSnapshot.js
│   │   ├── middleware/
│   │   │   ├── auth.js
│   │   │   ├── errorHandler.js
│   │   │   └── rateLimiter.js
│   │   ├── migrations/
│   │   │   └── normalizeIdentityFields.js
│   │   ├── models/
│   │   │   ├── Feedback.js
│   │   │   ├── HistoricalStat.js
│   │   │   ├── Order.js
│   │   │   ├── RevenueEvent.js
│   │   │   ├── RewardClaim.js
│   │   │   ├── RewardEpoch.js
│   │   │   ├── RewardEpochAllocationEvent.js
│   │   │   ├── RewardFunding.js
│   │   │   ├── Trade.js
│   │   │   └── User.js
│   │   ├── routes/
│   │   │   ├── admin.js
│   │   │   ├── auth.js
│   │   │   ├── feedback.js
│   │   │   ├── listings.js
│   │   │   ├── logs.js
│   │   │   ├── orders.js
│   │   │   ├── pii.js
│   │   │   ├── receipts.js
│   │   │   ├── referenceRates.js
│   │   │   ├── rewards.js
│   │   │   ├── stats.js
│   │   │   ├── tradeRisk.js
│   │   │   └── trades.js
│   │   ├── services/
│   │   │   ├── dlqProcessor.js
│   │   │   ├── encryption.js
│   │   │   ├── eventListener.js
│   │   │   ├── expectedChain.js
│   │   │   ├── health.js
│   │   │   ├── identityNormalizationGuard.js
│   │   │   ├── protocolConfig.js
│   │   │   ├── referenceTicker.js
│   │   │   ├── siwe.js
│   │   │   └── tokenEnv.js
│   │   ├── utils/
│   │   │   ├── logger.js
│   │   │   ├── schedulerSuccess.js
│   │   │   └── timeEnv.js
│   │   └── app.js
│   ├── test/
│   │   ├── admin.routes.resilience.test.js
│   │   ├── app.corsFailClosed.test.js
│   │   ├── auth.cookiePolicy.test.js
│   │   ├── auth.profileRailsValidation.test.js
│   │   ├── auth.refreshNonceHardening.test.js
│   │   ├── auth.sessionWalletMismatch.test.js
│   │   ├── cleanupSensitiveData.test.js
│   │   ├── db.disconnectPolicy.test.js
│   │   ├── eventListener.epochAllocationMirror.test.js
│   │   ├── eventListener.escrowReleasedOrder.test.js
│   │   ├── eventListener.finalityDepth.test.js
│   │   ├── eventListener.identityEnv.test.js
│   │   ├── eventListener.orderFilledMirror.test.js
│   │   ├── eventListener.reputationAuthorityMirror.test.js
│   │   ├── eventListener.rpcEnvRequired.test.js
│   │   ├── eventListener.settlementProposalMirror.test.js
│   │   ├── eventListener.tokenConfigRefresh.test.js
│   │   ├── expectedChain.guard.test.js
│   │   ├── health.readinessCorsConfig.test.js
│   │   ├── identityGuard.defaultMode.test.js
│   │   ├── identityGuard.modeValidation.test.js
│   │   ├── identityLookup.noExpr.test.js
│   │   ├── identityMigration.test.js
│   │   ├── orderListing.sortSemantics.test.js
│   │   ├── orders.config.test.js
│   │   ├── orders.marketTrustVisibility.route.test.js
│   │   ├── ordersTrades.paginationBigId.test.js
│   │   ├── paymentRailRiskConfig.validation.test.js
│   │   ├── pii.takerName.guard.test.js
│   │   ├── protocolConfig.failclosed.test.js
│   │   ├── protocolConfig.tokenConfig.test.js
│   │   ├── rateLimiter.aliasCleanup.test.js
│   │   ├── rateLimiter.tierOverlay.test.js
│   │   ├── rateLimiter.writeFallback.test.js
│   │   ├── redis.connectReadiness.test.js
│   │   ├── referenceRates.route.test.js
│   │   ├── referenceTicker.nonAuthorityCoupling.test.js
│   │   ├── referenceTicker.service.test.js
│   │   ├── reputationDecay.job.test.js
│   │   ├── rewards.authority.readonly.regression.test.js
│   │   ├── rewards.currentEpoch.route.test.js
│   │   ├── rewards.mirrorAuthority.route.test.js
│   │   ├── route.mounts.test.js
│   │   ├── scheduler.successContract.test.js
│   │   ├── scrubbers.test.js
│   │   ├── sessionWalletGuard.routes.test.js
│   │   ├── stats.logs.rateLimiter.route.test.js
│   │   ├── timeEnv.parser.test.js
│   │   ├── tokenEnv.chainAware.test.js
│   │   ├── tradeRisk.readModel.test.js
│   │   ├── trades.cancelSignature.test.js
│   │   ├── trades.offchainHealthScoreInput.route.test.js
│   │   ├── trades.settlementProposal.route.test.js
│   │   └── user.publicProfile.reputationBreakdown.test.js
│   ├── .dockerignore
│   ├── .env.example
│   ├── Dockerfile
│   ├── fly.toml
│   └── package.json
├── contracts/
│   ├── scripts/
│   │   ├── configureRewards.js
│   │   ├── deploy.js
│   │   ├── deployRewards.js
│   │   ├── smokeRewards.js
│   │   ├── switchRewardsTreasury.js
│   │   └── verifyRewardsDeployment.js
│   ├── src/
│   │   ├── ArafEscrow.sol
│   │   ├── ArafRevenueVault.sol
│   │   ├── ArafRewards.sol
│   │   ├── MockERC20.sol
│   │   ├── MockERC20FalseTransfer.sol
│   │   ├── MockEscrowRewardView.sol
│   │   ├── MockFeeOnTransferERC20.sol
│   │   ├── MockRevenueReceiver.sol
│   │   └── MockRevenueReceiverReverter.sol
│   ├── test/
│   │   ├── ArafEscrow.test.js
│   │   ├── ArafRevenueVault.test.js
│   │   ├── ArafRewards.test.js
│   │   ├── deploy.script.test.js
│   │   ├── hardhat.rpcEnvRequired.test.js
│   │   ├── partialSettlement.core.test.js
│   │   ├── paymentRiskLevel.snapshot.test.js
│   │   ├── protocolRevenue.classification.test.js
│   │   ├── reputationV3.authority.test.js
│   │   ├── rewardableTradeView.test.js
│   │   ├── rewards.deploy.scripts.test.js
│   │   ├── rewards.goLive.readiness.test.js
│   │   ├── rewards.rollout.e2e.test.js
│   │   ├── tokenDecimals.tierLimit.test.js
│   │   └── transferExactIn.security.test.js
│   ├── .env.example
│   ├── hardhat.config.js
│   └── package.json
├── docs/
│   ├── EN/
│   │   ├── API.md
│   │   ├── ARCHITECTURE.md
│   │   ├── GAME_THEORY.md
│   │   ├── LOCAL_DEVELOPMENT.md
│   │   └── REWARDS_ROLLOUT.md
│   ├── TR/
│   │   ├── API.md
│   │   ├── ARCHITECTURE.md
│   │   ├── GAME_THEORY.md
│   │   ├── LOCAL_DEVELOPMENT.md
│   │   ├── MAINNET_READINESS_CHECKLIST.md
│   │   └── REWARDS_ROLLOUT.md
├── frontend/
│   ├── src/
│   │   ├── app/
│   │   │   ├── apiConfig.js
│   │   │   ├── AppModals.jsx
│   │   │   ├── AppViews.jsx
│   │   │   ├── bootstrapState.js
│   │   │   ├── chainPolicy.js
│   │   │   ├── fillAmountPolicy.js
│   │   │   ├── orderUiModel.js
│   │   │   └── useAppSessionData.jsx
│   │   ├── components/
│   │   │   ├── ErrorBoundary.jsx
│   │   │   ├── PaymentRiskBadge.jsx
│   │   │   ├── PIIDisplay.jsx
│   │   │   ├── ReferenceRateTicker.jsx
│   │   │   ├── RewardsDashboard.jsx
│   │   │   ├── SettlementPreviewModal.jsx
│   │   │   └── SettlementProposalCard.jsx
│   │   ├── hooks/
│   │   │   ├── useArafContract.js
│   │   │   ├── useCountdown.js
│   │   │   ├── usePII.js
│   │   │   └── useRewardsContract.js
│   │   ├── test/
│   │   │   ├── AdminPanelPolling.test.jsx
│   │   │   ├── apiConfig.test.js
│   │   │   ├── apiPathAlignment.test.js
│   │   │   ├── AppModals.test.jsx
│   │   │   ├── AppRouting.test.js
│   │   │   ├── AppSmoke.test.jsx
│   │   │   ├── AppViews.referenceTicker.test.jsx
│   │   │   ├── AppViews.test.jsx
│   │   │   ├── bootstrapState.test.js
│   │   │   ├── chainPolicy.security.test.js
│   │   │   ├── deployEnvResolution.test.js
│   │   │   ├── fillAmountPolicy.test.js
│   │   │   ├── orderUiModel.test.js
│   │   │   ├── PaymentRiskBadge.test.jsx
│   │   │   ├── PIIDisplay.test.jsx
│   │   │   ├── ReferenceRateTicker.test.jsx
│   │   │   ├── rewards.authority.readonly.regression.test.js
│   │   │   ├── RewardsDashboard.test.jsx
│   │   │   ├── sessionGuardRegression.test.js
│   │   │   ├── sessionMapping.test.js
│   │   │   ├── setupTests.js
│   │   │   ├── SettlementProposalCard.test.js
│   │   │   ├── useAppSessionData.reputationMapping.test.js
│   │   │   ├── useAppSessionDataAuthChecked.test.jsx
│   │   │   ├── useAppSessionDataAuthToastDedup.test.jsx
│   │   │   ├── useArafContract.abiSource.test.js
│   │   │   ├── useArafContract.reputationV3.test.js
│   │   │   ├── usePII.test.jsx
│   │   │   └── useRewardsContract.abiSource.test.js
│   │   ├── AdminPanel.jsx
│   │   ├── App.jsx
│   │   ├── index.css
│   │   └── main.jsx
│   ├── .env.example
│   ├── index.html
│   ├── package.json
│   ├── postcss.config.js
│   ├── tailwind.config.js
│   ├── vercel.json
│   └── vite.config.js
├── .gitignore
├── LICENSE
└── README.md
