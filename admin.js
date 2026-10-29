function clientSideApp() {
  // --- STATE ---
  const state = {
    user: null,
    products: [],
    cart: JSON.parse(localStorage.getItem('cart')) || [],
    orders: []
  };

  // --- UTILS ---
  const $ = id => document.getElementById(id);
  const saveCart = () => localStorage.setItem('cart', JSON.stringify(state.cart));
  const formatMoney = amt => `৳${Number(amt).toFixed(2)}`;
  
  const showToast = (msg, type = 'success') => {
    const t = document.createElement('div');
    t.className = `toast clay ${type}`;
    t.innerText = msg;
    document.body.appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, 3000);
  };

  const api = async (endpoint, method = 'GET', body = null) => {
    try {
      const opts = { method, headers: { 'Content-Type': 'application/json' } };
      if (body) opts.body = JSON.stringify(body);
      const res = await fetch(endpoint, opts);
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Request failed');
      return data;
    } catch (err) {
      showToast(err.message, 'error');
      throw err;
    }
  };

  // --- ROUTER ---
  const routes = {
    '/': renderHome,
    '/shop': renderShop,
    '/cart': renderCart,
    '/login': renderLogin,
    '/admin': renderAdmin
  };

  async function route() {
    const path = window.location.hash.slice(1) || '/';
    const content = $('content');
    content.innerHTML = '<div class="loader"></div>';
    
    try {
      // Check auth if needed
      if (!state.user && document.cookie.includes('token=')) {
        const res = await fetch('/api/v1/auth/me');
        if (res.ok) state.user = (await res.json()).user;
      }
      
      updateNav();
      
      const routeHandler = routes[path];
      if (routeHandler) {
        await routeHandler(content);
      } else {
        content.innerHTML = `<div class="empty-state"><h2>404 - Page Not Found</h2></div>`;
      }
      lucide.createIcons();
    } catch (e) {
      content.innerHTML = `<div class="empty-state text-danger"><h2>Error Loading Page</h2></div>`;
    }
  }

  function updateNav() {
    $('cart-count').innerText = state.cart.reduce((sum, i) => sum + i.quantity, 0);
    const authLinks = $('auth-links');
    if (state.user) {
      authLinks.innerHTML = `
        ${['admin', 'pharmacist'].includes(state.user.role) ? `<a href="#/admin" class="nav-link">Dashboard</a>` : ''}
        <button onclick="appLogout()" class="clay-btn sm">Logout</button>
      `;
    } else {
      authLinks.innerHTML = `<a href="#/login" class="clay-btn sm">Login</a>`;
    }
  }

  // --- VIEWS ---
  async function renderHome(container) {
    container.innerHTML = `
      <div class="hero clay">
        <div>
          <span class="badge">Your Health, Our Priority</span>
          <h1>Welcome to MediNest Pharmacy</h1>
          <p>Get genuine medicines and healthcare products delivered to your doorstep.</p>
          <div style="margin-top:2rem;">
            <a href="#/shop" class="clay-btn">Shop Medicines</a>
          </div>
        </div>
        <img src="https://images.unsplash.com/photo-1576602976047-174e57a47881?w=500&q=80" alt="Pharmacy" style="border-radius: 24px; max-width: 400px; width: 100%;">
      </div>
      <div class="features">
        <div class="clay feature-card"><i data-lucide="shield-check"></i><h3>Genuine Products</h3></div>
        <div class="clay feature-card"><i data-lucide="truck"></i><h3>Fast Delivery</h3></div>
        <div class="clay feature-card"><i data-lucide="file-text"></i><h3>Prescription Service</h3></div>
      </div>
    `;
  }

  async function renderShop(container) {
    const data = await api('/api/v1/products');
    state.products = data.data;
    
    container.innerHTML = `
      <h2>Browse Medicines</h2>
      <div class="product-grid">
        ${state.products.map(p => `
          <div class="clay product-card">
            <img src="${p.image || 'https://via.placeholder.com/200'}" alt="${p.name}">
            <div class="p-4">
              ${p.requiresPrescription ? '<span class="badge warning">Rx Required</span>' : ''}
              <h3>${p.name}</h3>
              <p class="text-muted">${p.category}</p>
              <div style="display:flex; justify-content:space-between; align-items:center; margin-top:1rem;">
                <strong>${formatMoney(p.price)}</strong>
                <button onclick="addToCart('${p._id}')" class="clay-btn sm"><i data-lucide="shopping-cart"></i> Add</button>
              </div>
            </div>
          </div>
        `).join('')}
      </div>
    `;
  }

  async function renderCart(container) {
    if (state.cart.length === 0) {
      return container.innerHTML = `<div class="empty-state clay"><h2>Your cart is empty</h2><a href="#/shop" class="clay-btn mt-4">Go Shop</a></div>`;
    }

    const subtotal = state.cart.reduce((s, i) => s + (i.price * i.quantity), 0);
    const delivery = subtotal >= 1500 ? 0 : 60;
    const requiresRx = state.cart.some(i => i.requiresRx);

    container.innerHTML = `
      <div class="cart-layout">
        <div class="cart-items">
          <h2>Your Cart</h2>
          ${state.cart.map(item => `
            <div class="clay cart-item">
              <div>
                <h4>${item.name}</h4>
                <p>${formatMoney(item.price)} x ${item.quantity}</p>
              </div>
              <button onclick="removeFromCart('${item.productId}')" class="clay-btn danger sm">Remove</button>
            </div>
          `).join('')}
        </div>
        <div class="clay checkout-panel">
          <h3>Order Summary</h3>
          <p>Subtotal: ${formatMoney(subtotal)}</p>
          <p>Delivery: ${formatMoney(delivery)}</p>
          <hr>
          <h3>Total: ${formatMoney(subtotal + delivery)}</h3>
          
          <div class="mt-4">
            <input type="text" id="chk-address" placeholder="Delivery Address" class="clay-input w-100" required>
            <input type="text" id="chk-phone" placeholder="Phone Number" class="clay-input w-100 mt-2" required>
            ${requiresRx ? `<textarea id="chk-rx" placeholder="Prescription Reference / Note (Upload limited in demo)" class="clay-input w-100 mt-2" required></textarea>` : ''}
            <button onclick="processCheckout()" class="clay-btn w-100 mt-4">Confirm Order (Cash on Delivery)</button>
          </div>
        </div>
      </div>
    `;
  }

  async function renderLogin(container) {
    container.innerHTML = `
      <div style="max-width:400px; margin: 2rem auto;" class="clay p-4">
        <h2>Welcome Back</h2>
        <form onsubmit="handleLogin(event)">
          <input type="email" id="log-email" class="clay-input w-100 mt-2" placeholder="Email" required>
          <input type="password" id="log-pass" class="clay-input w-100 mt-2" placeholder="Password" required>
          <button type="submit" class="clay-btn w-100 mt-4">Sign In</button>
        </form>
        <p class="text-center mt-4">Demo Admin: admin@medinest.example</p>
        <p class="text-center">Run API Setup first if fresh DB.</p>
        <button onclick="runSetup()" class="clay-btn warning sm w-100 mt-2">Initialize Demo Data</button>
      </div>
    `;
  }

  async function renderAdmin(container) {
    if (!state.user || !['admin', 'pharmacist'].includes(state.user.role)) return window.location.hash = '/';
    
    const ordersRes = await api('/api/v1/orders');
    state.orders = ordersRes.data;

    container.innerHTML = `
      <h2>Admin Dashboard</h2>
      <div class="features mt-4">
        <div class="clay feature-card"><h3>Total Orders</h3><h2>${state.orders.length}</h2></div>
        <div class="clay feature-card"><h3>Revenue</h3><h2>${formatMoney(state.orders.filter(o=>o.status==='delivered').reduce((s,o)=>s+o.finalTotal,0))}</h2></div>
      </div>
      <div class="mt-4 clay p-4">
        <h3>Recent Orders</h3>
        <table style="width:100%; text-align:left; margin-top:1rem; border-collapse:collapse;">
          <tr><th>Order #</th><th>Status</th><th>Total</th><th>Action</th></tr>
          ${state.orders.map(o => `
            <tr style="border-bottom:1px solid #e1e5f8;">
              <td class="py-2">${o.orderNumber}</td>
              <td><span class="badge ${o.status === 'delivered' ? 'success' : 'warning'}">${o.status.replace('_',' ')}</span></td>
              <td>${formatMoney(o.finalTotal)}</td>
              <td>
                <select onchange="updateOrderStatus('${o._id}', this.value)" class="clay-input sm">
                  <option value="pending" ${o.status==='pending'?'selected':''}>Pending</option>
                  <option value="processing" ${o.status==='processing'?'selected':''}>Processing</option>
                  <option value="shipped" ${o.status==='shipped'?'selected':''}>Shipped</option>
                  <option value="delivered" ${o.status==='delivered'?'selected':''}>Delivered</option>
                  <option value="cancelled" ${o.status==='cancelled'?'selected':''}>Cancelled</option>
                </select>
              </td>
            </tr>
          `).join('')}
        </table>
      </div>
    `;
  }

  // --- ACTIONS ---
  window.addToCart = (id) => {
    const product = state.products.find(p => p._id === id);
    if (!product) return;
    const existing = state.cart.find(i => i.productId === id);
    if (existing) existing.quantity++;
    else state.cart.push({ productId: product._id, name: product.name, price: product.price, quantity: 1, requiresRx: product.requiresPrescription });
    saveCart();
    updateNav();
    showToast(`${product.name} added to cart`);
  };

  window.removeFromCart = (id) => {
    state.cart = state.cart.filter(i => i.productId !== id);
    saveCart();
    route();
  };

  window.handleLogin = async (e) => {
    e.preventDefault();
    try {
      const res = await api('/api/v1/auth/login', 'POST', { email: $('log-email').value, password: $('log-pass').value });
      state.user = res.user;
      showToast('Login successful');
      window.location.hash = state.user.role === 'admin' ? '/admin' : '/';
    } catch(e){}
  };

  window.appLogout = async () => {
    await api('/api/v1/auth/logout', 'POST');
    state.user = null;
    window.location.hash = '/login';
  };

  window.processCheckout = async () => {
    if (!state.user) {
      showToast('Please login to checkout', 'warning');
      return window.location.hash = '/login';
    }
    const address = $('chk-address').value;
    const phone = $('chk-phone').value;
    const rx = $('chk-rx') ? $('chk-rx').value : null;

    if (!address || !phone) return showToast('Address and phone are required', 'error');

    try {
      await api('/api/v1/orders', 'POST', { items: state.cart, address, phone, prescriptionNotes: rx });
      state.cart = [];
      saveCart();
      showToast('Order placed successfully!');
      window.location.hash = '/';
    } catch(e){}
  };

  window.updateOrderStatus = async (id, status) => {
    try {
      await api(`/api/v1/orders/${id}`, 'PATCH', { status });
      showToast('Order updated');
    } catch(e){}
  };

  window.runSetup = async () => {
    try {
      const res = await api('/api/v1/admin/setup', 'POST');
      showToast(res.message);
    } catch(e){}
  };

  // --- INIT ---
  window.addEventListener('hashchange', route);
  route();
}

module.exports = function renderFrontend() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>MediNest Pharmacy</title>
  <script src="https://unpkg.com/lucide@latest"></script>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --primary: #4F46E5;
      --secondary: #06B6D4;
      --success: #10B981;
      --warning: #F59E0B;
      --danger: #EF4444;
      --bg: #F5F7FF;
      --surface: #FFFFFF;
      --text: #1F2937;
      --muted: #6B7280;
    }
    
    * { box-sizing: border-box; font-family: 'Inter', sans-serif; }
    body { margin: 0; background: var(--bg); color: var(--text); -webkit-font-smoothing: antialiased; }
    a { text-decoration: none; color: inherit; }
    
    /* Claymorphism Utilities */
    .clay {
      background: var(--surface);
      border-radius: 24px;
      box-shadow: 12px 12px 24px #e1e5f8, -12px -12px 24px #ffffff;
      border: 1px solid rgba(255,255,255,0.6);
      transition: transform 0.3s ease, box-shadow 0.3s ease;
    }
    
    .clay-btn {
      display: inline-flex; align-items: center; justify-content: center; gap: 8px;
      background: var(--primary); color: white;
      border: none; padding: 12px 24px; border-radius: 16px; font-weight: 600; cursor: pointer;
      box-shadow: inset 4px 4px 8px rgba(255,255,255,0.2), inset -4px -4px 8px rgba(0,0,0,0.1), 6px 6px 12px #e1e5f8, -6px -6px 12px #ffffff;
      transition: all 0.2s ease;
    }
    .clay-btn:active { transform: scale(0.95); box-shadow: inset 6px 6px 12px rgba(0,0,0,0.15); }
    .clay-btn.danger { background: var(--danger); }
    .clay-btn.warning { background: var(--warning); }
    .clay-btn.sm { padding: 8px 16px; font-size: 14px; border-radius: 12px; }
    
    .clay-input {
      background: var(--bg); border: none; padding: 14px; border-radius: 16px; width: 100%;
      box-shadow: inset 4px 4px 8px #e1e5f8, inset -4px -4px 8px #ffffff; outline: none;
      font-size: 16px; transition: box-shadow 0.2s;
    }
    .clay-input:focus { box-shadow: inset 6px 6px 12px #d1d5e8, inset -6px -6px 12px #ffffff; }
    
    /* Layout */
    .navbar { display: flex; justify-content: space-between; align-items: center; padding: 1.5rem 5%; position: sticky; top: 0; z-index: 50; background: rgba(245,247,255,0.8); backdrop-filter: blur(10px); }
    .nav-brand { font-size: 1.5rem; font-weight: 700; color: var(--primary); display: flex; align-items: center; gap: 8px; }
    .nav-links { display: flex; gap: 2rem; align-items: center; }
    .nav-link { font-weight: 600; color: var(--text); transition: color 0.2s; }
    .nav-link:hover { color: var(--primary); }
    
    .container { max-width: 1200px; margin: 0 auto; padding: 2rem 5%; min-height: 80vh; }
    
    /* Components */
    .hero { display: flex; align-items: center; justify-content: space-between; padding: 4rem; margin-bottom: 3rem; gap: 2rem; flex-wrap: wrap; animation: fadeInUp 0.8s ease; }
    .hero h1 { font-size: 3rem; margin: 1rem 0; color: var(--primary); }
    
    .product-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 2rem; }
    .product-card { overflow: hidden; padding-bottom: 1rem; }
    .product-card img { width: 100%; height: 200px; object-fit: cover; border-bottom: 4px solid var(--bg); }
    .product-card:hover { transform: translateY(-5px); box-shadow: 16px 16px 32px #e1e5f8, -16px -16px 32px #ffffff; }
    
    .features { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 2rem; margin: 3rem 0; }
    .feature-card { padding: 2rem; text-align: center; }
    .feature-card i { color: var(--secondary); width: 48px; height: 48px; margin-bottom: 1rem; }
    
    .cart-layout { display: grid; grid-template-columns: 2fr 1fr; gap: 2rem; }
    .cart-item { display: flex; justify-content: space-between; align-items: center; padding: 1.5rem; margin-bottom: 1rem; }
    .checkout-panel { padding: 2rem; height: fit-content; }
    
    .badge { padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: 600; background: var(--bg); color: var(--primary); }
    .badge.warning { background: #fef3c7; color: var(--warning); }
    .badge.success { background: #d1fae5; color: var(--success); }
    
    .toast { position: fixed; bottom: 20px; right: 20px; padding: 1rem 2rem; z-index: 100; font-weight: 600; transition: opacity 0.3s; }
    .toast.success { border-left: 4px solid var(--success); }
    .toast.error { border-left: 4px solid var(--danger); }
    
    .loader { width: 48px; height: 48px; border: 5px solid var(--bg); border-bottom-color: var(--primary); border-radius: 50%; display: inline-block; box-sizing: border-box; animation: rotation 1s linear infinite; margin: 4rem auto; display: block; }
    .empty-state { text-align: center; padding: 4rem; color: var(--muted); }
    
    /* Utilities */
    .w-100 { width: 100%; } .mt-2 { margin-top: 0.5rem; } .mt-4 { margin-top: 1.5rem; } .p-4 { padding: 1.5rem; } .text-center { text-align: center; } .text-muted { color: var(--muted); } .text-danger { color: var(--danger); } .py-2 { padding: 0.5rem 0; }
    
    @keyframes rotation { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
    @keyframes fadeInUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
    
    @media (max-width: 768px) {
      .hero { padding: 2rem; flex-direction: column; text-align: center; }
      .hero h1 { font-size: 2rem; }
      .cart-layout { grid-template-columns: 1fr; }
      .nav-links { gap: 1rem; }
    }
  </style>
</head>
<body>
  <nav class="navbar">
    <a href="#/" class="nav-brand"><i data-lucide="cross"></i> MediNest</a>
    <div class="nav-links">
      <a href="#/shop" class="nav-link">Shop</a>
      <a href="#/cart" class="nav-link" style="position:relative;">
        <i data-lucide="shopping-cart"></i>
        <span id="cart-count" style="position:absolute; top:-10px; right:-15px; background:var(--danger); color:white; border-radius:50%; width:20px; height:20px; font-size:12px; display:flex; align-items:center; justify-content:center;">0</span>
      </a>
      <div id="auth-links"></div>
    </div>
  </nav>

  <div class="container" id="content"></div>

  <footer style="text-align: center; padding: 2rem; color: var(--muted); margin-top: 2rem;">
    <p>&copy; 2026 MediNest Pharmacy Demo. Fictional store for demonstration purposes.</p>
  </footer>

  <script>
    (${clientSideApp.toString()})();
  </script>
</body>
</html>`;
};
