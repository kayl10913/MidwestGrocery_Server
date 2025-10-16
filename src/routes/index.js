const express = require('express');
const router = express.Router();

router.get('/health', (_req, res) => res.json({ status: 'ok' }));

// mount sub-routers
router.use('/auth', require('./auth'));
router.use('/sync', require('./sync'));
router.use('/import', require('./import'));
router.use('/products', require('./products'));
router.use('/suppliers', require('./suppliers'));
router.use('/orders', require('./orders'));
router.use('/dashboard', require('./metrics'));

module.exports = router;


