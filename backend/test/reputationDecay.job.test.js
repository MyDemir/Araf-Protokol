jest.mock('../scripts/models/User', () => ({
  find: jest.fn(() => ({
    select: jest.fn().mockReturnThis(),
    sort: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue([
      {
        wallet_address: '0x1111111111111111111111111111111111111111',
        consecutive_bans: 1,
        banned_until: new Date('2025-01-01T00:00:00Z'),
      },
    ]),
  })),
}));

const mockWait = jest.fn().mockResolvedValue({ blockNumber: 123 });
const mockDecay = jest.fn().mockResolvedValue({ hash: '0xabc', wait: mockWait });
const mockGetReputation = jest.fn().mockResolvedValue({ bannedUntil: Math.floor(new Date('2025-01-01T00:00:00Z').getTime() / 1000), consecutiveBans: 1 });

jest.mock('ethers', () => ({
  ethers: {
    JsonRpcProvider: jest.fn(() => ({})),
    Wallet: jest.fn(() => ({ address: '0xrelayer' })),
    Contract: jest.fn(() => ({
      decayReputation: mockDecay,
      getReputation: mockGetReputation,
    })),
  },
}));

const { runReputationDecay } = require('../scripts/jobs/reputationDecay');

describe('reputationDecay job', () => {
  beforeAll(() => {
    process.env.BASE_RPC_URL = 'http://localhost:8545';
    process.env.RELAYER_PRIVATE_KEY = '0x' + '11'.repeat(32);
    process.env.ARAF_ESCROW_ADDRESS = '0x' + '22'.repeat(20);
  });

  it('waits for tx receipt after sending decayReputation', async () => {
    await runReputationDecay();
    expect(mockDecay).toHaveBeenCalled();
    expect(mockWait).toHaveBeenCalled();
  });
});
