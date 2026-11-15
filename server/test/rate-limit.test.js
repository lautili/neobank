const test = require("node:test");
const assert = require("node:assert/strict");
const { createRateLimiter } = require("../src/middleware/rateLimit");

function invoke(limiter, ip) {
  let error;
  limiter({ ip }, null, (nextError) => { error = nextError; });
  return error;
}

test("limita requests por clave y no crece por encima del máximo", () => {
  let time = 10;
  const limiter = createRateLimiter(1, 1000, { maxKeys: 2, now: () => time });
  assert.equal(invoke(limiter, "ip-a"), undefined);
  assert.equal(invoke(limiter, "ip-a").status, 429);
  assert.equal(invoke(limiter, "ip-b"), undefined);
  assert.equal(invoke(limiter, "ip-c").status, 503);
  assert.equal(limiter.getBucketCount(), 2);
});

test("limpia buckets expirados y admite una clave nueva", () => {
  let time = 0;
  const limiter = createRateLimiter(2, 1000, { maxKeys: 1, now: () => time });
  assert.equal(invoke(limiter, "ip-a"), undefined);
  time = 1001;
  assert.equal(invoke(limiter, "ip-b"), undefined);
  assert.equal(limiter.getBucketCount(), 1);
});
