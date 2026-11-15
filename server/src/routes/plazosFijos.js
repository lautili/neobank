const express = require("express");
const { pool, withTransaction } = require("../db");
const { httpError } = require("../errors");
const { calcularPlazoFijo, parseEntero, parseTasa } = require("../finance");
const { asyncHandler } = require("../middleware/asyncHandler");
const { requireAuth } = require("../middleware/auth");
const { centsToDecimal, parseId, parseMoney } = require("../money");
const { runIdempotent } = require("../idempotency");
const {
  cancelFixedDeposit,
  includeMaturityEstimate,
  settleMaturedFixedDeposits,
} = require("../fixedDeposits");

const router = express.Router();
router.use(requireAuth);

function leerSimulacion(body) {
  const monto = parseMoney(body?.monto ?? body?.monto_invertido);
  const tasa = parseTasa(body?.tasa_nominal_anual);
  const dias = parseEntero(body?.dias, 1, 365);
  if (!monto || !tasa || !dias) return null;
  return { monto, tasa, dias, calculo: calcularPlazoFijo(monto, tasa, dias) };
}

router.post("/simular", asyncHandler(async (req, res) => {
  const simulacion = leerSimulacion(req.body);
  if (!simulacion) throw httpError(400, "Datos de plazo fijo inválidos");
  res.json({
    monto_invertido: centsToDecimal(simulacion.monto),
    tasa_nominal_anual: simulacion.tasa,
    dias: simulacion.dias,
    ...simulacion.calculo,
  });
}));

router.get("/", asyncHandler(async (req, res) => {
  const rows = await withTransaction(async (connection) => {
    // Bloqueo y transición activa->finalizado hacen que el crédito y su movimiento ocurran una vez.
    await settleMaturedFixedDeposits(connection, req.user.id);
    const [deposits] = await connection.query(
      `SELECT p.id, p.cuenta_id, p.monto_invertido, p.tasa_nominal_anual, p.dias, p.liquidado_at,
              p.fecha_inicio, p.fecha_vencimiento, p.estado
       FROM plazos_fijos p
       JOIN cuentas c ON c.id = p.cuenta_id
       WHERE c.usuario_id = ?
       ORDER BY p.id DESC`,
      [req.user.id]
    );
    return deposits;
  });
  res.json(rows.map(includeMaturityEstimate));
}));

router.post("/", asyncHandler(async (req, res) => {
  const cuentaId = parseId(req.body?.cuenta_id);
  const simulacion = leerSimulacion(req.body);
  if (!cuentaId || !simulacion) throw httpError(400, "Datos de plazo fijo inválidos");

  const { result: plazoCreado } = await runIdempotent({
    userId: req.user.id,
    operation: "plazos-fijos.crear",
    key: req.get("Idempotency-Key"),
    payload: {
      cuenta_id: cuentaId,
      monto: simulacion.monto,
      tasa: simulacion.tasa,
      dias: simulacion.dias,
    },
    work: async (connection) => {
      const [cuentas] = await connection.query(
        "SELECT id, saldo FROM cuentas WHERE id = ? AND usuario_id = ? FOR UPDATE",
        [cuentaId, req.user.id]
      );
      if (!cuentas.length) throw httpError(404, "Cuenta no encontrada");

      const saldo = parseMoney(cuentas[0].saldo, { allowZero: true });
      if (saldo == null) throw httpError(500, "Error interno");
      if (saldo < simulacion.monto) throw httpError(400, "Saldo insuficiente");

      const resultante = saldo - simulacion.monto;
      const monto = centsToDecimal(simulacion.monto);
      const [plazo] = await connection.query(
        `INSERT INTO plazos_fijos (
           cuenta_id, monto_invertido, tasa_nominal_anual, dias, fecha_inicio, fecha_vencimiento, estado
         ) VALUES (?, ?, ?, ?, CURRENT_DATE, DATE_ADD(CURRENT_DATE, INTERVAL ? DAY), 'activo')`,
        [cuentaId, monto, simulacion.tasa, simulacion.dias, simulacion.dias]
      );
      await connection.query("UPDATE cuentas SET saldo = ? WHERE id = ?", [centsToDecimal(resultante), cuentaId]);
      await connection.query(
        `INSERT INTO movimientos (cuenta_id, tipo, monto, saldo_resultante, referencia_id)
         VALUES (?, 'plazo_fijo', ?, ?, ?)`,
        [cuentaId, monto, centsToDecimal(resultante), plazo.insertId]
      );

      const [creados] = await connection.query(
        `SELECT id, cuenta_id, monto_invertido, tasa_nominal_anual, dias, fecha_inicio, fecha_vencimiento, estado
         FROM plazos_fijos WHERE id = ?`,
        [plazo.insertId]
      );
      return {
        ...creados[0],
        saldo_resultante: centsToDecimal(resultante),
        ...simulacion.calculo,
      };
    },
  });

  res.status(201).json(plazoCreado);
}));

router.post("/:id/cancelar", asyncHandler(async (req, res) => {
  const depositId = parseId(req.params.id);
  if (!depositId) throw httpError(400, "Plazo fijo inválido");

  const { result } = await runIdempotent({
    userId: req.user.id,
    operation: "plazos-fijos.cancelar",
    key: req.get("Idempotency-Key"),
    payload: { plazo_fijo_id: depositId },
    work: (connection) => cancelFixedDeposit(connection, { depositId, userId: req.user.id }),
  });
  res.json(result);
}));

module.exports = router;
