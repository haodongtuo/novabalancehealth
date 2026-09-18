// netlify/functions/subscribe_email.js
// Captures an email address and hands back a real, single-use 15% discount code.
//
// Why the code is shown on screen instead of emailed: sending mail needs a
// provider, a verified sending domain and DNS records. Showing the code
// immediately works today, converts better, and the address is still stored for
// a newsletter later. Swap in an email send here when a provider is configured.
//
// Zero npm dependencies: crypto and https are Node built-ins.
const crypto = require('crypto');
const https = require('https');

const COUPON_ID = 'nb-refill-15'; // 15% off, created on first use
const COUPON_PERCENT = 15;
const CODE_PREFIX = 'NB15';
// Alphabet without 0/O/1/I/L so a code read off a phone screen cannot be mistyped.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const SITE_ORIGIN = 'https://novabalancehealth.com';

function randomCode() {
  const bytes = crypto.randomBytes(8);
  let out = '';
  for (let i = 0; i < 6; i++) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return `${CODE_PREFIX}-${out}`;
}

function isValidEmail(value) {
  if (typeof value !== 'string') return false;
  const email = value.trim();
  if (email.length < 6 || email.length > 254) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

function encodeForm(obj, prefix, out) {
  out = out || [];
  for (const key of Object.keys(obj)) {
    const value = obj[key];
    if (value === undefined || value === null) continue;
    const name = prefix ? `${prefix}[${key}]` : key;
    if (typeof value === 'object' && !Array.isArray(value)) encodeForm(value, name, out);
    else out.push(`${encodeURIComponent(name)}=${encodeURIComponent(String(value))}`);
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

function supabaseRequest(method, url, headers, payload) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const body = payload ? JSON.stringify(payload) : null;
    const req = https.request(
      {
        hostname: urlObj.hostname,
        path: urlObj.pathname + urlObj.search,
        method,
        headers: Object.assign({}, headers, body ? { 'Content-Length': Buffer.byteLength(body) } : {}),
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => resolve({ status: res.statusCode, body: data }));
      }
    );
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function ensureCouponExists(secretKey) {
  // Creating a coupon with a fixed id is idempotent enough: the second attempt
  // fails with resource_already_exists, which is the outcome we want anyway.
  const res = await stripePost(
    '/v1/coupons',
    { id: COUPON_ID, percent_off: COUPON_PERCENT, duration: 'once', name: '15% off your next refill' },
    secretKey
  );
  if (res.status === 200) return true;
  const code = res.body && res.body.error && res.body.error.code;
  if (code === 'resource_already_exists') return true;
  console.error('Coupon creation failed:', res.status, JSON.stringify(res.body));
  return false;
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

  let email;
  try {
    email = (JSON.parse(event.body || '{}').email || '').trim().toLowerCase();
  } catch (e) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Malformed request' }) };
  }

  if (!isValidEmail(email)) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Please enter a valid email address.' }) };
  }

  const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

  if (!STRIPE_SECRET_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error('subscribe_email missing env', {
      stripe: !!STRIPE_SECRET_KEY,
      url: !!SUPABASE_URL,
      key: !!SUPABASE_SERVICE_KEY,
    });
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Sign-up is not available right now.' }) };
  }

  const sbHeaders = {
    apikey: SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
    'Content-Type': 'application/json',
  };

  try {
    // Same address twice returns the same code instead of minting a new one.
    const existing = await supabaseRequest(
      'GET',
      `${SUPABASE_URL}/rest/v1/subscribers?email=eq.${encodeURIComponent(email)}&select=discount_code&limit=1`,
      sbHeaders
    );
    if (existing.status === 200) {
      const rows = JSON.parse(existing.body || '[]');
      if (rows.length && rows[0].discount_code) {
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ code: rows[0].discount_code, returning: true, percent_off: COUPON_PERCENT }),
        };
      }
    }

    if (!(await ensureCouponExists(STRIPE_SECRET_KEY))) {
      return { statusCode: 502, headers, body: JSON.stringify({ error: 'Sign-up is not available right now.' }) };
    }

    // Retry a few times in the vanishingly unlikely event of a code collision.
    let code = null;
    for (let attempt = 0; attempt < 5 && !code; attempt++) {
      const candidate = randomCode();
      const res = await stripePost(
        '/v1/promotion_codes',
        { coupon: COUPON_ID, code: candidate, max_redemptions: 1, metadata: { email } },
        STRIPE_SECRET_KEY
      );
      if (res.status === 200) code = candidate;
      else if (!(res.body && res.body.error && res.body.error.code === 'resource_already_exists')) {
        console.error('Promotion code creation failed:', res.status, JSON.stringify(res.body));
        break;
      }
    }

    if (!code) {
      return { statusCode: 502, headers, body: JSON.stringify({ error: 'Sign-up is not available right now.' }) };
    }

    const stored = await supabaseRequest(
      'POST',
      `${SUPABASE_URL}/rest/v1/subscribers`,
      Object.assign({}, sbHeaders, { Prefer: 'return=minimal,resolution=merge-duplicates' }),
      { email, discount_code: code, source: 'nfc_verify' }
    );
    if (stored.status >= 300) {
      // The code is live in Stripe, so still give it to the customer.
      console.error('Subscriber insert failed:', stored.status, stored.body);
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ code, returning: false, percent_off: COUPON_PERCENT }),
    };
  } catch (err) {
    console.error('subscribe_email error:', err.message, err.stack);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Sign-up is not available right now.' }) };
  }
};
