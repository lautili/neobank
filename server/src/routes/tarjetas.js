const express = require("express");
const { pool } = require("../db");
const { httpError } = require("../errors");
const { asyncHandler } = require("../middleware/asyncHandler");
const { requireAuth } = require("../middleware/auth");
const { parseId } = require("../money");

const router = express.Router();
router.use(requireAuth);

router.get("/", asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT t.id, t.cuenta_id, t.numero_enmascarado, t.tipo, t.estado, t.limite_credito
     FROM tarjetas t
     JOIN cuentas c ON c.id = t.cuenta_id
     WHERE c.usuario_id = ?
     ORDER BY t.id`,
    [req.user.id]
  );
  res.json(rows);
}));

router.patch("/:id", asyncHandler(async (req, res) => {
  const id = parseId(req.params.id);
  const estado = req.body?.estado;
  if (!id || (estado !== "activa" && estado !== "bloqueada")) {
    throw httpError(400, "Estado de tarjeta inválido");
  }

  const [existentes] = await pool.query(
    `SELECT t.id
     FROM tarjetas t
     JOIN cuentas c ON c.id = t.cuenta_id
     WHERE t.id = ? AND c.usuario_id = ?`,
    [id, req.user.id]
  );
  if (!existentes.length) throw httpError(404, "Tarjeta no encontrada");

  await pool.query(
    `UPDATE tarjetas t
     JOIN cuentas c ON c.id = t.cuenta_id
     SET t.estado = ?
     WHERE t.id = ? AND c.usuario_id = ?`,
    [estado, id, req.user.id]
  );

  const [rows] = await pool.query(
    `SELECT t.id, t.cuenta_id, t.numero_enmascarado, t.tipo, t.estado, t.limite_credito
     FROM tarjetas t
     JOIN cuentas c ON c.id = t.cuenta_id
     WHERE t.id = ? AND c.usuario_id = ?`,
    [id, req.user.id]
  );
  res.json(rows[0]);
}));

module.exports = router;
