require("dotenv").config();
const mysql = require("mysql2/promise");

const pool = mysql.createPool({
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT || 3306),
  database: process.env.DB_NAME || "jobease_db",
  user: process.env.DB_USER || "jobease_user",
  password: process.env.DB_PASSWORD || "NewPassword@123",
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

async function checkConnection() {
  const connection = await pool.getConnection();
  try {
    const [rows] = await connection.query(
      "SELECT DATABASE() AS database_name, @@hostname AS server_name, @@port AS server_port"
    );
    return rows[0];
  } finally {
    connection.release();
  }
}

module.exports = { pool, checkConnection };
