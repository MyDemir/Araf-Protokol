export const stateCopy = {
  ALL: { TR: 'Tümü', EN: 'All' },
  LOCKED: { TR: 'Kilitli', EN: 'Locked' },
  PAID: { TR: 'Ödeme Bildirildi', EN: 'Payment Reported' },
  CHALLENGED: { TR: 'İtiraz Süreci', EN: 'Challenge Phase' },
  RESOLVED: { TR: 'Çözüldü', EN: 'Resolved' },
  CANCELED: { TR: 'İptal', EN: 'Canceled' },
  BURNED: { TR: 'Yakıldı', EN: 'Burned' },
};

export const stateDescriptiveCopy = {
  ALL: { TR: 'Tüm İşlemler', EN: 'All Trades' },
  LOCKED: { TR: 'Kilitli İşlem', EN: 'Locked Trade' },
  PAID: { TR: 'Ödeme Bildirilmiş İşlem', EN: 'Payment Reported Trade' },
  CHALLENGED: { TR: 'İtiraz Sürecindeki İşlem', EN: 'Challenge Phase Trade' },
  RESOLVED: { TR: 'Çözülmüş İşlem', EN: 'Resolved Trade' },
  CANCELED: { TR: 'İptal Edilmiş İşlem', EN: 'Canceled Trade' },
  BURNED: { TR: 'Yakılmış İşlem', EN: 'Burned Trade' },
};

const pickLang = (lang) => (lang === 'TR' ? 'TR' : 'EN');

export const getStateLabel = (state, lang = 'EN', variant = 'short') => {
  const key = String(state || '').toUpperCase();
  const dictionary = variant === 'descriptive' ? stateDescriptiveCopy : stateCopy;
  const row = dictionary[key] || stateCopy[key];
  if (!row) return state || '—';
  const locale = pickLang(lang);
  return row[locale] || row.EN || row.TR || state || '—';
};

export default stateCopy;
