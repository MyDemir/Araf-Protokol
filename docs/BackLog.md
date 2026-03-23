🌀 ARAF PROTOKOLÜ — KAPSAMLI GELECEK PLANI VE TEKNİK BORÇ RAPORU
BÖLÜM 1: TEMEL MİMARİ VE GELECEK PLANI YOL HARİTASI
Sistemin teknik olgunluğunu ve güvenliğini en üst seviyeye taşımak için belirlenen temel protokol güncellemeleri.
1. PII Snapshot ve "Bait-and-Switch" Koruması
Hedef: İşlem kilitlendikten sonra profil bilgilerinin değiştirilerek karşı tarafın yanıltılmasını engellemek ve tam otonomi sağlamak.
 * Zafiyet: Mevcut yapıda IBAN ve isim bilgileri User tablosundan canlı çekilmektedir. Bu durum, işlem LOCKED olduktan sonra taraflardan birinin bilgilerini değiştirerek yanlış ödemeye veya haksız itiraza yol açmasına neden olur.
 * Çözüm (On-Lock Snapshot): İşlem kilitlendiği anda verilerin dondurulması mekanizması uygulanacaktır.
 * Düzeltilecek Alanlar:
   * models/Trade.js: pii_snapshot objesi (maker_bankOwner_enc, maker_iban_enc, taker_bankOwner_enc, captured_at) ve otomatik imha için snapshot_delete_at alanı eklenmelidir.
   * routes/trades.js: On-chain LOCKED durumu tetiklendiğinde, bilgiler User tablosundan Trade belgesine kopyalanmalıdır.
   * routes/pii.js: GET /api/pii/:tradeId ve taker-name endpoint'leri snapshot verisinden okuma yapacak şekilde revize edilmelidir.
2. Kullanıcı Deneyimi ve Onboarding (Tier 0)
Hedef: Yeni kullanıcıların sisteme giriş bariyerlerini düşürmek ve şeffaflığı artırmak.
 * 7 Günlük Kayıt Bariyeri: Tier 0 için zorunlu kılınan WALLET_AGE_MIN (7 gün) kuralı onboarding akışını kesmektedir; yeni kullanıcılar için "anlık" kullanım imkanı kurgulanmalıdır.
 * Dust Limiti Engeli: 0.001 ETH (~2-3$) tutarındaki zorunlu bakiye, küçük tutarlı (örn: 10 USDT) Tier 0 işlemleri için oransal olarak çok yüksek bir giriş maliyeti yaratmaktadır.
 * İşlem Cooldown Belirsizliği: Tier 0/1 için uygulanan 4 saatlik cooldown süresi UI üzerinde dinamik bir sayaçla gösterilmelidir.
3. Güvenlik ve Oyun Teorisi Analizleri
Hedef: Ekonomik caydırıcılığı korumak ve sistem manipülasyonunu engellemek.
 * Tier 0 Maliyetsiz Şantaj Riski: Taker teminatı %0 olduğu için kötü niyetli alıcılar, hiçbir maliyete katlanmadan itiraz açıp Maker'ın parasını (USDT_DECAY) eritebilir.
 * Race Condition (Ping Çakışması): autoRelease ve challengeTrade süreçlerinin aynı anda başlatılmaya çalışılması durumunda oluşan ConflictingPingPath hatası UI tarafından yönetilememektedir.
 * PII Doğrulama Guard: Maker banka bilgilerini girmeden ilan açamamalıdır; aksi halde Taker boş veriyle karşılaşarak süreci kilitleyebilir.
 * Mempool Sniping (Öncülleme): Maker'ın cancelOpenEscrow işleminin mempool'da görülüp bir Taker tarafından öncelenmesi (front-running) riskine karşı teknik önlemler değerlendirilmelidir.
4. Teknik, Yazılımsal ve Senkronizasyon Hataları
Hedef: Veri tutarlılığını sağlamak ve UI/Blockchain senkronizasyonunu güçlendirmek.
 * State ve Polling: chargebackAccepted bilgisi sayfa yenilendiğinde backend'den geri yüklenmelidir. Polling hızı (15 sn) kritik uyuşmazlık anları için optimize edilmelidir.
 * Event Listener Gecikmesi: handleStartTrade içindeki retry loop (12 sn) yetmeyebilir; PIIDisplay 404 hatası vermemesi için onay mekanizması güçlendirilmelidir.
 * Hassasiyet Kaybı (Precision): JavaScript'in Number tipi yerine viem'in parseUnits fonksiyonu ile BigInt bazlı hesaplamaya geçilmelidir.
 * Dinamik Decimals: Kodda sabitlenen decimals = 6 değeri yerine kontrattan decimals() değeri dinamik çekilmelidir.
 * Clock Drift (Saat Kayması): Kullanıcı yerel saati ile blokzincir zamanı arasındaki farktan dolayı oluşan erken tetikleme hataları için sayaçlara "güvenlik marjı" eklenmelidir.
5. Kimlik Doğrulama, Gizlilik ve PII Yönetimi
Hedef: GDPR uyumunu sağlamak ve hassas verileri korumak.
 * Logout Endpoint: JWT ve refresh token'ları backend tarafında geçersiz kılan bir logout API çağrısı eklenmelidir.
 * PII Token Duyarsızlığı: İşlem CANCELED olduktan sonra PII token'ı anında geçersiz kılınmalıdır.
 * XSS Koruması: taker-name ve piiBankOwner verileri render edilirken XSS saldırılarına karşı temizlenmelidir.
 * Hassas Veri Temizliği: Bellek kalıntılarını önlemek için PII verileri unmount anında daha agresif temizlenmelidir. Kanıt (Evidence) saklama süresi (30 gün) ters ibraz süreçleri için tekrar değerlendirilmelidir.
6. Yönetici (Admin) Paneli ve Operasyonel Riskler
Hedef: Admin yetkilerini kısıtlayarak sistemi tam otonom hale getirmek.
 * Admin Rolü: Admin "Karar Verici"den "Gözlemci/Kanıt Sağlayıcı"ya dönüştürülmeli; IBAN düzeltme yetkisi kaldırılmalıdır.
 * DB Senkronizasyonu: handleDeleteOrder on-chain iptali yaparken backend veritabanındaki ilanı da silmelidir.
 * Token Liste Yönetimi: Bir token destekten kaldırıldığında (setSupportedToken), aktif işlemlerin fonlarının kilitlenme riski için revert guard'ları kontrol edilmelidir.
BÖLÜM 2: MANTIK HATALARI, CÜZDAN VE ARAYÜZ (APP.JSX) TESPİTLERİ
1. İptal Sürecinde "Denetim İzi" (Audit Trail) Kaybı
 * Keşif: trades.js dosyasındaki /propose-cancel endpoint'inde, iptal teklifi geldiğinde trade.cancel_proposal.proposed_by = req.wallet komutuyla teklif sahibi kaydediliyor. Ancak ikinci taraf onay verdiğinde, bu alan onay veren kişinin adresiyle güncelleniyor.
 * Mantık Hatası: Bu durum, iptal sürecini gerçekte kimin başlattığı bilgisinin veritabanında üzerine yazılmasına (overwrite) neden oluyor.
 * Risk: Uyuşmazlık analizlerinde veya itibar puanı hesaplamalarında "Sürekli iptal teklif ederek satıcıyı taciz eden kim?" sorusunun cevabı teknik olarak kaybolmuş oluyor.
 * Öneri: proposed_by alanı sadece ilk teklifte set edilmeli, ikinci tarafın onayı ayrı bir approved_by alanında tutulmalıdır.
2. "Artık İzinler" (Unused Allowance Garbage) Sorunu
 * Keşif: App.jsx içerisindeki handleStartTrade (Taker için) ve handleCreateEscrow (Maker için) fonksiyonları önce approveToken çağırır, ardından kontrat işlemini yapar.
 * Teknik Risk: Eğer kullanıcı approve işlemini cüzdanında onaylar ancak hemen ardından lockEscrow veya createEscrow adımında cüzdan penceresini kapatırsa veya işlem başarısız olursa, verilen "harcama izni" (allowance) kontrat üzerinde açık kalır.
 * Güvenlik Etkisi: Kullanıcı işlemi gerçekleştirmese bile kontratın onun cüzdanından token çekme yetkisi devam eder.
 * Öneri: İşlem başarısız olduğunda (catch bloğunda), kullanıcının güvenliği için allowance değerini tekrar 0'a çekecek bir "temizlik" adımı eklenmelidir.
3. PII Girişinde Veri Tipi ve Uzunluk Korumasızlığı
 * Keşif: App.jsx içerisinde piiIban ve piiBankOwner verileri alınırken sadece boşluklar temizleniyor.
 * Veri Bütünlüğü Riski: Kullanıcı IBAN alanına 500 karakterlik rastgele bir metin girebilir. Bu veri backend'de şifrelenip kaydedilirken veritabanı şişmesine veya şifre çözme (decryption) sırasında buffer hatalarına yol açabilir.
 * Risk: Yanlış formatta girilen (örn. eksik haneli IBAN) bir veri kilitlendiğinde, karşı taraf (Taker) parayı gönderemez ve işlem mecburen uyuşmazlığa (CHALLENGED) gider.
 * Öneri: Frontend tarafında IBAN için regex (/^TR\d{24}$/) ve isim soyisim için karakter limiti zorunlu tutulmalıdır.
4. "Hayalet İlanlar" (Orphaned Listings) ve DB Senkronizasyonu
 * Keşif: handleDeleteOrder fonksiyonu on-chain cancelOpenEscrow işlemini başarıyla yaptığında sadece yerel state'i (setOrders) güncelliyor.
 * Mantık Hatası: Backend tarafındaki /api/listings/:id (DELETE) rotasını çağıran bir API isteği bulunmuyor.
 * Risk: Sen ilanını sildiğini sanırken, veritabanında (MongoDB) ilan OPEN kalmaya devam eder. Başka bir kullanıcı bu hayalet ilanı pazar yerinde görür, satın almaya çalışır ancak kontratta ilan artık olmadığı için boşuna gas ücreti öder veya hata alır.
 * Öneri: On-chain iptal başarılı olduktan sonra mutlaka backend veritabanından ilanı silecek API çağrısı yapılmalıdır.
5. Polling ve State Çakışması (Race Condition)
 * Keşif: App.jsx her 15 saniyede bir fetchMyTrades ile tüm işlemleri güncelliyor.
 * Teknik Risk: Kullanıcı tam handleRelease (Serbest Bırak) butonuna bastığı ve işlemin blokzincire gönderildiği saniyede, arka plandaki 15 saniyelik polling tetiklenirse, UI state'i henüz onaylanmamış eski veriyle üzerine yazılabilir.
 * UX Hatası: Kullanıcı "onayladım ama sayfa değişmedi" diyerek butona tekrar basabilir; bu da chargeback-ack endpoint'inin 409 hata vermesine veya gereksiz cüzdan uyarılarına neden olur.
 * Öneri: Herhangi bir kontrat işlemi (write) başladığında, polling mekanizması geçici olarak durdurulmalı (isContractLoading durumuna göre); işlem bittikten sonra manuel bir fetch tetiklenmelidir.
6. "Tek Yönlü Yol": Tier Tavanı (maxAllowedTier) Kilitlenmesi
 * Keşif: Mimarî döküman ve kontrat mantığına göre, bir kullanıcı yasaklandığında maxAllowedTier (Tier Tavanı) kalıcı olarak düşürülür.
 * Mantık Hatası: decayReputation fonksiyonu sadece ardışık yasak sayısını (consecutiveBans) sıfırlıyor, ancak düşürülen maxAllowedTier değerini yukarı çekecek bir mekanizma ne kontratta ne de dökümanda tanımlanmış.
 * Risk: Bir kullanıcı geçmişte hata yapıp Tier 4'ten Tier 1'e düştüyse, sonraki 1000 işlemi başarılı olsa bile teknik olarak tekrar Tier 2, 3 veya 4 olamaz. Sistemde "affedilme" olsa da "rütbe iadesi" fonksiyonel olarak eksik.
 * Öneri: Belirli sayıda başarılı işlemden sonra maxAllowedTier değerini bir kademe artıran otonom bir "Terfi" mantığı eklenmelidir.
7. IPFS Makbuz İçeriği ve "Çöp Veri" İstismarı
 * Keşif: reportPayment fonksiyonu Taker'dan bir ipfsHash (makbuz) bekler ve bunu sorgusuz sualsiz on-chain kaydeder.
 * Teknik Risk: App.jsx tarafında dosya yükleme zorunlu olsa da, bir kullanıcı doğrudan kontratla etkileşime girerek "rastgele bir metin" veya "boş string" göndererek işlemi PAID durumuna geçirebilir.
 * Sonuç: Maker (Satıcı) işlem odasına girdiğinde bozuk bir görsel veya boş bir link görür. Bu durum, "Yönetici Kanıtı" (Admin Evidence) sürecini imkansız kılar ve dürüst satıcıyı gereksiz bir CHALLENGED (itiraz) sürecine hapseder.
 * Öneri: Backend, IPFS hash'inin gerçekten bir görsel dosya olduğunu yükleme anında doğrulamalı ve kontrata gönderilmeden önce "geçerli kanıt" onayı vermelidir.
8. Gaz Ücreti Sıçraması ve UI "Donma" İllüzyonu
 * Keşif: useArafContract.js içerisinde waitForTransactionReceipt kullanıyorsun.
 * Teknik Risk: Base ağında gaz ücretleri aniden yükselirse (network spike), kullanıcının işlemi mempool'da (onay bekleyenler) takılı kalır.
 * UX Hatası: App.jsx bu süreçte muhtemelen bir "Yükleniyor" spinner'ı gösteriyor. Ancak işlem dakikalarca onaylanmazsa, kullanıcı sayfasını yenileyebilir. Yenileme anında txHash yerel state'ten silindiği için kullanıcı işleminin sonucunu (başarılı mı, hata mı?) takip edemez ve sistemin "donduğunu" sanır.
 * Öneri: İşlem gönderildiği an txHash geçici olarak localStorage üzerinde saklanmalı ve sayfa yenilense bile waitForTransactionReceipt süreci oradan devam ettirilmelidir.
9. SIWE Oturum Süresi vs. "Bleeding" Zamanlaması
 * Keşif: JWT (oturum) süresi 15 dakika olarak belirlenmiş.
 * Mantık Hatası: Uyuşmazlık (itiraz) aşaması olan "Bleeding Escrow" günlerce sürebilir.
 * Risk: Kullanıcı, işleminin en kritik "erime" saniyelerini takip ederken oturumu aniden kapanabilir. Eğer o an Base ağı yavaşsa veya kullanıcı SIWE ile tekrar imza atmakta gecikirse (cüzdan hatası vb.), itiraz için gereken kritik aksiyonları (örneğin pingMaker) saniyeler farkıyla kaçırabilir.
 * Öneri: Aktif bir işlemi (LOCKED, PAID, CHALLENGED) olan kullanıcılar için "uzatılmış oturum" (extended session) mantığı kurgulanmalıdır.
10. "Multi-Token" Görüntüleme ve Birim Karmaşası
 * Keşif: useArafContract.js içindeki getTrade fonksiyonu, kontrattan cryptoAmount değerini uint256 (en küçük birim - wei) olarak döner.
 * UI Hatası: Eğer App.jsx içindeki "İşlem Odası", her token'ı 6 decimals (USDT) varsayarak formatlıyorsa, yarın 18 decimals bir token (örn. DAI) eklendiğinde 1000 DAI'lik işlem ekranda 0.000000000001 DAI olarak görünür.
 * Sonuç: Kullanıcı miktarını yanlış görüp paniğe kapılabilir veya yanlış tutara onay verdiğini düşünebilir.
 * Öneri: renderTradeRoom bileşeni, miktarı formatlamadan önce mutlaka o işlemin tokenAddressine gidip decimals değerini kontrattan veya cache'den çekmelidir.
BÖLÜM 3: GİZLİLİK, PII VE SIWE GÜVENLİK VEKTÖRLERİ
1. PII Hasatçılığı (PII Harvesting) ve Veri Kazıma Riski
 * Keşif: Mevcut akışta bir Taker, bir ilanı kilitlediği (lockEscrow) anda satıcının PII (IBAN ve İsim) verilerine erişim yetkisi kazanır.
 * Teknik Risk: Kötü niyetli bir kullanıcı, özellikle yüksek Tier (Tier 3-4) ilanlarını hedef alarak bunları kilitleyebilir, PII verilerini kopyalayabilir ve ardından hiçbir ödeme yapmadan işlemi iptal etmeye (proposeCancel) veya asılı bırakmaya çalışabilir.
 * Sonuç: Bu durum, sistemin profesyonel satıcıların (Maker) gerçek kimlik ve banka bilgilerini toplamak isteyen "veri avcıları" için bir açık kapı haline gelmesine neden olur.
 * Öneri: PII verisinin gösterilmesi için Taker'ın sadece teminat kilitlemesi yetmemeli; Maker'ın da Taker'ın kimliğini/itibarını gördükten sonra "Verileri Göster" şeklinde ikinci bir on-chain onayı vermesi değerlendirilmelidir.
2. SIWE JWT ve Cüzdan Değişimi Uyumsuzluğu (Session Desync)
 * Keşif: Kullanıcılar SIWE ile giriş yaptıktan sonra tarayıcıda bir JWT saklanır.
 * Teknik Risk: Kullanıcı MetaMask üzerinden cüzdanını "Cüzdan B"ye çevirebilir ancak tarayıcıdaki JWT hala "Cüzdan A"ya ait kalabilir. authenticatedFetch fonksiyonu, backend'e "Cüzdan A"nın yetkisiyle istek atarken, useChainId veya useAccount gibi hook'lar UI'da "Cüzdan B"yi gösterecektir.
 * Sonuç: Kullanıcı "Cüzdan B" ile işlem yaptığını sanırken, backend tarafında "Cüzdan A"nın ilanlarını görebilir veya PII verilerine erişmeye çalışabilir. Bu durum "Yetki Aşımı" (Broken Access Control) hatalarına ve UI'da ciddi tutarsızlıklara yol açar.
 * Öneri: App.jsx içinde cüzdan adresi değiştiği anda mevcut JWT'yi temizleyen ve kullanıcıyı tekrar imzaya (SIWE) zorlayan bir "Watch" mekanizması kurulmalıdır.
3. Fiyat Bayatlaması (Price Staleness) ve Arbitraj Riski
 * Keşif: Maker bir ilanı OPEN durumda oluşturduğunda exchange_rate (fiyat) sabitlenir.
 * Mantık Hatası: P2P piyasasında USDT/TRY fiyatı saniyeler içinde değişebilir. Bir ilan 2 gün boyunca OPEN kalırsa, o andaki piyasa fiyatı ile ilandaki fiyat arasında büyük bir fark oluşabilir.
 * Risk: Eğer piyasa fiyatı ilandaki fiyatın çok üstüne çıkarsa, arbitrajcılar eski (ucuz) ilanı anında kilitleyerek Maker'ı zarara uğratır. Maker işlemi yapmazsa itibar puanı kaybeder ve teminatı tehlikeye girer.
 * Öneri: İlanlara bir "Son Kullanma Tarihi" (Expiry) eklenmeli veya App.jsx tarafında ilan kilitlenmeden hemen önce güncel piyasa fiyatı ile karşılaştırma yapıp Maker'a "Fiyatınız piyasanın çok altında, güncellemek ister misiniz?" uyarısı verilmelidir.
4. Banka Günlük Limit "Körlüğü"
 * Keşif: Protokol on-chain limitleri (Tier) bilir ancak kullanıcıların banka tarafındaki günlük EFT/Havale limitlerinden haberdar değildir.
 * Mantık Hatası: Bir Maker'ın on-chain Tier 4 yetkisi olabilir (30.000+ USDT), ancak o gün banka limiti dolmuş olabilir.
 * Risk: Taker ilanı kilitler, parasını on-chain'e yatırır. Maker banka limitinden dolayı parayı alamaz veya gönderemez. İşlem mecburen uyuşmazlığa (CHALLENGED) gider ve her iki tarafın fonları erimeye başlar.
 * Öneri: Makerlar için UI tarafında "Banka Limitim Doldu / Aktif Değilim" şeklinde bir anahtar (toggle) eklenmeli; bu anahtar kapatıldığında ilanlar pazar yerinde geçici olarak PAUSED durumuna alınmalıdır.
5. RPC Sağlayıcı Kesintisi ve "Lokal UI" Çöküşü
 * Keşif: useArafContract.js içerisinde tek bir publicClient kullanılıyor.
 * Teknik Risk: Base ağının ana RPC sağlayıcısı (örn. Ankr veya Infura) bir kesinti yaşarsa, App.jsx üzerindeki tüm readContract (bakiyeler, itibar, işlem durumu) çağrıları hata verir.
 * Sonuç: Kullanıcı parasının kilitli olduğu bir odada "Sözleşme Okunamıyor" hatası alırsa panikleyerek hatalı işlemler yapabilir veya Bleeding Escrow süresini takip edemez.
 * Öneri: Birden fazla RPC sağlayıcısı (Fallback Provider) tanımlanmalı; ana sağlayıcı çöktüğünde sistem otomatik olarak ikincil sağlayıcıya geçerek UI sürekliliğini sağlamalıdır.
BÖLÜM 4: EŞZAMANLILIK (CONCURRENCY) VE ARKA PLAN İŞLEMLERİ
1. İptal İmzalarında "Nonce Desenkronizasyonu" (Concurrency Risk)
 * Keşif: useArafContract.js içindeki signCancelProposal fonksiyonu, EIP-712 imzası için sigNonces değerini o an doğrudan kontrattan okur.
 * Teknik Risk: Eğer bir kullanıcının aynı anda açık olan iki farklı işlemi varsa ve ikisi için de aynı saniyelerde "İptal Teklifi" imzalamaya çalışırsa, her iki imza için de kontrattan aynı nonce değeri dönecektir.
 * Sonuç: Bu imzalardan ilki on-chain'e gönderilip onaylandığında kullanıcının nonce'ı artar. Diğer işlem için backend'de bekleyen ikinci imza, nonce uyumsuzluğu nedeniyle kontrat tarafından reddedilir (revert).
 * Öneri: Backend, her kullanıcı için "bekleyen/kullanılmamış nonce" takibi yapmalı veya UI tarafında aynı anda birden fazla imza süreci kısıtlanmalıdır.
2. Tarayıcı Kısıtlamaları ve Zamanlayıcı Sapması (Background Throttling)
 * Keşif: useCountdown hook'u muhtemelen standart setInterval kullanıyor.
 * Teknik Risk: Modern tarayıcılar (Chrome, Safari), sekme arka plana atıldığında JavaScript zamanlayıcılarını saniyede 1 kez çalışacak şekilde kısıtlar veya tamamen durdurur.
 * Risk: Kullanıcı autoRelease süresinin dolmasını beklerken sekme arka plandaysa, UI'daki geri sayım on-chain zamandan birkaç dakika geri kalabilir. Kullanıcı "Süre bitti" diye sekmeye döndüğünde butonun hala pasif olduğunu görür.
 * Öneri: Sayaçlar her saniye yerel saate güvenmek yerine, her tick anında on-chain block.timestamp referanslı bir "kalan süre" senkronizasyonu yapmalıdır.
3. "Kısmi Onay" (Partial Allowance) Sızıntısı
 * Keşif: handleCreateEscrow ve handleStartTrade fonksiyonları, önce totalLock miktarı için approveToken çağırır, hemen ardından ana kontrat fonksiyonunu tetikler.
 * Teknik Risk: Eğer approveToken başarılı olur ancak kullanıcı ana işlemi gönderirken gaz yetersizliği veya manuel iptal nedeniyle hata alırsa, cüzdanın kontrata verdiği "harcama yetkisi" geçerli kalır.
 * Güvenlik Etkisi: Kullanıcı daha sonra ilanı küçültmeye karar verirse veya vazgeçerse, kontrat üzerinde "fazladan" verilmiş bir yetki kalmış olur.
 * Öneri: Catch bloğunda başarısız olan işlemin ardından allowance değerini 0'a resetleyen bir güvenlik "clean-up" mekanizması eklenmelidir.
4. authenticatedFetch ve "Sessiz Hata" Döngüsü
 * Keşif: authenticatedFetch sadece 401 hatalarını yakalayıp refresh yapmaya çalışıyor.
 * Teknik Risk: Eğer backend veritabanı o an meşgulse ve 500/503 hatası dönerse, App.jsx içerisindeki fetchMyTrades polling mekanizması bu hatayı sessizce yutar.
 * UX Riski: Kullanıcı uyuşmazlık anında polling durursa karşı tarafın hamlelerini (örn: pingTakerForChallenge) göremez ve zamanlayıcı takibini kaybeder.
 * Öneri: API hataları için "Üstel Geri Çekilme" (Exponential Backoff) algoritmasıyla otomatik yeniden deneme mantığı kurulmalıdır.
5. SIWE Nonce "Eviction" (Bellek Boşaltma) Saldırısı
 * Keşif: loginWithSIWE fonksiyonu, backend'den bir nonce alarak süreci başlatır. Bu nonce'lar Redis üzerinde saklanır.
 * Teknik Risk: Sisteme giriş yapmamış bir saldırgan, sadece bir kullanıcının cüzdan adresini bilerek /api/auth/nonce?wallet=address endpoint'ine binlerce istek atabilir.
 * Sonuç: Redis üzerinde aynı adres için sürekli yeni nonce üretilmesi, bellek limitlerine ulaşıldığında gerçek kullanıcıların geçerli nonce'larının silinmesine (eviction) neden olabilir. Bu bir Hizmet Dışı Bırakma (DoS) vektörüdür.
6. "Zombie" Polling ve Logout Yarış Durumu (Race Condition)
 * Keşif: App.jsx içerisinde disconnect() çağrıldığında setIsAuthenticated(false) yapılıyor. Ancak bu işlem, o sırada arka planda devam eden fetchMyTrades döngüsünü atomik olarak durdurmuyor.
 * Teknik Risk: Kullanıcı çıkış yaptıktan milisaniyeler sonra arka plandaki eski bir fetch işlemi tamamlanabilir.
 * Sonuç: Kullanıcı çıkış yapmış görünmesine rağmen, UI üzerinde eski işleminin verileri (zombi veri) kısa süreliğine tekrar belirebilir. Paylaşılan bilgisayarlarda gizlilik ihlaline yol açar.
7. UI "Role Spoofing" (Rol Aldatmacası) Riski
 * Keşif: App.jsx içerisindeki activeEscrows.map fonksiyonunda kullanıcının rolü, backend'den gelen maker_address bilgisine göre o an belirlenir.
 * Teknik Risk: React Developer Tools gibi tarayıcı eklentileriyle bir kullanıcı, yerel userRole state'ini kolayca değiştirebilir.
 * Sonuç: Taker olan bir kullanıcı, kendisini yerelde "Maker" olarak işaretleyip "Serbest Bırak" butonunu görebilir. Kontrat bu işlemi reddedecek olsa da, bu açık; kullanıcılara dürüst olmayan kişilerin ekran görüntüsüyle (deceptive screenshots) karşı tarafı manipüle etmesi için kullanılabilir.
8. Mainnet Ortamında "Faucet UI" Sızıntısı
 * Keşif: renderMarket fonksiyonu içerisinde handleMint (Test USDT al) butonları her zaman render ediliyor.
 * Teknik Risk: Proje Base Mainnet'e geçtiğinde, bu butonlar process.env.NODE_ENV korumasına sahip değilse, gerçek kullanıcıların karşısına çıkmaya devam edecektir.
 * Sonuç: Kullanıcılar gerçek para ile işlem yaparken yanlışlıkla "Test USDT Al" butonuna basabilir; bu da kafa karışıklığına ve "scam" (dolandırıcılık) şüphesi uyandıran bir kullanıcı deneyimine yol açar.
9. "Hayalet İlan" Sızıntısı (DB-First Pre-creation Riski)
 * Keşif: App.jsx içerisindeki handleCreateEscrow fonksiyonu, on-chain işlemi başlatmadan hemen önce authenticatedFetch ile /api/listings endpoint'ine POST isteği atıyor.
 * Teknik Risk: Kullanıcı bu API çağrısı başarılı olduktan sonra cüzdan onayını (MetaMask penceresini) reddederse veya gas yetersizliği nedeniyle işlem başarısız olursa, ilan backend veritabanında OPEN olarak kalabilir.
 * Sonuç: Pazar yerinde "tıklanınca hata veren" veya "fonu olmayan" hayalet ilanlar birikir.
 * Öneri: İlan veritabanına "Taslak" (PENDING) olarak kaydedilmeli; yalnızca on-chain EscrowCreated olayı (event) backend tarafından yakalandığında OPEN statüsüne çekilmelidir.
BÖLÜM 5: PII, COMPONENT RENDER VE LOGLAMA ZAFİYETLERİ
1. usePII ve Refresh Token Desenkronizasyonu (Kritik)
 * Keşif: App.jsx içerisinde 401 hatalarını yakalayıp sessizce oturum yenileyen gelişmiş bir authenticatedFetch fonksiyonun var. Ancak usePII.js dosyası doğrudan standart fetch kullanıyor.
 * Teknik Risk: Kullanıcı işlem odasındayken oturumu (JWT) biterse ve "IBAN Göster" butonuna basarsa, sistem otomatik yenileme yapamayacağı için doğrudan "PII erişimi reddedildi" hatası verecektir.
 * Öneri: usePII.js içindeki çağrılar da App.jsx'teki merkezi authenticatedFetch mantığına bağlanmalıdır.
2. ErrorBoundary Üzerinden PII Sızıntısı Riski (Hassas Veri)
 * Keşif: ErrorBoundary.jsx, bir render hatası oluştuğunda hata mesajını ve bileşen ağacını (componentStack) backend log sistemine gönderiyor.
 * Teknik Risk: Eğer bir hata tam IBAN veya isim render edilirken (örneğin PIIDisplay içinde) oluşursa, componentStack veya error.message içeriğinde şifresi çözülmüş PII verileri yer alabilir.
 * Sonuç: "Veriler asla on-chain veya ham halde saklanmaz" felsefesine rağmen, bu hassas veriler merkezi backend log dosyalarına "düz metin" olarak sızmış olur.
3. usePII İstek Yarışı (Request Race Condition)
 * Keşif: usePII.js içindeki fetchPII fonksiyonu asenkron çalışıyor ancak önceki istekleri iptal eden bir mekanizmaya (AbortController) sahip değil.
 * Teknik Risk: Kullanıcı butona hızlıca üst üste basarsa veya internet yavaşken buton aktif kalırsa, backend'e birden fazla request-token isteği gider.
 * Sonuç: Daha yavaş dönen eski bir istek, yeni isteğin verisinin üzerine yazabilir veya backend'deki hız limitlerini gereksiz yere doldurabilir.
4. useCountdown Başlangıç Durumu (Initial State Flicker)
 * Keşif: useCountdown.js hook'u başlatıldığında isFinished state'i varsayılan olarak true gelmektedir.
 * UX Riski: Bir sayaç ilk yüklendiğinde, hedef tarih geçerli olsa bile ilk saniye dolana kadar UI üzerinde "Süre Bitti" veya "00:00" bilgisi görünüp sonra gerçek süreye dönecektir. Butonlar bir anlık aktif görünüp sonra kilitlenir.
5. PIIDisplay Pano (Clipboard) Güvenlik Eksikliği
 * Keşif: handleCopyIban fonksiyonu navigator.clipboard.writeText kullanıyor ancak işlemin başarısız olma ihtimalini (izin reddi, tarayıcı kısıtlaması) handle etmiyor.
 * Teknik Risk: Kullanıcı IBAN'ı kopyaladığını sanıp banka uygulamasına geçebilir ancak pano boş kalmış veya eski bir veri içeriyor olabilir.
 * Öneri: Kopyalama işlemi bir try-catch içine alınmalı ve window.isSecureContext kontrolü ile hata durumunda kullanıcıya görsel bir uyarı verilmelidir.
6. MockERC20.sol: "Admin Mint" Fonksiyonunda Yetki Kontrolü Eksikliği
 * Keşif: MockERC20.sol içerisinde yer alan mint(address to, uint256 amount) fonksiyonu, herhangi bir onlyOwner veya erişim kısıtlaması içermemektedir.
 * Teknik Risk: Bu dosya yanlışlıkla testnet veya mainnet ortamına bu haliyle deploy edilirse, herhangi bir kullanıcı sınırsız miktarda token basarak protokolün tüm ekonomik dengesini saniyeler içinde yok edebilir.
7. main.jsx: ErrorBoundary'nin Provider Katmanlarını Felç Etme Riski
 * Keşif: ErrorBoundary, main.jsx içerisinde WagmiProvider dahil tüm uygulamayı sarmalıyor.
 * Teknik Risk: Eğer bir cüzdan kütüphanesi veya global bir provider render sırasında hata fırlatırsa, ErrorBoundary tüm uygulamayı kapatarak ekranı karartır.
 * Sonuç (Total Blackout): Kullanıcı, sadece bir eklenti hatası yüzünden parasının kilitli olduğu "Trade Room" dahil hiçbir yere erişemez hale gelir. ErrorBoundary, provider'ların içine taşınmalıdır.
8. ErrorBoundary.jsx: Üretim Ortamında Yerel Port (Fallback) Sızıntısı
 * Keşif: ErrorBoundary, VITE_API_URL tanımlı değilse hataları http://localhost:4000/api/logs/client-error adresine göndermeye çalışıyor.
 * Teknik Risk: Üretim ortamındaki bir kullanıcıda bu değişken okunamazsa, sistem hassas hata stack'lerini kullanıcının kendi yerel bilgisayarındaki 4000 portuna sızdırmaya çalışacaktır.
9. MockERC20.sol: Mapping Bloat (Bellek Şişmesi)
 * Keşif: Faucet koruması için kullanılan lastMintTime mapping'i, her yeni cüzdan adresi için blokzincirde kalıcı depolama (storage) alanı ayırır.
 * Teknik Risk: Testnet süreçlerinde binlerce bot faucet'i tetiklediğinde, kontratın depolama maliyeti ve blok boyutu gereksiz yere artar. Temizleme (epoch) mantığı gereklidir.
BÖLÜM 6: SUNUCU (BACKEND), ALTYAPI VE LOGLAMA ZAFİYETLERİ
1. Log Dizini ve Dizin Gezginliği (Directory Traversal) Riski
 * Keşif: logger.js içerisinde log dosyasının konumu projenin kök dizini (../../araf_full_stack.log.txt) olarak belirlenmiş.
 * Teknik Risk: Eğer web sunucusu (Nginx/Apache) statik dosyaları kök dizinden sunacak şekilde yanlış yapılandırılırsa, bu log dosyası doğrudan internete açık hale gelebilir.
 * Sonuç: Loglar içerisinde yer alan stack trace (hata yığınları), cüzdan adresleri ve işlem ID'leri saldırganlar için bir "bilgi madeni" haline gelir.
2. Cancun EVM Versiyonu ve L2 Uyumluluk Çıkmazı
 * Keşif: hardhat.config.js dosyasında evmVersion: "cancun" olarak ayarlanmış.
 * Teknik Risk: Base gibi Layer 2 ağları, Ethereum Mainnet'teki Cancun güncellemelerini (özellikle TLOAD / TSTORE gibi opcodeları) her zaman aynı anda desteklemeyebilir.
 * Sonuç: Kontrat Base ağına deploy edildiğinde unrecognized opcode hatasıyla kontratın çalışmaması veya revert etmesi riski doğar.
3. Hata Loglama Endpoint'i ve "Disk Spam" Saldırısı
 * Keşif: useArafContract.js içerisindeki writeContract wrapper'ı, her işlem hatasında backend'deki /api/logs/client-error endpoint'ine veri gönderiyor.
 * Teknik Risk: Bu endpoint kimlik doğrulamasız (auth-free) çalışıyor. Kötü niyetli bir kullanıcı veya bot, devasa boyutlu JSON paketlerini saniyede binlerce kez göndererek sunucu diskini saniyeler içinde doldurabilir (Disk Space Exhaustion).
4. EIP-712 Deadline ve "Sonsuz Onay" Boşluğu
 * Keşif: signCancelProposal fonksiyonunda frontend seviyesinde maksimum 7 günlük bir deadline kısıtı var.
 * Mantık Hatası: Eğer ArafEscrow.sol kontratı gelen bu deadline değerini kendi içindeki bir üst sınırla karşılaştırmıyorsa, bu kısıt sadece UI seviyesinde kalır.
 * Risk: Bir saldırgan 10 yıl sonrasına deadline verilmiş bir iptal imzası oluşturabilir.
5. Worker Yarış Durumu (Distributed Worker Race Condition)
 * Keşif: eventListener.js on-chain event'leri işlerken blok numarasını Redis üzerindeki CHECKPOINT_KEY ile takip ediyor.
 * Teknik Risk: Eğer backend ölçeklenirse (birden fazla instance), aynı anda çalışan iki worker aynı blokları tarayabilir.
 * Sonuç: MongoDB tarafında mükerrer "Failure Score" yazılmasına veya veri çakışmalarına neden olabilir. Redis tabanlı bir Distributed Lock (Redlock) mekanizması şarttır.
6. Zincir Yeniden Düzenleme (Chain Re-org) Hassasiyeti
 * Keşif: eventListener.js event'i yakaladığı an MongoDB'de ilgili işlemin durumunu güncelliyor.
 * Teknik Risk: Base gibi Katman 2 ağlarında blokların "revert" edilmesi (zincirin re-org olması) durumu yaşanabilir.
 * Sonuç: Eğer bir işlem on-chain'de geçersiz kalırsa, MongoDB "Ödendi" durumunda kalmaya devam eder. Event'ler işlenmeden önce belirli bir "Blok Onay Sayısı" beklenmelidir.
7. İtibar Senkronizasyonunda "Kör Nokta" (Tier Tavanı Riski)
 * Keşif: _onReputationUpdated fonksiyonu; successful, failed, bannedUntil ve effectiveTier alanlarını güncelliyor ancak consecutiveBans ve maxAllowedTier (tier tavanı) alanlarını güncellemiyor.
 * Sonuç: Kullanıcı on-chain'de ceza alıp Tier 1'e düşse bile, MongoDB hala Tier 4 olduğunu iddia edecektir. Maker ilan açmaya çalıştığında kontrat işlemi reddedecek, kullanıcı nedenini anlayamayacaktır.
8. Event Replay ve "$inc" Çakışması (Mükerrer Puanlama)
 * Keşif: _replayMissedEvents fonksiyonu, kaçırılan blokları toplu halde işliyor.
 * Teknik Risk: Sistem $inc operatörü barındıran bir fonksiyonu işlerken çökerse ve Redis checkpoint güncellenmemişse, yeniden başladığında aynı event'i tekrar işleyecektir.
 * Sonuç: Kullanıcının failure_score (başarısızlık puanı) haksız yere iki veya üç kez artırılmış olur. Benzersiz bir transactionHash kontrolü (idempotency check) zorunlu tutulmalıdır.
9. Protocol Config ve "Zombi" Önbellek (Migration Riski)
 * Keşif: protocolConfig.js on-chain parametreleri Redis üzerinde 7 gün boyunca saklıyor.
 * Mantık Hatası: Eğer bir kontrat güncellemesiyle "Burn süresi" değişirse, backend 7 gün boyunca eski parametreleri kullanmaya devam edecektir. Kullanıcılar hatalı işlemlerle karşılaşır.
10. DLQ (Dead Letter Queue) Boğulma Riski
 * Keşif: dlqProcessor.js her 60 saniyede bir çalışıyor ve her seferinde kuyruktan sadece son 10 entry'yi siliyor.
 * Teknik Risk: RPC sağlayıcısı 1 saatlik kesinti yaşarsa ve binlerce event DLQ'ya düşerse, bu hızla kuyruğu temizlemek günler sürebilir. Redis belleği şişer.
11. Backend Veri Tipinde Hassasiyet Kaybı (BigInt -> Number)
 * Keşif: eventListener.js on-chain'den gelen amount değerini Number(amount) olarak MongoDB'ye kaydediyor.
 * Teknik Risk: JavaScript'te Number tipi (64-bit float) en fazla 2^53-1 değerine kadar güvenli tam sayı garantisi verir.
 * Sonuç: 18 ondalıklı (decimals) bir token eklendiğinde, yüksek miktarlı işlemler bu sınırı kolayca aşacaktır. Finansal miktarlar Decimal128 olarak saklanmalıdır.
12. Ping Sınıflandırma ve Yarış Durumu
 * Keşif: _onMakerPinged fonksiyonu, pinger adresini trade.taker_address ile karşılaştırarak işlemin ne olduğunu belirliyor.
 * Mantık Hatası: Eğer EscrowLocked ve MakerPinged olayları çok kısa aralıklarla gerçekleşirse, veritabanında taker adresi henüz null olacağı için ping işlemi yanlış sınıflandırılabilir veya sessizce başarısız olabilir.
13. Atomik Olmayan Veritabanı Güncellemeleri
 * Keşif: _onEscrowReleased fonksiyonu önce Trade belgesini güncelliyor, ardından ayrı bir çağrı ile User belgesindeki itibar puanlarını artırıyor.
 * Teknik Risk: Sunucu tam bu iki işlem arasında kapanırsa, işlem RESOLVED olarak işaretlenir ancak kullanıcının başarılı işlem sayısı artmaz. "MongoDB Transactions" (Oturumlar) kullanılmalıdır.
14. Sabit Protokol Ücreti Yanılsaması (Fee Drift)
 * Keşif: App.jsx içerisinde net alacak tutarı rawCryptoAmt * 0.001 formülüyle manuel olarak hesaplanıyor.
 * Risk: Eğer ileride kontrat ücreti %0.2'den %0.3'e çıkarılırsa, kullanıcı UI'da farklı, on-chain'de farklı bir kesinti görecektir. TAKER_FEE_BPS değerleri UI'a dinamik çekilmelidir.
BÖLÜM 7: [KRİTİK VE YÜKSEK SEVİYELİ] DEVASA BULGULAR
1. [KRİTİK] Auth: Refresh Token Hijacking ile Cüzdan İmperonasyonu
 * Keşif: auth.js içindeki /refresh endpoint'i, yenileme işlemi için cüzdan adresini req.body.wallet üzerinden alıyor. Ardından bu adresi ve cookie'deki refreshToken'ı rotateRefreshToken fonksiyonuna iletiyor.
 * Ölümcül Hata: siwe.js içindeki rotateRefreshToken fonksiyonu, Redis'ten token'a ait familyId'yi çekerken, bu token'ın gerçekten istekte belirtilen cüzdana ait olup olmadığını DOĞRULAMIYOR.
 * Saldırı Senaryosu: Kötü niyetli bir kullanıcı, kendi yasal refreshToken'ı ile /refresh endpoint'ine {"wallet": "KURBANIN_ADRESI"} gövdesiyle istek atar. Redis aile anahtarını bulamaz ve hataya düşmeden doğrudan kurban adına yepyeni bir Access Token (JWT) üretir.
 * Sonuç: %100 oranında çalışan, cüzdan imzası gerektirmeyen tam bir "Hesap Ele Geçirme" (Account Takeover) zafiyetidir.
2. [KRİTİK] Oyun Teorisi İhlali: Kurbanın Cezalandırılması (Algorithmic Betrayal)
 * Keşif: eventListener.js (_onEscrowReleased fonksiyonu) içinde şu mantık bulunuyor: if (wasDisputed && trade.maker_address) { // Maker'ın failure_score'unu artır }.
 * Mantık Hatası: İşlemin RELEASED olması, Maker'ın (Satıcı) itibari parayı başarıyla gönderdiğini ve Taker'ın (Alıcı) yalan söyleyerek haksız yere itiraz açtığını kanıtlar. Ancak kod, Taker'ı cezalandırmak yerine dürüst Maker'ın itibar puanını düşürüyor ve failure_score yazıyor!
 * Sonuç: Sistem kendi dürüst satıcılarını algoritmik olarak cezalandırmaktadır. Cezanın taker_address hedefine yazılması şarttır.
3. [KRİTİK] UX / Performans: Render Thrashing (React Ölüm Döngüsü)
 * Keşif: App.jsx içerisinde geri sayım hook'ları şu şekilde çağrılıyor: const gracePeriodEndDate = activeTrade?.paidAt ? new Date(...) : null;
 * Yaşam Döngüsü Hatası: new Date(...) her render'da yeni bir referans (object reference) yaratır. useCountdown içindeki useEffect bu referansın değiştiğini görerek her saniye çalışan setInterval'ı temizler ve yeniden başlatır.
 * Sonuç: Ekranda çalışan 6 farklı zamanlayıcı, uygulamayı sonsuz bir "yık-yeniden-kur" döngüsüne sokar. Tarayıcı kilitlenir ve "Trade Room" tamamen donar (UI Freeze). gracePeriodEndDate kesinlikle useMemo ile sarmalanmalıdır.
4. [GÜVENLİK] Triangulation (Üçgen) Dolandırıcılığı "Bypass" Açığı
 * Keşif: Sistemin Maker'ı dolandırıcılıktan koruyan en büyük kalkanı, Taker'ın "Banka Sahibi Adı"nı Maker'a göstermektir. Ancak App.jsx içindeki handleStartTrade fonksiyonunda, Taker'ın kendi PII bilgilerini (bankOwner) doldurup doldurmadığı kontrol EDİLMİYOR.
 * Zafiyet: Kötü niyetli bir Taker, yeni bir cüzdanla sisteme girip adını hiç belirtmeden bir ilanı kilitleyebilir. Maker, işlem odasına girdiğinde karşı tarafın ismini null olarak görür ve gelen paranın doğru kişiden gelip gelmediğini teyit edemez.
5. [YÜKSEK] Altyapı: Multi-Katmanlı RAM Şişmesi (DoS Bombası)
 * Keşif: Dekont yükleme servisi receipts.js multer.memoryStorage() kullanıyor (Limit: 5MB).
 * Teknik Risk: Dosya önce RAM'de Buffer olarak tutulur. Ardından Base64 string'e çevrilir (RAM kullanımı ~6.6MB'a çıkar). Sonrasında AES-256 şifrelemesinden geçer. Sadece 5MB'lık tek bir dekont yüklemesi, Node.js Heap belleğinde anlık olarak ~30MB RAM tüketir.
 * Sonuç: Aynı anda 20-30 kullanıcı dekont yüklediğinde, sunucu "Out of Memory" (OOM) hatası vererek anında çöker ve tüm aktif işlemleri felç eder. Dosyalar geçici diske (diskStorage) yazılmalı ve "Stream" ile işlenmelidir.
6. [ÖLÜMCÜL MANTIK] dlqProcessor.js: DLQ "Sonsuz Döngü" ve Arşiv Hatası
 * Keşif: Hatalı on-chain olayları rPush (sağa/sona ekle) kullanılarak Redis'e eklenir. Yani listenin başı (0) en eski, sonu (-1) en yeni olaylardır. Ancak dlqProcessor.js kuyruk dolduğunda (MAX > 100) arşive taşıma işlemini şu kodla yapıyor: const oldEntries = await redis.lRange(DLQ_KEY, -overflow, -1);
 * Zafiyet: Bu kod, kuyruğa yeni giren en taze elemanları alır, arşive atar ve ardından listeyi baştan keserek (lTrim 0, 99) eski ve hatalı ilk 100 elemanı aktif DLQ'da sonsuza kadar tutar.
 * Sonuç: DLQ'da takılı kalan eski 100 hata sürekli olarak döngüye girip işlemciyi meşgul eder. Yeni hatalar ise yutulur. Çözüm: lRange(DLQ_KEY, 0, overflow - 1) kullanılmalıdır.
7. [KRİTİK FİNANS/MATH] Fiat Miktarının Kripto Gibi Kilitlenmesi
 * Keşif: Taker bir ilanı satın aldığında, kilitlenecek kripto miktarı şu kodla hesaplanıyor: const cryptoAmtRaw = BigInt(Math.round((parseFloat(order.max) || 0) * 1e6));
 * Zafiyet: order.max değeri kullanıcının ilanındaki İtibari Para (Fiat) üst limitidir (Örn: 50.000 TRY). Ancak kod, bu rakamı kur değerine (order.rate) bölmeden doğrudan kripto (USDT) tutarıymış gibi işleyip kontrata kilit emri gönderiyor.
 * Sonuç: Taker, 50.000 TRY'lik (yaklaşık 1.428 USDT) işlem yapmak istediğinde, arayüz ondan 50.000 USDT kilitlemesini isteyecektir. Kontrat bu işlemi reddedecek, bakiyesi olanların ise tüm fonlarını yanlışlıkla kilitlemesine yol açacaktır.
8. [KRİTİK ALTYAPI] rateLimiter.js: Global Proxy Bloklanması (Tam Kesinti)
 * Keşif: Uygulamanın tüm API korumaları IP bazlı sınırlandırma yaparken şu mantığı kullanıyor: keyGenerator: (req) => req.ip
 * Zafiyet: Eğer sunucu Cloudflare veya Nginx (Ters Proxy) arkasındaysa ve app.set('trust proxy', true) ayarı yapılmamışsa, req.ip tüm kullanıcılar için Load Balancer'ın tekil IP adresi olarak döner.
 * Sonuç: Sistem canlıya alındığında, dünya genelindeki toplam giriş sayısı dakikada 10'u geçtiği an tüm kullanıcılar engellenir (Rate Limit) ve platform %100 erişilemez (DoS) hale gelir.
9. [YÜKSEK HAFIZA KAÇAĞI] eventListener.js: WebSocket "Zombi" Yeniden Bağlantısı
 * Keşif: RPC bağlantısı koptuğunda this.provider.on("error") tetiklenir ve _reconnect() çağrılır. Bu fonksiyon yeni bir WebSocketProvider oluşturur.
 * Zafiyet: Eski (hata vermiş ama hala yaşamaya çalışan) provider nesnesi hiçbir zaman açıkça yok edilmez (oldProvider.destroy() çağrılmaz).
 * Sonuç: Her ağ dalgalanmasında RAM'de yeni bir zombi WebSocket bağlantısı birikir. Bu bağlantılar Node.js sunucusunu çökertecek (OOM) ve veritabanına mükerrer olaylar yazacaktır.
10. [YÜKSEK VERİ BOZULMASI] eventListener.js: Replay Sırasında İdempotency Eksikliği
 * Keşif: Sunucu çöktüğünde _replayMissedEvents ile kaçırılan bloklar tekrar işlendiğinde, olayların çoğu aynı olayın iki kez yazılmasını engellemek için kontroller içerir.
 * Zafiyet: Ancak _onBleedingDecayed fonksiyonu içerisinde hiçbir kontrol olmadan doğrudan veritabanına artış komutu yollanıyor: $inc: { "financials.total_decayed": Number(decayedAmount) }
 * Sonuç: Blok tarayıcı aynı bloğu iki kez işlerse, kilitli fonların erime (decayed) miktarları veritabanında sahte bir şekilde katlanarak artar.
BÖLÜM 8: UYARLAMA, SIZINTI VE DOs ZAFİYETLERİ
1. [KRİTİK UYARLAMA] Web3 Mobil Cüzdan "SameSite=Strict" Tuzağı
 * Keşif: JWT cookie'si üretilirken sameSite: "strict" olarak ayarlanmış.
 * Zafiyet: Web3 (dApp) dünyasında, mobil cihazlarda kullanıcılar MetaMask'tan işlem onaylayıp tarayıcıya geri yönlendirildiklerinde (cross-site navigation), modern tarayıcılar "Strict" kuralları gereği hedef siteye JWT cookie'sini göndermez.
 * Sonuç: Kullanıcı dApp'e geri döndüğünde, sistem cookie'yi göremediği için aniden "Oturum Kapandı" (Logged Out) hatası verir. sameSite: "lax" olmalıdır.
2. [KRİTİK API KİLİTLENMESİ] errorHandler.js: "Sonsuz İstek" (Request Hanging)
 * Keşif: Global hata yakalayıcı; ValidationError ve JWT hatalarını if bloklarıyla yakalayıp cevap dönüyor.
 * Zafiyet: Eğer beklenmeyen bir 500 hatası olursa ve bu hata mevcut if bloklarına uymazsa, fonksiyonun sonunda herhangi bir fallback yanıtı (res.status(500).send(...)) veya next(err) çağrısı YOKTUR.
 * Sonuç: İstek (request) zaman aşımına uğrayana kadar asılı kalır. Kullanıcılar sonsuz bir "Yükleniyor..." spinner'ı ile baş başa bırakılır.
3. [YÜKSEK BİLGİ SIZINTISI] Plaintext PII Log Sızıntısı
 * Keşif: Loglanan obje içine şu satır eklenmiş: body: process.env.NODE_ENV !== "production" ? req.body : {}
 * Zafiyet: Geliştirme veya testnet ortamı bile olsa, /api/auth/profile endpoint'ine gönderilen req.body içerisinde şifrelenmemiş (plaintext) IBAN, İsim ve Telegram bilgileri bulunur. Bu veriler doğrudan log dosyasına yazılır.
4. [KRİTİK DOs] auth.js: Unutulan Rate Limit ve Kriptografik Spam
 * Keşif: auth.js dosyasının başında authLimiter import edilmiş, ancak router.put("/profile", requireAuth, ...) satırında kullanılması unutulmuş.
 * Zafiyet: Bu endpoint, gelen verileri ağır bir HKDF ve AES-256-GCM şifreleme süreci içeren encryptPII fonksiyonuna gönderir. Kötü niyetli bir kullanıcı saniyede yüzlerce kez bu endpoint'i çağırarak sunucunun tüm CPU'sunu boğabilir (Asymmetric DoS).
5. [YÜKSEK TOCTOU YARIŞI] receipts.js: Dekont Üzerine Yazma (Evidence Tampering)
 * Keşif: Dosya yüklenirken Trade.findOne ile işlemin LOCKED durumunda olup olmadığı kontrol ediliyor. Ancak alt satırlardaki veri yazma işlemi findOneAndUpdate({ onchain_escrow_id: onchainId }, { $set: ... }) şeklinde yapılıyor.
 * Zafiyet: findOne ile findOneAndUpdate arasında geçen milisaniyeler (Time-of-Check to Time-of-Use) içinde işlem statüsü değişebilir. Güncelleme sorgusuna mutlaka status: "LOCKED" şartı eklenmelidir.
6. [YÜKSEK CEZA KAÇAĞI] Replay (Yeniden Oynatma) Körlüğü
 * Keşif: Haksız itiraz cezasını yazabilmek için kod, mevcut durumu okuyarak bir flag oluşturuyor: const wasDisputed = existingTrade?.status === "CHALLENGED".
 * Zafiyet: Sunucu Trade statüsünü RESOLVED olarak günceller ancak User puanını artıramadan çökerse, yeniden başladığında existingTrade veritabanından RESOLVED döneceği için wasDisputed flag'i false kalır. Kötü niyetli kullanıcı alması gereken cezadan kurtulur.
7. [YÜKSEK GİZLİLİK İHLALİ] pii.js: 15 Dakikalık Zaman Penceresi
 * Keşif: PII verisini çözen endpoint, yalnızca requirePIIToken kontrolüne güveniyor ve işlemin iptal edilip edilmediğine (Trade Status) bakmıyor.
 * Zafiyet: Taker, Token'ı alır almaz işlemi iptal edebilir. İşlem CANCELED olsa bile, Taker 14 dakika boyunca Maker'ın şifresi çözülmüş IBAN bilgilerine erişmeye devam edebilir. Anlık statü kontrolü (LOCKED veya PAID) tekrar yapılmalıdır.
BÖLÜM 9: VERİTABANI (MONGODB), ÖN BELLEK VE SON KAPSAMLI BULGULAR
1. [KRİTİK MANTIK] User.js: İllüzyondan İbaret "Ban Kaldırma" İşlemi
 * Keşif: checkBanExpiry fonksiyonu, kullanıcının ceza süresinin dolup dolmadığını kontrol ediyor ve dolmuşsa this.is_banned = false; atamalarını yapıyor.
 * Zafiyet: Bu fonksiyon, nesnenin bellekteki durumunu değiştirir ancak hiçbir zaman await this.save() çağrısı yapmaz.
 * Sonuç: Veri MongoDB'ye kaydedilmediği için kullanıcı sonsuza kadar "yasaklı" kalır. Sistemin otonom ceza affı mekanizması teknik olarak çalışmamaktadır.
2. [KRİTİK VERİ BOZULMASI] eventListener.js: Hardcoded "USDT/TRY" Fallback Tuzağı
 * Keşif: On-chain işlem yakalandığında off-chain ilanı (listing) bulunamazsa bir fallback objesi oluşturuluyor: { crypto_amount: Number(amount), exchange_rate: 0, crypto_asset: "USDT", fiat_currency: "TRY" }.
 * Sonuç: Ağdaki bir yavaşlık nedeniyle USDC ve EUR tabanlı bir işlemin ilanı anında bulunamazsa, sistem bu işlemi kalıcı olarak USDT ve TRY olarak yazar. Finansal veri bütünlüğü tamamen yok olur.
3. [YÜKSEK OYUN TEORİSİ] trades.js: İptal Sürecinin Sabote Edilmesi (Proposal Overwrite)
 * Keşif: /propose-cancel endpoint'i, her iki tarafın EIP-712 iptal imzalarını kaydederken doğrudan trade.cancel_proposal.deadline = new Date(value.deadline * 1000); ataması yapıyor.
 * Zafiyet: Maker iyi niyetli teklifini kaydettikten sonra, kötü niyetli bir Taker sürekli farklı bir deadline ile istek atarak Maker'ın yasal imzasını on-chain'de geçersiz kılar.
4. [HUKUKİ / GİZLİLİK RİSKİ] receipts.js & Trade.js: Unutulma Hakkı İllüzyonu (Ghost Data)
 * Keşif: Yorum satırlarında şifreli dekontların receipt_delete_at zamanı geldiğinde bir temizleme görevi tarafından null'a çekileceği belirtiliyor.
 * Zafiyet: MongoDB'nin yerleşik TTL mekanizması yalnızca tüm dokümanı siler, belirli bir alanı null yapamaz. Projede belirtilen "cleanupReceipts" adında çalışan bir arka plan servisi yoktur. Yasal süresi dolan veriler sistemde sonsuza kadar asılı kalır.
5. [KRİTİK OYUN TEORİSİ] pii.js & auth.js: Dinamik PII Manipülasyonu (TOCTOU Saldırısı)
 * Keşif: /taker-name/:onchainId rotası Taker'ın güncel bankOwner verisini okur. Taker'ın profilini güncelleyebildiği /profile rotasında, aktif bir işlemi olup olmadığı kontrol edilmez.
 * Saldırı Senaryosu: Taker işlemi kilitler. Çalınmış banka hesabından transfer başlatır. Maker parayı görmeden hemen önce, Taker kendi bankOwner adını çalınmış hesabın adıyla günceller. Maker ismin eşleştiğini sanıp parayı serbest bırakır. "Snapshot" (anlık görüntü) olarak dondurulması zorunludur.
6. [KRİTİK OTONOMİ] reputationDecay.js: Null Timestamp Körlüğü
 * Keşif: İtibar temizleme görevi, banned_until: { $lt: 180DaysAgo } sorgusuyla 180 gün olmuş kullanıcıları arar.
 * Zafiyet: Cezası biten kullanıcılarda bu değer null yapılır. MongoDB'nin $lt operatörü null değerlerle eşleşmez. "180 gün sonra temiz sayfa" taahhüdü teknik olarak tamamen çökmüştür.
7. [YÜKSEK DENETİM RİSKİ] logs.js: Kimlik Doğrulamasız Log Silme (Cover-up) Saldırısı
 * Keşif: POST /client-error rotası hiçbir kimlik doğrulaması veya özel Rate Limit barındırmaz.
 * Siber Güvenlik Riski: logger.js dosyaların şişmesini önlemek için maxsize: 25MB ve maxFiles: 5 limitleriyle ayarlanmıştır. Saldırgan saniyede binlerce anlamsız istek atarak 125MB'lık limiti doldurur ve sistemin gerçek saldırıya dair tuttuğu tüm yasal denetim (audit) loglarını sildirir.
8. [YÜKSEK VERİTABANI ÇÖKÜŞÜ] eventListener.js: Sınırsız Dizi Büyümesi
 * Keşif: Her ceza puanında User belgesindeki reputation_history dizisine $push operatörüyle yeni bir obje ekler.
 * Teknik Risk: Mongoose şemasında boyut sınırı (örn: $slice: -50) konulmamıştır. Aktif hesapların dizisi zamanla binlerce elemana ulaşıp 16MB'lık MongoDB limitini aşar ve kullanıcı veritabanı kilitlenir.
9. [KRİTİK DARBOĞAZ] db.js: Veritabanı Havuzu Kıtlığı (Connection Pool Starvation)
 * Keşif: db.js dosyasında maxPoolSize: 10 olarak ayarlanmış. Sunucu yeniden başladığında, eventListener geçmiş blokları taramak için ağır sorgular çalıştırır.
 * Sonuç: serverSelectionTimeoutMS: 5000 olduğu için, 10 bağlantıyı sömüren worker yüzünden normal API istekleri anında 500 Hata Kodu fırlatarak çöker. Havuz limiti (örn: 50-100) çıkarılmalıdır.
10. [YÜKSEK UYUMSUZLUK] db.js: Soket ve Proxy Zaman Aşımı Uyuşmazlığı (Gateway Timeout)
 * Keşif: db.js içinde socketTimeoutMS: 45000 (45 saniye) olarak ayarlanmış.
 * Zafiyet: Ters Proxy sistemleri genellikle 30 saniye içinde yanıt gelmezse 504 Gateway Timeout döner. Sorgu bitene kadar boşa CPU/RAM tüketilir.
11. [KRİTİK MANTIK] eventListener.js: Zombi İlanların Dirilişi (Resurrection Bug)
 * Keşif: On-chain işlemi off-chain ilanla eşleştirirken şu sorgu atılır: Listing.findOne({ maker_address: maker, onchain_escrow_id: null }).sort({ _id: -1 }).
 * Zafiyet: Sorguda status: "OPEN" filtresi unutulmuştur. Taker, Maker ilanı silmeden hemen önce işlemi başlatırsa, DELETED statüsünde olsa bile ilan bulunur ve $set: { status: "OPEN" } komutuyla silinmiş ilan adeta bir zombi gibi diriltilir.
12. [KRİTİK VERİ KAYBI] eventListener.js: "Kör Nokta" Checkpoint Zehirlenmesi
 * Keşif: _replayMissedEvents fonksiyonu, blokları tararken hata oluşursa catch (err) bloğu sadece uyarı basıp devam ediyor. Döngünün sonunda _updateCheckpointIfHigher(to) her halükarda çağrılıyor.
 * Sonuç: O bloklardaki olaylar çekilemese bile sistem Checkpoint'i ileri sarar. İşlemler DLQ'ya bile düşmeden sonsuza dek kaybolur.
13. [ORTA UX/VERİ] listings.js & trades.js: Kararsız Sayfalama (Unstable Pagination)
 * Keşif: Pazar yeri ilanları çekilirken .sort({ exchange_rate: 1 }).skip(skip).limit(value.limit) kullanılıyor.
