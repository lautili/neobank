const crypto = require("crypto");
const { httpError } = require("./errors");

const KEY_PATTERN = /^[\x21-\x7e]{1,128}$/;

function hash(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function validateIdempotencyKey(value) {
  if (typeof value !== "string" || !KEY_PATTERN.test(value)) {
    throw httpError(400, "Se requiere un Idempotency-Key válido (1 a 128 caracteres ASCII imprimibles)");
  }
  return value;
}

function decodeResponse(value) {
  return typeof value === "string" ? JSON.parse(value) : value;
}

function createIdempotentExecutor(databasePool, transaction) {
  return async function execute({ userId, operation, key, payload, work }) {
    const keyHash = hash(validateIdempotencyKey(key));
    const payloadHash = hash(JSON.stringify(payload));

    try {
      return await transaction(async (connection) => {
        await connection.query(
          `INSERT INTO idempotency_requests (usuario_id, operacion, key_hash, payload_hash)
           VALUES (?, ?, ?, ?)`,
          [userId, operation, keyHash, payloadHash]
        );
        const result = await work(connection);
        await connection.query(
          `UPDATE idempotency_requests SET response_body = ?
           WHERE usuario_id = ? AND operacion = ? AND key_hash = ?`,
          [JSON.stringify(result), userId, operation, keyHash]
        );
        return { result, replayed: false };
      });
    } catch (error) {
      if (error.code !== "ER_DUP_ENTRY") throw error;

      const [rows] = await databasePool.query(
        `SELECT payload_hash, response_body FROM idempotency_requests
         WHERE usuario_id = ? AND operacion = ? AND key_hash = ?`,
        [userId, operation, keyHash]
      );
      if (!rows.length) throw error;
      if (rows[0].payload_hash !== payloadHash) {
        throw httpError(409, "La clave de idempotencia ya se utilizó con otros datos");
      }
      if (rows[0].response_body == null) {
        throw httpError(503, "El resultado de la operación aún no está disponible; reintentá");
      }
      return { result: decodeResponse(rows[0].response_body), replayed: true };
    }
  };
}

let defaultExecutor;
function runIdempotent(options) {
  if (!defaultExecutor) {
    const { pool, withTransaction } = require("./db");
    defaultExecutor = createIdempotentExecutor(pool, withTransaction);
  }
  return defaultExecutor(options);
}

module.exports = { createIdempotentExecutor, runIdempotent, validateIdempotencyKey };
