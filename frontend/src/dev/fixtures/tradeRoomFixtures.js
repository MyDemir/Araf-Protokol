const baseTimer = { isFinished: false, days: 0, hours: 3, minutes: 24, seconds: 12 };
const expiredTimer = { isFinished: true, days: 0, hours: 0, minutes: 0, seconds: 0 };

export const uiLabBaseTrade = {
  id: '#LAB-1001',
  onchainId: '1001',
  state: 'LOCKED',
  role: 'taker',
  maker: '0xMaker000000000000000000000000000000000001',
  taker: '0xTaker000000000000000000000000000000000001',
  amount: '125.00 USDT',
  crypto: 'USDT',
  fiat: 'TRY',
  chargebackAcked: true,
  settlementProposal: null,
  _pendingBackendSync: false,
};

export const normalTimers = {
  gracePeriod: baseTimer,
  makerPing: { isFinished: false, days: 1, hours: 4, minutes: 0, seconds: 0 },
  makerChallengePing: { isFinished: false, days: 0, hours: 20, minutes: 15, seconds: 0 },
  makerChallenge: { isFinished: false, days: 2, hours: 2, minutes: 0, seconds: 0 },
  bleeding: { isFinished: false, days: 8, hours: 0, minutes: 0, seconds: 0 },
  principalProtection: { isFinished: false, days: 5, hours: 0, minutes: 0, seconds: 0 },
};

export const expiredTimers = Object.fromEntries(Object.keys(normalTimers).map((key) => [key, expiredTimer]));

const scenario = (id, label, overrides = {}) => ({
  id,
  label,
  category: 'tradeRoom',
  decisionInput: {
    trade: { ...uiLabBaseTrade, id: `#${id}`, onchainId: id.replace(/\D/g, '') || '1001', state: overrides.tradeState || 'LOCKED', role: overrides.userRole || 'taker', ...(overrides.trade || {}) },
    tradeState: overrides.tradeState || 'LOCKED',
    userRole: overrides.userRole || 'taker',
    paymentIpfsHash: overrides.paymentIpfsHash || '',
    timers: overrides.timers || normalTimers,
    isConnected: overrides.isConnected ?? true,
    isAuthenticated: overrides.isAuthenticated ?? true,
    isSupportedChain: overrides.isSupportedChain ?? true,
    isPaused: overrides.isPaused ?? false,
    lang: 'EN',
    canBurnExpired: overrides.canBurnExpired ?? false,
  },
});

export const tradeRoomScenarios = [
  scenario('locked-taker', 'LOCKED / taker', { tradeState: 'LOCKED', userRole: 'taker' }),
  scenario('locked-maker', 'LOCKED / maker', { tradeState: 'LOCKED', userRole: 'maker' }),
  scenario('paid-taker', 'PAID / taker', { tradeState: 'PAID', userRole: 'taker', paymentIpfsHash: 'ipfs://proof-paid' }),
  scenario('paid-maker', 'PAID / maker', { tradeState: 'PAID', userRole: 'maker', paymentIpfsHash: 'ipfs://proof-paid' }),
  scenario('challenged-taker', 'CHALLENGED / taker', { tradeState: 'CHALLENGED', userRole: 'taker', paymentIpfsHash: 'ipfs://proof-challenged' }),
  scenario('challenged-maker', 'CHALLENGED / maker', { tradeState: 'CHALLENGED', userRole: 'maker', paymentIpfsHash: 'ipfs://proof-challenged' }),
  scenario('wrong-chain', 'Wrong chain', { isSupportedChain: false, paymentIpfsHash: 'ipfs://proof' }),
  scenario('paused-system', 'Paused system', { isPaused: true, paymentIpfsHash: 'ipfs://proof' }),
  scenario('unauthenticated', 'Unauthenticated', { isAuthenticated: false, isConnected: false }),
  scenario('missing-payment-proof', 'Missing payment proof', { tradeState: 'LOCKED', userRole: 'taker', paymentIpfsHash: '' }),
  scenario('with-payment-proof', 'With payment proof', { tradeState: 'LOCKED', userRole: 'taker', paymentIpfsHash: 'ipfs://proof-ready' }),
  scenario('can-burn-expired', 'Can burn expired', { tradeState: 'CHALLENGED', userRole: 'taker', canBurnExpired: true, timers: expiredTimers }),
  scenario('timers-normal', 'Timers normal', { timers: normalTimers }),
  scenario('timers-expired-critical', 'Timers expired / critical', { timers: expiredTimers, canBurnExpired: true, tradeState: 'CHALLENGED' }),
];
