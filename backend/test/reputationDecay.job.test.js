"use strict";

let mockCandidates = [];
const mockWait = jest.fn().mockResolvedValue({ blockNumber: 123 });
const mockDecay = jest.fn().mockResolvedValue({ hash: "0xabc", wait: mockWait });
const mockGetReputation = jest.fn();

jest.mock("../scripts/models/User", () => ({
  find: jest.fn(() => ({
    select: jest.fn().mockReturnThis(),
    sort: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    lean: jest.fn().mockImplementation(async () => mockCandidates),
  })),
}));

jest.mock("ethers", () => ({
  ethers: {
    JsonRpcProvider: jest.fn(() => ({})),
    Wallet: jest.fn(() => ({ address: "0xrelayer" })),
    Contract: jest.fn(() => ({
      decayReputation: mockDecay,
      getReputation: mockGetReputation,
    })),
  },
}));

const { runReputationDecay } = require("../scripts/jobs/reputationDecay");

describe("reputationDecay job", () => {
  beforeAll(() => {
    process.env.BASE_RPC_URL = "http://localhost:8545";
    process.env.RELAYER_PRIVATE_KEY = "0x" + "11".repeat(32);
    process.env.ARAF_ESCROW_ADDRESS = "0x" + "22".repeat(20);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockCandidates = [];
  });

  it("waits for tx receipt after sending decayReputation", async () => {
    mockCandidates = [
      {
        wallet_address: "0x1111111111111111111111111111111111111111",
        consecutive_bans: 1,
        banned_until: new Date("2025-01-01T00:00:00Z"),
      },
    ];
    mockGetReputation.mockResolvedValue({
      bannedUntil: Math.floor(new Date("2025-01-01T00:00:00Z").getTime() / 1000),
      consecutiveBans: 1,
    });

    await runReputationDecay();
    expect(mockDecay).toHaveBeenCalled();
    expect(mockWait).toHaveBeenCalled();
  });

  it("applies the 90-day clean-slate boundary (>=90 days triggers, <90 days does not)", async () => {
    const nowMs = new Date("2026-04-21T00:00:00Z").getTime();
    const ninetyDaysMs = 90 * 24 * 60 * 60 * 1000;
    const eligible = "0x1111111111111111111111111111111111111111";
    const ineligible = "0x2222222222222222222222222222222222222222";

    mockCandidates = [
      { wallet_address: eligible, consecutive_bans: 2, banned_until: new Date(nowMs - ninetyDaysMs) },
      { wallet_address: ineligible, consecutive_bans: 2, banned_until: new Date(nowMs - ninetyDaysMs + 1000) },
    ];

    mockGetReputation.mockImplementation(async (wallet) => {
      if (wallet === eligible) {
        return { bannedUntil: Math.floor((nowMs - ninetyDaysMs) / 1000), consecutiveBans: 2 };
      }
      return { bannedUntil: Math.floor((nowMs - ninetyDaysMs + 1000) / 1000), consecutiveBans: 2 };
    });

    const nowSpy = jest.spyOn(Date, "now").mockReturnValue(nowMs);
    try {
      await runReputationDecay();
    } finally {
      nowSpy.mockRestore();
    }

    expect(mockDecay).toHaveBeenCalledTimes(1);
    expect(mockDecay).toHaveBeenCalledWith(eligible);
  });

  it("skips decay when getReputation response is not V3 named shape", async () => {
    mockCandidates = [
      {
        wallet_address: "0x1111111111111111111111111111111111111111",
        consecutive_bans: 1,
        banned_until: new Date("2025-01-01T00:00:00Z"),
      },
    ];
    mockGetReputation.mockResolvedValue([1n, 0n, 0n, 0n, 0n]);

    const result = await runReputationDecay();
    expect(mockDecay).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.processed).toBe(0);
  });
});
