import React from 'react';
import { actions, admin, errors, orderSide, paymentRisk, profile, rewards, settlement, states } from '../copy';

// PII copy uses a language-bucket shape (`tr`/`en` objects) consumed by getPiiCopy,
// not the row-based `{ TR, EN }` dictionary shape expected by getCopy/CopyProvider.
const dictionaries = {
  states,
  actions,
  orderSide,
  settlement,
  paymentRisk,
  profile,
  rewards,
  admin,
  errors,
};

export const getCopy = (dict, key, lang = 'EN') => {
  const row = dict?.[key];
  if (!row) return key;
  return row[lang === 'TR' ? 'TR' : 'EN'] || row.EN || row.TR || key;
};

const CopyContext = React.createContext({ dictionaries, getCopy });

export const CopyProvider = ({ children }) => {
  const value = React.useMemo(() => ({ dictionaries, getCopy }), []);
  return <CopyContext.Provider value={value}>{children}</CopyContext.Provider>;
};

export const useCopy = () => React.useContext(CopyContext);

export default CopyProvider;
