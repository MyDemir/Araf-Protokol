"use strict";

const fs = require("fs");
const path = require("path");

describe("identity guard default mode", () => {
  it("does not keep off-by-default guard mode in app bootstrap", () => {
    const source = fs.readFileSync(path.join(__dirname, "../scripts/app.js"), "utf8");
    expect(source).toContain("return process.env.NODE_ENV === \"production\" ? \"enforce\" : \"warn\"");
    expect(source).not.toContain("IDENTITY_NORMALIZATION_GUARD || \"off\"");
  });
});
