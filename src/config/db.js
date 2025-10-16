const mysql = require('mysql2/promise');
const dotenv = require('dotenv');

dotenv.config();

// Optional SSL for providers like Hostinger (set DB_SSL=true in env when required)
// Some providers require SNI (TLS servername) to match the cert hostname.
// If your DB_HOST is an IP, set DB_SSL_SERVERNAME to the host name from your provider.
const sslOption = process.env.DB_SSL === 'true'
  ? {
      rejectUnauthorized: false,
      ...(process.env.DB_SSL_SERVERNAME ? { servername: process.env.DB_SSL_SERVERNAME } : {}),
      minVersion: 'TLSv1.2',
    }
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


