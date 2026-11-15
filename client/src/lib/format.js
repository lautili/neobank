const currencyFormatter = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
});

const dateFormatter = new Intl.DateTimeFormat("es-AR", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

export function formatMoney(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? currencyFormatter.format(amount) : "—";
}

export function formatDate(value) {
  if (!value) return "—";
  const text = String(value);
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(text) ? `${text}T12:00:00` : text);
  return Number.isNaN(date.getTime()) ? "—" : dateFormatter.format(date);
}

export function getMovementLabel(type) {
  const labels = {
    ingreso: "Ingreso",
    extraccion: "Extracción",
    transferencia_enviada: "Transferencia enviada",
    transferencia_recibida: "Transferencia recibida",
    prestamo: "Préstamo acreditado",
    plazo_fijo: "Plazo fijo",
  };
  return labels[type] || "Movimiento";
}

export function isCreditMovement(type) {
  return ["ingreso", "transferencia_recibida", "prestamo"].includes(type);
}
