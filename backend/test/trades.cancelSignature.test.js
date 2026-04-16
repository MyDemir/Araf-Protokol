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

const mockTradeDoc = {
  onchain_escrow_id: 42,
  maker_address: '0x1111111111111111111111111111111111111111',
  taker_address: '0x3333333333333333333333333333333333333333',
  cancel_proposal: {},
  save: jest.fn().mockResolvedValue(),
};

jest.mock('../scripts/models/Trade', () => ({
  findById: jest.fn().mockResolvedValue(mockTradeDoc),
}));

jest.mock('../scripts/routes/tradeRisk', () => ({
  buildBankProfileRisk: () => ({ level: 'LOW' }),
}));

const mockSigNonces = jest.fn().mockResolvedValue(0n);
const mockVerifyTypedData = jest.fn().mockReturnValue('0x1111111111111111111111111111111111111111');

jest.mock('ethers', () => ({
  ethers: {
    JsonRpcProvider: jest.fn(() => ({
      getNetwork: jest.fn().mockResolvedValue({ chainId: 84532n }),
    })),
    Contract: jest.fn(() => ({
      sigNonces: mockSigNonces,
    })),
    verifyTypedData: (...args) => mockVerifyTypedData(...args),
  },
}));

const router = require('../scripts/routes/trades');

describe('POST /api/trades/propose-cancel signature verification', () => {
  it('accepts valid EIP-712 signature recovery match', async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/trades', router);

    const res = await request(app)
      .post('/api/trades/propose-cancel')
      .send({
        tradeId: '507f1f77bcf86cd799439011',
        signature: '0x' + '11'.repeat(65),
        deadline: Math.floor(Date.now() / 1000) + 3600,
      });

    expect(res.status).toBe(200);
    expect(mockSigNonces).toHaveBeenCalled();
    expect(mockVerifyTypedData).toHaveBeenCalled();
  });
});
