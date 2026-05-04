import React from 'react';
import stateCopy from '../copy/states';
import actionCopy from '../copy/actions';
import orderSideCopy from '../copy/orderSide';
import settlementCopy from '../copy/settlement';
import paymentRiskCopy from '../copy/paymentRisk';
import profileCopy from '../copy/profile';
import rewardsCopy from '../copy/rewards';
import adminCopy from '../copy/admin';
import errorCopy from '../copy/errors';

const dictionaries = {
  states: stateCopy,
  actions: actionCopy,
  orderSide: orderSideCopy,
  settlement: settlementCopy,
  paymentRisk: paymentRiskCopy,
  profile: profileCopy,
  rewards: rewardsCopy,
  admin: adminCopy,
  errors: errorCopy,
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
