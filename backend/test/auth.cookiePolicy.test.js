"use strict";

describe("auth cookie policy deploy matrix", () => {
  const ORIGINAL_ENV = { ...process.env };

  afterEach(() => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV };
  });

  function loadRouteWithEnv(nodeEnv) {
    process.env.NODE_ENV = nodeEnv;
    process.env.JWT_SECRET = "a".repeat(80);

    let authRoutes;
    jest.isolateModules(() => {
      jest.doMock("../scripts/middleware/rateLimiter", () => ({
        authLimiter: (_req, _res, next) => next(),
      }));
      jest.doMock("../scripts/middleware/auth", () => ({
        requireAuth: (_req, _res, next) => next(),
        requireSessionWalletMatch: (_req, _res, next) => next(),
      }));
      jest.doMock("../scripts/services/siwe", () => ({
        generateNonce: jest.fn(),
        verifySiweSignature: jest.fn(),
        getSiweConfig: jest.fn(() => ({ domain: "localhost", uri: "https://localhost" })),
        issueJWT: jest.fn(),
        issueRefreshToken: jest.fn(),
        rotateRefreshToken: jest.fn(),
        revokeRefreshToken: jest.fn(),
        blacklistJWT: jest.fn(),
      }));
      jest.doMock("../scripts/services/encryption", () => ({
        encryptPayoutProfile: jest.fn(),
        decryptPayoutProfile: jest.fn(),
        buildPayoutFingerprint: jest.fn(() => "fingerprint"),
      }));
      jest.doMock("../scripts/models/User", () => ({
        findOneAndUpdate: jest.fn(),
        findOne: jest.fn(),
      }));
      jest.doMock("../scripts/models/Trade", () => ({
        exists: jest.fn(),
      }));
      authRoutes = require("../scripts/routes/auth");
    });
    return authRoutes;
  }

  it("keeps same-origin cookie policy in non-production mode", () => {
    const authRoutes = loadRouteWithEnv("development");
    const jwt = authRoutes._getJwtCookieOptions();
    const refresh = authRoutes._getRefreshCookieOptions();

    expect(jwt.sameSite).toBe("lax");
    expect(jwt.secure).toBe(false);
    expect(refresh.sameSite).toBe("lax");
    expect(refresh.secure).toBe(false);
  });

  it("uses secure cookie flags in production while preserving same-origin SameSite", () => {
    const authRoutes = loadRouteWithEnv("production");
    const jwt = authRoutes._getJwtCookieOptions();
    const refresh = authRoutes._getRefreshCookieOptions();

    expect(jwt.sameSite).toBe("lax");
    expect(jwt.secure).toBe(true);
    expect(refresh.sameSite).toBe("lax");
    expect(refresh.secure).toBe(true);
  });
});
