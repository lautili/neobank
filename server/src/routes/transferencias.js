const express = require("express");
const { pool } = require("../db");
const { httpError } = require("../errors");
const { asyncHandler } = require("../middleware/asyncHandler");
const { requireAuth } = require("../middleware/auth");
const { addCentsWithinLimit, centsToDecimal, parseDescripcion, parseId, parseMoney } = require("../money");
const { runIdempotent } = require("../idempotency");

const router = express.Router();
router.use(requireAuth);

router.get("/", asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT DISTINCT t.id, t.cuenta_origen_id, t.cuenta_destino_id, t.monto, t.descripcion, t.created_at
     FROM transferencias t
     JOIN cuentas c ON c.id = t.cuenta_origen_id OR c.id = t.cuenta_destino_id
     WHERE c.usuario_id = ?
     ORDER BY t.id DESC
     LIMIT 100`,
    [req.user.id]
  );
  res.json(rows);
}));

router.post("/", asyncHandler(async (req, res) => {
  const origenId = parseId(req.body?.cuenta_origen_id);
  const destino = String(req.body?.destino ?? "").trim();
  const monto = parseMoney(req.body?.monto);
  const descripcion = parseDescripcion(req.body?.descripcion);
  if (!origenId || !/^\d{22}$/.test(destino) || !monto || descripcion === undefined) {
    throw httpError(400, "Datos de transferencia inválidos");
  }

  const { result: transferencia } = await runIdempotent({
    userId: req.user.id,
    operation: "transferencias.crear",
    key: req.get("Idempotency-Key"),
    payload: { cuenta_origen_id: origenId, destino, monto, descripcion },
    work: async (connection) => {
      const [origenPropio] = await connection.query(
        "SELECT id FROM cuentas WHERE id = ? AND usuario_id = ?",
        [origenId, req.user.id]
      );
      if (!origenPropio.length) throw httpError(404, "Cuenta de origen no encontrada");

      const [destinos] = await connection.query(
        "SELECT id FROM cuentas WHERE cbu = ? OR cvu = ?",
        [destino, destino]
      );
      if (destinos.length !== 1) throw httpError(404, "Cuenta de destino no encontrada");
      const destinoId = destinos[0].id;
      if (destinoId === origenId) throw httpError(400, "La cuenta de destino debe ser distinta");

      const primero = Math.min(origenId, destinoId);
      const segundo = Math.max(origenId, destinoId);
      const [bloqueadas] = await connection.query(
        "SELECT id, saldo, moneda FROM cuentas WHERE id IN (?, ?) ORDER BY id FOR UPDATE",
        [primero, segundo]
      );
      if (bloqueadas.length !== 2) throw httpError(404, "Cuenta no encontrada");

      const origen = bloqueadas.find((cuenta) => cuenta.id === origenId);
      const destinoCuenta = bloqueadas.find((cuenta) => cuenta.id === destinoId);
      if (origen.moneda !== destinoCuenta.moneda) {
        throw httpError(400, "Las cuentas deben usar la misma moneda");
      }

      const saldoOrigen = parseMoney(origen.saldo, { allowZero: true });
      const saldoDestino = parseMoney(destinoCuenta.saldo, { allowZero: true });
      if (saldoOrigen == null || saldoDestino == null) throw httpError(500, "Error interno");
      if (saldoOrigen < monto) throw httpError(400, "Saldo insuficiente");

      const nuevoOrigen = saldoOrigen - monto;
      const nuevoDestino = addCentsWithinLimit(saldoDestino, monto);
      if (nuevoDestino == null) throw httpError(400, "El saldo resultante excede el máximo permitido");
      const montoDecimal = centsToDecimal(monto);

      await connection.query("UPDATE cuentas SET saldo = ? WHERE id = ?", [centsToDecimal(nuevoOrigen), origenId]);
      await connection.query("UPDATE cuentas SET saldo = ? WHERE id = ?", [centsToDecimal(nuevoDestino), destinoId]);
      const [transferencia] = await connection.query(
        `INSERT INTO transferencias (cuenta_origen_id, cuenta_destino_id, monto, descripcion)
         VALUES (?, ?, ?, ?)`,
        [origenId, destinoId, montoDecimal, descripcion]
      );
      await connection.query(
        `INSERT INTO movimientos (cuenta_id, tipo, monto, saldo_resultante, referencia_id)
         VALUES (?, 'transferencia_enviada', ?, ?, ?)`,
        [origenId, montoDecimal, centsToDecimal(nuevoOrigen), transferencia.insertId]
      );
      await connection.query(
        `INSERT INTO movimientos (cuenta_id, tipo, monto, saldo_resultante, referencia_id)
         VALUES (?, 'transferencia_recibida', ?, ?, ?)`,
        [destinoId, montoDecimal, centsToDecimal(nuevoDestino), transferencia.insertId]
      );
      return {
        id: transferencia.insertId,
        cuenta_origen_id: origenId,
        cuenta_destino_id: destinoId,
        monto: montoDecimal,
        descripcion,
        saldo_resultante: centsToDecimal(nuevoOrigen),
      };
    },
  });

  res.status(201).json(transferencia);
}));

module.exports = router;
