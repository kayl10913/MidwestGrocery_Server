const db = require('../config/db');

async function listOrders(req, res) {
  try {
    const page = Math.max(parseInt(req.query.page || '1'), 1);
    const pageSize = Math.min(Math.max(parseInt(req.query.pageSize || '20'), 1), 100);
    const offset = (page - 1) * pageSize;
    const deviceId = req.query.device_id;
    
    let query = 'SELECT id, order_code, name, contact, address, status, type, payment, ref, totalPrice, discount, net_total, device_id, created_at FROM orders';
    let countQuery = 'SELECT COUNT(*) AS total FROM orders';
    let params = [];
    let countParams = [];
    
    // Filter by device_id if provided
    if (deviceId) {
      query += ' WHERE device_id = ?';
      countQuery += ' WHERE device_id = ?';
      params.push(deviceId);
      countParams.push(deviceId);
    }
    
    query += ' ORDER BY id DESC LIMIT ? OFFSET ?';
    params.push(pageSize, offset);
    
    const [rows] = await db.query(query, params);
    const [[{ total }]] = await db.query(countQuery, countParams);
    res.json({ orders: rows, page, pageSize, total });
  } catch (_e) {
    res.status(500).json({ message: 'Server error' });
  }
}

async function updateOrderPayment(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    const { payment, ref, status, device_id, fcm_token } = req.body || {};
    if (!Number.isFinite(id)) return res.status(400).json({ message: 'Invalid id' });

    // Validate enum values
    const validPayments = ['Cash', 'GCash'];
    const validStatuses = ['Pending', 'Processing', 'Completed', 'Cancelled', 'Declined', 'Delivered'];

    if (payment && !validPayments.includes(payment)) {
      return res.status(400).json({ message: 'Invalid payment method. Must be Cash or GCash' });
    }

    if (status && !validStatuses.includes(status)) {
      return res.status(400).json({ message: 'Invalid status. Must be one of: ' + validStatuses.join(', ') });
    }

    // Detect optional columns to avoid errors on schemas without them
    let has_device_id = 0, has_fcm_token = 0;
    let has_track_stock = 0;
    try {
      const [[rowDev]] = await db.query(
        "SELECT COUNT(*) AS has_device_id FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'orders' AND column_name = 'device_id'"
      );
      has_device_id = Number(rowDev && rowDev.has_device_id) ? 1 : 0;
    } catch (e) { /* ignore, default 0 */ }
    try {
      const [[rowFcm]] = await db.query(
        "SELECT COUNT(*) AS has_fcm_token FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'orders' AND column_name = 'fcm_token'"
      );
      has_fcm_token = Number(rowFcm && rowFcm.has_fcm_token) ? 1 : 0;
    } catch (e) { /* ignore, default 0 */ }
    try {
      const [[rowTrack]] = await db.query(
        "SELECT COUNT(*) AS has_track_stock FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'products' AND column_name = 'track_stock'"
      );
      has_track_stock = Number(rowTrack && rowTrack.has_track_stock) ? 1 : 0;
    } catch (e) { /* ignore, default 0 */ }

    // Check if device_id matches (if provided and column exists)
    if (device_id && has_device_id) {
      const [existingOrder] = await db.query('SELECT device_id FROM orders WHERE id = ?', [id]);
      if (existingOrder.length === 0) {
        return res.status(404).json({ message: 'Order not found' });
      }
      if (existingOrder[0].device_id !== device_id) {
        return res.status(403).json({ message: 'Access denied. This order belongs to a different device.' });
      }
    }

    // allow partial updates: at least one field must be provided
    const fields = [];
    const values = [];
    if (typeof payment !== 'undefined') { fields.push('payment = ?'); values.push(payment); }
    if (typeof ref !== 'undefined') { fields.push('ref = ?'); values.push(ref); }
    if (typeof status !== 'undefined') { fields.push('status = ?'); values.push(status); }
    if (fields.length === 0) return res.status(400).json({ message: 'No update fields' });

    // Optionally store/refresh fcm_token if provided
    if (typeof fcm_token !== 'undefined' && has_fcm_token) {
      fields.push('fcm_token = ?');
      values.push(fcm_token);
    }

    // If moving to Processing, adjust inventory once using a transaction guarded by previous status
    let updated; // ensure availability for response and FCM
    if (status === 'Processing') {
      const conn = await db.getConnection();
      try {
        await conn.beginTransaction();

        // Lock the order row to prevent race conditions
        const selectCols = has_device_id ? 'id, status, device_id' : 'id, status';
        const [lockedRows] = await conn.query(`SELECT ${selectCols} FROM orders WHERE id = ? LIMIT 1 FOR UPDATE`, [id]);
        if (!lockedRows.length) {
          await conn.rollback();
          conn.release();
          return res.status(404).json({ message: 'Not found' });
        }

        // Re-validate device_id under the same transaction if provided and column exists
        if (has_device_id && device_id && lockedRows[0].device_id && lockedRows[0].device_id !== device_id) {
          await conn.rollback();
          conn.release();
          return res.status(403).json({ message: 'Access denied. This order belongs to a different device.' });
        }

        const previousStatus = lockedRows[0].status;

        // Update order fields (including status/payment/ref/fcm_token) within transaction
        const txFields = [...fields];
        const txValues = [...values];
        txValues.push(id);
        await conn.query(`UPDATE orders SET ${txFields.join(', ')} WHERE id = ?`, txValues);

        // Only decrement stock if transitioning into Processing (avoid double-decrement)
        let itemsProcessed = 0;
        let stockUpdates = 0;
        if (previousStatus !== 'Processing') {
          try {
            const [items] = await conn.query('SELECT product_id, COALESCE(quantity, qty) AS qty FROM order_items WHERE order_id = ?', [id]);
            itemsProcessed = Array.isArray(items) ? items.length : 0;
            for (const item of items) {
              const qty = Number(item.qty) || 0;
              if (qty <= 0) continue;
              await conn.query(
                'UPDATE products SET stock = GREATEST(stock - ?, 0) WHERE id = ?',
                [qty, item.product_id]
              );
              stockUpdates += 1;
            }
          } catch (e) {
            // If order_items table doesn't exist or query fails, skip decrement but still update status
            try { console.warn('Inventory decrement skipped:', e.message); } catch (_e) {}
          }
        }

        await conn.commit();
        const selectAfterCols = has_device_id ? 'id, order_code, name, contact, address, status, type, payment, ref, totalPrice, discount, net_total, device_id, created_at' : 'id, order_code, name, contact, address, status, type, payment, ref, totalPrice, discount, net_total, created_at';
        const [rows] = await db.query(`SELECT ${selectAfterCols} FROM orders WHERE id = ? LIMIT 1`, [id]);
        updated = rows[0];
        // attach diagnostics to help clients verify stock updates
        updated.items_processed = itemsProcessed;
        updated.stock_updates = stockUpdates;
      } catch (_txe) {
        try { await conn.rollback(); } catch (_e2) {}
        try { conn.release(); } catch (_e3) {}
        try { console.error('updateOrderPayment tx error:', _txe.message); } catch (_e4) {}
        return res.status(500).json({ message: 'Server error' });
      } finally {
        try { conn.release(); } catch (_e4) {}
      }
    } else {
      values.push(id);
      await db.query(`UPDATE orders SET ${fields.join(', ')} WHERE id = ?`, values);
      const selectAfterCols = has_device_id ? 'id, order_code, name, contact, address, status, type, payment, ref, totalPrice, discount, net_total, device_id, created_at' : 'id, order_code, name, contact, address, status, type, payment, ref, totalPrice, discount, net_total, created_at';
      const [rows] = await db.query(`SELECT ${selectAfterCols} FROM orders WHERE id = ? LIMIT 1`, [id]);
      if (!rows.length) return res.status(404).json({ message: 'Not found' });
      updated = rows[0];
    }

    // Send response once
    res.json({ order: updated });

    // Fire FCM push if possible
    if (status && validStatuses.includes(status) && has_fcm_token) {
      try {
        const [[tokRow]] = await db.query('SELECT fcm_token FROM orders WHERE id = ? LIMIT 1', [id]);
        const token = tokRow && tokRow.fcm_token;
        if (token) {
          const { initFirebaseAdmin, admin } = require('../config/fcm');
          initFirebaseAdmin();
          if (admin.apps && admin.apps.length > 0) {
            let title;
            let body;
            switch (status) {
              case 'Processing':
                title = 'Order Being Processed';
                body = `Your order #${updated.order_code} is now being prepared.`;
                break;
              case 'Completed':
                title = 'Order Completed';
                body = `Your order #${updated.order_code} has been completed.`;
                break;
              case 'Delivered':
                title = 'Order Delivered!';
                body = `Your order #${updated.order_code} has been delivered successfully.`;
                break;
              case 'Cancelled':
                title = 'Order Cancelled';
                body = `Your order #${updated.order_code} has been cancelled.`;
                break;
              case 'Declined':
                title = 'Order Declined';
                body = `Your order #${updated.order_code} was declined. Please contact support.`;
                break;
              default:
                title = 'Order Update';
                body = `Your order #${updated.order_code} status has been updated to ${status}.`;
            }
            await admin.messaging().send({
              token,
              notification: { title, body },
              data: {
                orderId: String(updated.id),
                orderCode: updated.order_code,
                status,
              },
            });
          }
        }
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('FCM send error:', e.message);
      }
    }
  } catch (_e) {
    res.status(500).json({ message: 'Server error' });
  }
}

async function createOrder(req, res) {
  try {
    const { name, contact, address, payment, ref, totalPrice, discount, net_total, status, type, device_id, fcm_token, items = [] } = req.body || {};

    if (!name || typeof name !== 'string') {
      return res.status(400).json({ message: 'Name is required' });
    }

    if (!totalPrice || typeof totalPrice !== 'number') {
      return res.status(400).json({ message: 'Total price is required' });
    }

    if (!device_id || typeof device_id !== 'string') {
      return res.status(400).json({ message: 'Device ID is required' });
    }

    // Validate enum values
    const validPayments = ['Cash', 'GCash'];
    const validStatuses = ['Pending', 'Processing', 'Completed', 'Cancelled', 'Declined', 'Delivered'];
    const validTypes = ['Online', 'In-Store'];

    if (payment && !validPayments.includes(payment)) {
      return res.status(400).json({ message: 'Invalid payment method. Must be Cash or GCash' });
    }

    if (status && !validStatuses.includes(status)) {
      return res.status(400).json({ message: 'Invalid status. Must be one of: ' + validStatuses.join(', ') });
    }

    if (type && !validTypes.includes(type)) {
      return res.status(400).json({ message: 'Invalid type. Must be Online or In-Store' });
    }

    // Generate order code
    const orderCode = 'ORD' + Date.now().toString().slice(-6);

    // Insert order and its items in a transaction
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();

      const [result] = await conn.query(
        'INSERT INTO orders (order_code, name, contact, address, payment, ref, totalPrice, discount, net_total, status, type, device_id, fcm_token) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [orderCode, name, contact || null, address || null, payment || 'Cash', ref || null, totalPrice, discount || 0, net_total || totalPrice, status || 'Pending', type || 'Online', device_id, fcm_token || null]
      );

      const orderId = result.insertId;

      // Insert order items if provided
      let insertedItems = 0;
      if (Array.isArray(items)) {
        for (const it of items) {
          const productId = Number(it.product_id || it.productId);
          const quantity = Number(it.quantity || it.qty || 0);
          if (!Number.isFinite(productId) || productId <= 0 || !Number.isFinite(quantity) || quantity <= 0) continue;
          // Use provided price or fetch from products
          let unitPrice = Number(it.price);
          if (!Number.isFinite(unitPrice)) {
            const [[prod]] = await conn.query('SELECT price FROM products WHERE id = ? LIMIT 1', [productId]);
            unitPrice = prod ? Number(prod.price) || 0 : 0;
          }
          try {
            await conn.query(
              'INSERT INTO order_items (order_id, product_id, quantity, unit_price) VALUES (?, ?, ?, ?)',
              [orderId, productId, quantity, unitPrice]
            );
            insertedItems += 1;
          } catch (e) {
            try { console.warn('order_items insert skipped:', e.message, { orderId, productId, quantity }); } catch (_e) {}
          }
        }
      }

      await conn.commit();

      // Respond with created order
      const [rows] = await db.query('SELECT id, order_code, name, contact, address, status, type, payment, ref, totalPrice, discount, net_total, device_id, created_at FROM orders WHERE id = ? LIMIT 1', [orderId]);
      res.status(201).json({ order: rows[0], inserted_items: insertedItems });
    } catch (e) {
      try { await conn.rollback(); } catch (_e) {}
      return res.status(500).json({ message: 'Server error' });
    } finally {
      try { conn.release(); } catch (_e2) {}
    }
  } catch (_e) {
    res.status(500).json({ message: 'Server error' });
  }
}

async function getOrder(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    const deviceId = req.query.device_id;
    if (!Number.isFinite(id)) return res.status(400).json({ message: 'Invalid id' });

    let query = 'SELECT id, order_code, name, contact, address, status, type, payment, ref, totalPrice, discount, net_total, device_id, created_at FROM orders WHERE id = ?';
    let params = [id];
    
    // Filter by device_id if provided
    if (deviceId) {
      query += ' AND device_id = ?';
      params.push(deviceId);
    }
    
    query += ' LIMIT 1';
    
    const [rows] = await db.query(query, params);
    if (!rows.length) return res.status(404).json({ message: 'Order not found' });
    const order = rows[0];
    // Attempt to include items with product names and quantities if table exists
    try {
      const [items] = await db.query(
        'SELECT oi.product_id, oi.quantity AS quantity, p.name AS product_name, oi.unit_price AS price FROM order_items oi LEFT JOIN products p ON p.id = oi.product_id WHERE oi.order_id = ? ORDER BY oi.id ASC',
        [id]
      );
      order.items = items.map(it => ({ product_id: it.product_id, name: it.product_name, quantity: Number(it.quantity) || 0, price: Number(it.price) || 0 }));
    } catch (_e) {
      // items optional
    }
    res.json({ order });
  } catch (_e) {
    res.status(500).json({ message: 'Server error' });
  }
}

async function getOrderItems(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ message: 'Invalid id' });
    const [items] = await db.query(
      'SELECT oi.id, oi.product_id, oi.quantity AS quantity, oi.unit_price AS price, p.name AS product_name FROM order_items oi LEFT JOIN products p ON p.id = oi.product_id WHERE oi.order_id = ? ORDER BY oi.id ASC',
      [id]
    );
    const data = items.map(it => ({ id: it.id, product_id: it.product_id, name: it.product_name, quantity: Number(it.quantity) || 0, price: Number(it.price) || 0 }));
    res.json({ items: data });
  } catch (_e) {
    res.status(500).json({ message: 'Server error' });
  }
}

module.exports = { listOrders, updateOrderPayment, createOrder, getOrder, getOrderItems };


