// netlify/functions/create_checkout_session.js
// Creates a Stripe Checkout Session for the NovaBalance cart.
//
// Design notes:
//  - Zero npm dependencies. The site is deployed by dragging a zip into Netlify,
//    which does not run `npm install`, so everything uses Node built-ins only.
//  - The browser sends product ids and quantities ONLY. Every price comes from
//    the server-side CATALOG below. A tampered client cannot change what it pays.
//  - Stripe Checkout is hosted by Stripe: card data never touches this site, and
//    the promotion-code box, 3-D Secure and wallets come for free.
const https = require('https');

// ---------------------------------------------------------------------------
// Server-side price list. This is the ONLY source of truth for money.
// Amounts are in cents. Keep in sync with products.json / the product pages.
// FemBalance and OvaBalance are intentionally absent: they are not in production
// yet and are hidden from the storefront.
// ---------------------------------------------------------------------------
const CATALOG = {
  vagibalance: {
    name: 'VagiBalance™ Gel (3ml)',
    description: 'Vaginal pH Balance Gel',
    amount: 2999,
    url: 'https://novabalancehealth.com/vagi-balance.html',
  },
  prostabalance: {
    name: 'ProstaBalance™ (60 Tablets)',
    description: "Men's Prostate Support",
    amount: 9999,
    url: 'https://novabalancehealth.com/prosta-balance.html',
  },
};

const MAX_QTY_PER_ITEM = 10;
const FREE_SHIPPING_THRESHOLD = 5000; // $50.00 in cents
const FLAT_SHIPPING_AMOUNT = 599; // $5.99 in cents
const SITE_ORIGIN = 'https://novabalancehealth.com';

// ---------------------------------------------------------------------------
// Minimal form-encoder for Stripe's API (it takes application/x-www-form-urlencoded
// with bracketed nested keys, e.g. line_items[0][price_data][unit_amount]).
// ---------------------------------------------------------------------------
function encodeForm(obj, prefix, out) {
  out = out || [];
  for (const key of Object.keys(obj)) {
    const value = obj[key];
    if (value === undefined || value === null) continue;
    const name = prefix ? `${prefix}[${key}]` : key;
    if (Array.isArray(value)) {
      value.forEach((item, i) => {
        if (item !== null && typeof item === 'object') encodeForm(item, `${name}[${i}]`, out);
        else out.push(`${encodeURIComponent(`${name}[${i}]`)}=${encodeURIComponent(String(item))}`);
      });
    } else if (typeof value === 'object') {
      encodeForm(value, name, out);
    } else {
      out.push(`${encodeURIComponent(name)}=${encodeURIComponent(String(value))}`);
    }
  }
  return out;
}

function stripePost(path, payload, secretKey) {
  const body = encodeForm(payload).join('&');
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'api.stripe.com',
        path,
        method: 'POST',
        headers: {
          Authorization: `Bearer ${secretKey}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(body),
          'Stripe-Version': '2024-06-20',
        },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(data) });
          } catch (e) {
            resolve({ status: res.statusCode, body: { raw: data } });
          }
        });
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

exports.handler = async function (event) {
  const headers = {
    'Access-Control-Allow-Origin': SITE_ORIGIN,
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
  if (!STRIPE_SECRET_KEY) {
    console.error('STRIPE_SECRET_KEY is not set');
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Payments are not configured yet. Please contact support.' }),
    };
  }

  // -- parse and validate the cart -----------------------------------------
  let items;
  try {
    const parsed = JSON.parse(event.body || '{}');
    items = parsed.items;
  } catch (e) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Malformed request body' }) };
  }

  if (!Array.isArray(items) || items.length === 0) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Your cart is empty' }) };
  }

  // Collapse duplicates, clamp quantities, reject unknown products.
  const wanted = new Map();
  for (const raw of items) {
    const id = raw && typeof raw.id === 'string' ? raw.id.trim().toLowerCase() : '';
    if (!CATALOG[id]) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: `That product is not available for purchase.` }),
      };
    }
    let qty = parseInt(raw.qty, 10);
    if (!Number.isFinite(qty) || qty < 1) qty = 1;
    if (qty > MAX_QTY_PER_ITEM) qty = MAX_QTY_PER_ITEM;
    wanted.set(id, Math.min((wanted.get(id) || 0) + qty, MAX_QTY_PER_ITEM));
  }

  const line_items = [];
  let subtotal = 0;
  for (const [id, qty] of wanted) {
    const product = CATALOG[id];
    subtotal += product.amount * qty;
    line_items.push({
      quantity: qty,
      price_data: {
        currency: 'usd',
        unit_amount: product.amount,
        product_data: { name: product.name, description: product.description },
      },
    });
  }

  // -- shipping: free at or above the threshold, flat rate below it ---------
  const freeShipping = subtotal >= FREE_SHIPPING_THRESHOLD;
  const shipping_options = [
    {
      shipping_rate_data: {
        type: 'fixed_amount',
        display_name: freeShipping ? 'Free standard shipping' : 'Standard shipping',
        fixed_amount: { amount: freeShipping ? 0 : FLAT_SHIPPING_AMOUNT, currency: 'usd' },
        delivery_estimate: {
          minimum: { unit: 'business_day', value: 3 },
          maximum: { unit: 'business_day', value: 7 },
        },
      },
    },
  ];

  const payload = {
    mode: 'payment',
    line_items,
    shipping_options,
    allow_promotion_codes: true, // Stripe renders the discount-code box for us
    billing_address_collection: 'auto',
    shipping_address_collection: { allowed_countries: ['US'] },
    phone_number_collection: { enabled: false },
    success_url: `${SITE_ORIGIN}/order-success.html?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${SITE_ORIGIN}/order-cancelled.html`,
    metadata: {
      cart: JSON.stringify(Array.from(wanted.entries()).map(([id, qty]) => ({ id, qty }))),
      subtotal_cents: String(subtotal),
    },
  };

  try {
    const result = await stripePost('/v1/checkout/sessions', payload, STRIPE_SECRET_KEY);
    if (result.status !== 200 || !result.body || !result.body.url) {
      console.error('Stripe session creation failed:', result.status, JSON.stringify(result.body));
      return {
        statusCode: 502,
        headers,
        body: JSON.stringify({ error: 'We could not start checkout. Please try again in a moment.' }),
      };
    }
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ url: result.body.url, id: result.body.id }),
    };
  } catch (err) {
    console.error('create_checkout_session error:', err.message, err.stack);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'We could not start checkout. Please try again in a moment.' }),
    };
  }
};
