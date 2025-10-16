const db = require('../config/db');

async function getMetrics(_req, res) {
  try {
    // Today-only metrics
    const [[{ total_sales = 0 }]] = await db.query("SELECT COALESCE(SUM(net_total),0) AS total_sales FROM orders WHERE DATE(created_at) = CURDATE()");
    const [[{ total_orders = 0 }]] = await db.query("SELECT COUNT(*) AS total_orders FROM orders WHERE DATE(created_at) = CURDATE()");
    const [[{ customers = 0 }]] = await db.query("SELECT COUNT(DISTINCT name) AS customers FROM orders WHERE DATE(created_at) = CURDATE()");
    const [[{ low_stock = 0 }]] = await db.query('SELECT COUNT(*) AS low_stock FROM products WHERE stock < 5');
    res.json({ totalSales: Number(total_sales), totalOrders: Number(total_orders), customers: Number(customers), lowStock: Number(low_stock) });
  } catch (_e) {
    res.status(500).json({ message: 'Server error' });
  }
}

async function getSalesOverview(_req, res) {
  try {
    // Last 7 days, aggregate totals by type if available (type column)
    const [rows] = await db.query(
      `SELECT DATE(created_at) as day,
              SUM(CASE WHEN type = 'Online' THEN net_total ELSE 0 END) AS online_total,
              SUM(CASE WHEN type <> 'Online' THEN net_total ELSE 0 END) AS instore_total
       FROM orders
       WHERE DATE(created_at) BETWEEN DATE_SUB(CURDATE(), INTERVAL 6 DAY) AND CURDATE()
       GROUP BY DATE(created_at)
       ORDER BY day ASC`
    );
    // Ensure 7 entries (fill missing days with zeros)
    // Normalize DB date key as YYYY-MM-DD regardless of driver returning Date or string
    const toKey = (d) => {
      if (!d) return '';
      if (d instanceof Date) return d.toISOString().slice(0, 10);
      const s = String(d);
      // Handle 'YYYY-MM-DD' strings directly
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
      try { return new Date(s).toISOString().slice(0,10); } catch (_e) { return s.slice(0,10); }
    };
    const map = new Map(rows.map(r => [toKey(r.day), r]));
    const result = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0,10);
      const item = map.get(key) || { day: key, online_total: 0, instore_total: 0 };
      result.push({ day: key, online: Number(item.online_total || 0), instore: Number(item.instore_total || 0) });
    }
    res.json({ days: result });
  } catch (_e) {
    res.status(500).json({ message: 'Server error' });
  }
}

module.exports = { getMetrics, getSalesOverview };


