const express = require('express');
const request = require('supertest');

process.env.BASE_RPC_URL = 'http://localhost:8545';
process.env.EXPECTED_CHAIN_ID = '84532';
process.env.ARAF_ESCROW_ADDRESS = '0x' + '22'.repeat(20);
const mockRoomReadLimiter = jest.fn((_req, _res, next) => next());
const mockCoordinationWriteLimiter = jest.fn((_req, _res, next) => next());

jest.mock('../scripts/middleware/auth', () => ({
  requireAuth: (req, _res, next) => {
    req.wallet = '0x1111111111111111111111111111111111111111';
    next();
  },
  requireSessionWalletMatch: (_req, _res, next) => next(),
}));

jest.mock('../scripts/middleware/rateLimiter', () => ({
  roomReadLimiter: (...args) => mockRoomReadLimiter(...args),
  coordinationWriteLimiter: (...args) => mockCoordinationWriteLimiter(...args),
}));

jest.mock('../scripts/models/User', () => ({
  find: jest.fn().mockResolvedValue([]),
}));

const buildTradeDoc = (status = 'LOCKED') => ({
  onchain_escrow_id: 42,
  status,
  maker_address: '0x1111111111111111111111111111111111111111',
  taker_address: '0x3333333333333333333333333333333333333333',
  cancel_proposal: {},
  save: jest.fn().mockResolvedValue(),
});

let mockTradeDoc = buildTradeDoc('LOCKED');

jest.mock('../scripts/models/Trade', () => ({
  findById: jest.fn().mockImplementation(() => Promise.resolve(mockTradeDoc)),
}));

jest.mock('../scripts/routes/tradeRisk', () => ({
  buildBankProfileRisk: () => ({ level: 'LOW' }),
}));

const mockAssertProviderExpectedChainOrThrow = jest.fn().mockResolvedValue();
jest.mock('../scripts/services/expectedChain', () => ({
  assertProviderExpectedChainOrThrow: (...args) => mockAssertProviderExpectedChainOrThrow(...args),
}));

const mockSigNonces = jest.fn().mockResolvedValue(0n);
const mockVerifyTypedData = jest.fn().mockReturnValue('0x1111111111111111111111111111111111111111');
const mockHashDomain = jest.fn().mockReturnValue('0x' + 'aa'.repeat(32));
const mockContractCtor = jest.fn(function (address) {
  return {
    _address: address,
    sigNonces: mockSigNonces,
    domainSeparator: jest.fn().mockResolvedValue('0x' + 'aa'.repeat(32)),
  };
});

jest.mock('ethers', () => ({
  ethers: {
    JsonRpcProvider: jest.fn(() => ({
      getNetwork: jest.fn().mockResolvedValue({ chainId: 84532n }),
    })),
    Contract: mockContractCtor,
    verifyTypedData: (...args) => mockVerifyTypedData(...args),
    TypedDataEncoder: { hashDomain: (...args) => mockHashDomain(...args) },
  },
}));

const router = require('../scripts/routes/trades');

describe('POST /api/trades/propose-cancel signature verification', () => {
  beforeEach(() => {
    mockTradeDoc = buildTradeDoc('LOCKED');
    mockSigNonces.mockClear();
    mockVerifyTypedData.mockClear();
    mockHashDomain.mockClear();
    mockContractCtor.mockClear();
    mockAssertProviderExpectedChainOrThrow.mockClear();
    mockRoomReadLimiter.mockClear();
    mockCoordinationWriteLimiter.mockClear();
    router.__resetCancelVerifier?.();
    process.env.EXPECTED_CHAIN_ID = '84532';
  });

  const buildApp = () => {
    const app = express();
    app.use(express.json());
    app.use('/api/trades', router);
    return app;
  };

  const sendRequest = (app, deadline = Math.floor(Date.now() / 1000) + 3600) => request(app)
    .post('/api/trades/propose-cancel')
    .send({
      tradeId: '507f1f77bcf86cd799439011',
      signature: '0x' + '11'.repeat(65),
      deadline,
    });

  it('accepts valid EIP-712 signature recovery match', async () => {
    const res = await sendRequest(buildApp());

    expect(res.status).toBe(200);
    expect(mockCoordinationWriteLimiter).toHaveBeenCalled();
    expect(mockRoomReadLimiter).not.toHaveBeenCalled();
    expect(mockSigNonces).toHaveBeenCalled();
    expect(mockHashDomain).toHaveBeenCalled();
    expect(mockVerifyTypedData).toHaveBeenCalled();
  });

  it('reads_cancel_nonce_per_trade', async () => {
    await sendRequest(buildApp());

    expect(mockSigNonces).toHaveBeenCalledWith(
      '0x1111111111111111111111111111111111111111',
      '42'
    );
  });

  it('does_not_use_global_cancel_nonce', async () => {
    await sendRequest(buildApp());

    const callArgs = mockSigNonces.mock.calls[0] || [];
    expect(callArgs.length).toBe(2);
  });

  it.each(['LOCKED', 'PAID', 'CHALLENGED'])('allows cancel coordination for %s state', async (status) => {
    mockTradeDoc = buildTradeDoc(status);

    const res = await sendRequest(buildApp());

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockVerifyTypedData).toHaveBeenCalled();
  });

  it.each(['RESOLVED', 'CANCELED', 'BURNED'])('rejects cancel coordination for %s state', async (status) => {
    mockTradeDoc = buildTradeDoc(status);

    const res = await sendRequest(buildApp());

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('CANCEL_STATE_NOT_ALLOWED');
    expect(mockVerifyTypedData).not.toHaveBeenCalled();
  });

  it('security_rejects_second_signature_when_cancel_deadline_differs_even_by_30_seconds', async () => {
    const base = Math.floor(Date.now() / 1000) + 3600;
    mockTradeDoc.cancel_proposal.deadline = new Date((base - 30) * 1000);

    const res = await sendRequest(buildApp(), base);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('CANCEL_DEADLINE_MISMATCH');
    expect(mockTradeDoc.cancel_proposal.maker_signed).not.toBe(true);
    expect(mockTradeDoc.cancel_proposal.taker_signed).not.toBe(true);
  });

  it('security_accepts_second_signature_when_cancel_deadline_matches_exactly', async () => {
    const base = Math.floor(Date.now() / 1000) + 3600;
    mockTradeDoc.cancel_proposal.deadline = new Date(base * 1000);

    const res = await sendRequest(buildApp(), base);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('security_rebuilds_cancel_verifier_when_runtime_config_changes', async () => {
    const app = buildApp();
    await sendRequest(app);
    const afterFirst = mockContractCtor.mock.calls.length;

    process.env.ARAF_ESCROW_ADDRESS = '0x' + '33'.repeat(20);
    await sendRequest(app);

    const recent = mockContractCtor.mock.calls.slice(afterFirst - 1, afterFirst + 1);
    expect(recent[0][0]).toBe('0x' + '22'.repeat(20));
    expect(recent[1][0]).toBe('0x' + '33'.repeat(20));
  });

  it('security_reset_cancel_verifier_clears_provider_contract_and_cache_key', async () => {
    await sendRequest(buildApp());
    expect(router.__getCancelVerifierCacheKey()).toBeTruthy();

    router.__resetCancelVerifier();

    expect(router.__getCancelVerifierCacheKey()).toBeNull();
  });

  it('fails_closed_when_provider_chain_does_not_match_expected_chain_id', async () => {
    process.env.EXPECTED_CHAIN_ID = '8453';
    mockAssertProviderExpectedChainOrThrow.mockRejectedValueOnce(new Error('Chain ID uyuşmazlığı'));
    const res = await sendRequest(buildApp());

    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(`${JSON.stringify(res.body)} ${res.text}`).toMatch(/Chain ID uyuşmazlığı/);
    expect(mockVerifyTypedData).not.toHaveBeenCalled();
  });
});
