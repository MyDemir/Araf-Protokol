"use strict";

describe("app production CORS fail-closed", () => {
  const ORIGINAL_ENV = { ...process.env };

  afterEach(() => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV };
  });

  it("exits when NODE_ENV=production and ALLOWED_ORIGINS is missing", () => {
    process.env.NODE_ENV = "production";
    process.env.JWT_SECRET = "a".repeat(80);
    delete process.env.ALLOWED_ORIGINS;

    const exitSpy = jest.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`EXIT_${code}`);
    });

    expect(() => {
      jest.isolateModules(() => {
        require("../scripts/app");
      });
    }).toThrow("EXIT_1");

    exitSpy.mockRestore();
  });
});
