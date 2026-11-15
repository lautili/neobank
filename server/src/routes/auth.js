const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { pool, withTransaction } = require("../db");
const { httpError } = require("../errors");
const { digits, maskedCard } = require("../ids");
const { asyncHandler } = require("../middleware/asyncHandler");
const { rateLimit, authRateLimit, authRateWindowMs, authRateMaxKeys } = require("../middleware/auth");

const router = express.Router();
const limited = rateLimit(authRateLimit, authRateWindowMs, { maxKeys: authRateMaxKeys });
const DUMMY_HASH = "$2a$12$R9h/cIPz0gi.URNNX3kh2OPST9/PgBkqquzi.Ss7KIUgO2t0jWMUW";

function validarRegistro(body) {
  const nombre = String(body.nombre ?? "").trim();
  const apellido = String(body.apellido ?? "").trim();
  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  const dni = String(body.dni ?? "").trim();

  if (!/^[\p{L} ]{2,100}$/u.test(nombre) || !/^[\p{L} ]{2,100}$/u.test(apellido)) {
    return null;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 255) return null;
  if (password.length < 8 || Buffer.byteLength(password) > 72) return null;
  if (!/^\d{7,8}$/.test(dni)) return null;

  return { nombre, apellido, email, password, dni };
}

router.post("/register", limited, asyncHandler(async (req, res) => {
  const data = validarRegistro(req.body || {});
  if (!data) throw httpError(400, "Datos de registro inválidos");

  const passwordHash = await bcrypt.hash(data.password, 12);
  const usuario = await withTransaction(async (connection) => {
    const [user] = await connection.query(
      `INSERT INTO usuarios (nombre, apellido, email, password_hash, dni)
       VALUES (?, ?, ?, ?, ?)`,
      [data.nombre, data.apellido, data.email, passwordHash, data.dni]
    );

    let cuentaId = null;
    for (let attempt = 0; attempt < 5 && !cuentaId; attempt += 1) {
      const cbu = digits(22);
      const cvu = digits(22);
      if (cbu === cvu) continue;
      try {
        const [cuenta] = await connection.query(
          `INSERT INTO cuentas (usuario_id, cbu, cvu) VALUES (?, ?, ?)`,
          [user.insertId, cbu, cvu]
        );
        cuentaId = cuenta.insertId;
        await connection.query(
          `INSERT INTO tarjetas (cuenta_id, numero_enmascarado, tipo, estado, limite_credito)
           VALUES (?, ?, 'debito', 'activa', NULL)`,
          [cuentaId, maskedCard()]
        );
      } catch (error) {
        if (error.code !== "ER_DUP_ENTRY") throw error;
      }
    }
    if (!cuentaId) throw httpError(500, "Error interno");
    return {
      id: user.insertId,
      nombre: data.nombre,
      apellido: data.apellido,
      email: data.email,
      dni: data.dni,
    };
  });

  const token = jwt.sign({ sub: usuario.id }, process.env.JWT_SECRET, { expiresIn: "8h" });
  res.status(201).json({ token, usuario });
}));

router.post("/login", limited, asyncHandler(async (req, res) => {
  const email = String(req.body?.email ?? "").trim().toLowerCase();
  const password = String(req.body?.password ?? "");
  if (!email || !password || password.length > 72) {
    throw httpError(400, "Credenciales inválidas");
  }

  const [rows] = await pool.query(
    `SELECT id, nombre, apellido, email, dni, password_hash FROM usuarios WHERE email = ?`,
    [email]
  );
  const user = rows[0];
  const matches = await bcrypt.compare(password, user ? user.password_hash : DUMMY_HASH);
  if (!user || !matches) throw httpError(401, "Credenciales inválidas");

  const token = jwt.sign({ sub: user.id }, process.env.JWT_SECRET, { expiresIn: "8h" });
  res.json({
    token,
    usuario: {
      id: user.id,
      nombre: user.nombre,
      apellido: user.apellido,
      email: user.email,
      dni: user.dni,
    },
  });
}));

module.exports = router;
