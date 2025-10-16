const db = require('../config/db');

async function listSuppliers(_req, res) {
  try {
    const [rows] = await db.query(`
      SELECT s.id, s.name, s.contact, s.last_delivery, s.created_at,
             GROUP_CONCAT(p.name ORDER BY p.name SEPARATOR ',') AS items_csv
      FROM suppliers s
      LEFT JOIN supplier_products sp ON sp.supplier_id = s.id
      LEFT JOIN products p ON p.id = sp.product_id
      GROUP BY s.id
      ORDER BY s.name ASC
    `);
    const suppliers = rows.map(r => ({
      id: r.id,
      name: r.name,
      contact: r.contact,
      last_delivery: r.last_delivery,
      created_at: r.created_at,
      items: r.items_csv ? r.items_csv.split(',') : []
    }));
    res.json({ suppliers });
  } catch (_e) {
    res.status(500).json({ message: 'Server error' });
  }
}

async function createSupplier(req, res) {
  const { name, contact = null, lastDelivery = null } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ message: 'Name required' });
  try {
    const [result] = await db.query('INSERT INTO suppliers (name, contact, last_delivery) VALUES (?, ?, ?)', [name.trim(), contact, lastDelivery]);
    const [rows] = await db.query('SELECT id, name, contact, last_delivery, created_at FROM suppliers WHERE id = ?', [result.insertId]);
    res.status(201).json({ supplier: rows[0] });
  } catch (_e) {
    res.status(500).json({ message: 'Server error' });
  }
}

async function updateSupplier(req, res) {
  const { id } = req.params;
  const { name, contact = null, lastDelivery = null } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ message: 'Name required' });
  try {
    await db.query('UPDATE suppliers SET name = ?, contact = ?, last_delivery = ? WHERE id = ?', [name.trim(), contact, lastDelivery, id]);
    const [rows] = await db.query('SELECT id, name, contact, last_delivery, created_at FROM suppliers WHERE id = ?', [id]);
    res.json({ supplier: rows[0] });
  } catch (_e) {
    res.status(500).json({ message: 'Server error' });
  }
}

async function deleteSupplier(req, res) {
  const { id } = req.params;
  try {
    await db.query('DELETE FROM supplier_products WHERE supplier_id = ?', [id]);
    await db.query('DELETE FROM suppliers WHERE id = ?', [id]);
    res.json({ success: true });
  } catch (_e) {
    res.status(500).json({ message: 'Server error' });
  }
}

async function addSupplierProduct(req, res) {
  const supplierId = Number(req.params.id);
  const { productId } = req.body || {};
  if (!Number.isFinite(supplierId) || !Number.isFinite(productId)) {
    return res.status(400).json({ message: 'Invalid ids' });
  }
  try {
    await db.query('INSERT IGNORE INTO supplier_products (supplier_id, product_id) VALUES (?, ?)', [supplierId, productId]);
    res.json({ success: true });
  } catch (_e) {
    res.status(500).json({ message: 'Server error' });
  }
}

async function restockSupplierProduct(req, res) {
  const supplierId = Number(req.params.id);
  const { productId, qty, date } = req.body || {};
  if (!Number.isFinite(supplierId) || !Number.isFinite(productId)) {
    return res.status(400).json({ message: 'Invalid ids' });
  }
  const quantity = Number(qty) || 0;
  if (quantity <= 0) return res.status(400).json({ message: 'Quantity must be > 0' });
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query('UPDATE products SET stock = stock + ? WHERE id = ? LIMIT 1', [quantity, productId]);
    await conn.query('UPDATE suppliers SET last_delivery = ? WHERE id = ? LIMIT 1', [date || new Date(), supplierId]);
    await conn.query('INSERT IGNORE INTO supplier_products (supplier_id, product_id) VALUES (?, ?)', [supplierId, productId]);
    const [[product]] = await conn.query('SELECT id, name, category, price, stock FROM products WHERE id = ? LIMIT 1', [productId]);
    const [[supplier]] = await conn.query('SELECT id, name, contact, last_delivery FROM suppliers WHERE id = ? LIMIT 1', [supplierId]);
    await conn.commit();
    res.json({ success: true, product, supplier });
  } catch (e) {
    await conn.rollback();
    res.status(500).json({ message: 'Server error' });
  } finally {
    conn.release();
  }
}

module.exports = { listSuppliers, createSupplier, updateSupplier, deleteSupplier, addSupplierProduct, restockSupplierProduct };


