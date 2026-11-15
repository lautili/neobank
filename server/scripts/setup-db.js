require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");

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
