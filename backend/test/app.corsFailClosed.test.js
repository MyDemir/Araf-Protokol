"use strict";

describe("app production CORS fail-closed", () => {
  const ORIGINAL_ENV = { ...process.env };

  afterEach(() => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV };
  });

  function expectBootToExitWithEnv(envPatch) {
    Object.assign(process.env, envPatch);
    process.env.JWT_SECRET = process.env.JWT_SECRET || "a".repeat(80);

    const exitSpy = jest.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`EXIT_${code}`);
    });

    expect(() => {
      jest.isolateModules(() => {
        require("../scripts/app");
      });
    }).toThrow("EXIT_1");

    exitSpy.mockRestore();
  }

  it("exits when NODE_ENV=production and ALLOWED_ORIGINS is missing", () => {
    delete process.env.ALLOWED_ORIGINS;
    expectBootToExitWithEnv({ NODE_ENV: "production" });
  });

  it("security_exits_when_production_allowed_origin_contains_path", () => {
    expectBootToExitWithEnv({ NODE_ENV: "production", ALLOWED_ORIGINS: "https://example.com/path" });
  });

  it("security_exits_when_production_allowed_origin_contains_query", () => {
    expectBootToExitWithEnv({ NODE_ENV: "production", ALLOWED_ORIGINS: "https://example.com?x=1" });
  });


});
