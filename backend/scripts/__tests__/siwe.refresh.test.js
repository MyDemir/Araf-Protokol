"use strict";

process.env.JWT_SECRET = "Araf_Test_Secret_2026_!@#_x9Kp7Lm2Qw4Er6Ty8Ui0Op1As3Df5Gh7Jk9Zx1Cv";

jest.mock("../config/redis", () => ({
  getRedisClient: jest.fn(),
}));

const { getRedisClient } = require("../config/redis");
const { rotateRefreshToken } = require("../services/siwe");

function createMultiMock() {
  return {
    setEx: jest.fn().mockReturnThis(),
    sAdd: jest.fn().mockReturnThis(),
    expire: jest.fn().mockReturnThis(),
    del: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue([]),
  };
}

describe("siwe rotateRefreshToken", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("does not revoke wallet families when refresh token key is missing", async () => {
    const redis = {
      getDel: jest.fn().mockResolvedValue(null),
      sMembers: jest.fn(),
      multi: jest.fn(() => createMultiMock()),
    };
    getRedisClient.mockReturnValue(redis);

    await expect(rotateRefreshToken("missing-token", "0x1111111111111111111111111111111111111111"))
      .rejects
      .toThrow("Refresh token geçersiz veya süresi dolmuş");

    expect(redis.sMembers).not.toHaveBeenCalled();
    expect(redis.multi).not.toHaveBeenCalled();
  });

  test("uses wallet from stored refresh token payload as authority", async () => {
    const familyMulti = createMultiMock();
    const issueMulti = createMultiMock();

    const redis = {
      getDel: jest.fn().mockResolvedValue(JSON.stringify({
        familyId: "fam-1",
        wallet: "0x2222222222222222222222222222222222222222",
      })),
      sMembers: jest.fn().mockResolvedValue(["old-1", "old-2"]),
      multi: jest
        .fn()
        .mockReturnValueOnce(familyMulti)
        .mockReturnValueOnce(issueMulti),
    };
    getRedisClient.mockReturnValue(redis);

    const result = await rotateRefreshToken(
      "valid-token",
      "0x2222222222222222222222222222222222222222"
    );

    expect(result.wallet).toBe("0x2222222222222222222222222222222222222222");
    expect(typeof result.token).toBe("string");
    expect(typeof result.refreshToken).toBe("string");

    expect(redis.sMembers).toHaveBeenCalledWith("family:0x2222222222222222222222222222222222222222:fam-1");
  });

  test("rotates successfully when expected wallet is not provided", async () => {
    const familyMulti = createMultiMock();
    const issueMulti = createMultiMock();

    const redis = {
      getDel: jest.fn().mockResolvedValue(JSON.stringify({
        familyId: "fam-2",
        wallet: "0x3333333333333333333333333333333333333333",
      })),
      sMembers: jest.fn().mockResolvedValue(["old-3"]),
      multi: jest
        .fn()
        .mockReturnValueOnce(familyMulti)
        .mockReturnValueOnce(issueMulti),
    };
    getRedisClient.mockReturnValue(redis);

    const result = await rotateRefreshToken("valid-token-no-wallet");
    expect(result.wallet).toBe("0x3333333333333333333333333333333333333333");
  });
});
