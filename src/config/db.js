const mysql = require('mysql2/promise');
const dotenv = require('dotenv');

dotenv.config();

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'midwest_grocery',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  // Enable SSL for providers like Hostinger when DB_SSL=true
  ...(String(process.env.DB_SSL || '').toLowerCase() === 'true'
    ? { ssl: { rejectUnauthorized: false } }
    : {}),
});

module.exports = pool;


