# Repository Tree — High-Level Map

> This document is a high-level repository map for orientation. It is not UX guidance; frontend UX guardrails are documented in `ARCHITECTURE.md`.
>
> Generated/large folders such as `node_modules`, `artifacts`, `cache`, coverage output, logs, and local env files are intentionally omitted.

```text
Araf-Protokol/
├── .github/
│   └── workflows/
│       └── ci.yml
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
│   │   │   ├── logRedaction.js
│   │   │   ├── logger.js
│   │   │   ├── schedulerSuccess.js
│   │   │   └── timeEnv.js
│   │   └── app.js
│   ├── test/
│   │   └── *.test.js
│   ├── Dockerfile
│   ├── fly.toml
│   ├── package-lock.json
│   └── package.json
├── contracts/
│   ├── scripts/
│   │   ├── checkAbiDrift.js
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
│   │   └── Mock*.sol
│   ├── test/
│   │   └── *.test.js
│   ├── hardhat.config.js
│   ├── package-lock.json
│   └── package.json
├── docs/
│   ├── EN/
│   │   ├── API.md
│   │   ├── ARCHITECTURE.md
│   │   ├── ARCHITECTURE_INCENTIVES.md
│   │   ├── GAME_THEORY.md
│   │   ├── GOVERNANCE_READINESS.md
│   │   ├── DEPLOYMENT_GUIDE.md
│   │   ├── PII_ENCRYPTION_MIGRATION.md
│   │   ├── REPOSITORY_TREE.md
│   │   ├── REWARDS_ABUSE_OBSERVABILITY.md
│   │   ├── REWARDS_ROLLOUT.md
│   │   └── V3_TERMINOLOGY_AUDIT.md
│   ├── Plan/
│   │   └── *.md
│   └── TR/
│       ├── API.md
│       ├── ARCHITECTURE.md
│       ├── ARCHITECTURE_INCENTIVES.md
│       ├── GAME_THEORY.md
│       ├── GOVERNANCE_READINESS.md
│       ├── DEPLOYMENT_GUIDE.md
│       ├── MAINNET_READINESS_CHECKLIST.md
│       ├── PII_ENCRYPTION_MIGRATION.md
│       ├── REPOSITORY_TREE.md
│       ├── REWARDS_ABUSE_OBSERVABILITY.md
│       ├── REWARDS_ROLLOUT.md
│       └── V3_TERMINOLOGY_AUDIT.md
├── frontend/
│   ├── scripts/
│   │   └── run-vitest.js
│   ├── src/
│   │   ├── app/
│   │   │   ├── actions/
│   │   │   ├── contexts/
│   │   │   ├── providers/
│   │   │   ├── AppModals.jsx
│   │   │   ├── AppViews.jsx
│   │   │   └── useAppSessionData.jsx
│   │   ├── components/
│   │   │   ├── ErrorBoundary.jsx
│   │   │   ├── PaymentRiskBadge.jsx
│   │   │   ├── PIIDisplay.jsx
│   │   │   ├── ReferenceRateTicker.jsx
│   │   │   ├── RewardsDashboard.jsx
│   │   │   └── SettlementProposalCard.jsx
│   │   ├── dev/
│   │   │   └── fixtures/
│   │   ├── hooks/
│   │   │   ├── useArafContract.js
│   │   │   ├── useCountdown.js
│   │   │   ├── usePII.js
│   │   │   └── useRewardsContract.js
│   │   ├── test/
│   │   │   ├── setupTests.js
│   │   │   └── *.test.{js,jsx}
│   │   ├── App.jsx
│   │   ├── index.css
│   │   └── main.jsx
│   ├── index.html
│   ├── package-lock.json
│   ├── package.json
│   ├── postcss.config.js
│   ├── tailwind.config.js
│   ├── vercel.json
│   └── vite.config.js
├── shared/
├── test/
│   └── testarea.md
├── README.md
├── package.json
└── LICENSE
```
