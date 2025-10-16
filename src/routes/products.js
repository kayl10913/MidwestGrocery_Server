const express = require('express');
const { authRequired } = require('../middleware/auth');
const { 
  listProducts, 
  getProduct, 
  updateProduct, 
  uploadProductImage, 
  deleteProductImage, 
  cleanupOrphanedImages,
  getProductImage,
  getProductImagePlaceholder,
  getProductThumbnail,
  getAllProductsLazy,
  getLowStockItems
} = require('../controllers/productsController');
const { handleUpload } = require('../middleware/upload');

const router = express.Router();

router.get('/', authRequired, listProducts);
router.get('/public', listProducts);
router.get('/lazy', authRequired, getAllProductsLazy);
router.get('/lazy/public', getAllProductsLazy);
router.get('/low-stock', authRequired, getLowStockItems);
router.get('/low-stock/public', getLowStockItems);
router.get('/:id', authRequired, getProduct);
router.get('/:id/image', authRequired, getProductImage);
router.get('/:id/image/placeholder', authRequired, getProductImagePlaceholder);
router.get('/:id/image/thumbnail', authRequired, getProductThumbnail);
router.patch('/:id', authRequired, updateProduct);
router.post('/:id/image', authRequired, handleUpload, uploadProductImage);
router.delete('/:id/image', authRequired, deleteProductImage);
router.post('/cleanup-images', authRequired, cleanupOrphanedImages);

module.exports = router;


