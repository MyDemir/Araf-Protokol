"use strict";

jest.mock("../services/siwe", () => ({
  verifyJWT: jest.fn(),
  isJWTBlacklisted: jest.fn(),
  revokeRefreshToken: jest.fn(),
}));

const { verifyJWT } = require("../services/siwe");
const { requirePIIToken } = require("../middleware/auth");

function buildRes() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
}

describe("requirePIIToken", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("rejects when PII token wallet and session wallet differ", () => {
    verifyJWT.mockReturnValue({
      type: "pii",
      sub: "0x2222222222222222222222222222222222222222",
      tradeId: "507f1f77bcf86cd799439011",
    });

    const req = {
      params: { tradeId: "507f1f77bcf86cd799439011" },
      headers: { authorization: "Bearer token" },
      wallet: "0x1111111111111111111111111111111111111111",
    };
    const res = buildRes();
    const next = jest.fn();

    requirePIIToken(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: "PII token oturum cüzdanıyla eşleşmiyor." });
    expect(next).not.toHaveBeenCalled();
  });

  test("allows request when PII token wallet and session wallet match", () => {
    verifyJWT.mockReturnValue({
      type: "pii",
      sub: "0x1111111111111111111111111111111111111111",
      tradeId: "507f1f77bcf86cd799439011",
    });

    const req = {
      params: { tradeId: "507f1f77bcf86cd799439011" },
      headers: { authorization: "Bearer token" },
      wallet: "0x1111111111111111111111111111111111111111",
    };
    const res = buildRes();
    const next = jest.fn();

    requirePIIToken(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.piiWallet).toBe("0x1111111111111111111111111111111111111111");
  });
});
