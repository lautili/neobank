require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");

async function ensureColumn(connection, table, column, definition) {
  const [rows] = await connection.query(
    `SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  if (!rows.length) {
    await connection.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
  }
}

async function main() {
  const schema = fs.readFileSync(path.join(__dirname, "..", "..", "db", "schema.sql"), "utf8");
  const connection = await mysql.createConnection({
    host: process.env.MYSQL_HOST || "127.0.0.1",
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || "root",
    password: process.env.MYSQL_PASSWORD || "",
    multipleStatements: true,
  });

  try {
    await connection.query(schema);
    await ensureColumn(connection, "usuarios", "alias", "VARCHAR(30) NULL");
    await ensureColumn(connection, "usuarios", "alias_updated_at", "DATETIME NULL");
    await ensureColumn(connection, "usuarios", "avatar_url", "VARCHAR(2048) NULL");
    await ensureColumn(connection, "plazos_fijos", "liquidado_at", "DATETIME NULL");
    await connection.query(
      `ALTER TABLE movimientos MODIFY tipo ENUM(
        'ingreso', 'extraccion', 'transferencia_enviada', 'transferencia_recibida',
        'prestamo', 'plazo_fijo', 'plazo_fijo_cancelado', 'plazo_fijo_vencido'
      ) NOT NULL`
    );
    await connection.query(
      "ALTER TABLE plazos_fijos MODIFY estado ENUM('activo', 'finalizado', 'cancelado') NOT NULL DEFAULT 'activo'"
    );
    console.log(`Base ${process.env.MYSQL_DATABASE || "neobank"} lista`);
  } catch (error) {
    console.error(error.code || "DB_SETUP_ERROR");
    process.exitCode = 1;
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error(error.code || "DB_SETUP_ERROR");
  process.exitCode = 1;
});
