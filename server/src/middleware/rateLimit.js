const { httpError } = require("../errors");

function createRateLimiter(limit, windowMs, { maxKeys = 10_000, now = Date.now } = {}) {
  const buckets = new Map();
  let nextCleanup = 0;

  function cleanup(currentTime) {
    for (const [key, timestamps] of buckets) {
      const recent = timestamps.filter((stamp) => currentTime - stamp < windowMs);
      if (recent.length) buckets.set(key, recent);
      else buckets.delete(key);
    }
  }

  const middleware = (req, res, next) => {
    const currentTime = now();
    if (currentTime >= nextCleanup) {
      cleanup(currentTime);
      nextCleanup = currentTime + Math.min(windowMs, 60_000);
    }

    // Express no confía en X-Forwarded-For salvo que trust proxy esté configurado.
    const key = req.ip || req.socket?.remoteAddress || "local";
    let timestamps = buckets.get(key);
    if (!timestamps) {
      if (buckets.size >= maxKeys) {
        next(httpError(503, "Limitador temporalmente saturado"));
        return;
      }
      timestamps = [];
    }

    const recent = timestamps.filter((stamp) => currentTime - stamp < windowMs);
    if (recent.length >= limit) {
      buckets.set(key, recent);
      next(httpError(429, "Demasiados intentos. Probá más tarde"));
      return;
    }
    recent.push(currentTime);
    buckets.set(key, recent);
    next();
  };

  middleware.getBucketCount = () => buckets.size;
  return middleware;
}

function rateLimit(limit, windowMs, options) {
  return createRateLimiter(limit, windowMs, options);
}

module.exports = { createRateLimiter, rateLimit };
