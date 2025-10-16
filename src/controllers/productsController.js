const db = require('../config/db');
const path = require('path');
const { imageOptimization, generatePlaceholder, checkImageExists, resizeImage, progressiveLoading } = require('../middleware/imageOptimization');

async function listProducts(req, res) {
  try {
    const page = Math.max(parseInt(req.query.page || '1'), 1);
    const pageSize = Math.min(Math.max(parseInt(req.query.pageSize || '25'), 1), 100);
    const offset = (page - 1) * pageSize;
    const search = req.query.search || '';
    
    // Build search condition
    let searchCondition = '';
    let searchParams = [];
    if (search) {
      searchCondition = 'WHERE name LIKE ? OR category LIKE ? OR description LIKE ?';
      const searchTerm = `%${search}%`;
      searchParams = [searchTerm, searchTerm, searchTerm];
    }
    
    // Get total count with search
    const countQuery = `SELECT COUNT(*) AS total FROM products ${searchCondition}`;
    const [[{ total }]] = await db.query(countQuery, searchParams);
    
    // Get paginated products with search
    const productsQuery = `
      SELECT id, name, category, description, price, stock, image, created_at 
      FROM products 
      ${searchCondition}
      ORDER BY name ASC 
      LIMIT ? OFFSET ?
    `;
    const [rows] = await db.query(productsQuery, [...searchParams, pageSize, offset]);
    
    // Add lazy loading support for images
    const products = rows.map(product => ({
      ...product,
      image_url: product.image ? `/uploads/${product.image}` : null,
      placeholder_url: product.image ? `/api/products/${product.id}/image/placeholder` : `/assets/images/Midwest.jpg`,
      has_image: !!product.image
    }));
    
    res.json({ 
      products, 
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize)
      }
    });
  } catch (_e) {
    console.error('Error in listProducts:', _e);
    res.status(500).json({ message: 'Server error' });
  }
}

async function updateProduct(req, res) {
  const id = Number(req.params.id);
  const { name, category, description, price, stock } = req.body || {};
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ message: 'Invalid id' });
  if (!name || typeof name !== 'string') return res.status(400).json({ message: 'Name required' });
  try {
    await db.query(
      'UPDATE products SET name = ?, category = ?, description = ?, price = ?, stock = ? WHERE id = ? LIMIT 1',
      [name, category || null, description || null, Number(price) || 0, Number(stock) || 0, id]
    );
    const [rows] = await db.query('SELECT id, name, category, description, price, stock, image, created_at FROM products WHERE id = ? LIMIT 1', [id]);
    if (!rows[0]) return res.status(404).json({ message: 'Not found' });
    const product = {
      ...rows[0],
      image_url: rows[0].image ? `/uploads/${rows[0].image}` : `/assets/images/Midwest.jpg`
    };
    res.json({ product });
  } catch (_e) {
    res.status(500).json({ message: 'Server error' });
  }
}

async function uploadProductImage(req, res) {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ message: 'Invalid id' });
  
  if (!req.file) {
    return res.status(400).json({ message: 'No image file provided' });
  }

  try {
    // Update product with image filename
    await db.query(
      'UPDATE products SET image = ? WHERE id = ? LIMIT 1',
      [req.file.filename, id]
    );
    
    // Get updated product
    const [rows] = await db.query('SELECT id, name, category, price, stock, image, created_at FROM products WHERE id = ? LIMIT 1', [id]);
    if (!rows[0]) return res.status(404).json({ message: 'Product not found' });
    
    const product = {
      ...rows[0],
      image_url: `/uploads/${rows[0].image}`
    };
    
    res.json({ 
      message: 'Image uploaded successfully',
      product 
    });
  } catch (_e) {
    res.status(500).json({ message: 'Server error' });
  }
}

async function deleteProductImage(req, res) {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ message: 'Invalid id' });
  
  try {
    // Get current product to find image filename
    const [rows] = await db.query('SELECT image FROM products WHERE id = ? LIMIT 1', [id]);
    if (!rows[0]) return res.status(404).json({ message: 'Product not found' });
    
    const currentImage = rows[0].image;
    console.log(`Deleting image for product ${id}: ${currentImage}`);
    
    // Remove image from database
    await db.query('UPDATE products SET image = NULL WHERE id = ? LIMIT 1', [id]);
    
    // Delete image file if it exists
    if (currentImage) {
      const fs = require('fs');
      const imagePath = path.join(__dirname, '../../uploads', currentImage);
      console.log(`Attempting to delete file: ${imagePath}`);
      
      if (fs.existsSync(imagePath)) {
        fs.unlinkSync(imagePath);
        console.log(`Successfully deleted file: ${imagePath}`);
      } else {
        console.log(`File not found: ${imagePath}`);
      }
    }
    
    res.json({ 
      message: 'Image deleted successfully',
      deletedFile: currentImage
    });
  } catch (error) {
    console.error('Error deleting product image:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
}

// Bulk delete images for products that no longer have image references
async function cleanupOrphanedImages(req, res) {
  try {
    const fs = require('fs');
    const uploadsDir = path.join(__dirname, '../../uploads');
    
    // Get all image files in uploads directory
    const imageFiles = fs.readdirSync(uploadsDir)
      .filter(file => /\.(jpg|jpeg|png|gif|webp)$/i.test(file));
    
    // Get all image references from database
    const [rows] = await db.query('SELECT image FROM products WHERE image IS NOT NULL');
    const dbImages = rows.map(row => row.image);
    
    // Find orphaned files
    const orphanedFiles = imageFiles.filter(file => !dbImages.includes(file));
    
    let deletedCount = 0;
    for (const file of orphanedFiles) {
      const filePath = path.join(uploadsDir, file);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        deletedCount++;
        console.log(`Deleted orphaned file: ${file}`);
      }
    }
    
    res.json({ 
      message: `Cleanup completed. Deleted ${deletedCount} orphaned files.`,
      deletedFiles: orphanedFiles,
      deletedCount
    });
  } catch (error) {
    console.error('Error during cleanup:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
}

async function getProduct(req, res) {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ message: 'Invalid id' });
  
  try {
    const [rows] = await db.query(
      'SELECT id, name, category, description, price, stock, image, created_at FROM products WHERE id = ? LIMIT 1',
      [id]
    );
    
    if (!rows[0]) return res.status(404).json({ message: 'Product not found' });
    
    const product = {
      ...rows[0],
      image_url: rows[0].image ? `/uploads/${rows[0].image}` : `/assets/images/Midwest.jpg`
    };
    
    res.json({ product });
  } catch (_e) {
    console.error('Error in getProduct:', _e);
    res.status(500).json({ message: 'Server error' });
  }
}

// Lazy loading endpoints
async function getProductImage(req, res) {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ message: 'Invalid id' });
  
  try {
    const [rows] = await db.query('SELECT image FROM products WHERE id = ? LIMIT 1', [id]);
    if (!rows[0] || !rows[0].image) {
      return res.status(404).json({ message: 'Product or image not found' });
    }
    
    const imagePath = path.join(__dirname, '../../uploads', rows[0].image);
    
    // Apply image optimization middleware
    imageOptimization(req, res, () => {
      checkImageExists(imagePath, res, () => {
        resizeImage(req, res, () => {
          progressiveLoading(req, res, () => {
            res.sendFile(imagePath);
          });
        });
      });
    });
  } catch (error) {
    console.error('Error serving product image:', error);
    res.status(500).json({ message: 'Server error' });
  }
}

async function getProductImagePlaceholder(req, res) {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ message: 'Invalid id' });
  
  try {
    const [rows] = await db.query('SELECT image FROM products WHERE id = ? LIMIT 1', [id]);
    if (!rows[0] || !rows[0].image) {
      // Return default placeholder
      const defaultPath = path.join(__dirname, '../../assets/images/Midwest.jpg');
      return res.sendFile(defaultPath);
    }
    
    const imagePath = path.join(__dirname, '../../uploads', rows[0].image);
    const fs = require('fs');
    
    if (!fs.existsSync(imagePath)) {
      const defaultPath = path.join(__dirname, '../../assets/images/Midwest.jpg');
      return res.sendFile(defaultPath);
    }
    
    // Set placeholder-specific headers
    res.set({
      'Cache-Control': 'public, max-age=86400', // 1 day
      'Content-Type': 'image/svg+xml',
      'X-Image-Type': 'placeholder',
      'X-Loading-Strategy': 'lazy'
    });
    
    // Generate and return SVG placeholder
    const placeholder = generatePlaceholder(48, 48);
    res.send(placeholder);
  } catch (error) {
    console.error('Error serving placeholder:', error);
    res.status(500).json({ message: 'Server error' });
  }
}

async function getProductThumbnail(req, res) {
  const id = Number(req.params.id);
  const size = req.query.size || 'small'; // small, medium, large
  
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ message: 'Invalid id' });
  
  try {
    const [rows] = await db.query('SELECT image FROM products WHERE id = ? LIMIT 1', [id]);
    if (!rows[0] || !rows[0].image) {
      const defaultPath = path.join(__dirname, '../../assets/images/Midwest.jpg');
      return res.sendFile(defaultPath);
    }
    
    const imagePath = path.join(__dirname, '../../uploads', rows[0].image);
    
    // Apply image optimization middleware for thumbnails
    imageOptimization(req, res, () => {
      checkImageExists(imagePath, res, () => {
        resizeImage(req, res, () => {
          // Set thumbnail-specific headers
          res.set({
            'Cache-Control': 'public, max-age=604800', // 1 week
            'Content-Type': 'image/jpeg',
            'X-Image-Type': 'thumbnail',
            'X-Thumbnail-Size': size,
            'X-Loading-Strategy': 'eager'
          });
          
          res.sendFile(imagePath);
        });
      });
    });
  } catch (error) {
    console.error('Error serving thumbnail:', error);
    res.status(500).json({ message: 'Server error' });
  }
}

// Get all products with lazy loading support
async function getAllProductsLazy(req, res) {
  try {
    const search = req.query.search || '';
    
    // Build search condition
    let searchCondition = '';
    let searchParams = [];
    if (search) {
      searchCondition = 'WHERE name LIKE ? OR category LIKE ? OR description LIKE ?';
      const searchTerm = `%${search}%`;
      searchParams = [searchTerm, searchTerm, searchTerm];
    }
    
    // Get all products (no pagination for lazy loading)
    const productsQuery = `
      SELECT id, name, category, description, price, stock, image, created_at 
      FROM products 
      ${searchCondition}
      ORDER BY name ASC
    `;
    const [rows] = await db.query(productsQuery, searchParams);
    
    // Add lazy loading support for images
    const products = rows.map(product => ({
      ...product,
      image_url: product.image ? `/api/products/${product.id}/image` : null,
      placeholder_url: product.image ? `/api/products/${product.id}/image/placeholder` : `/assets/images/Midwest.jpg`,
      thumbnail_url: product.image ? `/api/products/${product.id}/image/thumbnail` : `/assets/images/Midwest.jpg`,
      has_image: !!product.image
    }));
    
    res.json({ 
      products,
      total: products.length,
      lazy_loading: true
    });
  } catch (error) {
    console.error('Error in getAllProductsLazy:', error);
    res.status(500).json({ message: 'Server error' });
  }
}

// Get all low stock items with lazy loading support
async function getLowStockItems(req, res) {
  try {
    const lowStockThreshold = parseInt(req.query.threshold || '5');
    const search = req.query.search || '';
    
    // Build search condition for low stock items
    let searchCondition = `WHERE stock <= ?`;
    let searchParams = [lowStockThreshold];
    
    if (search) {
      searchCondition += ' AND (name LIKE ? OR category LIKE ? OR description LIKE ?)';
      const searchTerm = `%${search}%`;
      searchParams.push(searchTerm, searchTerm, searchTerm);
    }
    
    // Get all low stock products
    const productsQuery = `
      SELECT id, name, category, description, price, stock, image, created_at 
      FROM products 
      ${searchCondition}
      ORDER BY stock ASC, name ASC
    `;
    const [rows] = await db.query(productsQuery, searchParams);
    
    // Add lazy loading support for images
    const products = rows.map(product => ({
      ...product,
      image_url: product.image ? `/api/products/${product.id}/image` : null,
      placeholder_url: product.image ? `/api/products/${product.id}/image/placeholder` : `/assets/images/Midwest.jpg`,
      thumbnail_url: product.image ? `/api/products/${product.id}/image/thumbnail` : `/assets/images/Midwest.jpg`,
      has_image: !!product.image,
      is_low_stock: true,
      stock_status: product.stock === 0 ? 'out_of_stock' : 'low_stock'
    }));
    
    res.json({ 
      products,
      total: products.length,
      low_stock_threshold: lowStockThreshold,
      out_of_stock: products.filter(p => p.stock === 0).length,
      low_stock: products.filter(p => p.stock > 0 && p.stock <= lowStockThreshold).length,
      lazy_loading: true
    });
  } catch (error) {
    console.error('Error in getLowStockItems:', error);
    res.status(500).json({ message: 'Server error' });
  }
}

module.exports = { 
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
};


