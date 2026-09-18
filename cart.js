// cart.js — Client-side cart logic for NovaBalance Health
// Works with the server-side CATALOG in netlify/functions/create_checkout_session.js
// Only vagibalance and prostabalance are purchasable; others are coming soon.

const PRODUCTS = {
  vagibalance: { name: 'VagiBalance™ Gel (3ml)', price: 29.99 },
  prostabalance: { name: 'ProstaBalance™ (60 Tablets)', price: 99.99 },
};

// Persistent cart backed by localStorage
const CART_KEY = 'novabalance_cart';
const cart = JSON.parse(localStorage.getItem(CART_KEY) || '{}');

function saveCart() {
  localStorage.setItem(CART_KEY, JSON.stringify(cart));
}

// ── Cart UI helpers ──────────────────────────────────────────────────────────

function updateCartUI() {
  const total = Object.entries(cart).reduce(
    (sum, [id, qty]) => sum + (PRODUCTS[id]?.price ?? 0) * qty,
    0
  );
  const count = Object.values(cart).reduce((s, q) => s + q, 0);

  // Count badge (index.html has #cart-count)
  const countEl = document.getElementById('cart-count');
  if (countEl) countEl.textContent = count;

  // Total
  const totalEl = document.getElementById('cart-total');
  if (totalEl) totalEl.textContent = '$' + total.toFixed(2);

  // Checkout button
  const btn = document.getElementById('checkout-btn');
  if (btn) btn.disabled = count === 0;

  // Render line items
  const container = document.getElementById('cart-items');
  const emptyMsg = document.getElementById('empty-cart-msg');
  if (!container) return;

  if (count === 0) {
    if (emptyMsg) emptyMsg.style.display = '';
    // Remove all item rows
    container.querySelectorAll('.cart-line').forEach(el => el.remove());
    return;
  }

  if (emptyMsg) emptyMsg.style.display = 'none';

  // Rebuild item rows
  container.querySelectorAll('.cart-line').forEach(el => el.remove());
  for (const [id, qty] of Object.entries(cart)) {
    if (qty <= 0) continue;
    const p = PRODUCTS[id];
    if (!p) continue;
    const div = document.createElement('div');
    div.className = 'cart-line flex items-center justify-between gap-3';
    div.innerHTML = `
      <div class="flex-1 min-w-0">
        <p class="font-semibold text-slate-800 text-sm truncate">${p.name}</p>
        <p class="text-[#00B4D8] text-sm">$${(p.price * qty).toFixed(2)}</p>
      </div>
      <div class="flex items-center gap-2">
        <button onclick="changeQty('${id}',-1)" class="w-7 h-7 rounded-full border border-slate-300 text-slate-600 font-bold flex items-center justify-center hover:bg-slate-100 transition">−</button>
        <span class="w-6 text-center font-semibold">${qty}</span>
        <button onclick="changeQty('${id}',1)" class="w-7 h-7 rounded-full border border-slate-300 text-slate-600 font-bold flex items-center justify-center hover:bg-slate-100 transition">+</button>
      </div>
    `;
    container.appendChild(div);
  }
}

// ── Public API (called from HTML onclick attributes) ─────────────────────────

function addToCart(productId) {
  // Gracefully handle unknown / coming-soon products
  if (!PRODUCTS[productId]) {
    showToast('This product is coming soon! 🚀', false);
    return;
  }
  cart[productId] = (cart[productId] || 0) + 1;
  saveCart();
  updateCartUI();
  showToast(PRODUCTS[productId].name + ' added to cart ✓', true);
}

function changeQty(productId, delta) {
  cart[productId] = Math.max(0, (cart[productId] || 0) + delta);
  if (cart[productId] === 0) delete cart[productId];
  saveCart();
  updateCartUI();
}

function toggleCart() {
  const modal = document.getElementById('cart-modal');
  if (!modal) return;
  modal.classList.toggle('hidden');
}

function closeSuccess() {
  const modal = document.getElementById('success-modal');
  if (modal) modal.classList.add('hidden');
}

// ── Checkout ─────────────────────────────────────────────────────────────────

async function processCheckout() {
  const items = Object.entries(cart).map(([id, qty]) => ({ id, qty }));
  if (items.length === 0) return;

  const btn = document.getElementById('checkout-btn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Redirecting…';
  }

  try {
    const res = await fetch('/.netlify/functions/create_checkout_session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items }),
    });
    const data = await res.json();
    if (data.url) {
      window.location.href = data.url;
    } else {
      alert(data.error || 'Something went wrong. Please try again.');
      if (btn) { btn.disabled = false; btn.textContent = 'Checkout'; }
    }
  } catch (err) {
    alert('Network error. Please check your connection and try again.');
    if (btn) { btn.disabled = false; btn.textContent = 'Checkout'; }
  }
}

// ── Toast notification ────────────────────────────────────────────────────────

function showToast(message, success = true) {
  let toast = document.getElementById('cart-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'cart-toast';
    toast.style.cssText =
      'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);' +
      'padding:12px 24px;border-radius:8px;font-size:14px;font-weight:600;' +
      'color:#fff;z-index:9999;transition:opacity 0.3s;pointer-events:none;';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.style.background = success ? '#16a34a' : '#0A2540';
  toast.style.opacity = '1';
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => { toast.style.opacity = '0'; }, 2500);
}

// ── NFC repurchase helper (called from NFC portal in index.html) ─────────────

function repurchaseScanned() {
  // The NFC portal sets window._nfcProductId when a tag is scanned.
  const id = window._nfcProductId;
  if (id && PRODUCTS[id]) {
    addToCart(id);
    closeNfcPortal();
    toggleCart();
  }
}

function closeNfcPortal() {
  const portal = document.getElementById('nfc-portal');
  if (portal) portal.classList.add('hidden');
}

// 页面加载时从 localStorage 恢复购物车显示
document.addEventListener('DOMContentLoaded', updateCartUI);
