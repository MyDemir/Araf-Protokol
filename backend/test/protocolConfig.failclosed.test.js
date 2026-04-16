jest.mock('../scripts/config/redis', () => ({
  getRedisClient: () => ({
    get: jest.fn().mockResolvedValue(null),
    setEx: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
  }),
}));

const { updateCachedFeeConfig } = require('../scripts/services/protocolConfig');

describe('protocolConfig fail-closed cache mutation', () => {
  it('rejects partial cache patch before full config load', async () => {
    await expect(updateCachedFeeConfig(10, 0)).rejects.toMatchObject({ code: 'CONFIG_UNAVAILABLE' });
  });
});
