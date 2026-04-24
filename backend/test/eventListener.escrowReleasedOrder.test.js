"use strict";

jest.mock("../scripts/config/redis", () => ({
  getRedisClient: jest.fn(() => ({
    get: jest.fn(),
    setEx: jest.fn(),
    del: jest.fn(),
    rPush: jest.fn(),
  })),
}));

jest.mock("../scripts/utils/logger", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

jest.mock("../scripts/services/protocolConfig", () => ({
  updateCachedFeeConfig: jest.fn(),
  updateCachedCooldownConfig: jest.fn(),
  updateCachedTokenConfig: jest.fn(),
}));

jest.mock("../scripts/models/Order", () => ({
  findOneAndUpdate: jest.fn().mockResolvedValue({}),
}));

jest.mock("../scripts/models/Trade", () => ({
  findOneAndUpdate: jest.fn().mockResolvedValue({}),
  updateOne: jest.fn().mockResolvedValue({}),
  findOne: jest.fn().mockReturnValue({
    select: jest.fn().mockReturnValue({
      lean: jest.fn().mockResolvedValue(null),
    }),
  }),
}));

jest.mock("../scripts/models/User", () => ({
  findOne: jest.fn().mockReturnValue({
    select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(null) }),
  }),
  findOneAndUpdate: jest.fn().mockResolvedValue({}),
}));

jest.mock("mongoose", () => ({
  startSession: jest.fn().mockResolvedValue({
    startTransaction: jest.fn(),
    commitTransaction: jest.fn().mockResolvedValue(),
    abortTransaction: jest.fn().mockResolvedValue(),
    endSession: jest.fn().mockResolvedValue(),
  }),
}));

const worker = require("../scripts/services/eventListener");

describe("eventListener EscrowReleased argument order", () => {
  it("parses_EscrowReleased_takerPenalty_before_makerPenalty", () => {
    const synthetic = worker.buildSyntheticEventFromDLQEntry({
      eventName: "EscrowReleased",
      txHash: "0xabc",
      blockNumber: 100,
      args: [
        11n,
        "0x1111111111111111111111111111111111111111",
        "0x2222222222222222222222222222222222222222",
        7n, // taker penalty/fee
        3n, // maker penalty/fee
      ],
    });

    expect(synthetic.args.takerFee).toBe(7n);
    expect(synthetic.args.makerFee).toBe(3n);
  });
});
