"use strict";

const express = require("express");
const request = require("supertest");

const mockSiwe = {
  generateNonce: jest.fn(),
  verifySiweSignature: jest.fn(),
  issueJWT: jest.fn(),
  issueRefreshToken: jest.fn(),
  rotateRefreshToken: jest.fn(),
  revokeRefreshToken: jest.fn(),
  blacklistJWT: jest.fn(),
};

const mockUser = {
  findOneAndUpdate: jest.fn(),
};

jest.mock("../middleware/rateLimiter", () => ({
  authLimiter: (_req, _res, next) => next(),
}));

jest.mock("../middleware/auth", () => ({
  requireAuth: (req, _res, next) => {
    req.wallet = "0x1111111111111111111111111111111111111111";
    next();
  },
}));

jest.mock("../services/siwe", () => mockSiwe);
jest.mock("../models/User", () => mockUser);
jest.mock("../services/encryption", () => ({ encryptPII: jest.fn() }));
jest.mock("../utils/logger", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

describe("auth nonce + verify happy path", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.SIWE_DOMAIN = "app.araf.io";
    process.env.SIWE_URI = "https://app.araf.io";
  });

  function buildApp() {
    const router = require("../routes/auth");
    const app = express();
    app.use(express.json());
    app.use("/api/auth", router);
    return app;
  }

  test("nonce endpoint returns backend SIWE domain + uri", async () => {
    mockSiwe.generateNonce.mockResolvedValue("nonce-1");
    const app = buildApp();

    const res = await request(app).get("/api/auth/nonce").query({
      wallet: "0x1111111111111111111111111111111111111111",
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      nonce: "nonce-1",
      siweDomain: "app.araf.io",
      siweUri: "https://app.araf.io",
    });
  });

  test("verify endpoint returns success payload when signature verification succeeds", async () => {
    mockSiwe.verifySiweSignature.mockResolvedValue("0x1111111111111111111111111111111111111111");
    mockSiwe.issueJWT.mockReturnValue("jwt-token");
    mockSiwe.issueRefreshToken.mockResolvedValue("refresh-token");
    mockUser.findOneAndUpdate.mockResolvedValue({
      checkBanExpiry: jest.fn().mockResolvedValue(),
      toPublicProfile: jest.fn().mockReturnValue({ wallet: "0x1111111111111111111111111111111111111111" }),
    });
    const app = buildApp();

    const res = await request(app)
      .post("/api/auth/verify")
      .send({
        message: "x".repeat(20),
        signature: `0x${"a".repeat(130)}`,
      });

    expect(res.status).toBe(200);
    expect(res.body.wallet).toBe("0x1111111111111111111111111111111111111111");
    expect(mockSiwe.verifySiweSignature).toHaveBeenCalledTimes(1);
  });
});
