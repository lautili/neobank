const express = require("express");
const { pool } = require("../db");
const { httpError } = require("../errors");
const { asyncHandler } = require("../middleware/asyncHandler");
const { requireAuth } = require("../middleware/auth");
const { addCentsWithinLimit, centsToDecimal, parseId, parseMoney } = require("../money");
const { runIdempotent } = require("../idempotency");

const router = express.Router();
router.use(requireAuth);

const cuentaFields = "id, usuario_id, cbu, cvu, saldo, moneda, created_at";

router.get("/", asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT ${cuentaFields} FROM cuentas WHERE usuario_id = ? ORDER BY id`,
    [req.user.id]
  );
  res.json(rows);
}));

router.get("/:id", asyncHandler(async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) throw httpError(400, "Cuenta inválida");
  const [rows] = await pool.query(
    `SELECT ${cuentaFields} FROM cuentas WHERE id = ? AND usuario_id = ?`,
    [id, req.user.id]
  );
  if (!rows.length) throw httpError(404, "Cuenta no encontrada");
  res.json(rows[0]);
}));

router.get("/:id/movimientos", asyncHandler(async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) throw httpError(400, "Cuenta inválida");
  const [cuentas] = await pool.query(
    "SELECT id FROM cuentas WHERE id = ? AND usuario_id = ?",
    [id, req.user.id]
  );
  if (!cuentas.length) throw httpError(404, "Cuenta no encontrada");

  const [rows] = await pool.query(
    `SELECT id, cuenta_id, tipo, monto, saldo_resultante, referencia_id, created_at
     FROM movimientos WHERE cuenta_id = ? ORDER BY id DESC LIMIT 100`,
    [id]
  );
  res.json(rows);
}));

router.post("/:id/movimientos", asyncHandler(async (req, res) => {
  const id = parseId(req.params.id);
  const tipo = req.body?.tipo;
  const monto = parseMoney(req.body?.monto);
  if (!id || (tipo !== "ingreso" && tipo !== "extraccion") || !monto) {
    throw httpError(400, "Movimiento inválido");
  }

  const { result: movimiento } = await runIdempotent({
    userId: req.user.id,
    operation: "cuentas.movimientos",
    key: req.get("Idempotency-Key"),
    payload: { cuenta_id: id, tipo, monto },
    work: async (connection) => {
      const [cuentas] = await connection.query(
        "SELECT id, saldo FROM cuentas WHERE id = ? AND usuario_id = ? FOR UPDATE",
        [id, req.user.id]
      );
      if (!cuentas.length) throw httpError(404, "Cuenta no encontrada");

      const saldo = parseMoney(cuentas[0].saldo, { allowZero: true });
      if (saldo == null) throw httpError(500, "Error interno");
      if (tipo === "extraccion" && saldo < monto) throw httpError(400, "Saldo insuficiente");

      const resultante = tipo === "ingreso" ? addCentsWithinLimit(saldo, monto) : saldo - monto;
      if (resultante == null) throw httpError(400, "El saldo resultante excede el máximo permitido");
      await connection.query("UPDATE cuentas SET saldo = ? WHERE id = ?", [centsToDecimal(resultante), id]);
      const [mov] = await connection.query(
        `INSERT INTO movimientos (cuenta_id, tipo, monto, saldo_resultante) VALUES (?, ?, ?, ?)`,
        [id, tipo, centsToDecimal(monto), centsToDecimal(resultante)]
      );
      return {
        id: mov.insertId,
        cuenta_id: id,
        tipo,
        monto: centsToDecimal(monto),
        saldo_resultante: centsToDecimal(resultante),
      };
    },
  });

  res.status(201).json(movimiento);
}));

module.exports = router;
