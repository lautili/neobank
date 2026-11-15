const mysql = require("mysql2/promise");
const { createTransactionRunner } = require("./transactions");

const pool = mysql.createPool({
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
  waitForConnections: true,
  connectionLimit: 10,
  namedPlaceholders: false,
  decimalNumbers: false,
  timezone: "Z",
});

const withTransaction = createTransactionRunner(pool);

module.exports = { pool, withTransaction, createTransactionRunner };
