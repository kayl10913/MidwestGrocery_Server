const db = require('../config/db');

async function findUserByEmail(email) {
  const [rows] = await db.query('SELECT * FROM users WHERE email = ? LIMIT 1', [email]);
  return rows[0] || null;
}

async function createUser({ name, email, passwordHash, role = 'admin' }) {
  const [result] = await db.query(
    'INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)',
    [name, email, passwordHash, role]
  );
  return { id: result.insertId, name, email, role };
}

module.exports = { findUserByEmail, createUser };


