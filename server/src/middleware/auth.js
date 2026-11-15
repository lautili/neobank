const jwt = require("jsonwebtoken");
const { httpError } = require("../errors");
const { createRateLimiter, rateLimit } = require("./rateLimit");

function positiveIntegerEnv(name, fallback, min, max) {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  if (!/^\d+$/.test(raw)) throw new Error(`${name} debe ser un entero válido`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${name} está fuera del rango permitido`);
  }
  return value;
}

const authRateLimit = positiveIntegerEnv("AUTH_RATE_LIMIT_LIMIT", 10, 1, 10_000);
const authRateWindowMs = positiveIntegerEnv("AUTH_RATE_LIMIT_WINDOW_MS", 60_000, 1_000, 3_600_000);
const authRateMaxKeys = positiveIntegerEnv("AUTH_RATE_LIMIT_MAX_KEYS", 10_000, 100, 100_000);

function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const match = /^Bearer\s+([A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+)$/.exec(header);
  if (!match) {
    next(httpError(401, "No autenticado"));
    return;
  }

  try {
    const payload = jwt.verify(match[1], process.env.JWT_SECRET);
    const id = Number(payload.sub);
    if (!Number.isInteger(id) || id <= 0) {
      next(httpError(401, "No autenticado"));
      return;
    }
    req.user = { id };
    next();
  } catch {
    next(httpError(401, "No autenticado"));
  }
}

module.exports = {
  createRateLimiter,
  requireAuth,
  rateLimit,
  authRateLimit,
  authRateWindowMs,
  authRateMaxKeys,
};
