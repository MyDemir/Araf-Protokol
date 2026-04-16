const express = require('express');
const request = require('supertest');

jest.mock('../scripts/middleware/auth', () => ({
  requireAuth: (_req, _res, next) => next(),
}));

jest.mock('../scripts/middleware/rateLimiter', () => ({
  marketReadLimiter: (_req, _res, next) => next(),
  ordersWriteLimiter: (_req, _res, next) => next(),
}));

jest.mock('../scripts/models/Order', () => ({}));
jest.mock('../scripts/models/Trade', () => ({}));

jest.mock('../scripts/services/protocolConfig', () => ({
  getConfig: jest.fn(() => ({
    bondMap: { 0: { makerBps: 0, takerBps: 0 } },
    feeConfig: { takerFeeBps: 10, makerFeeBps: 0 },
    cooldownConfig: { tier0TradeCooldown: 14400, tier1TradeCooldown: 14400 },
    tokenMap: { '0xabc': { supported: true, allowSellOrders: true, allowBuyOrders: true } },
  })),
}));

const { getConfig } = require('../scripts/services/protocolConfig');
const ordersRouter = require('../scripts/routes/orders');

describe('GET /api/orders/config', () => {
  it('returns authoritative config response shape', async () => {
    const app = express();
    app.use('/api/orders', ordersRouter);

    const res = await request(app).get('/api/orders/config');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      bondMap: expect.any(Object),
      feeConfig: expect.any(Object),
      cooldownConfig: expect.any(Object),
      tokenMap: expect.any(Object),
    });
    expect(getConfig).toHaveBeenCalled();
  });
});
