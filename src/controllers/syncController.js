const db = require('../config/db');

async function getAll(_req, res) {
  try {
    const [products] = await db.query('SELECT * FROM products ORDER BY id DESC');
    const [suppliers] = await db.query('SELECT * FROM suppliers ORDER BY id DESC');
    const [orders] = await db.query('SELECT * FROM orders ORDER BY id DESC');
    // For simplicity, items per order are omitted here; can be extended later
    res.json({ products, suppliers, orders });
  } catch (e) {
    res.status(500).json({ message: 'Server error' });
  }
}

async function saveAll(req, res) {
  const { products = [], suppliers = [], orders = [] } = req.body || {};
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // Replace-all strategy (simple and sufficient for now)
    await conn.query('DELETE FROM orders');
    await conn.query('DELETE FROM supplier_products');
    await conn.query('DELETE FROM suppliers');
    await conn.query('DELETE FROM products');

    for (const p of products) {
      await conn.query(
        'INSERT INTO products (id, name, category, price, stock, created_at) VALUES (?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP))',
        [p.id || null, p.name, p.category || null, p.price || 0, p.stock || 0, p.created_at || null]
      );
    }

    for (const s of suppliers) {
      const [result] = await conn.query(
        'INSERT INTO suppliers (id, name, contact, last_delivery, created_at) VALUES (?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP))',
        [s.id || null, s.name, s.contact || null, s.lastDelivery || null, s.created_at || null]
      );
      const supplierId = s.id || result.insertId;
      const items = Array.isArray(s.items) ? s.items : [];
      // Map item names to product ids by name
      for (const itemName of items) {
        const [prodRows] = await conn.query('SELECT id FROM products WHERE name = ? LIMIT 1', [itemName]);
        if (prodRows[0]) {
          await conn.query('INSERT IGNORE INTO supplier_products (supplier_id, product_id) VALUES (?, ?)', [supplierId, prodRows[0].id]);
        }
      }
    }

    for (const o of orders) {
      await conn.query(
        'INSERT INTO orders (id, order_code, customer_name, status, type, payment, ref, total, discount, net_total, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP))',
        [o.id || null, o.id || o.order_code || null, o.customer, o.status || 'Pending', o.type || 'Online', o.payment || 'Cash', o.ref || null, o.total || 0, o.discount || 0, o.netTotal || 0, o.created_at || null]
      );
    }

    await conn.commit();
    res.json({ message: 'Saved' });
  } catch (e) {
    await conn.rollback();
    res.status(500).json({ message: 'Server error' });
  } finally {
    conn.release();
  }
}

module.exports = { getAll, saveAll };


