// netlify/functions/stripe_webhook.js
// Receives Stripe events and records paid orders in Supabase.
//
// SECURITY: this endpoint is public. Anything posting here could invent an
// "order" unless the Stripe signature is verified first. Verification uses the
// raw request body and a constant-time compare; never parse the body before the
// signature checks out, and never trust fields from an unverified payload.
//
// Zero npm dependencies: crypto and https are Node built-ins.
const crypto = require('crypto');
const https = require('https');

const SIGNATURE_TOLERANCE_SECONDS = 300; // reject replays older than 5 minutes

function verifyStripeSignature(rawBody, signatureHeader, secret) {
  if (!signatureHeader) return { ok: false, reason: 'missing Stripe-Signature header' };

  let timestamp = null;
  const providedSignatures = [];
  for (const part of signatureHeader.split(',')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key === 't') timestamp = value;
    else if (key === 'v1') providedSignatures.push(value);
  }

  if (!timestamp || providedSignatures.length === 0) {
    return { ok: false, reason: 'malformed Stripe-Signature header' };
  }

  const age = Math.floor(Date.now() / 1000) - parseInt(timestamp, 10);
  if (!Number.isFinite(age) || Math.abs(age) > SIGNATURE_TOLERANCE_SECONDS) {
    return { ok: false, reason: `timestamp outside tolerance (${age}s)` };
  }

  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody}`, 'utf8')
    .digest('hex');
  const expectedBuf = Buffer.from(expected, 'utf8');

  for (const candidate of providedSignatures) {
    const candidateBuf = Buffer.from(candidate, 'utf8');
    if (candidateBuf.length !== expectedBuf.length) continue;
    if (crypto.timingSafeEqual(candidateBuf, expectedBuf)) return { ok: true };
  }
  return { ok: false, reason: 'no signature matched' };
}

function supabaseRequest(method, url, headers, payload) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const body = payload ? JSON.stringify(payload) : null;
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method,
      headers: Object.assign({}, headers, body ? { 'Content-Length': Buffer.byteLength(body) } : {}),
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

exports.handler = async function (event) {
  const headers = { 'Content-Type': 'application/json' };

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

  if (!STRIPE_WEBHOOK_SECRET) {
    console.error('STRIPE_WEBHOOK_SECRET is not set');
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Webhook not configured' }) };
  }

  // Netlify hands us the body base64-encoded when the request is binary.
  const rawBody = event.isBase64Encoded
    ? Buffer.from(event.body || '', 'base64').toString('utf8')
    : event.body || '';

  const signatureHeader =
    (event.headers && (event.headers['stripe-signature'] || event.headers['Stripe-Signature'])) || '';

  const verdict = verifyStripeSignature(rawBody, signatureHeader, STRIPE_WEBHOOK_SECRET);
  if (!verdict.ok) {
    console.error('Rejected webhook:', verdict.reason);
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid signature' }) };
  }

  let stripeEvent;
  try {
    stripeEvent = JSON.parse(rawBody);
  } catch (e) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Malformed payload' }) };
  }

  // Only paid checkouts create orders. Everything else is acknowledged and ignored,
  // otherwise Stripe retries forever.
  if (stripeEvent.type !== 'checkout.session.completed') {
    return { statusCode: 200, headers, body: JSON.stringify({ received: true, ignored: stripeEvent.type }) };
  }

  const session = (stripeEvent.data && stripeEvent.data.object) || {};
  if (session.payment_status !== 'paid') {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ received: true, ignored: `payment_status=${session.payment_status}` }),
    };
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    // The payment already succeeded; never fail the webhook over our own storage
    // gap or Stripe will retry a charge that is genuinely complete.
    console.error('Supabase env missing - order NOT recorded:', session.id);
    return { statusCode: 200, headers, body: JSON.stringify({ received: true, stored: false }) };
  }

  const details = session.customer_details || {};
  const shipping = session.shipping_details || session.collected_information?.shipping_details || {};
  const address = shipping.address || details.address || {};

  let cart = null;
  try {
    cart = session.metadata && session.metadata.cart ? JSON.parse(session.metadata.cart) : null;
  } catch (e) {
    cart = null;
  }

  const order = {
    stripe_session_id: session.id,
    stripe_payment_intent: session.payment_intent || null,
    email: details.email || null,
    customer_name: shipping.name || details.name || null,
    amount_subtotal: session.amount_subtotal,
    amount_discount: (session.total_details && session.total_details.amount_discount) || 0,
    amount_shipping: (session.total_details && session.total_details.amount_shipping) || 0,
    amount_total: session.amount_total,
    currency: session.currency,
    items: cart,
    shipping_address: Object.keys(address).length ? address : null,
    status: 'paid',
  };

  try {
    const res = await supabaseRequest(
      'POST',
      `${SUPABASE_URL}/rest/v1/orders`,
      {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        // Same session delivered twice must not create two orders.
        Prefer: 'return=minimal,resolution=merge-duplicates',
      },
      order
    );

    if (res.status >= 300) {
      console.error('Supabase insert failed:', res.status, res.body, 'session:', session.id);
      return { statusCode: 200, headers, body: JSON.stringify({ received: true, stored: false }) };
    }

    console.log('Order recorded:', session.id, order.amount_total, order.currency);
    return { statusCode: 200, headers, body: JSON.stringify({ received: true, stored: true }) };
  } catch (err) {
    console.error('stripe_webhook storage error:', err.message, 'session:', session.id);
    return { statusCode: 200, headers, body: JSON.stringify({ received: true, stored: false }) };
  }
};
