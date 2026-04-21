"use strict";

describe("identity normalization guard mode validation", () => {
  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it("accepts valid modes: off/warn/enforce", () => {
    const { normalizeGuardMode } = require("../scripts/services/identityNormalizationGuard");
    expect(normalizeGuardMode("off")).toBe("off");
    expect(normalizeGuardMode("warn")).toBe("warn");
    expect(normalizeGuardMode("enforce")).toBe("enforce");
  });

  it("rejects invalid mode instead of silently downgrading to warn", async () => {
    const { verifyIdentityNormalization } = require("../scripts/services/identityNormalizationGuard");
    await expect(verifyIdentityNormalization({ mode: "enfrce" })).rejects.toThrow(/IDENTITY_GUARD_INVALID_MODE/);
  });

  it("keeps existing behavior for valid warn/enforce flows", async () => {
    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    const Order = { countDocuments: jest.fn().mockResolvedValue(1) };
    const Trade = { countDocuments: jest.fn().mockResolvedValue(0) };

    let verifyIdentityNormalization;
    jest.isolateModules(() => {
      jest.doMock("../scripts/utils/logger", () => logger);
      jest.doMock("../scripts/models/Order", () => Order);
      jest.doMock("../scripts/models/Trade", () => Trade);
      ({ verifyIdentityNormalization } = require("../scripts/services/identityNormalizationGuard"));
    });

    const warnResult = await verifyIdentityNormalization({ mode: "warn" });
    expect(warnResult.ok).toBe(false);
    await expect(verifyIdentityNormalization({ mode: "enforce" })).rejects.toThrow(/Mixed legacy numeric identity bulundu/);
  });
});
