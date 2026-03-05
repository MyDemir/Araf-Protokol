import React, { useState, useEffect } from 'react';
// --- WEB3 ENTEGRASYON KÜTÜPHANELERİ ---
// YENİ: useSignMessage eklendi (SIWE imzası için)
import { useAccount, useConnect, useDisconnect, useSignMessage } from 'wagmi';
import { injected } from 'wagmi/connectors';

// --- BİLEŞEN VE HOOK İTHALATI ---
import PIIDisplay from './components/PIIDisplay'; // H-03 Entegrasyonu

// YENİ: Backend API Adresimiz (Codespace testleri için dinamik)
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

function App() {
  // ==========================================
  // --- 1. EKRAN VE STATE YÖNETİMİ ---
  // ==========================================
  const [currentView, setCurrentView] = useState('dashboard');
  const [showMakerModal, setShowMakerModal] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [showFeedbackModal, setShowFeedbackModal] = useState(false);
  const [showWalletModal, setShowWalletModal] = useState(false); // Multi-wallet Seçim Modalı
  
  // --- MİMARİ TEST STATE'LERİ ---
  const [tradeState, setTradeState] = useState('LOCKED');
  const [userRole, setUserRole] = useState('taker');
  const [isBanned, setIsBanned] = useState(false);
  const [cancelStatus, setCancelStatus] = useState(null);
  const [cooldownPassed, setCooldownPassed] = useState(false);
  const [chargebackAccepted, setChargebackAccepted] = useState(false); 

  // --- WEB3 DURUM YÖNETİMİ ---
  const { address, isConnected } = useAccount();
  const { connect, connectors } = useConnect();
  const { disconnect } = useDisconnect();
  const { signMessageAsync } = useSignMessage(); // YENİ: İmza kancası
  
  const [jwtToken, setJwtToken] = useState(null); // SIWE sonrası dolacak token
  const [isLoggingIn, setIsLoggingIn] = useState(false); // YENİ: Yükleniyor state'i

  // --- KULLANICI VE VERİ STATE'LERİ ---
  const [lang, setLang] = useState('TR'); 
  const [filterTier1, setFilterTier1] = useState(false);
  const [searchAmount, setSearchAmount] = useState('');
  const [profileTab, setProfileTab] = useState('ayarlar');
  
  // NOT: bankOwner ve bankIBAN statik değişkenleri PII entegrasyonu ile artık dinamikleşti.
  const [telegramHandle, setTelegramHandle] = useState('ahmet_tr'); 
  const [activeTrade, setActiveTrade] = useState(null);

  const [feedbackText, setFeedbackText] = useState('');
  const [feedbackRating, setFeedbackRating] = useState(0);

  // ==========================================
  // --- 2. SAHTE VERİLER (MOCK DATA) ---
  // ==========================================
  const [orders, setOrders] = useState([
    { id: 1, maker: "0x7F...3bA", crypto: "USDT", fiat: "TRY", rate: "33.50", min: 500,  max: 2500,  tier: 1, bond: "0%",  successRate: 100, txCount: 12 },
    { id: 2, maker: "0x1A...9cK", crypto: "USDC", fiat: "TRY", rate: "33.45", min: 1000, max: 15000, tier: 2, bond: "8%",  successRate: 97,  txCount: 34 },
    { id: 3, maker: "0x9D...4fE", crypto: "ETH",  fiat: "USD", rate: "3100.00", min: 500, max: 5000, tier: 3, bond: "6%",  successRate: 88,  txCount: 9  },
  ]);

  const [activeEscrows] = useState([
    { id: '#1042', role: 'maker', counterparty: '0x88...1b', state: 'PAID', amount: '1000 USDT', action: 'Ödeme Onayı Bekleniyor' },
    { id: '#1039', role: 'maker', counterparty: '0x91...4a', state: 'CHALLENGED', amount: '500 USDC', action: 'ARAF Fazında' },
    { id: '#1045', role: 'taker', counterparty: '0x7F...3bA', state: 'LOCKED', amount: '250 USDT', action: 'Ödeme Yapmanız Bekleniyor' },
  ]);

  const filteredOrders = orders.filter(order => {
    const amountMatch = searchAmount === '' || (Number(searchAmount) >= order.min && Number(searchAmount) <= order.max);
    const tierMatch = filterTier1 ? order.tier === 1 : true;
    return amountMatch && tierMatch;
  });

  const [toast, setToast] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  // ==========================================
  // --- 3. YARDIMCI FONKSİYONLAR ---
  // ==========================================
  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  const formatAddress = (addr) => addr ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : '';

  const getWalletIcon = (name) => {
    const n = name.toLowerCase();
    if (n.includes('metamask')) return '🦊';
    if (n.includes('okx')) return '🖤';
    if (n.includes('coinbase')) return '🔵';
    return '👛';
  };

  // YENİ: SIWE (Sign-In With Ethereum) Akışı
  const loginWithSIWE = async () => {
    if (!address) return;
    try {
      setIsLoggingIn(true);
      
      // UX GÜNCELLEMESİ: Kullanıcıyı yönlendir
      showToast(lang === 'TR' ? 'Lütfen cüzdanınızdan imza isteğini onaylayın 🦊' : 'Please approve the signature request in your wallet 🦊', 'info');

      // 1. Backend'den Nonce (Tek kullanımlık şifre) al
      const nonceRes = await fetch(`${API_URL}/api/auth/nonce?wallet=${address}`);
      const { nonce } = await nonceRes.json();

      // 2. İmza mesajını oluştur (EIP-4361 Formatı)
      const domain = window.location.host;
      const origin = window.location.origin;
      const statement = 'Sign in to Araf Protocol to manage your trades and secure PII data.';
      const message = `${domain} wants you to sign in with your Ethereum account:\n${address}\n\n${statement}\n\nURI: ${origin}\nVersion: 1\nChain ID: 8453\nNonce: ${nonce}\nIssued At: ${new Date().toISOString()}`;

      // 3. Kullanıcıya imzalat
      const signature = await signMessageAsync({ message });

      // 4. İmzayı Backend'e doğrulat
      const verifyRes = await fetch(`${API_URL}/api/auth/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, signature }),
      });

      const data = await verifyRes.json();
      
      if (data.token) {
        setJwtToken(data.token);
        showToast(lang === 'TR' ? 'Sisteme başarıyla giriş yapıldı! 🚀' : 'Successfully signed in! 🚀', 'success');
      } else {
        throw new Error(data.error || 'Doğrulama başarısız');
      }
    } catch (error) {
      console.error("SIWE Error:", error);
      // UX GÜNCELLEMESİ: Hata durumunda bilgi ver
      if (error.message?.includes('rejected')) {
        showToast(lang === 'TR' ? 'İmza işlemi sizin tarafınızdan iptal edildi.' : 'Signature request was cancelled by you.', 'error');
      } else {
        showToast(lang === 'TR' ? 'Giriş başarısız oldu.' : 'Login failed.', 'error');
      }
    } finally {
      setIsLoggingIn(false);
    }
  };

  // Cüzdan değiştiğinde veya koptuğunda JWT'yi sıfırla
  useEffect(() => {
    if (!isConnected) setJwtToken(null);
  }, [isConnected, address]);

  const handleStartTrade = (order) => {
    if (isBanned) {
      showToast(lang === 'TR' ? '🚫 30 Günlük Alım kısıtlamanız bulunmaktadır.' : '🚫 You have a 30-day buying restriction.', 'error');
      return;
    }
    setActiveTrade(order);
    setTradeState('LOCKED');
    setCancelStatus(null);
    setCooldownPassed(false);
    setChargebackAccepted(false);
    setCurrentView('tradeRoom');
  };

  const handleDeleteOrder = (id) => {
    setOrders(prev => prev.filter(o => o.id !== id));
    setConfirmDeleteId(null);
    showToast(lang === 'TR' ? 'İlan pazar yerinden kaldırıldı.' : 'Listing removed from marketplace.');
  };

  const handleProposeCancel = () => {
    setCancelStatus('proposed_by_me');
    showToast(lang === 'TR' ? 'İptal teklifi gönderildi. Onay bekleniyor...' : 'Cancel proposal sent. Waiting for approval...', 'info');
  };

  const submitFeedback = () => {
    setShowFeedbackModal(false);
    setFeedbackText('');
    setFeedbackRating(0);
    showToast(lang === 'TR' ? 'Geri bildiriminiz için teşekkürler!' : 'Thank you for your feedback!', 'success');
  };

  const getSafeTelegramUrl = (handle) => {
    const safeHandle = handle.replace(/[^a-zA-Z0-9_]/g, '');
    return `https://t.me/${safeHandle}`;
  };

  // --- ÇEVİRİ SÖZLÜĞÜ ---
  const t = {
    title: lang === 'TR' ? 'Pazar Yeri' : 'Marketplace',
    subtitle: lang === 'TR' ? 'Merkeziyetsiz, hakemsiz P2P takas tahtası.' : 'Decentralized, oracle-free P2P escrow board.',
    searchPlaceholder: lang === 'TR' ? 'Tutar Ara...' : 'Search Amount...',
    bondFilter: lang === 'TR' ? '%0 Teminat' : '0% Bond',
    vol: lang === 'TR' ? 'Toplam Hacim' : 'Total Volume',
    trades: lang === 'TR' ? 'Başarılı İşlem' : 'Success Trades',
    users: lang === 'TR' ? 'Aktif Kullanıcı' : 'Active Users',
    burn: lang === 'TR' ? 'Eriyen Kasa' : 'Burned Treasury',
    tableSeller: lang === 'TR' ? 'Satıcı' : 'Seller',
    tableRate: lang === 'TR' ? 'Kur' : 'Rate',
    tableLimit: lang === 'TR' ? 'Limit' : 'Limit',
    tableBond: lang === 'TR' ? 'Bond' : 'Bond',
    tableAction: lang === 'TR' ? 'İşlem' : 'Action',
    buyBtn: lang === 'TR' ? 'Satın Al' : 'Buy',
    createAd: lang === 'TR' ? '+ İlan Aç' : '+ Create Ad',
  };

  // ==========================================
  // --- 4. RENDER MODALLARI ---
  // ==========================================

  const renderWalletModal = () => {
    if (!showWalletModal) return null;
    return (
      <div className="fixed inset-0 bg-slate-900/90 backdrop-blur-md flex items-center justify-center p-4 z-[100]">
        <div className="bg-slate-800 border border-slate-700 rounded-2xl p-6 w-full max-w-sm shadow-2xl">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-xl font-bold text-white">{lang === 'TR' ? 'Cüzdan Seçin' : 'Select Wallet'}</h2>
            <button onClick={() => setShowWalletModal(false)} className="text-slate-400 hover:text-white text-2xl leading-none">&times;</button>
          </div>
          <div className="space-y-3">
            {connectors.map((connector) => (
              <button
                key={connector.uid}
                onClick={() => { connect({ connector }); setShowWalletModal(false); }}
                className="w-full flex items-center justify-between bg-slate-900 hover:bg-slate-700 border border-slate-700 p-4 rounded-xl transition-all group"
              >
                <div className="flex items-center space-x-3">
                  <span className="text-2xl">{getWalletIcon(connector.name)}</span>
                  <span className="font-bold text-white group-hover:text-emerald-400">{connector.name}</span>
                </div>
                <span className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Connect</span>
              </button>
            ))}
          </div>
          <p className="mt-6 text-[10px] text-center text-slate-500 italic">
            {lang === 'TR' ? '* Araf Protocol hiçbir zaman private key istemez.' : '* Araf Protocol never asks for private keys.'}
          </p>
        </div>
      </div>
    );
  };

  const renderFeedbackModal = () => {
    if (!showFeedbackModal) return null;
    return (
      <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
        <div className="bg-slate-800 border border-slate-700 rounded-2xl p-6 w-full max-w-sm shadow-2xl">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-bold text-white">{lang === 'TR' ? 'Geri Bildirim' : 'Feedback'}</h2>
            <button onClick={() => setShowFeedbackModal(false)} className="text-slate-400 hover:text-white text-2xl">&times;</button>
          </div>
          <p className="text-sm text-slate-400 mb-4">{lang === 'TR' ? 'Araf Protocol deneyiminizi nasıl buldunuz?' : 'How is your experience with Araf Protocol?'}</p>
          <div className="flex justify-center space-x-2 mb-4">
            {[1, 2, 3, 4, 5].map((star) => (
              <button key={star} onClick={() => setFeedbackRating(star)} className={`text-3xl transition ${feedbackRating >= star ? 'text-yellow-400 scale-110' : 'text-slate-600 hover:text-yellow-400/50'}`}>★</button>
            ))}
          </div>
          <textarea value={feedbackText} onChange={(e) => setFeedbackText(e.target.value)} placeholder={lang === 'TR' ? 'Düşünceleriniz veya bulduğunuz hatalar...' : 'Your thoughts or bugs found...'} className="w-full bg-slate-900 text-white px-3 py-3 rounded-xl border border-slate-700 outline-none h-24 text-sm mb-4 resize-none"></textarea>
          <button onClick={submitFeedback} disabled={feedbackRating === 0} className={`w-full py-3 rounded-xl font-bold transition ${feedbackRating > 0 ? 'bg-emerald-600 hover:bg-emerald-500 text-white' : 'bg-slate-700 text-slate-500 cursor-not-allowed'}`}>
            {lang === 'TR' ? 'Gönder' : 'Submit'}
          </button>
        </div>
      </div>
    );
  };

  const renderMakerModal = () => {
    if (!showMakerModal) return null;
    return (
      <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
        <div className="bg-slate-800 border border-slate-700 rounded-2xl p-6 w-full max-w-md shadow-2xl max-h-[90vh] overflow-y-auto">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-bold text-white">{t.createAd}</h2>
            <button onClick={() => setShowMakerModal(false)} className="text-slate-400 hover:text-white text-2xl">&times;</button>
          </div>
          <div className="space-y-4">
            <div className="flex space-x-2">
              <div className="w-1/2">
                <label className="block text-xs text-slate-400 mb-1">{lang === 'TR' ? 'Satılacak Kripto' : 'Crypto to Sell'}</label>
                <select className="w-full bg-slate-900 text-white px-3 py-2 rounded-xl border border-slate-700 outline-none"><option>USDT</option><option>USDC</option><option>ETH</option></select>
              </div>
              <div className="w-1/2">
                <label className="block text-xs text-slate-400 mb-1">{lang === 'TR' ? 'İstenecek İtibari Para' : 'Fiat Currency'}</label>
                <select className="w-full bg-slate-900 text-white px-3 py-2 rounded-xl border border-slate-700 outline-none"><option>TRY</option><option>USD</option><option>EUR</option></select>
              </div>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">{lang === 'TR' ? 'Satılacak Miktar' : 'Amount'}</label>
              <input type="number" placeholder="Örn: 1000" className="w-full bg-slate-900 text-white px-3 py-2 rounded-xl border border-slate-700 outline-none" />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">{lang === 'TR' ? 'Kur Fiyatı' : 'Exchange Rate'}</label>
              <input type="number" placeholder="Örn: 33.50" className="w-full bg-slate-900 text-white px-3 py-2 rounded-xl border border-slate-700 outline-none" />
            </div>
            <div className="flex space-x-2">
              <div className="w-1/2"><label className="block text-xs text-slate-400 mb-1">{lang === 'TR' ? 'Min. Limit' : 'Min Limit'}</label><input type="number" placeholder="500" className="w-full bg-slate-900 text-white px-3 py-2 rounded-xl border border-slate-700 outline-none" /></div>
              <div className="w-1/2"><label className="block text-xs text-slate-400 mb-1">{lang === 'TR' ? 'Max. Limit' : 'Max Limit'}</label><input type="number" placeholder="2500" className="w-full bg-slate-900 text-white px-3 py-2 rounded-xl border border-slate-700 outline-none" /></div>
            </div>
            <div className="mt-4 p-3 bg-emerald-900/20 border border-emerald-500/30 rounded-xl">
              <p className="text-xs text-emerald-400 mb-2 font-medium">🛡️ Tier 2 {lang === 'TR' ? 'Kuralları Geçerlidir' : 'Rules Apply'}</p>
              <div className="flex justify-between text-xs text-slate-300 mb-1"><span>{lang === 'TR' ? 'Satıcı Teminatı' : 'Maker Bond'} (%15):</span> <span>150 Kripto</span></div>
              <div className="flex justify-between text-sm font-bold text-white border-t border-emerald-500/30 pt-2"><span>{lang === 'TR' ? 'Toplam Kilitlenecek:' : 'Total Locked:'}</span> <span>1150 Kripto</span></div>
            </div>
            <button className="w-full bg-emerald-600 hover:bg-emerald-500 text-white py-3 rounded-xl font-bold mt-2 shadow-lg shadow-emerald-900/20">{lang === 'TR' ? 'Varlığı ve Teminatı Kilitle' : 'Lock Asset & Bond'}</button>
          </div>
        </div>
      </div>
    );
  };

  const renderProfileModal = () => {
    if (!showProfileModal) return null;
    const myOrders = address ? orders.filter(o => o.maker.toLowerCase() === address.toLowerCase()) : [];

    return (
      <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
        <div className="bg-slate-800 border border-slate-700 rounded-2xl w-full max-w-md shadow-2xl max-h-[90vh] flex flex-col">
          <div className="flex justify-between items-center p-6 border-b border-slate-700 shrink-0">
            <h2 className="text-2xl font-bold text-white">{lang === 'TR' ? 'Profil Merkezi' : 'Profile Center'}</h2>
            <button onClick={() => setShowProfileModal(false)} className="text-slate-400 hover:text-white text-2xl leading-none">&times;</button>
          </div>

          <div className="flex border-b border-slate-700 shrink-0 overflow-x-auto hide-scrollbar">
            {['ayarlar', 'ilanlarim', 'aktif', 'gecmis'].map(tab => (
              <button key={tab} onClick={() => setProfileTab(tab)} className={`px-4 py-3 text-sm font-medium capitalize transition whitespace-nowrap ${profileTab === tab ? 'text-emerald-400 border-b-2 border-emerald-400' : 'text-slate-400 hover:text-white'}`}>
                {tab === 'ayarlar' ? (lang === 'TR' ? 'Ayarlar' : 'Settings') : tab === 'ilanlarim' ? (lang === 'TR' ? 'İlanlarım' : 'My Ads') : tab === 'aktif' ? (lang === 'TR' ? 'Aktif İşlemler' : 'Active Trades') : (lang === 'TR' ? 'Geçmiş' : 'History')}
              </button>
            ))}
          </div>

          <div className="overflow-y-auto p-6 flex-1">
            {profileTab === 'ayarlar' && (
              <div className="space-y-4 text-sm">
                {isBanned && (
                  <div className="bg-red-950/40 border border-red-900/50 p-4 rounded-xl flex items-start space-x-3">
                    <span className="text-2xl">🚫</span>
                    <div>
                      <p className="font-bold text-red-400">{lang === 'TR' ? '30 Günlük İşlem Kısıtlaması' : '30-Day Restriction'}</p>
                      <p className="text-red-300/80 text-xs mt-1">{lang === 'TR' ? 'Sadece Maker olarak ilan açabilirsiniz.' : 'You can only create ads as Maker.'}</p>
                    </div>
                  </div>
                )}
                
                <div className="bg-slate-900 p-4 rounded-xl border border-slate-700">
                   <p className="text-slate-400 text-xs mb-1 uppercase tracking-widest font-bold">Cüzdan Adresi</p>
                   <p className="font-mono text-white text-xs break-all">{address ? address : 'Bağlı Değil'}</p>
                </div>
                
                <div className="bg-slate-900 p-4 rounded-xl border border-slate-700">
                   <p className="text-slate-400 text-xs mb-1 uppercase tracking-widest font-bold">Oturum Durumu (JWT)</p>
                   <p className="font-mono text-white text-xs break-all">{jwtToken ? '✅ Sisteme Giriş Yapıldı' : '❌ İmza Bekleniyor'}</p>
                </div>
              </div>
            )}
            
            {profileTab === 'ilanlarim' && (
              <div className="space-y-3">
                {myOrders.length > 0 ? myOrders.map(order => (
                  <div key={order.id} className={`bg-slate-900 border rounded-xl p-4 transition-all duration-200 ${confirmDeleteId === order.id ? 'border-red-500/60 bg-red-950/20' : 'border-slate-700'}`}>
                    <div className="flex justify-between items-center">
                      <div>
                        <p className="font-bold text-white text-sm">{order.crypto} → {order.fiat}</p>
                        <p className="text-xs text-slate-400 mt-0.5">{order.rate} {order.fiat} · {order.min}–{order.max}</p>
                      </div>
                      {confirmDeleteId !== order.id && <button onClick={() => setConfirmDeleteId(order.id)} className="text-xs text-red-400 border border-red-500/40 hover:bg-red-500/10 px-3 py-1.5 rounded-lg transition font-medium">Sil</button>}
                    </div>
                    {confirmDeleteId === order.id && (
                      <div className="mt-3 pt-3 border-t border-red-500/20">
                        <p className="text-xs text-red-400 mb-3">⚠️ {lang === 'TR' ? 'Emin misin?' : 'Are you sure?'}</p>
                        <div className="flex gap-2">
                          <button onClick={() => handleDeleteOrder(order.id)} className="flex-1 bg-red-500 hover:bg-red-400 text-white text-xs font-bold py-2 rounded-lg transition">Evet</button>
                          <button onClick={() => setConfirmDeleteId(null)} className="flex-1 bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs font-bold py-2 rounded-lg transition">İptal</button>
                        </div>
                      </div>
                    )}
                  </div>
                )) : <p className="text-center text-slate-500 text-xs mt-4">İlan bulunamadı.</p>}
              </div>
            )}

            {profileTab === 'aktif' && (
              <div className="space-y-3">
                {activeEscrows.map(escrow => (
                  <div key={escrow.id} className="bg-slate-900 border border-slate-700 rounded-xl p-4">
                    <div className="flex justify-between items-start mb-2">
                      <div><span className="font-mono text-emerald-400 font-bold">{escrow.id}</span><span className="text-xs text-slate-500 ml-2 uppercase border border-slate-700 px-2 py-0.5 rounded">{escrow.role}</span></div>
                      <span className={`text-xs font-bold px-2 py-1 rounded ${escrow.state === 'PAID' ? 'bg-emerald-500/20 text-emerald-400' : escrow.state === 'CHALLENGED' ? 'bg-red-500/20 text-red-400' : 'bg-blue-500/20 text-blue-400'}`}>{escrow.state}</span>
                    </div>
                    <p className="text-white font-medium text-sm mb-1">{escrow.amount}</p>
                    <p className="text-xs text-slate-400 mb-3">Karşı Taraf: <span className="font-mono">{escrow.counterparty}</span></p>
                    <button onClick={() => { setShowProfileModal(false); setCurrentView('tradeRoom'); setTradeState(escrow.state); }} className="w-full bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold py-2 rounded-lg transition border border-slate-600">
                      {lang === 'TR' ? 'Odaya Git →' : 'Go to Room →'}
                    </button>
                  </div>
                ))}
              </div>
            )}
            
            {profileTab === 'gecmis' && (
              <div className="space-y-3 text-sm">
                {[
                  { id: 'TX-001', date: '01.03.2026', amount: '1.000 TRY', crypto: '29.85 USDT', status: 'Tamamlandı' },
                  { id: 'TX-002', date: '15.02.2026', amount: '500 TRY',  crypto: '14.92 USDT', status: 'Tamamlandı' },
                  { id: 'TX-003', date: '02.02.2026', amount: '2.500 TRY', crypto: '74.55 USDT', status: 'İptal'       },
                ].map(tx => (
                  <div key={tx.id} className="bg-slate-900 border border-slate-700 rounded-xl p-3 flex justify-between items-center">
                    <div><p className="font-mono text-xs text-slate-400">{tx.id} · {tx.date}</p><p className="text-white font-medium mt-0.5">{tx.amount} → {tx.crypto}</p></div>
                    <span className={`text-xs px-2 py-1 rounded-md font-bold ${tx.status === 'Tamamlandı' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}`}>{tx.status}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  // ==========================================
  // --- 5. PAZAR YERİ EKRANI (DASHBOARD) ---
  // ==========================================
  const renderDashboard = () => (
    <main className="max-w-6xl mx-auto p-4 md:p-6 pb-24 relative">
      <div className="mb-8 p-3 bg-slate-800 rounded-xl border border-purple-500/50 flex flex-wrap gap-4 items-center text-sm shadow-lg shadow-purple-900/20">
        <span className="text-purple-400 font-bold tracking-widest uppercase text-xs">🛠️ UX Paneli:</span>
        <div className="flex items-center space-x-2">
          <button onClick={() => setUserRole('taker')} className={`px-3 py-1.5 rounded-lg transition ${userRole === 'taker' ? 'bg-purple-600 text-white' : 'bg-slate-700'}`}>Taker</button>
          <button onClick={() => setUserRole('maker')} className={`px-3 py-1.5 rounded-lg transition ${userRole === 'maker' ? 'bg-purple-600 text-white' : 'bg-slate-700'}`}>Maker</button>
        </div>
        <div className="w-px h-6 bg-slate-600 hidden sm:block"></div>
        <button onClick={() => setIsBanned(!isBanned)} className={`px-3 py-1.5 rounded-lg font-medium transition ${isBanned ? 'bg-red-600 text-white border border-red-500' : 'bg-slate-700 hover:bg-slate-600'}`}>
          {isBanned ? '🔴 Ban Aktif' : '⚪ Ban Kapalı'}
        </button>
      </div>

      <div className="flex flex-col md:flex-row justify-between items-start md:items-end mb-6 space-y-4 md:space-y-0">
        <div><h1 className="text-2xl md:text-3xl font-bold mb-1">{t.title}</h1><p className="text-sm text-slate-400">{t.subtitle}</p></div>
        <div className="flex items-center space-x-2 w-full md:w-auto">
          <input type="number" value={searchAmount} onChange={(e) => setSearchAmount(e.target.value)} placeholder={t.searchPlaceholder} className="w-full md:w-48 bg-slate-800 text-white px-4 py-2 rounded-xl border border-slate-700 outline-none focus:border-emerald-500" />
          <button onClick={() => setFilterTier1(!filterTier1)} className={`whitespace-nowrap px-4 py-2 rounded-xl font-medium transition text-sm ${filterTier1 ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-900/30' : 'bg-slate-700 text-slate-300'}`}>{t.bondFilter}</button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <div className="bg-slate-800/60 border border-slate-700 p-4 rounded-2xl shadow-lg relative overflow-hidden group"><div className="absolute -right-4 -top-4 text-emerald-500/10 text-6xl group-hover:scale-110 transition-transform">📈</div><p className="text-slate-400 text-xs font-medium uppercase tracking-wider mb-1">{t.vol}</p><p className="text-2xl font-bold text-white">$4.2M+</p></div>
        <div className="bg-slate-800/60 border border-slate-700 p-4 rounded-2xl shadow-lg relative overflow-hidden group"><div className="absolute -right-4 -top-4 text-blue-500/10 text-6xl group-hover:scale-110 transition-transform">🤝</div><p className="text-slate-400 text-xs font-medium uppercase tracking-wider mb-1">{t.trades}</p><p className="text-2xl font-bold text-white">12,450</p></div>
        <div className="bg-slate-800/60 border border-slate-700 p-4 rounded-2xl shadow-lg relative overflow-hidden group"><div className="absolute -right-4 -top-4 text-purple-500/10 text-6xl group-hover:scale-110 transition-transform">👥</div><p className="text-slate-400 text-xs font-medium uppercase tracking-wider mb-1">{t.users}</p><p className="text-2xl font-bold text-white">3,820</p></div>
        <div className="bg-red-950/30 border border-red-900/50 p-4 rounded-2xl shadow-lg relative overflow-hidden group"><div className="absolute -right-4 -top-4 text-red-500/10 text-6xl group-hover:scale-110 transition-transform">🔥</div><p className="text-red-400/80 text-xs font-medium uppercase tracking-wider mb-1">{t.burn}</p><p className="text-2xl font-bold text-red-400">$14,200</p></div>
      </div>

      <div className="overflow-x-auto bg-slate-800/50 rounded-2xl border border-slate-700 shadow-xl">
        <table className="w-full text-left border-collapse min-w-[620px]">
          <thead>
            <tr className="border-b border-slate-700 text-xs text-slate-400 uppercase">
              <th className="p-4 font-medium">{t.tableSeller}</th><th className="p-4 font-medium">{t.tableRate}</th><th className="p-4 font-medium">{t.tableLimit}</th><th className="p-4 font-medium">{t.tableBond}</th><th className="p-4 font-medium text-right">{t.tableAction}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-700/50">
            {filteredOrders.length > 0 ? (
              filteredOrders.map((order) => (
                <tr key={order.id} className="hover:bg-slate-700/30 transition">
                  <td className="p-4">
                    <div className="flex items-center space-x-2">
                      <div className="w-6 h-6 rounded-full bg-slate-700 flex items-center justify-center text-xs border border-slate-600 shrink-0">🛡️</div>
                      <div>
                        <span className="font-mono text-emerald-400 text-sm">{order.maker}</span>
                        <div className="flex items-center space-x-1 mt-0.5 text-xs">
                          <span className={`${order.successRate === 100 ? 'text-emerald-400' : 'text-orange-400'}`}>%{order.successRate}</span><span className="text-slate-600">·</span><span className="text-slate-400">📜 {order.txCount} tx</span>
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="p-4"><div className="font-bold text-base">{order.rate} {order.fiat}</div><div className="text-xs text-slate-500">1 {order.crypto}</div></td>
                  <td className="p-4 text-slate-300 text-sm">{order.min} - {order.max} {order.fiat}</td>
                  <td className="p-4 text-xs font-bold text-emerald-400">{order.bond}</td>
                  <td className="p-4 text-right"><button onClick={() => handleStartTrade(order)} className="bg-slate-100 text-slate-900 px-4 py-2 rounded-lg font-bold text-sm hover:bg-white">{t.buyBtn}</button></td>
                </tr>
              ))
            ) : (<tr><td colSpan="5" className="p-8 text-center text-slate-500">{lang === 'TR' ? 'İlan bulunamadı.' : 'No ads found.'}</td></tr>)}
          </tbody>
        </table>
      </div>

      <div className="md:hidden fixed bottom-6 right-6 flex flex-col space-y-3 z-30">
        <button onClick={() => setShowFeedbackModal(true)} className="w-12 h-12 bg-slate-700 border border-slate-600 rounded-full flex items-center justify-center text-white text-xl shadow-lg">💬</button>
        <button onClick={() => setShowMakerModal(true)} className="w-14 h-14 bg-emerald-600 rounded-full flex items-center justify-center text-white text-3xl shadow-lg shadow-emerald-600/50">+</button>
      </div>
    </main>
  );

  // ==========================================
  // --- 6. İŞLEM VE ARAF ODASI (TRADE ROOM) ---
  // ==========================================
  const renderTradeRoom = () => {
    const isChallenged = tradeState === 'CHALLENGED';
    const bgTheme = isChallenged ? 'bg-red-950/20' : 'bg-slate-900';
    const borderTheme = isChallenged ? 'border-red-900/50' : 'border-slate-800';
    const isTaker = userRole === 'taker';
    const isMaker = userRole === 'maker';

    return (
      <main className={`max-w-6xl mx-auto p-4 md:p-6 mt-4 transition-colors duration-500 ${bgTheme} pb-24`}>
        <div className="mb-4 p-2 bg-slate-800 rounded-xl border border-slate-700 flex flex-wrap gap-2 items-center text-xs">
          <button onClick={() => setTradeState('LOCKED')} className={`px-3 py-1.5 rounded ${tradeState === 'LOCKED' ? 'bg-blue-600' : 'bg-slate-700'}`}>1. LOCKED</button>
          <button onClick={() => { setTradeState('PAID'); setCooldownPassed(false); setChargebackAccepted(false); }} className={`px-3 py-1.5 rounded ${tradeState === 'PAID' ? 'bg-emerald-600' : 'bg-slate-700'}`}>2. PAID</button>
          <button onClick={() => setTradeState('CHALLENGED')} className={`px-3 py-1.5 rounded ${tradeState === 'CHALLENGED' ? 'bg-red-600' : 'bg-slate-700'}`}>3. CHALLENGED</button>
          {tradeState === 'PAID' && isMaker && (
            <button onClick={() => setCooldownPassed(!cooldownPassed)} className="ml-auto bg-orange-600 px-3 py-1.5 rounded font-bold">⏱️ Simüle Et: 1 Saat {cooldownPassed ? 'Geri Al' : 'İleri Sar'}</button>
          )}
          {tradeState === 'CHALLENGED' && (
             <button onClick={() => setCancelStatus('proposed_by_other')} className="ml-auto bg-slate-700 px-3 py-1.5 rounded text-orange-400 border border-orange-500/30">Simüle Et: Karşı Taraf İptal İstedi</button>
          )}
        </div>

        <button onClick={() => setCurrentView('dashboard')} className="text-slate-400 hover:text-white mb-4 flex items-center text-sm font-medium">← {lang === 'TR' ? 'Geri Dön' : 'Go Back'}</button>
        
        <div className="w-full bg-red-950/40 border border-red-900/50 p-3 rounded-xl mb-6 flex items-start space-x-3 text-sm">
          <span className="text-xl">🛡️</span>
          <div>
            <p className="text-red-400 font-bold">{lang === 'TR' ? 'Güvenlik Uyarısı!' : 'Security Warning!'}</p>
            <p className="text-slate-300 text-xs mt-0.5">{lang === 'TR' ? 'Araf Protocol destek ekibi size ASLA mesaj atmaz. Tüm sorunları kontrat butonlarıyla çözün. Harici cüzdanlara asla elden para göndermeyin.' : 'Araf Protocol support will NEVER DM you. Resolve all issues via contract buttons. Never send funds to external wallets.'}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className={`bg-slate-800/80 p-5 rounded-2xl border ${borderTheme} shadow-xl`}>
            <h3 className="text-lg font-bold mb-4 text-white">{lang === 'TR' ? 'İşlem Detayları' : 'Trade Details'}</h3>
            <div className="space-y-3 text-sm">
              <div className="bg-slate-900 p-3 rounded-xl border border-slate-700">
                <p className="text-slate-400 mb-1">{isTaker ? (lang === 'TR' ? 'Gönderilecek Tutar' : 'Amount to Send') : (lang === 'TR' ? 'Alınacak Tutar' : 'Amount to Receive')}</p>
                <p className="text-xl font-bold text-white">33.500,00 TRY</p>
                <p className="text-xs text-emerald-400 mt-1">1000 USDT</p>
              </div>

              {isTaker ? (
                <div className="bg-slate-900 p-4 rounded-xl border border-slate-700 relative overflow-hidden">
                  <div className="absolute top-0 right-0 bg-blue-600 text-white text-[10px] font-bold px-2 py-1 rounded-bl-lg">End-to-End Encrypted</div>
                  <p className="text-slate-400 mb-2 uppercase text-[10px] tracking-widest font-bold">🛡️ {lang === 'TR' ? 'Güvenli PII Verisi' : 'Secure PII Data'}</p>
                  
                  {/* H-03 Düzeltmesi: Statik IBAN yerine Güvenli Bileşen Entegrasyonu */}
                  <PIIDisplay 
                    tradeId={activeTrade?.id || 'TEST'} 
                    authToken={jwtToken} 
                    lang={lang}
                  />

                  <div className="mt-4 p-2 bg-slate-800 rounded-lg flex items-start space-x-2 border border-slate-600">
                    <span className="text-lg">🔒</span>
                    <p className="text-[10px] text-slate-300 leading-tight">Bu bilgiler blockchain'e kaydedilmez. Sadece bu işleme özel şifreli olarak iletilmiştir.</p>
                  </div>
                </div>
              ) : (
                <div className="bg-slate-900 p-4 rounded-xl border border-slate-700 text-center">
                  <div className="text-3xl mb-2">🏦</div>
                  <p className="text-slate-300 font-medium text-sm">{lang === 'TR' ? 'Banka hesabınıza ödeme bekleniyor.' : 'Waiting for fiat payment.'}</p>
                </div>
              )}

              {/* GÜVENLİ XSS KORUMALI TELEGRAM BUTONU */}
              <div className="bg-slate-900 p-3 rounded-xl border border-slate-700 flex justify-between items-center">
                <span className="text-slate-400">{lang === 'TR' ? 'Karşı Taraf:' : 'Counterparty:'}</span>
                <a href={getSafeTelegramUrl(telegramHandle)} target="_blank" rel="noopener noreferrer" className="flex items-center space-x-1 text-blue-400 hover:text-blue-300 transition bg-blue-500/10 px-3 py-1.5 rounded-lg border border-blue-500/30">
                  <span>💬</span><span className="font-bold text-xs">{lang === 'TR' ? 'Mesaj At' : 'Message'}</span>
                </a>
              </div>

            </div>
          </div>

          <div className={`col-span-1 lg:col-span-2 bg-slate-800/80 p-5 rounded-2xl border ${borderTheme} shadow-xl flex flex-col justify-center`}>
            {tradeState === 'LOCKED' && (
              <div className="text-center py-6">
                <div className="w-14 h-14 bg-blue-500/20 text-blue-400 rounded-full flex items-center justify-center mx-auto mb-4 text-2xl">🔒</div>
                <h2 className="text-xl md:text-2xl font-bold text-white mb-2">{lang === 'TR' ? 'USDT Kilitlendi' : 'USDT Locked'}</h2>
                {isTaker ? (
                  <button onClick={() => { setTradeState('PAID'); setCooldownPassed(false); }} className="bg-blue-600 hover:bg-blue-500 text-white w-full sm:w-auto px-8 py-3 rounded-xl font-bold mt-4">
                    {lang === 'TR' ? 'Ödemeyi Yaptım' : 'I have paid'}
                  </button>
                ) : (
                  <p className="text-slate-400 mb-6 text-sm animate-pulse">{lang === 'TR' ? 'Alıcının transferi bekleniyor...' : 'Waiting for buyer transfer...'}</p>
                )}
              </div>
            )}

            {tradeState === 'PAID' && (
              <div className="text-center py-4 flex flex-col items-center">
                <h2 className="text-lg md:text-xl font-bold text-emerald-400 mb-2">{lang === 'TR' ? 'Ödeme Bildirildi' : 'Payment Reported'}</h2>
                <div className="w-full max-w-sm bg-slate-900 border border-slate-700 rounded-2xl p-4 mb-6">
                  <p className="text-xs text-slate-500 mb-1 uppercase font-bold">Grace Period</p>
                  <div className="text-4xl sm:text-5xl font-mono font-bold text-white tracking-wider">47:59:12</div>
                </div>
                {isTaker ? (
                  <p className="text-slate-400 text-sm mb-4">{lang === 'TR' ? 'Satıcının onayı bekleniyor.' : 'Waiting for seller release.'}</p>
                ) : (
                  <div className="w-full max-w-md flex flex-col space-y-4">
                    <label className="flex items-start space-x-3 p-3 bg-red-950/30 border border-red-900/50 rounded-xl cursor-pointer text-left">
                      <input 
                        type="checkbox" 
                        checked={chargebackAccepted} 
                        onChange={(e) => setChargebackAccepted(e.target.checked)}
                        className="mt-1 w-4 h-4 accent-emerald-500 rounded bg-slate-800 border-slate-600 focus:ring-emerald-500 focus:ring-offset-slate-900"
                      />
                      <span className="text-xs text-slate-300">
                        <strong className="text-red-400">{lang === 'TR' ? 'UYARI:' : 'WARNING:'}</strong> {lang === 'TR' ? 'Paranın farklı isimli bir hesaptan gelmediğini ve Chargeback (Ters İbraz) riskini anladığımı kabul ediyorum.' : 'I confirm the funds came from the correct name and understand the Chargeback risk.'}
                      </span>
                    </label>

                    <div className="flex flex-col sm:flex-row justify-center gap-3">
                      <button 
                        disabled={!chargebackAccepted}
                        className={`w-full sm:w-auto px-8 py-3 rounded-xl font-bold transition ${chargebackAccepted ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-900/20' : 'bg-slate-700 text-slate-500 cursor-not-allowed'}`}>
                        {lang === 'TR' ? 'Serbest Bırak' : 'Release USDT'}
                      </button>
                      <button onClick={() => cooldownPassed && setTradeState('CHALLENGED')} disabled={!cooldownPassed} className={`w-full sm:w-auto px-6 py-3 rounded-xl font-bold transition ${cooldownPassed ? 'bg-red-500/10 text-red-500 border border-red-500/50 hover:bg-red-500 hover:text-white' : 'bg-slate-800 text-slate-500 border border-slate-700 cursor-not-allowed'}`}>
                        {cooldownPassed ? (lang === 'TR' ? 'İtiraz Et' : 'Challenge') : '⏳ Cooldown 59:12'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {tradeState === 'CHALLENGED' && (
              <div className="text-center py-2">
                <div className="w-14 h-14 bg-red-500/20 text-red-500 rounded-full flex items-center justify-center mx-auto mb-3 text-2xl animate-pulse">⚠️</div>
                <h2 className="text-2xl md:text-3xl font-bold text-red-500 mb-2">{lang === 'TR' ? 'ARAF FAZI' : 'PURGATORY PHASE'}</h2>
                <div className="w-full bg-red-950/40 border border-red-900/50 rounded-2xl p-4 mb-6 text-left">
                  <div className="mb-4">
                    <div className="flex justify-between text-xs mb-1"><span className="text-red-400 font-bold">{lang === 'TR' ? 'Senin Teminatın' : 'Your Bond'}</span><span className="text-white font-mono">-%20 / Gün</span></div>
                    <div className="w-full bg-slate-900 rounded-full h-2 overflow-hidden border border-red-900/30"><div className="bg-red-600 h-2 rounded-full w-[20%]"></div></div>
                  </div>
                  <div className="mb-3">
                    <div className="flex justify-between text-xs mb-1"><span className="text-orange-400">{lang === 'TR' ? 'Karşı Tarafın Teminatı' : 'Opponent Bond'}</span><span className="text-slate-300 font-mono">-%10 / Gün</span></div>
                    <div className="w-full bg-slate-900 rounded-full h-2 overflow-hidden border border-orange-900/30"><div className="bg-orange-500/50 h-2 rounded-full w-[10%]"></div></div>
                  </div>
                  <div className="mt-4 pt-3 border-t border-red-900/30">
                    <p className="text-xs text-slate-400 font-medium flex items-center justify-between"><span>🛡️ {lang === 'TR' ? 'Ana Para Koruma:' : 'Principal Protection:'}</span><span className="text-emerald-400 font-mono">2 Gün 14 Saat</span></p>
                  </div>
                </div>

                <div className="bg-slate-900/50 border border-slate-700 rounded-xl p-4">
                  {cancelStatus === null && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {isMaker && <button className="w-full bg-slate-800 border border-emerald-500/50 text-emerald-400 p-3 rounded-xl font-bold text-sm hover:bg-emerald-500 hover:text-white transition">🤝 {lang === 'TR' ? 'Serbest Bırak' : 'Release'}</button>}
                      <button onClick={handleProposeCancel} className="w-full bg-slate-800 border border-orange-500/50 text-orange-400 p-3 rounded-xl font-bold text-sm hover:bg-orange-500 hover:text-white transition">↩️ {lang === 'TR' ? 'İptal Teklif Et' : 'Propose Cancel'}</button>
                    </div>
                  )}
                  {cancelStatus === 'proposed_by_me' && (
                    <div className="py-3 px-4 bg-orange-500/10 border border-orange-500/30 rounded-xl flex items-center justify-center space-x-3">
                      <div className="w-5 h-5 border-2 border-orange-400 border-t-transparent rounded-full animate-spin"></div>
                      <span className="text-orange-400 font-bold text-sm">Pending Approval...</span>
                    </div>
                  )}
                  {cancelStatus === 'proposed_by_other' && (
                    <div className="animate-pulse-slow">
                      <p className="text-orange-400 font-bold text-sm mb-3">⚠️ {lang === 'TR' ? 'Karşı taraf iptal teklif etti.' : 'Opponent proposed cancellation.'}</p>
                      <div className="grid grid-cols-2 gap-3">
                        <button onClick={() => { setCancelStatus(null); setTradeState('LOCKED'); setCurrentView('dashboard'); showToast(lang === 'TR' ? 'İptal onaylandı.' : 'Cancel approved.', 'success'); }} className="w-full bg-orange-600 hover:bg-orange-500 text-white p-3 rounded-xl font-bold text-sm">{lang === 'TR' ? 'Onayla' : 'Approve'}</button>
                        <button onClick={() => setCancelStatus(null)} className="w-full bg-slate-700 hover:bg-slate-600 text-white p-3 rounded-xl font-bold text-sm">{lang === 'TR' ? 'Reddet' : 'Reject'}</button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
    );
  };

  // ==========================================
  // --- 7. ANA YAPI (ROUTER & NAVBAR) ---
  // ==========================================
  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 font-sans">
      <nav className="flex justify-between items-center p-4 border-b border-slate-800 bg-slate-900/90 backdrop-blur-md sticky top-0 z-40">
        <div className="flex items-center space-x-2 cursor-pointer" onClick={() => setCurrentView('dashboard')}>
          <div className="w-8 h-8 rounded bg-gradient-to-br from-red-500 to-orange-500 flex items-center justify-center font-bold">A</div>
          <span className="text-lg font-bold tracking-widest hidden sm:block">ARAF</span>
        </div>
        
        {/* MOBİL UYUMLU VE SIWE ENTEGRELİ NAVBAR BUTONLARI */}
        <div className="flex items-center space-x-2 sm:space-x-3">
          <button onClick={() => setLang(lang === 'TR' ? 'EN' : 'TR')} className="bg-slate-800 border border-slate-700 px-2 sm:px-3 py-1.5 rounded-lg text-xs sm:text-sm font-bold text-slate-300 hover:bg-slate-700 hover:text-white transition shadow-inner">
            🌐 <span className="hidden xs:inline">{lang}</span>
          </button>
          
          <button onClick={() => setShowMakerModal(true)} className="hidden md:block text-emerald-400 border border-emerald-500/30 px-3 py-1.5 rounded-lg text-sm font-medium">{t.createAd}</button>
          
          <button 
            onClick={() => {
              // YENİ MANTIK: Bağlı değilse cüzdan aç, bağlı ama JWT yoksa SIWE yap, JWT varsa cüzdanı kopar
              if (!isConnected) setShowWalletModal(true);
              else if (!jwtToken) loginWithSIWE();
              else disconnect();
            }}
            disabled={isLoggingIn}
            className={`flex items-center justify-center space-x-2 px-3 sm:px-4 py-1.5 rounded-lg font-bold text-xs sm:text-sm transition-all ${
              isLoggingIn
              ? 'bg-orange-800 text-orange-200 cursor-not-allowed opacity-80' 
              : isConnected && jwtToken
              ? 'bg-slate-800 text-emerald-400 border border-emerald-500/20 hover:bg-red-950/20 hover:text-red-400' 
              : isConnected && !jwtToken
              ? 'bg-orange-600 hover:bg-orange-500 text-white shadow-lg shadow-orange-900/20 animate-pulse'
              : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-900/20'
            }`}
          >
            {isLoggingIn ? (
              <>
                <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-orange-200" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                {lang === 'TR' ? 'Bekleniyor...' : 'Pending...'}
              </>
            ) :
              isConnected && jwtToken ? (
              <>
                <span className="hidden sm:inline">{formatAddress(address)}</span>
                <span className="sm:hidden">0x..{address?.slice(-3)}</span>
              </>
            ) : isConnected && !jwtToken ? (
              lang === 'TR' ? '✍️ İmzala' : '✍️ Sign In'
            ) : (
              lang === 'TR' ? 'Cüzdan' : 'Connect'
            )}
          </button>

          <button onClick={() => setShowProfileModal(true)} className="w-8 h-8 bg-slate-800 border border-slate-700 rounded-full flex items-center justify-center text-sm hover:bg-slate-700 relative shrink-0">
            👤 {isBanned && <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-red-500 rounded-full border-2 border-slate-900"></span>}
          </button>
        </div>
      </nav>

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] animate-bounce-in w-[90%] md:w-auto">
          <div className={`flex items-center gap-3 text-white text-sm font-medium px-5 py-3 rounded-2xl shadow-xl border ${toast.type === 'error' ? 'bg-red-600 border-red-500' : toast.type === 'info' ? 'bg-blue-600 border-blue-500' : 'bg-emerald-600 border-emerald-500'}`}>
            <span className="text-base">{toast.type === 'error' ? '✖' : toast.type === 'info' ? 'ℹ' : '✓'}</span>{toast.message}
          </div>
        </div>
      )}

      <button onClick={() => setShowFeedbackModal(true)} className="hidden md:flex fixed bottom-6 left-6 items-center space-x-2 bg-slate-800 border border-slate-700 hover:bg-slate-700 px-4 py-2 rounded-full text-slate-300 transition shadow-lg z-30 font-medium text-sm">
        <span>💬</span> <span>{lang === 'TR' ? 'Geri Bildirim' : 'Feedback'}</span>
      </button>

      {renderWalletModal()}
      {renderFeedbackModal()}
      {renderMakerModal()}
      {renderProfileModal()}
      {currentView === 'dashboard' ? renderDashboard() : renderTradeRoom()}
    </div>
  );
}

export default App;
