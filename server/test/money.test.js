const test = require("node:test");
const assert = require("node:assert/strict");
const { MAX_CENTS, addCentsWithinLimit, centsToDecimal, parseMoney } = require("../src/money");

test("los créditos respetan el máximo DECIMAL y conservan centavos exactos", () => {
  assert.equal(addCentsWithinLimit(MAX_CENTS - 1, 1), MAX_CENTS);
  assert.equal(addCentsWithinLimit(MAX_CENTS, 1), null);
  assert.equal(centsToDecimal(addCentsWithinLimit(1001, 1)), "10.02");
  assert.equal(parseMoney("0.01"), 1);
});
