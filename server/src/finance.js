const { centsToDecimal } = require("./money");

function parseTasa(value) {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0 || value > 200) return null;
    const text = value.toFixed(2);
    if (Math.abs(value - Number(text)) > 1e-8) return null;
    return text;
  }
  const text = String(value ?? "").trim();
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
  if (Number(text) > 200) return null;
  const [whole, fraction = ""] = text.split(".");
  return `${Number(whole)}.${fraction.padEnd(2, "0")}`;
}

function parseEntero(value, min, max) {
  if (typeof value === "number") {
    if (!Number.isInteger(value) || value < min || value > max) return null;
    return value;
  }
  if (!/^\d+$/.test(String(value ?? "").trim())) return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) return null;
  return number;
}

function calcularPrestamo(montoCents, cuotas, tasaAnual) {
  const tasaMensual = Number(tasaAnual) / 100 / 12;
  let cuotaCents;
  if (tasaMensual === 0) {
    cuotaCents = Math.round(montoCents / cuotas);
  } else {
    const factor = tasaMensual / (1 - Math.pow(1 + tasaMensual, -cuotas));
    cuotaCents = Math.round(montoCents * factor);
  }
  const totalCents = cuotaCents * cuotas;
  return {
    cuota: centsToDecimal(cuotaCents),
    total: centsToDecimal(totalCents),
    interes: centsToDecimal(totalCents - montoCents),
  };
}

function calcularPlazoFijo(montoCents, tasaAnual, dias) {
  const tasaCentesimos = Math.round(Number(tasaAnual) * 100);
  const interesCents = Math.round((montoCents * tasaCentesimos * dias) / 365 / 10000);
  return {
    interes: centsToDecimal(interesCents),
    monto_al_vencimiento: centsToDecimal(montoCents + interesCents),
  };
}

module.exports = {
  parseTasa,
  parseEntero,
  calcularPrestamo,
  calcularPlazoFijo,
};
