"use strict";

const fs = require("fs");
const path = require("path");

describe("deploy hardening static guards", () => {
  it("backend Dockerfile uses Node 22 LTS alpine and non-root user", () => {
    const src = fs.readFileSync(path.resolve(process.cwd(), "Dockerfile"), "utf8");
    expect(src).toContain("FROM node:22-alpine");
    expect(src).not.toContain("FROM node:18-alpine");
    expect(src).toContain("USER nodeapp");
    expect(src).toContain("npm ci --omit=dev");
    expect(src).not.toContain("npm install --omit=dev");
  });

  it("deployment guide mentions readiness and env policy", () => {
    const en = fs.readFileSync(path.resolve(process.cwd(), "../docs/EN/DEPLOYMENT_GUIDE.md"), "utf8");
    expect(en).toContain("/ready");
    expect(en).toContain("VITE_*");
    expect(en).toContain("REDIS_TLS_SKIP_VERIFY=true");
  });
});
