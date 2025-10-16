const mysql = require('mysql2/promise');
const dotenv = require('dotenv');

dotenv.config();

// Optional SSL for providers like Hostinger (set DB_SSL=true in env when required)
const sslOption = process.env.DB_SSL === 'true'
  ? { rejectUnauthorized: false }
  : undefined;

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'midwest_grocery',
  ssl: sslOption,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

module.exports = pool;


