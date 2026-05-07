export const paymentRiskCopy = {
  LOW: { TR: 'Düşük', EN: 'Low' },
  MEDIUM: { TR: 'Orta', EN: 'Medium' },
  HIGH: { TR: 'Yüksek', EN: 'High' },
  RESTRICTED: { TR: 'Kısıtlı', EN: 'Restricted' },
};

export const paymentRiskSummaryCopy = {
  title: {
    TR: 'Ödeme yöntemi karmaşıklığı',
    EN: 'Payment method complexity',
  },
  compactTitle: {
    TR: 'Ödeme karmaşıklığı',
    EN: 'Payment complexity',
  },
  subtitle: {
    TR: 'Ödeme yönteminin operasyonel iş yükünü gösterir.',
    EN: 'Shows operational handling for the payment method.',
  },
  operationalExplanation: {
    TR: 'Bu sinyal ödeme yönteminin operasyonel iş yükünü ve işlem adımlarını özetler.',
    EN: 'This signal summarizes operational workload and handling steps for the payment method.',
  },
  notTrustScore: {
    TR: 'Kullanıcı veya karşı taraf güven puanı değildir; escrow sonucunu belirlemez.',
    EN: 'Not a user trust score or counterparty trust score; it does not decide escrow outcomes.',
  },
  genericWarning: {
    TR: 'Genel payment config; bu order’a özel rail sinyali değildir.',
    EN: 'Generic payment config; this is not an order-specific rail signal.',
  },
  previewOnly: {
    TR: 'Preview/config only: Bu değerler kontrat hükmü değildir; nihai authority on-chain kurallardır.',
    EN: 'Preview/config only: These values are not contract authority; final authority remains on-chain rules.',
  },
  restrictedAvailability: {
    TR: 'Bu durum frontend/backend availability config sinyalidir; settlement/release authority kontratta kalır.',
    EN: 'This is a frontend/backend availability config signal; settlement/release authority remains on-chain.',
  },
  disclosureButton: {
    TR: 'Teknik açıklamayı göster',
    EN: 'Show technical disclosure',
  },
  hideDisclosureButton: {
    TR: 'Teknik açıklamayı gizle',
    EN: 'Hide technical disclosure',
  },
  disclosureTitle: {
    TR: 'Teknik açıklama',
    EN: 'Technical disclosure',
  },
  disclosureIntro: {
    TR: 'Aşağıdaki alanlar config/debug bağlamıdır; kullanıcı güveni veya settlement otoritesi değildir.',
    EN: 'The fields below are config/debug context; they are not user trust or settlement authority.',
  },
};

export const getPaymentRiskLevelLabel = (riskLevel, lang = 'TR') => {
  const normalized = String(riskLevel || 'MEDIUM').toUpperCase();
  const row = paymentRiskCopy[normalized] || paymentRiskCopy.MEDIUM;
  return row[lang === 'TR' ? 'TR' : 'EN'] || row.EN || row.TR;
};

export const getPaymentRiskSummaryCopy = (key, lang = 'TR') => {
  const row = paymentRiskSummaryCopy[key];
  if (!row) return '';
  return row[lang === 'TR' ? 'TR' : 'EN'] || row.EN || row.TR || '';
};

export default paymentRiskCopy;
