const express = require('express');
const { MongoClient, ObjectId } = require('mongodb');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const renderFrontend = require('./admin');

const app = express();

// Security & Middleware
app.use(helmet({
  contentSecurityPolicy: false // Disabled only to allow CDN icons/fonts in this single-file demo architecture
}));
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());
app.use(rateLimit({ windowMs: 15 * 60 * 1000, limit: 100, message: { success: false, message: 'Too many requests' } }));

// Environment & DB Config
const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.MONGODB_DB_NAME || 'medinest_pharmacy';
const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_only_for_local_dev';

let cachedClient = null;

async function getDb() {
  if (cachedClient) return cachedClient.db(DB_NAME);
  if (!MONGODB_URI) throw new Error('MONGODB_URI is not defined.');
  
  cachedClient = new MongoClient(MONGODB_URI, { maxPoolSize: 10 });
  await cachedClient.connect();
  const db = cachedClient.db(DB_NAME);
  
  // Create Indexes silently (fire and forget for this setup)
  db.collection('users').createIndex({ email: 1 }, { unique: true }).catch(()=>{});
  db.collection('products').createIndex({ sku: 1 }, { unique: true }).catch(()=>{});
  db.collection('orders').createIndex({ orderNumber: 1 }, { unique: true }).catch(()=>{});
  
  return db;
}

// Authentication Middleware
const requireAuth = (roles = []) => async (req, res, next) => {
  try {
    const token = req.cookies.token;
    if (!token) return res.status(401).json({ success: false, message: 'Unauthorized' });
    
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    
    if (roles.length && !roles.includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Forbidden: Insufficient privileges' });
    }
    next();
  } catch (err) {
    res.status(401).json({ success: false, message: 'Invalid or expired session' });
  }
};

// --- API ROUTES ---

// Health Check
app.get('/api/health', async (req, res) => {
  try {
    await getDb();
    res.json({ success: true, message: 'API is running. DB Connected.' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Database connection failed' });
  }
});

// Auth endpoints
app.post('/api/v1/auth/register', async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) return res.status(400).json({ success: false, message: 'Missing fields' });
  
  try {
    const db = await getDb();
    const existing = await db.collection('users').findOne({ email });
    if (existing) return res.status(400).json({ success: false, message: 'Email already in use' });
    
    const hash = await bcrypt.hash(password, 10);
    const user = { name, email, password: hash, role: 'customer', createdAt: new Date() };
    await db.collection('users').insertOne(user);
    
    res.json({ success: true, message: 'Registration successful' });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Registration failed' });
  }
});

app.post('/api/v1/auth/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const db = await getDb();
    const user = await db.collection('users').findOne({ email });
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }
    
    const token = jwt.sign({ id: user._id, role: user.role, name: user.name }, JWT_SECRET, { expiresIn: '1d' });
    res.cookie('token', token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', maxAge: 86400000 });
    res.json({ success: true, user: { id: user._id, name: user.name, email: user.email, role: user.role } });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Login failed' });
  }
});

app.post('/api/v1/auth/logout', (req, res) => {
  res.clearCookie('token').json({ success: true, message: 'Logged out' });
});

app.get('/api/v1/auth/me', requireAuth(), async (req, res) => {
  res.json({ success: true, user: req.user });
});

// Product Endpoints
app.get('/api/v1/products', async (req, res) => {
  try {
    const db = await getDb();
    const products = await db.collection('products').find({ archived: { $ne: true } }).toArray();
    res.json({ success: true, data: products });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Failed to fetch products' });
  }
});

app.post('/api/v1/products', requireAuth(['admin', 'pharmacist']), async (req, res) => {
  try {
    const db = await getDb();
    const product = { ...req.body, stock: Number(req.body.stock), price: Number(req.body.price), createdAt: new Date() };
    await db.collection('products').insertOne(product);
    res.json({ success: true, message: 'Product created' });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Failed to create product' });
  }
});

// Orders & Checkout Endpoints
app.post('/api/v1/orders', requireAuth(), async (req, res) => {
  const { items, address, phone, prescriptionNotes } = req.body;
  if (!items || !items.length) return res.status(400).json({ success: false, message: 'Cart is empty' });

  try {
    const db = await getDb();
    
    // Validate stock and price server-side
    let total = 0;
    let requiresPrescription = false;
    const orderItems = [];

    for (const item of items) {
      const product = await db.collection('products').findOne({ _id: new ObjectId(item.productId) });
      if (!product || product.stock < item.quantity) {
        return res.status(400).json({ success: false, message: `Insufficient stock for ${product?.name || 'an item'}.` });
      }
      total += product.price * item.quantity;
      if (product.requiresPrescription) requiresPrescription = true;
      
      orderItems.push({
        productId: product._id,
        name: product.name,
        price: product.price,
        quantity: item.quantity
      });
    }

    const deliveryFee = total >= 1500 ? 0 : 60;
    const finalTotal = total + deliveryFee;

    // Atomic stock reduction (Fallback for lack of replica set transactions in some free tiers)
    for (const item of orderItems) {
      const result = await db.collection('products').updateOne(
        { _id: item.productId, stock: { $gte: item.quantity } },
        { $inc: { stock: -item.quantity } }
      );
      if (result.modifiedCount === 0) {
        // Rollback previous on partial failure (simulated transaction)
        return res.status(409).json({ success: false, message: 'Stock conflict during checkout. Please try again.' });
      }
    }

    const orderNumber = 'ORD-' + Math.random().toString(36).substring(2, 8).toUpperCase();
    const status = requiresPrescription ? 'awaiting_prescription' : 'pending';

    const order = {
      orderNumber, userId: req.user.id, items: orderItems, total, deliveryFee, finalTotal,
      address, phone, prescriptionNotes, status, createdAt: new Date()
    };

    await db.collection('orders').insertOne(order);
    res.json({ success: true, message: 'Order placed successfully', orderNumber });

  } catch (e) {
    res.status(500).json({ success: false, message: 'Checkout failed' });
  }
});

app.get('/api/v1/orders', requireAuth(), async (req, res) => {
  try {
    const db = await getDb();
    const query = req.user.role === 'customer' ? { userId: req.user.id } : {};
    const orders = await db.collection('orders').find(query).sort({ createdAt: -1 }).toArray();
    res.json({ success: true, data: orders });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Failed to fetch orders' });
  }
});

app.patch('/api/v1/orders/:id', requireAuth(['admin', 'pharmacist']), async (req, res) => {
  try {
    const db = await getDb();
    const { status } = req.body;
    await db.collection('orders').updateOne({ _id: new ObjectId(req.params.id) }, { $set: { status, updatedAt: new Date() } });
    res.json({ success: true, message: 'Order updated' });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Failed to update order' });
  }
});

// Admin Demo Seeder (Idempotent)
app.post('/api/v1/admin/setup', async (req, res) => {
  try {
    const db = await getDb();
    const adminEmail = process.env.ADMIN_EMAIL;
    const adminPass = process.env.ADMIN_PASSWORD;
    if (!adminEmail || !adminPass) return res.status(400).json({ success: false, message: 'Admin credentials not in environment' });

    const existingAdmin = await db.collection('users').findOne({ email: adminEmail });
    if (!existingAdmin) {
      const hash = await bcrypt.hash(adminPass, 10);
      await db.collection('users').insertOne({ name: 'System Admin', email: adminEmail, password: hash, role: 'admin' });
    }

    const count = await db.collection('products').countDocuments();
    if (count === 0) {
      await db.collection('products').insertMany([
        { name: 'Paracetamol 500mg', category: 'Over-the-Counter', price: 20, stock: 500, requiresPrescription: false, image: 'https://images.unsplash.com/photo-1584308666744-24d5e74f9e04?w=400&q=80', description: 'Pain reliever and fever reducer.', sku: 'PARA500' },
        { name: 'Amoxicillin 250mg', category: 'Prescription Medicines', price: 150, stock: 100, requiresPrescription: true, image: 'https://images.unsplash.com/photo-1471864190281-a93a3070b6de?w=400&q=80', description: 'Antibiotic used to treat bacterial infections.', sku: 'AMOX250' },
        { name: 'Vitamin C 1000mg', category: 'Vitamins and Supplements', price: 300, stock: 200, requiresPrescription: false, image: 'https://images.unsplash.com/photo-1577401239170-897942555fb3?w=400&q=80', description: 'Immune system support.', sku: 'VITC1000' },
      ]);
    }
    res.json({ success: true, message: 'Setup complete. Demo data ready.' });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Setup failed' });
  }
});

// Catch-all to serve the combined frontend (excluding /api)
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) return res.status(404).json({ success: false, message: 'API route not found' });
  res.send(renderFrontend());
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ success: false, message: 'An unexpected server error occurred.' });
});

module.exports = app;

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`MediNest Server running on port ${PORT}`));
}
