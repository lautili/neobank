const MAX_CENTS = 999999999999;

function centsToDecimal(cents) {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100);
  const fraction = String(abs % 100).padStart(2, "0");
  return `${sign}${whole}.${fraction}`;
}

function parseMoney(value, { allowZero = false } = {}) {
  let text;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0 || value > 9999999999.99) return null;
    text = value.toFixed(2);
    if (Math.abs(value - Number(text)) > 1e-8) return null;
  } else {
    text = String(value ?? "").trim();
  }

  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;

  const [whole, fraction = ""] = text.split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents) || cents > MAX_CENTS) return null;
  if (cents === 0 && !allowZero) return null;
  return cents;
}

function addCentsWithinLimit(balanceCents, amountCents) {
  const result = balanceCents + amountCents;
  return Number.isSafeInteger(result) && result <= MAX_CENTS ? result : null;
}

function parseId(value) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0 || id > 2147483647) return null;
  return id;
}

function parseDescripcion(value) {
  if (value == null || value === "") return null;
  const text = String(value).replace(/[\u0000-\u001F\u007F]/g, "").trim();
  if (!text || text.length > 140) return undefined;
  return text;
}

module.exports = { MAX_CENTS, addCentsWithinLimit, centsToDecimal, parseMoney, parseId, parseDescripcion };
