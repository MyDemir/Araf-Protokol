Araf Protocol'ün tam dosya yapısı:

```
araf-protocol/
│
├── 📄 .gitignore
├── 📄 README.md
│
├── 📁 contracts/                          # Hardhat Akıllı Kontrat Katmanı
│   ├── 📄 hardhat.config.js
│   ├── 📄 package.json
│   ├── 📁 src/
│   │   ├── 📄 ArafEscrow.sol               # Ana kontrat (Bleeding Escrow, EIP-712, Anti-Sybil)
│   │   └── 📄 MockERC20.sol                # Test USDT/USDC token'ı
│   ├── 📁 scripts/
│   │   └── 📄 deploy.js
│   └── 📁 test/
│       └── 📄 ArafEscrow.test.js
│
├── 📁 backend/                            # Express.js Web2.5 API Katmanı
│   ├── 📄 package.json
│   ├── 📄 .env.example
│   └── 📁 scripts/
│       ├── 📄 app.js                       # Uygulama giriş noktası
│       ├── 📁 config/
│       │   ├── 📄 db.js                    # MongoDB bağlantısı
│       │   └── 📄 redis.js                 # Redis bağlantısı
│       ├── 📁 models/
│       │   ├── 📄 User.js                  # Kullanıcı + şifreli PII şeması
│       │   └── 📄 Trade.js                 # Listing + Trade şemaları
│       ├── 📁 routes/
│       │   ├── 📄 auth.js                  # SIWE nonce + verify + profil
│       │   ├── 📄 listings.js              # Pazar yeri CRUD
│       │   ├── 📄 trades.js                # İşlem odası + EIP-712 cancel
│       │   ├── 📄 pii.js                   # IBAN fetch (en kritik endpoint)
│       │   └── 📄 feedback.js              # Kullanıcı geri bildirimi
│       ├── 📁 middleware/
│       │   ├── 📄 auth.js                  # JWT + PII token doğrulama
│       │   ├── 📄 rateLimiter.js           # Redis sliding window limitleri
│       │   └── 📄 errorHandler.js          # Global hata yakalayıcı
│       ├── 📁 services/
│       │   ├── 📄 siwe.js                  # SIWE akışı + JWT üretimi
│       │   ├── 📄 encryption.js            # AES-256-GCM envelope şifreleme
│       │   └── 📄 eventListener.js         # On-chain event → MongoDB sync
│       └── 📁 utils/
│           └── 📄 logger.js                # Winston logger
│
├── 📁 frontend/                           # React + Vite + Tailwind
│   ├── 📄 index.html
│   ├── 📄 package.json
│   ├── 📄 vite.config.js
│   ├── 📄 tailwind.config.js
│   ├── 📄 postcss.config.js
│   ├── 📁 public/
│   └── 📁 src/
│       ├── 📄 main.jsx
│       ├── 📄 App.jsx                      # Tüm UI (Dashboard, Trade Room, Modaller)
│       ├── 📄 index.css                    # Tailwind + custom animasyonlar
│       ├── 📁 components/
│       │   └── 📄 PIIDisplay.jsx           # Güvenli IBAN görüntüleme bileşeni
│       └── 📁 hooks/
│           └── 📄 usePII.js                # 2-adımlı PII fetch hook
│
└── 📁 docs/                               # Mimari Dokümantasyon
    ├── 📄 ARCHITECTURE.md                  # Protokol parametreleri, tier sistemi, oyun teorisi
    ├── 📄 DATABASE_AND_SECURITY.md         # DB şemaları + güvenlik audit özeti
    ├── 📄 GAME_THEORY.md                   # (Boş — içerik bekliyor)
    ├── 📄 WORKFLOWS.md                     # (Boş — içerik bekliyor)
    └── 📄 ux.md                            # UX tasarım notları
```
