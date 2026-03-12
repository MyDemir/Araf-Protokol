# 🌀 Araf Protocol: Yerel Geliştirme Ortamı Kurulum Rehberi

> **Versiyon:** 1.0 | **Son Güncelleme:** Mart 2026

Bu doküman, Araf Protokolü'nün tüm bileşenlerini (Hardhat, Backend, Frontend) yerel bir makinede test etmek için nasıl çalıştırılacağını adım adım açıklar.

---

## 1. Mimarinin Anlaşılması

Yerel ortam, üç ayrı terminalde çalışan üç ana servisten oluşur:

1.  **Hardhat Node:** Yerel bir Ethereum blockchain simülasyonu. Akıllı kontratlarımız burada yaşayacak.
2.  **Backend (API):** Node.js/Express sunucusu. Veritabanı işlemleri, kimlik doğrulama ve PII yönetimi burada gerçekleşir.
3.  **Frontend (UI):** React/Vite geliştirme sunucusu. Kullanıcı arayüzü burada çalışır.

---

## 2. Ön Gereksinimler

*   **Node.js:** `v18.x` veya daha üstü.
*   **npm:** Node.js ile birlikte gelir.
*   **MongoDB & Redis:** Bu servislerin yerel olarak çalışıyor olması veya bir bulut sağlayıcıdan (örn: MongoDB Atlas, Upstash) alınmış bağlantı URL'lerinin olması gerekir.

---

## 3. Kurulum Adımları

### Adım 1: Bağımlılıkları Yükleme

Projenin her bir parçası için gerekli olan npm paketlerini yükleyin. Projenin ana dizinindeyken aşağıdaki komutları sırasıyla çalıştırın:

```bash
# Akıllı kontrat bağımlılıkları
cd contracts && npm install && cd ..

# Backend bağımlılıkları
cd backend && npm install && cd ..

# Frontend bağımlılıkları
cd frontend && npm install && cd ..
```

### Adım 2: Yerel Blockchain'i Başlatma

**Terminal 1**'i açın ve Hardhat'in yerel test ağını başlatın. Bu terminal, test süresince açık kalmalıdır.

```bash
cd contracts/
npx hardhat node
```

Bu komut, size test için kullanabileceğiniz 20 adet cüzdan adresi ve özel anahtarlarını (private key) listeleyecektir.

### Adım 3: Akıllı Kontratları Deploy Etme

**Terminal 2**'yi açın. `contracts` klasöründe, `TREASURY_ADDRESS`'i içeren bir `.env` dosyası oluşturun. Bu adres, Hardhat'in size verdiği adreslerden herhangi biri olabilir (genellikle ikinci adres iyi bir seçimdir).

**`contracts/.env` dosyası örneği:**
```env
# Hardhat node'un verdiği adreslerden birini kullanın (örn: Account #1)
TREASURY_ADDRESS=0x70997970C51812dc3A010C7d01b50e0d17dc79C8
```

Şimdi, kontratları yerel ağınıza deploy edin:

```bash
cd contracts/
npx hardhat run scripts/deploy.js --network localhost
```

Bu komutun çıktısı size `ArafEscrow` ve `MockUSDT` kontratlarının adreslerini verecektir. **Bu adresleri bir sonraki adım için not alın.**

### Adım 4: Backend'i Yapılandırma ve Başlatma

**Terminal 2**'yi kullanmaya devam edebilirsiniz. `backend` klasöründe, gerekli tüm ortam değişkenlerini içeren bir `.env` dosyası oluşturun.

**`backend/.env` dosyası örneği:**
```env
# 3. Adımdaki deploy çıktısından gelen adresler
ARAF_ESCROW_ADDRESS=0x...
USDT_ADDRESS=0x...

# Hardhat node'un verdiği adreslerden birini relayer olarak kullanın
RELAYER_PRIVATE_KEY=0x...

# Yerel veritabanı ve Redis bağlantılarınız
MONGO_URI=mongodb://localhost:27017/araf_protocol_dev
REDIS_URL=redis://localhost:6379

# Güvenlik sırları (geliştirme için basit değerler yeterli)
JWT_SECRET=local-jwt-secret
REFRESH_TOKEN_SECRET=local-refresh-secret
KMS_MASTER_KEY=12345678901234567890123456789012 # 32 byte'lık bir string

# Diğer ayarlar
BASE_RPC_URL=http://127.0.0.1:8545/
SIWE_DOMAIN=localhost
ALLOWED_ORIGINS=http://localhost:5173
```

Backend sunucusunu geliştirme modunda başlatın:

```bash
cd backend/
npm run dev
```
Bu terminal de açık kalmalıdır.

### Adım 5: Frontend'i Yapılandırma ve Başlatma

**Terminal 3**'ü açın. `frontend` klasöründe, `.env.development` adında bir dosya oluşturun.

**`frontend/.env.development` dosyası örneği:**
```env
VITE_API_URL=http://localhost:4000
VITE_ESCROW_ADDRESS=0x... # 3. Adımdaki ARAF_ESCROW_ADDRESS ile aynı
```

Frontend geliştirme sunucusunu başlatın:

```bash
cd frontend/
npm run dev
```

Tarayıcınızda `http://localhost:5173` adresini açtığınızda Araf Protokolü arayüzünü görmelisiniz. Artık cüzdanınızı bağlayıp (MetaMask'i Hardhat ağına bağlamayı unutmayın) tüm akışları test edebilirsiniz!