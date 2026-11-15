const express = require("express");
const { pool } = require("../db");
const { httpError } = require("../errors");
const { calcularPrestamo, parseEntero, parseTasa } = require("../finance");
const { asyncHandler } = require("../middleware/asyncHandler");
const { requireAuth } = require("../middleware/auth");
const { addCentsWithinLimit, centsToDecimal, parseId, parseMoney } = require("../money");
const { runIdempotent } = require("../idempotency");

const router = express.Router();
router.use(requireAuth);

function leerSimulacion(body) {
  const monto = parseMoney(body?.monto ?? body?.monto_solicitado);
  const cuotas = parseEntero(body?.cuotas, 1, 60);
  const tasa = parseTasa(body?.tasa_interes);
  if (!monto || !cuotas || !tasa) return null;
  return { monto, cuotas, tasa, calculo: calcularPrestamo(monto, cuotas, tasa) };
}

router.post("/simular", asyncHandler(async (req, res) => {
  const simulacion = leerSimulacion(req.body);
  if (!simulacion) throw httpError(400, "Datos de préstamo inválidos");
  res.json({
    monto_solicitado: centsToDecimal(simulacion.monto),
    cuotas: simulacion.cuotas,
    tasa_interes: simulacion.tasa,
    ...simulacion.calculo,
  });
}));

router.get("/", asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT id, usuario_id, monto_solicitado, cuotas, tasa_interes, estado, created_at
     FROM prestamos WHERE usuario_id = ? ORDER BY id DESC`,
    [req.user.id]
  );
  res.json(rows);
}));

router.post("/", asyncHandler(async (req, res) => {
  const cuentaId = parseId(req.body?.cuenta_id);
  const simulacion = leerSimulacion(req.body);
  if (!cuentaId || !simulacion) throw httpError(400, "Datos de préstamo inválidos");

  const { result: prestamoCreado } = await runIdempotent({
    userId: req.user.id,
    operation: "prestamos.crear",
    key: req.get("Idempotency-Key"),
    payload: {
      cuenta_id: cuentaId,
      monto: simulacion.monto,
      cuotas: simulacion.cuotas,
      tasa: simulacion.tasa,
    },
    work: async (connection) => {
      const [cuentas] = await connection.query(
        "SELECT id, saldo FROM cuentas WHERE id = ? AND usuario_id = ? FOR UPDATE",
        [cuentaId, req.user.id]
      );
      if (!cuentas.length) throw httpError(404, "Cuenta no encontrada");

      const saldo = parseMoney(cuentas[0].saldo, { allowZero: true });
      if (saldo == null) throw httpError(500, "Error interno");
      const resultante = addCentsWithinLimit(saldo, simulacion.monto);
      if (resultante == null) throw httpError(400, "El saldo resultante excede el máximo permitido");
      const monto = centsToDecimal(simulacion.monto);

      const [prestamo] = await connection.query(
        `INSERT INTO prestamos (usuario_id, monto_solicitado, cuotas, tasa_interes, estado)
         VALUES (?, ?, ?, ?, 'activo')`,
        [req.user.id, monto, simulacion.cuotas, simulacion.tasa]
      );
      await connection.query("UPDATE cuentas SET saldo = ? WHERE id = ?", [centsToDecimal(resultante), cuentaId]);
      await connection.query(
        `INSERT INTO movimientos (cuenta_id, tipo, monto, saldo_resultante, referencia_id)
         VALUES (?, 'prestamo', ?, ?, ?)`,
        [cuentaId, monto, centsToDecimal(resultante), prestamo.insertId]
      );
      return {
        id: prestamo.insertId,
        cuenta_id: cuentaId,
        monto_solicitado: monto,
        cuotas: simulacion.cuotas,
        tasa_interes: simulacion.tasa,
        estado: "activo",
        saldo_resultante: centsToDecimal(resultante),
        ...simulacion.calculo,
      };
    },
  });

  res.status(201).json(prestamoCreado);
}));

module.exports = router;
