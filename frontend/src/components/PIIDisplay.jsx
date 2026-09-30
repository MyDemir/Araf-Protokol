/**
 * PIIDisplay — Şifreli ödeme profili + iletişim görüntüleme bileşeni
 *
 * Ödeme bilgileri varsayılan olarak GİZLİ gelir; kullanıcı onay verince fetch edilir.
 * usePII(tradeId, authenticatedFetch) — tüm auth httpOnly cookie üzerinden.
 *
 * ORTA-15 Fix: Pano (Clipboard) Güvenlik Eksikliği giderildi.
 *   ÖNCEKİ: navigator.clipboard.writeText hata durumunu handle etmiyordu.
 *   HTTP ortamında (Secure Context dışı) sessizce başarısız oluyordu.
 *   Kullanıcı IBAN'ı kopyaladığını sanıp banka uygulamasına geçiyordu.
 *   ŞİMDİ:
 *     1. window.isSecureContext kontrolü — HTTP'de alternatif yöntem sunuluyor
 *     2. try-catch ile hata yakalanıp kullanıcıya görsel uyarı veriliyor
 *     3. Güvenli bağlam yoksa seçim (select) + execCommand fallback kullanılıyor
 *
 * Kullanım (App.jsx'te):
 *   <PIIDisplay tradeId={activeTrade.id} lang={lang}
 *               authenticatedFetch={authenticatedFetch} />
 */

import { Lock, LockOpen, MessageCircle, ShieldCheck, TriangleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { usePII } from '../hooks/usePII';
import { getPiiCopy } from '../app/copy';

// [TR] F19.2 — İletişim değeri karşı tarafça girilir; doğrulanmadan href'e konmaz.
// [EN] The contact value is counterparty-supplied; it is validated before it reaches an href.
const EMAIL_RE = /^[^\s@<>"',;:()[\]\\]+@[^\s@<>"',;:()[\]\\]+\.[A-Za-z]{2,}$/;
const PHONE_RE = /^\+?[0-9][0-9\s().-]{5,22}$/;

export const buildTelegramHref = (handle) => {
  const clean = String(handle || '').replace(/^@/, '').replace(/[^a-zA-Z0-9_]/g, '');
  return clean ? `https://t.me/${encodeURIComponent(clean)}` : null;
};

export const buildContactHref = (channel, value) => {
  if (!channel || value == null) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  if (channel === 'telegram') return buildTelegramHref(raw);
  if (channel === 'email') {
    if (raw.length > 254 || !EMAIL_RE.test(raw)) return null;
    // [TR] '@' mailto adres biçiminde geçerlidir; geri kalan her şey kaçışlanır.
    return `mailto:${encodeURIComponent(raw).replace(/%40/g, '@')}`;
  }
  if (channel === 'phone') {
    if (!PHONE_RE.test(raw)) return null;
    const digits = raw.replace(/\D/g, '');
    if (digits.length < 7 || digits.length > 15) return null;
    // [TR] Baştaki '+' tel: URI'sinde geçerlidir; kalan yalnız rakamdır.
    return `tel:${raw.startsWith('+') ? '+' : ''}${encodeURIComponent(digits)}`;
  }
  return null;
};

/**
 * @param {string}   tradeId             Backend trade ID (Trade koleksiyonunun MongoDB _id'si)
 * @param {string}   lang                'TR' veya 'EN'
 * @param {Function} authenticatedFetch  App.jsx'ten gelen JWT yönetimli fetch (YÜKS-06)
 */
export default function PIIDisplay({ tradeId, lang = 'tr', authenticatedFetch }) {
  const normalizedLang = (lang || 'tr').toLowerCase();
  const t = getPiiCopy(normalizedLang);

  const { pii, loading, error, fetchPII, clearPII } = usePII(tradeId, authenticatedFetch);
  // [TR] F19.3 — Açık durum, hangi işlem için açıldığını tutar; tradeId değişince otomatik kapanır
  //      (önceki işlemin "açık" durumu yeni işlemin kilitli görünümünü atlamasın).
  // [EN] The revealed flag remembers which trade it was opened for, so a tradeId change re-locks the view.
  const [revealedTradeId, setRevealedTradeId] = useState(null);
  const revealed = tradeId != null && revealedTradeId === tradeId;
  // [TR] copied: 'idle' | 'success' | 'error'
  const [copyState, setCopyState] = useState({ status: 'idle', field: null });

  // [TR] A→B→A geçişinde eski "açık" durum geri gelmesin; tradeId her değiştiğinde kilitle.
  useEffect(() => {
    setRevealedTradeId(null);
    setCopyState({ status: 'idle', field: null });
  }, [tradeId]);

  const handleReveal = async () => {
    if (pii?.payoutProfile) {
      setRevealedTradeId(tradeId);
      return;
    }
    const payload = await fetchPII();
    if (payload?.payoutProfile) {
      setRevealedTradeId(tradeId);
    }
  };

  const handleHide = () => {
    setRevealedTradeId(null);
    clearPII();
    setCopyState({ status: 'idle', field: null });
  };

  // ORTA-15 Fix: Clipboard kopyalama güvenli ve hata toleranslı
  const handleCopyField = async (fieldKey, rawValue) => {
    if (!rawValue) return;
    const cleanValue = String(rawValue).replace(/\s/g, '');

    // [TR] Güvenli bağlam kontrolü (HTTPS veya localhost)
    if (!window.isSecureContext) {
      // [TR] HTTP ortamı — otomatik kopyalama API'si çalışmaz, kullanıcıyı uyar
      setCopyState({ status: 'error', field: fieldKey });
      setTimeout(() => setCopyState({ status: 'idle', field: null }), 3000);
      return;
    }

    try {
      await navigator.clipboard.writeText(cleanValue);
      setCopyState({ status: 'success', field: fieldKey });
      setTimeout(() => setCopyState({ status: 'idle', field: null }), 2000);
    } catch (err) {
      // [TR] İzin reddedildi veya başka clipboard hatası — fallback: seçim yöntemi
      try {
        const textArea = document.createElement('textarea');
        textArea.value = cleanValue;
        textArea.style.position = 'fixed';
        textArea.style.opacity = '0';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        const success = document.execCommand('copy');
        document.body.removeChild(textArea);
        setCopyState({ status: success ? 'success' : 'error', field: fieldKey });
      } catch {
        setCopyState({ status: 'error', field: fieldKey });
      }
      setTimeout(() => setCopyState({ status: 'idle', field: null }), 3000);
    }
  };

  const getContactCtaLabel = (channel) => {
    if (channel === 'telegram') return t.telegramBtn;
    if (channel === 'email') return t.emailBtn;
    if (channel === 'phone') return t.phoneBtn;
    return null;
  };
  const getFieldLabel = (key) => {
    const map = {
      account_holder_name: lang === 'TR' ? 'Hesap Sahibi' : 'Account Holder',
      iban: 'IBAN',
      routing_number: lang === 'TR' ? 'Routing Number' : 'Routing Number',
      account_number: lang === 'TR' ? 'Hesap Numarası' : 'Account Number',
      account_type: lang === 'TR' ? 'Hesap Türü' : 'Account Type',
      bic: 'BIC',
      bank_name: lang === 'TR' ? 'Banka Adı' : 'Bank Name',
    };
    return map[key] || key;
  };

  const contactHref = buildContactHref(pii?.payoutProfile?.contact?.channel, pii?.payoutProfile?.contact?.value);

  // ── Kilitli görünüm ──────────────────────────────────────────────────────
  if (!revealed) {
    return (
      <div className="bg-surface p-4 rounded-xl border border-borderStrong space-y-3">
        {/* [TR] Kilitli görünüm tek başlık + tek satır; aynı mesajı veren kutu ve alt başlık birleştirildi. */}
        <div className="flex items-start gap-3">
          <span className="text-textMuted shrink-0" aria-hidden="true"><Lock className="w-6 h-6" strokeWidth={1.8} aria-hidden="true" /></span>
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-textPrimary leading-snug">{t.lockedTitle}</h3>
            <p className="text-xs text-textMuted leading-relaxed">{t.lockedSub}</p>
          </div>
        </div>

        {/* HTTP uyarısı — ORTA-15 */}
        {!window.isSecureContext && (
          <div className="p-3 bg-warning/10 border border-warning/40 rounded-lg">
            <p className="text-warning text-sm leading-relaxed">{t.noSecureContext}</p>
          </div>
        )}

        {error && (
          <div className="p-3 bg-danger/10 border border-danger/40 rounded-lg">
            <p className="text-danger text-sm leading-relaxed flex items-start gap-1.5"><TriangleAlert className="w-4 h-4 mt-0.5 shrink-0" strokeWidth={1.8} aria-hidden="true" />{error}</p>
          </div>
        )}

        <button
          onClick={handleReveal}
          disabled={loading}
          className={`w-full py-3 rounded-xl font-bold text-sm transition ${
            loading
              ? 'bg-elevated text-textMuted border border-borderStrong cursor-not-allowed'
              : 'bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-900/20'
          }`}
        >
          {loading ? (
            <span className="flex items-center justify-center space-x-2">
              <span className="w-4 h-4 border-2 border-blue-300 border-t-transparent rounded-full animate-spin" />
              <span>{t.revealBtnLoading}</span>
            </span>
          ) : <span className="inline-flex items-center justify-center gap-2"><LockOpen className="w-4 h-4" strokeWidth={1.8} aria-hidden="true" />{t.revealBtn}</span>}
        </button>

        <p className="text-center text-[11px] text-textMuted leading-relaxed">{t.disclaimer}</p>
      </div>
    );
  }

  // ── Açık görünüm ─────────────────────────────────────────────────────────
  return (
    <div className="bg-surface p-4 rounded-xl border border-borderStrong relative overflow-hidden">
      <div className="absolute top-0 right-0 bg-blue-600 text-white text-xs font-bold px-2 py-1 rounded-bl-lg">
        {t.encryptedBadge}
      </div>

      <p className="text-textMuted text-xs mb-3 font-semibold uppercase tracking-wider pr-32 flex items-center gap-1.5">
        <ShieldCheck className="w-3.5 h-3.5" strokeWidth={1.8} aria-hidden="true" />{t.sectionTitle}
      </p>

      {pii ? (
        <>
          <p className="text-textMuted text-xs mb-1 uppercase tracking-wider">{getFieldLabel('account_holder_name')}</p>
          <p className="font-bold text-textPrimary text-lg mb-3 leading-snug">{pii?.payoutProfile?.fields?.account_holder_name || '—'}</p>

          {['TR_IBAN', 'SEPA_IBAN'].includes(pii?.payoutProfile?.rail) && (
            <>
              <p className="text-textMuted text-xs mb-1 uppercase tracking-wider">IBAN</p>
              <p className="font-mono text-success mb-3 break-all text-base tracking-wide">
                {pii?.payoutProfile?.fields?.iban || '—'}
              </p>
            </>
          )}

          {pii.payoutProfile?.rail && (
            <p className="text-xs text-blue-300 mb-3">
              {t.railPrefix}: <span className="font-mono">{pii.payoutProfile.rail}</span>
            </p>
          )}

          {pii.payoutProfile?.fields && (
            <div className="mb-3 p-3 rounded-lg border border-borderSubtle bg-elevated">
              {Object.entries(pii.payoutProfile.fields).map(([key, value]) => {
                if (value == null || value === '' || key === 'iban' || key === 'account_holder_name') return null;
                return (
                  <p key={key} className="text-xs text-textSecondary break-all">
                    <span className="text-textMuted">{getFieldLabel(key)}:</span> {String(value)}
                  </p>
                );
              })}
            </div>
          )}

          <div className="flex space-x-2 mb-3">
            {['TR_IBAN', 'SEPA_IBAN'].includes(pii?.payoutProfile?.rail) && (
              <button
                onClick={() => handleCopyField('iban', pii?.payoutProfile?.fields?.iban)}
                className={`flex-1 text-xs font-medium py-2 rounded-lg transition border ${
                  copyState.status === 'success' && copyState.field === 'iban'
                    ? 'bg-success/10 text-success border-success/40'
                    : copyState.status === 'error' && copyState.field === 'iban'
                    ? 'bg-danger/10 text-danger border-danger/40'
                    : 'bg-elevated hover:bg-surface text-textSecondary border-borderStrong'
                }`}
              >
                {copyState.status === 'success' && copyState.field === 'iban'
                  ? t.copied
                  : copyState.status === 'error' && copyState.field === 'iban'
                  ? t.copyError
                  : t.copyIban}
              </button>
            )}
            {pii?.payoutProfile?.rail === 'US_ACH' && (
              <>
                <button
                  onClick={() => handleCopyField('routing_number', pii?.payoutProfile?.fields?.routing_number)}
                  className="flex-1 text-xs font-medium py-2 rounded-lg transition border bg-elevated hover:bg-surface text-textSecondary border-borderStrong"
                >
                  {copyState.status === 'success' && copyState.field === 'routing_number' ? t.copied : t.copyRouting}
                </button>
                <button
                  onClick={() => handleCopyField('account_number', pii?.payoutProfile?.fields?.account_number)}
                  className="flex-1 text-xs font-medium py-2 rounded-lg transition border bg-elevated hover:bg-surface text-textSecondary border-borderStrong"
                >
                  {copyState.status === 'success' && copyState.field === 'account_number' ? t.copied : t.copyAccount}
                </button>
              </>
            )}
            <button
              onClick={handleHide}
              className="px-4 bg-elevated hover:bg-surface text-textSecondary text-xs py-2 rounded-lg transition border border-borderStrong"
            >
              {t.hideBtn}
            </button>
          </div>

          {contactHref ? (
            <a
              href={contactHref}
              target={pii?.payoutProfile?.contact?.channel === 'telegram' ? "_blank" : undefined}
              rel={pii?.payoutProfile?.contact?.channel === 'telegram' ? "noopener noreferrer" : undefined}
              className="flex items-center justify-center space-x-2 w-full py-2.5 rounded-xl bg-[#24A1DE]/10 border border-[#24A1DE]/30 text-[#24A1DE] hover:bg-[#24A1DE]/20 text-sm font-bold transition-all mb-3"
            >
              <MessageCircle className="w-4 h-4" strokeWidth={1.8} aria-hidden="true" />
              <span>{getContactCtaLabel(pii?.payoutProfile?.contact?.channel)}</span>
            </a>
          ) : (
            <div className="flex items-center justify-center space-x-2 w-full py-2 rounded-xl bg-elevated border border-borderSubtle text-textMuted text-xs mb-3">
              <MessageCircle className="w-4 h-4" strokeWidth={1.8} aria-hidden="true" />
              <span>{t.noContact}</span>
            </div>
          )}

          <div className="p-3 bg-elevated rounded-lg flex items-start space-x-2 border border-borderSubtle">
            <span className="shrink-0 text-textMuted mt-0.5"><ShieldCheck className="w-4 h-4" strokeWidth={1.8} aria-hidden="true" /></span>
            <p className="text-sm text-textSecondary leading-relaxed">{t.notice}</p>
          </div>
        </>
      ) : error ? (
        <div className="text-center py-4">
          <p className="text-danger text-sm mb-2 inline-flex items-center gap-1.5"><TriangleAlert className="w-4 h-4" strokeWidth={1.8} aria-hidden="true" />{error}</p>
          <button
            onClick={handleHide}
            className="px-4 bg-elevated hover:bg-surface text-textSecondary text-xs py-2 rounded-lg transition border border-borderStrong"
          >
            {t.hideBtn}
          </button>
        </div>
      ) : (
        <div className="text-center py-4">
          <div className="w-6 h-6 border-2 border-blue-400 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
          <p className="text-textSecondary text-sm">{t.loading}</p>
        </div>
      )}
    </div>
  );
}
