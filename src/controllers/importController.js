const fs = require('fs');
const { parse } = require('csv-parse');
const db = require('../config/db');

async function importProducts(req, res) {
  if (!req.file) return res.status(400).json({ message: 'CSV file required' });
  const filePath = req.file.path;
  let imported = 0;
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await new Promise((resolve, reject) => {
      const stream = fs.createReadStream(filePath)
        .pipe(parse({ columns: true, trim: true }))
        .on('data', async (row) => {
          stream.pause();
          try {
            // Map against export_items-1.csv
            const handle = row.Handle;
            const sku = row.SKU;
            const name = row.Name;
            if (!name) { stream.resume(); return; }
            const category = row.Category || null;
            const description = row.Description || null;
            const soldByWeight = (row['Sold by weight'] || 'N').toString().toUpperCase() === 'Y' ? 1 : 0;
            const option1Name = row['Option 1 name'] || null;
            const option1Value = row['Option 1 value'] || null;
            const option2Name = row['Option 2 name'] || null;
            const option2Value = row['Option 2 value'] || null;
            const option3Name = row['Option 3 name'] || null;
            const option3Value = row['Option 3 value'] || null;
            const cost = parseFloat(row.Cost || 0) || 0;
            const barcode = row.Barcode || null;
            const includedSku = row['SKU of included item'] || null;
            const includedQty = parseInt(row['Quantity of included item'] || 0) || 0;
            const trackStock = (row['Track stock'] || 'Y').toString().toUpperCase() === 'Y' ? 1 : 0;
            const available = (row['Available for sale [Midwest Grocery Store]'] || 'Y').toString().toUpperCase() === 'Y' ? 1 : 0;
            const price = parseFloat(row['Price [Midwest Grocery Store]'] || 0) || 0;
            const stock = parseInt(row['In stock [Midwest Grocery Store]'] || 0) || 0;
            const lowStock = parseInt(row['Low stock [Midwest Grocery Store]'] || 5) || 5;
            const taxField = row['"Tax - ""VAT"" (12%)"'] || row['Tax - "VAT" (12%)'] || null;
            let taxLabel = null, taxRate = 0;
            if (taxField) { taxLabel = 'VAT'; taxRate = 12; }
            await conn.query(
              'INSERT INTO products (handle, sku, name, category, description, sold_by_weight, option1_name, option1_value, option2_name, option2_value, option3_name, option3_value, cost, barcode, included_sku, included_qty, track_stock, available_for_sale, price, stock, low_stock_threshold, tax_label, tax_rate) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE sku=VALUES(sku), name=VALUES(name), category=VALUES(category), description=VALUES(description), sold_by_weight=VALUES(sold_by_weight), option1_name=VALUES(option1_name), option1_value=VALUES(option1_value), option2_name=VALUES(option2_name), option2_value=VALUES(option2_value), option3_name=VALUES(option3_name), option3_value=VALUES(option3_value), cost=VALUES(cost), barcode=VALUES(barcode), included_sku=VALUES(included_sku), included_qty=VALUES(included_qty), track_stock=VALUES(track_stock), available_for_sale=VALUES(available_for_sale), price=VALUES(price), stock=VALUES(stock), low_stock_threshold=VALUES(low_stock_threshold), tax_label=VALUES(tax_label), tax_rate=VALUES(tax_rate)'
              , [handle, sku, name, category, description, soldByWeight, option1Name, option1Value, option2Name, option2Value, option3Name, option3Value, cost, barcode, includedSku, includedQty, trackStock, available, price, stock, lowStock, taxLabel, taxRate]
            );
            imported += 1;
          } catch (_e) {}
          stream.resume();
        })
        .on('end', resolve)
        .on('error', reject);
    });
    await conn.commit();
    res.json({ message: 'Products imported', imported });
  } catch (e) {
    await conn.rollback();
    res.status(500).json({ message: 'Import failed' });
  } finally {
    fs.unlink(filePath, () => {});
    conn.release();
  }
}

async function importSales(req, res) {
  if (!req.file) return res.status(400).json({ message: 'CSV file required' });
  const filePath = req.file.path;
  let imported = 0;
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await new Promise((resolve, reject) => {
      const stream = fs.createReadStream(filePath)
        .pipe(parse({ columns: true, trim: true }))
        .on('data', async (row) => {
          stream.pause();
          try {
            // Map sales summary CSV to daily summary table
            const date = row.Date; // e.g., 2/6/25
            const gross = parseFloat(row['Gross sales'] || 0) || 0;
            const refunds = parseFloat(row['Refunds'] || 0) || 0;
            const discounts = parseFloat(row['Discounts'] || 0) || 0;
            const net = parseFloat(row['Net sales'] || 0) || 0;
            const cog = parseFloat(row['Cost of goods'] || 0) || 0;
            const profit = parseFloat(row['Gross profit'] || 0) || 0;
            const marginStr = (row['Margin'] || '0').toString().replace('%','');
            const margin = parseFloat(marginStr || 0) || 0;
            const taxes = parseFloat(row['Taxes'] || 0) || 0;
            // Normalize date to YYYY-MM-DD
            const summaryDate = new Date(date);
            const yyyy = summaryDate.getFullYear();
            const mm = String(summaryDate.getMonth()+1).padStart(2,'0');
            const dd = String(summaryDate.getDate()).padStart(2,'0');
            const isoDate = `${yyyy}-${mm}-${dd}`;
            await conn.query(
              'INSERT INTO sales_daily_summary (summary_date, gross_sales, refunds, discounts, net_sales, cost_of_goods, gross_profit, margin_percent, taxes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE gross_sales=VALUES(gross_sales), refunds=VALUES(refunds), discounts=VALUES(discounts), net_sales=VALUES(net_sales), cost_of_goods=VALUES(cost_of_goods), gross_profit=VALUES(gross_profit), margin_percent=VALUES(margin_percent), taxes=VALUES(taxes)'
              , [isoDate, gross, refunds, discounts, net, cog, profit, margin, taxes]
            );
            imported += 1;
          } catch (_e) {}
          stream.resume();
        })
        .on('end', resolve)
        .on('error', reject);
    });
    await conn.commit();
    res.json({ message: 'Sales imported', imported });
  } catch (e) {
    await conn.rollback();
    res.status(500).json({ message: 'Import failed' });
  } finally {
    fs.unlink(filePath, () => {});
    conn.release();
  }
}

module.exports = { importProducts, importSales };


