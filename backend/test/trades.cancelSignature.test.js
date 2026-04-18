const express = require('express');
const request = require('supertest');

process.env.BASE_RPC_URL = 'http://localhost:8545';
process.env.ARAF_ESCROW_ADDRESS = '0x' + '22'.repeat(20);

jest.mock('../scripts/middleware/auth', () => ({
  requireAuth: (req, _res, next) => {
    req.wallet = '0x1111111111111111111111111111111111111111';
    next();
  },
  requireSessionWalletMatch: (_req, _res, next) => next(),
}));

jest.mock('../scripts/middleware/rateLimiter', () => ({
  tradesLimiter: (_req, _res, next) => next(),
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

const mockSigNonces = jest.fn().mockResolvedValue(0n);
const mockVerifyTypedData = jest.fn().mockReturnValue('0x1111111111111111111111111111111111111111');
const mockHashDomain = jest.fn().mockReturnValue('0x' + 'aa'.repeat(32));

jest.mock('ethers', () => ({
  ethers: {
    JsonRpcProvider: jest.fn(() => ({
      getNetwork: jest.fn().mockResolvedValue({ chainId: 84532n }),
    })),
    Contract: jest.fn(() => ({
      sigNonces: mockSigNonces,
      domainSeparator: jest.fn().mockResolvedValue('0x' + 'aa'.repeat(32)),
    })),
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
  });

  const buildApp = () => {
    const app = express();
    app.use(express.json());
    app.use('/api/trades', router);
    return app;
  };

  const sendRequest = (app) => request(app)
    .post('/api/trades/propose-cancel')
    .send({
      tradeId: '507f1f77bcf86cd799439011',
      signature: '0x' + '11'.repeat(65),
      deadline: Math.floor(Date.now() / 1000) + 3600,
    });

  it('accepts valid EIP-712 signature recovery match', async () => {
    const res = await sendRequest(buildApp());

    expect(res.status).toBe(200);
    expect(mockSigNonces).toHaveBeenCalled();
    expect(mockHashDomain).toHaveBeenCalled();
    expect(mockVerifyTypedData).toHaveBeenCalled();
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
});
