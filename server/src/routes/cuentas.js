const express = require("express");
const { pool, withTransaction } = require("../db");
const { httpError } = require("../errors");
const { asyncHandler } = require("../middleware/asyncHandler");
const { requireAuth } = require("../middleware/auth");
const { addCentsWithinLimit, centsToDecimal, parseId, parseMoney } = require("../money");
const { runIdempotent } = require("../idempotency");
const { settleMaturedFixedDeposits } = require("../fixedDeposits");

const router = express.Router();
router.use(requireAuth);

const cuentaFields = "id, usuario_id, cbu, cvu, alias, alias_updated_at, saldo, moneda, created_at";
const ALIAS_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{5,29}$/;

router.get("/", asyncHandler(async (req, res) => {
  const rows = await withTransaction(async (connection) => {
    // Los saldos de dashboard deben incluir vencimientos acreditados aunque no se visite /plazos-fijos.
    await settleMaturedFixedDeposits(connection, req.user.id);
    const [accounts] = await connection.query(
      `SELECT ${cuentaFields} FROM cuentas WHERE usuario_id = ? ORDER BY id`,
      [req.user.id]
    );
    return accounts;
  });
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

router.patch("/:id/alias", asyncHandler(async (req, res) => {
  const id = parseId(req.params.id);
  const rawAlias = req.body?.alias;
  const alias = rawAlias === null ? null : typeof rawAlias === "string" ? rawAlias.trim().toLowerCase() : undefined;
  if (!id || (alias !== null && (typeof alias !== "string" || !ALIAS_PATTERN.test(alias)))) {
    throw httpError(400, "Alias inválido: usá de 6 a 30 letras, números, puntos, guiones o guiones bajos, sin espacios");
  }

  const cuenta = await withTransaction(async (connection) => {
    const [rows] = await connection.query(
      `SELECT id, usuario_id, cbu, cvu, alias, alias_updated_at, saldo, moneda, created_at,
              (alias_updated_at IS NULL OR alias_updated_at <= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 30 DAY))
                AS alias_change_allowed
       FROM cuentas WHERE id = ? AND usuario_id = ? FOR UPDATE`,
      [id, req.user.id]
    );
    if (!rows.length) throw httpError(404, "Cuenta no encontrada");
    const current = rows[0];
    if (alias !== current.alias && !current.alias_change_allowed) {
      throw httpError(429, "El alias de esta cuenta solo puede cambiarse una vez cada 30 días");
    }

    if (alias !== current.alias) {
      try {
        await connection.query(
          "UPDATE cuentas SET alias = ?, alias_updated_at = UTC_TIMESTAMP() WHERE id = ?",
          [alias, id]
        );
      } catch (error) {
        if (error.code === "ER_DUP_ENTRY") {
          throw httpError(409, "Ese alias ya está asociado a otra cuenta");
        }
        throw error;
      }
    }
    const [updated] = await connection.query(
      `SELECT ${cuentaFields} FROM cuentas WHERE id = ? AND usuario_id = ?`,
      [id, req.user.id]
    );
    return updated[0];
  });

  res.json({ cuenta });
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
