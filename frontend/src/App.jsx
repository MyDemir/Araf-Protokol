import React from 'react';
import { useAppController } from './app/useAppController';
import AppViews from './app/AppViews';
import AppModals, { EnvWarningBanner } from './app/AppModals';

function App() {
  const controller = useAppController();

  return (
    <div className="flex flex-col md:flex-row h-screen bg-[#060608] text-slate-100 font-sans overflow-hidden selection:bg-emerald-500/30 pb-16 md:pb-0 relative">
      <EnvWarningBanner />

      {controller.isPaused && (
        <div className="absolute top-0 left-0 right-0 z-[70] bg-red-950/90 backdrop-blur border-b border-red-800 px-6 py-2 flex justify-center items-center shadow-xl">
          <span className="text-sm font-bold text-red-200">⚠️ {controller.lang === 'TR' ? 'Sistem şu an bakım modundadır. Yeni işlem açılamaz.' : 'System is currently in maintenance mode. New trades cannot be opened.'}</span>
        </div>
      )}

      {controller.isConnected && ![8453, 84532, 31337].includes(controller.chainId) && (
        <div className="absolute top-0 left-0 right-0 z-[80] bg-red-950/95 backdrop-blur border-b border-red-800 px-6 py-2 flex justify-center items-center shadow-xl">
          <span className="text-sm font-bold text-red-200">⚠️ {controller.lang === 'TR' ? 'Yanlış Ağ! Lütfen cüzdanınızdan Base Sepolia ağına geçin.' : 'Wrong Network! Please switch to Base Sepolia in your wallet.'}</span>
        </div>
      )}

      {controller.isConnected && controller.isWalletRegistered === false && (
        <div className="absolute top-0 left-0 right-0 z-[60] bg-orange-900/90 backdrop-blur border-b border-orange-700 px-6 py-2 flex justify-center items-center gap-4 shadow-xl">
          <span className="text-sm font-bold text-orange-200">⚠️ {controller.lang === 'TR' ? 'Cüzdan On-Chain Kayıtlı Değil (Anti-Sybil 7 Gün)' : 'Wallet Not Registered (Anti-Sybil 7 Days)'}</span>
          <button onClick={controller.handleRegisterWallet} disabled={controller.isRegisteringWallet} className="bg-orange-500 text-black px-4 py-1.5 rounded-lg text-xs font-bold hover:bg-orange-400 disabled:opacity-50 transition">{controller.isRegisteringWallet ? '⏳' : '📝 Kaydet'}</button>
        </div>
      )}

      {controller.isConnected && controller.isWalletRegistered === true && controller.sybilStatus && controller.sybilStatus.aged === false && (
        <div className="absolute top-0 left-0 right-0 z-[59] bg-orange-900/80 backdrop-blur border-b border-orange-700 px-6 py-2 flex justify-center items-center shadow-xl">
          <span className="text-xs font-bold text-orange-100">
            ⏳ {controller.lang === 'TR'
              ? `Cüzdan kayıtlı ancak 7 günlük yaş şartı henüz dolmadı. Kalan süre: ~${controller.walletAgeRemainingDays ?? '?'} gün.`
              : `Wallet is registered but the 7-day age requirement is not met yet. Remaining: ~${controller.walletAgeRemainingDays ?? '?'} day(s).`}
          </span>
        </div>
      )}

      <AppViews controller={controller} />
      <AppModals controller={controller} />

      <button
        onClick={() => controller.setShowFeedbackModal(true)}
        title={controller.lang === 'TR' ? 'Geri Bildirim' : 'Feedback'}
        className="fixed top-5 right-5 md:top-6 md:right-6 z-40 h-11 px-4 bg-[#111113] hover:bg-[#1a1a1f] border border-[#222] rounded-2xl flex items-center justify-center gap-2 text-sm font-semibold text-white shadow-[0_0_15px_rgba(0,0,0,0.45)] transition-transform hover:scale-[1.02] hover:border-slate-600"
      >
        <span>💬</span>
        <span>{controller.lang === 'TR' ? 'Geri Bildirim' : 'Feedback'}</span>
      </button>

      {controller.toast && (
        <div className="fixed bottom-20 md:bottom-6 left-1/2 -translate-x-1/2 md:left-auto md:-translate-x-0 md:right-6 z-[100] animate-bounce-in w-[90%] sm:w-auto">
          <div className={`px-4 md:px-6 py-3 md:py-4 rounded-xl shadow-2xl border text-sm font-bold backdrop-blur-md text-center md:text-left ${controller.toast.type === 'error' ? 'bg-[#1a0f0f]/90 border-red-900/50 text-red-400' : controller.toast.type === 'info' ? 'bg-[#0a1a2a]/90 border-blue-900/50 text-blue-400' : 'bg-[#0a1a10]/90 border-emerald-900/50 text-emerald-400'}`}>
            {controller.toast.message}
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
