# Araf Protocol - Güncel Dosya Yapısı

```
araf-protocol/
│
├── 📄 .gitignore
├── 📄 README.md
│
├── 📁 contracts/                          # Solidity Smart Contract Katmanı
│   ├── 📄 hardhat.config.js               # Hardhat yapılandırması (Base L2, Solidity 0.8.24)
│   ├── 📄 package.json
│   │
│   ├── 📁 src/
│   │   ├── 📄 ArafEscrow.sol              # Ana kontrat (Bleeding Escrow + Anti-Sybil + EIP-712)
│   │   └── 📄 MockERC20.sol               # Test token'ı (USDT/USDC mock)
│   │
│   ├── 📁 scripts/
│   │   └── 📄 deploy.js                   # Deploy scripti (ABI otomatik frontend'e kopyalar)
│   │
│   └── 📁 test/
│       └── 📄 ArafEscrow.test.js          # Tam test suite (Happy path, Anti-Sybil, Bleeding, Cancel)
│
├── 📁 backend/                            # Node.js + Express Web2.5 API
│   ├── 📄 package.json
│   ├── 📄 .env.example                    # Ortam değişkenleri şablonu
│   │
│   └── 📁 scripts/
│       ├── 📄 app.js                      # Ana uygulama (Bootstrap + Routes + Graceful Shutdown)
│       │
│       ├── 📁 config/
│       │   ├── 📄 db.js                   # MongoDB bağlantı yöneticisi
│       │   └── 📄 redis.js                # Redis bağlantı yöneticisi (Rate limiting + Nonces)
│       │
│       ├── 📁 models/
│       │   ├── 📄 User.js                 # Kullanıcı modeli (Şifreli PII + Reputation cache)
│       │   ├── 📄 Trade.js                # Listing + Trade şemaları (Chargeback ack dahil)
│       │   └── 📄 Feedback.js             # Geri bildirim şeması
│       │
│       ├── 📁 routes/
│       │   ├── 📄 auth.js                            # Pazar yeri CRUD (GET/POST/DELETE)
│       │   ├── 📄 trades.js               # İşlem odası + EIP-712 cancel + Chargeback ack
│       │   ├── 📄 pii.js                  # 🔐 KRİTİK: 2-adımlı IBAN fetch endpoint
│       │   └── 📄 feedback.js             # Kullanıcı geri bildirimi
│       │
│       ├── 📁 middleware/
│       │   ├── 📄 auth.js                 # JWT + PII token doğrulama (requireAuth + requirePIIToken)
│       │   ├── 📄 rateLimiter.js          # Redis sliding window (PII: 3/10min, Auth: 10/min)
│       │   └── 📄 errorHandler.js         # Global hata yakalayıcı
│       │
│       ├── 📁 services/
│       │   ├── 📄 siwe.js                 # SIWE akışı + JWT üretimi + Nonce yönetimi (Redis)
│       │   ├── 📄 encryption.js           # AES-256-GCM envelope encryption (HKDF ile async)
│       │   ├── 📄 eventListener.js        # Zincir dinleyici (On-chain → MongoDB sync + DLQ)
│       │   └── 📄 dlqProcessor.js         # Dead Letter Queue monitor (başarısız event'leri izler)
│       │
│       └── 📁 utils/
│           └── 📄 logger.js               # Winston logger (production/dev log seviyeleri)
│
├── 📁 frontend/                           # React + Vite + Tailwind
│   ├── 📄 index.html
│   ├── 📄 package.json
│   ├── 📄 vite.config.js
│   ├── 📄 tailwind.config.js
│   ├── 📄 postcss.config.js
│   │
│   ├── 📁 public/
│   │   └── 📄 X.md                        # Boş placeholder
│   │
│   └── 📁 src/
│       ├── 📄 main.jsx                    # Wagmi + React Query Provider (ErrorBoundary sarmalı)
│       ├── 📄 App.jsx                     # 🎨 ANA UI (Dashboard + Trade Room + Modaller + SIWE)
│       ├── 📄 index.css                   # Tailwind + Custom animasyonlar
│       │
│       ├── 📁 components/
│       │   ├── 📄 ErrorBoundary.jsx       # Global render hata sınırı (L-05 Fix)
│       │   └── 📄 PIIDisplay.jsx          # 🔐 Güvenli IBAN görüntüleme (H-03 Fix)
│       │
│       └── 📁 hooks/
│           ├── 📄 usePII.js               # 2-adımlı PII fetch hook (auto-cleanup)
│           └── 📄 useArafContract.js      # Kontrat etkileşim hook (H-07 Fix)
│
└── 📁 docs/                               # Mimari Dokümantasyon
    ├── 📄 ARCHITECTURE.md                 # 📚 Protokol parametreleri + Tier + Oyun teorisi
    ├── 📄 DATABASE_AND_SECURITY.md        # 🔐 DB şemaları + Güvenlik audit özeti
    ├── 📄 GAME_THEORY.md                  # (Boş - içerik bekliyor)
    ├── 📄 WORKFLOWS.md                    # (Boş - içerik bekliyor)
    └── 📄 ux.md                           # UX tasarım notları
```
