export const APP_LANG_STORAGE_KEY = 'araf_lang';
export const TERMS_ACCEPTED_STORAGE_KEY = 'araf_terms_accepted';

// [TR] İlk dil kararını SSR-safe şekilde hesaplar:
//      1) localStorage tercihi (EN/TR) 2) yoksa EN fallback.
// [EN] Computes initial language in an SSR-safe way:
//      1) persisted localStorage preference (EN/TR) 2) fallback EN.
export const getInitialLang = () => {
  if (typeof window === 'undefined') return 'EN';
  const savedLang = window.localStorage.getItem(APP_LANG_STORAGE_KEY);
  if (savedLang === 'TR' || savedLang === 'EN') return savedLang;
  return 'EN';
};

// [TR] Kullanım koşulları kabul bilgisini localStorage'dan hydrate eder (SSR-safe).
// [EN] Hydrates terms acceptance state from localStorage (SSR-safe).
export const getInitialTermsAccepted = () => {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem(TERMS_ACCEPTED_STORAGE_KEY) === 'true';
};
