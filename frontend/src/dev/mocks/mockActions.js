export const UI_LAB_ACTION_KEYS = [
  'report_payment',
  'release_funds',
  'start_challenge',
  'ping_maker',
  'auto_release',
  'propose_cancel',
  'burn_expired',
];

export const createUiLabActionLogger = ({ scenarioId, appendLog }) => (actionKey, details = {}) => {
  const entry = {
    actionKey,
    scenarioId,
    timestamp: new Date().toISOString(),
    details,
  };
  if (typeof appendLog === 'function') appendLog(entry);
  return entry;
};

export const createTradeRoomActionCallbacks = ({ scenarioId, appendLog, disabled = false } = {}) => {
  const log = createUiLabActionLogger({ scenarioId, appendLog });
  return UI_LAB_ACTION_KEYS.reduce((acc, key) => {
    acc[key] = {
      onClick: () => log(key),
      disabled,
    };
    return acc;
  }, {});
};

export const createSetterAction = ({ scenarioId, appendLog, actionKey }) => (...args) => {
  createUiLabActionLogger({ scenarioId, appendLog })(actionKey, { args });
};
