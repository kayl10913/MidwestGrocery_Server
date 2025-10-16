const express = require('express');
const morgan = require('morgan');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(morgan('dev'));

// Serve static files from uploads directory
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Serve static assets (like default images)
app.use('/assets', express.static(path.join(__dirname, '../assets')));

// Routes
const apiRouter = require('./routes');
app.use('/api', apiRouter);

app.get('/', (_req, res) => {
  res.json({ name: 'Midwest Grocery API', status: 'ok' });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Server running on port ${PORT}`);

  // Lightweight daily automation: roll up yesterday into sales_daily_summary at 00:05
  try {
    const db = require('./config/db');
    const schedule = require('node-schedule');
    schedule.scheduleJob('5 0 * * *', async () => {
      const sql = `
INSERT INTO sales_daily_summary
  (summary_date, gross_sales, refunds, discounts, net_sales, cost_of_goods, gross_profit, margin_percent, taxes)
SELECT
  DATE(o.created_at) AS summary_date,
  SUM(oi.qty * oi.price),
  SUM(o.refund_amount),
  SUM(o.discount),
  SUM(oi.qty * oi.price) - SUM(o.discount) - SUM(o.refund_amount),
  SUM(oi.qty * p.cost),
  (SUM(oi.qty * oi.price) - SUM(o.discount) - SUM(o.refund_amount)) - SUM(oi.qty * p.cost),
  CASE WHEN (SUM(oi.qty * oi.price) - SUM(o.discount) - SUM(o.refund_amount)) = 0 THEN 0
       ELSE ROUND(((SUM(oi.qty * oi.price) - SUM(o.discount) - SUM(o.refund_amount)) - SUM(oi.qty * p.cost)) /
                  (SUM(oi.qty * oi.price) - SUM(o.discount) - SUM(o.refund_amount)) * 100, 2) END,
  SUM(o.tax_amount)
FROM orders o
JOIN order_items oi ON oi.order_id = o.id
JOIN products p    ON p.id = oi.product_id
WHERE DATE(o.created_at) = CURDATE() - INTERVAL 1 DAY
GROUP BY DATE(o.created_at)
ON DUPLICATE KEY UPDATE
  gross_sales = VALUES(gross_sales),
  refunds     = VALUES(refunds),
  discounts   = VALUES(discounts),
  net_sales   = VALUES(net_sales),
  cost_of_goods = VALUES(cost_of_goods),
  gross_profit  = VALUES(gross_profit),
  margin_percent= VALUES(margin_percent),
  taxes         = VALUES(taxes);`;
      await db.query(sql);
      console.log('[scheduler] sales_daily_summary updated');
    });
  } catch (e) {
    console.warn('Scheduler init failed:', e.message);
  }
});


