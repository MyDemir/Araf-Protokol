export const tradeTermsCopy = {
  order: { TR: 'Emir', EN: 'Order' },
  myOrders: { TR: 'Emirlerim', EN: 'My Orders' },
  createOrder: { TR: 'Emir Oluştur', EN: 'Create Order' },
  gracePeriod: { TR: 'Onay süresi', EN: 'Grace period' },
  bleedingEscrow: { TR: 'Eriyen emanet', EN: 'Bleeding escrow' },
  releaseFunds: { TR: 'Ödemeyi Onayla', EN: 'Release Funds' },
  release: { TR: 'Serbest Bırak', EN: 'Release' },
  burn: { TR: 'Yak', EN: 'Burn' },
  burnExpiredTrade: { TR: 'Süre Aşımı Yakımı', EN: 'Burn Expired Trade' },
  settlement: { TR: 'Uzlaşma', EN: 'Settlement' },
};

export const getTradeTerm = (key, lang = 'EN') => {
  const row = tradeTermsCopy[key];
  if (!row) return key;
  return row[lang === 'TR' ? 'TR' : 'EN'] || row.EN || row.TR || key;
};

export default tradeTermsCopy;
