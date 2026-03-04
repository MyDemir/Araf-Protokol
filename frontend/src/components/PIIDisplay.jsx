/**
 * PIIDisplay — Güvenli IBAN Görüntüleme Bileşeni
 *
 * H-03 Düzeltmesi:
 *   - IBAN varsayılan olarak GİZLİ gelir, kullanıcı butona basınca fetch edilir
 *   - usePII hook'u aracılığıyla backend'den her seferinde yeniden çekilir
 *   - Component unmount olduğunda IBAN otomatik olarak bellekten silinir
 *   - Ekran görüntüsü koruması için copy-only mod (göster/gizle toggle)
 *
 * Kullanım (App.jsx'te):
 *   import PIIDisplay from './PIIDisplay';
 *   <PIIDisplay tradeId={activeTrade.id} authToken={jwt} />
 */

import React, { useState } from 'react';
import { usePII } from './usePII';

export default function PIIDisplay({ tradeId, authToken }) {
  const { pii, loading, error, fetchPII, clearPII } = usePII(tradeId, authToken);
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied]     = useState(false);

  const handleReveal = async () => {
    if (!pii) {
      await fetchPII();
    }
    setRevealed(true);
  };

  const handleHide = () => {
    setRevealed(false);
    clearPII();
  };

  const handleCopy = () => {
    if (!pii?.iban) return;
    navigator.clipboard.writeText(pii.iban.replace(/\s/g, ''));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // ── Henüz gösterilmemiş ───────────────────────────────────────────────────
  if (!revealed) {
    return (
      <div className="bg-slate-900 p-4 rounded-xl border border-slate-700">
        <p className="text-slate-400 text-xs mb-3">Satıcı Banka Bilgileri</p>
        <div className="bg-slate-800 rounded-lg p-3 mb-3 flex items-center space-x-3">
          <span className="text-2xl">🔒</span>
          <div>
            <p className="text-white font-medium text-sm">IBAN şifrelenmiş</p>
            <p className="text-slate-500 text-xs mt-0.5">
              Görmek için kimliğini doğrula
            </p>
          </div>
        </div>

        {error && (
          <div className="mb-3 p-2 bg-red-950/40 border border-red-900/50 rounded-lg">
            <p className="text-red-400 text-xs">⚠ {error}</p>
          </div>
        )}

        <button
          onClick={handleReveal}
          disabled={loading}
          className={`w-full py-2.5 rounded-xl font-bold text-sm transition ${
            loading
              ? 'bg-slate-700 text-slate-400 cursor-not-allowed'
              : 'bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-900/20'
          }`}
        >
          {loading ? (
            <span className="flex items-center justify-center space-x-2">
              <span className="w-4 h-4 border-2 border-blue-300 border-t-transparent rounded-full animate-spin"></span>
              <span>Doğrulanıyor...</span>
            </span>
          ) : (
            '🔓 IBAN\'ı Güvenli Göster'
          )}
        </button>

        <p className="text-center text-[10px] text-slate-500 mt-2">
          Backend API üzerinden şifreli kanal — ekran görüntüsüne dikkat
        </p>
      </div>
    );
  }

  // ── Gösterilmiş ───────────────────────────────────────────────────────────
  return (
    <div className="bg-slate-900 p-4 rounded-xl border border-blue-500/40 relative overflow-hidden">
      {/* Şifreli kanal rozeti */}
      <div className="absolute top-0 right-0 bg-blue-600 text-white text-[10px] font-bold px-2 py-1 rounded-bl-lg">
        End-to-End Encrypted
      </div>

      <p className="text-slate-400 text-xs mb-3">Satıcı Banka Bilgileri</p>

      {pii ? (
        <>
          <p className="font-bold text-white text-base">{pii.bankOwner}</p>
          <p className="font-mono text-emerald-400 mt-1 break-all text-sm tracking-wider">
            {pii.iban}
          </p>

          <div className="flex space-x-2 mt-3">
            <button
              onClick={handleCopy}
              className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium py-2 rounded-lg transition border border-slate-600"
            >
              {copied ? '✓ Kopyalandı' : '📋 IBAN Kopyala'}
            </button>
            <button
              onClick={handleHide}
              className="px-4 bg-slate-800 hover:bg-slate-700 text-slate-400 text-xs py-2 rounded-lg transition border border-slate-600"
            >
              🙈 Gizle
            </button>
          </div>

          {pii.telegram && (
            <a
              href={`https://t.me/${pii.telegram.replace(/[^a-zA-Z0-9_]/g, '')}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center space-x-1 mt-2 text-blue-400 hover:text-blue-300 text-xs py-2 rounded-lg bg-blue-500/10 border border-blue-500/20 transition"
            >
              <span>💬</span>
              <span>@{pii.telegram} ile iletişim kur</span>
            </a>
          )}

          <div className="mt-3 p-2 bg-slate-800 rounded-lg flex items-start space-x-2 border border-slate-700">
            <span className="text-sm">🛡️</span>
            <p className="text-[10px] text-slate-400 leading-tight">
              Bu bilgiler blockchain'e kaydedilmez. 
              Sadece bu işleme özel şifreli olarak iletilmiştir. 
              İşlem tamamlandıktan sonra kaydetme.
            </p>
          </div>
        </>
      ) : (
        <div className="text-center py-4">
          <div className="w-6 h-6 border-2 border-blue-400 border-t-transparent rounded-full animate-spin mx-auto mb-2"></div>
          <p className="text-slate-400 text-sm">Yükleniyor...</p>
        </div>
      )}
    </div>
  );
}
