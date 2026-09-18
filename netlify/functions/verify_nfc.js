// netlify/functions/verify_nfc.js
// NovaBalance NFC tag verification function
const https = require('https');

function httpsGet(url, headers) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      headers
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch(e) {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function httpsPatch(url, headers, payload) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const body = JSON.stringify(payload);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'PATCH',
      headers: { ...headers, 'Content-Length': Buffer.byteLength(body) }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode }));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

exports.handler = async function(event, context) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  const uid = event.queryStringParameters && event.queryStringParameters.uid;

  if (!uid) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ authentic: false, error: 'Missing uid parameter' })
    };
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error('Missing env vars:', { hasUrl: !!SUPABASE_URL, hasKey: !!SUPABASE_SERVICE_KEY });
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ authentic: false, error: 'Server configuration error' })
    };
  }

  try {
    const supabaseHeaders = {
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json'
    };

    // Query the nfc_tags table
    const queryUrl = `${SUPABASE_URL}/rest/v1/nfc_tags?tag_uid=eq.${encodeURIComponent(uid)}&select=tag_uid,product_name,batch_number,scan_count,is_authentic&limit=1`;
    const result = await httpsGet(queryUrl, supabaseHeaders);

    if (result.status !== 200) {
      console.error('Supabase query failed:', result.status, result.body);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ authentic: false, error: 'Database error' })
      };
    }

    const rows = result.body;

    if (!rows || !Array.isArray(rows) || rows.length === 0) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ authentic: false, uid })
      };
    }

    const tag = rows[0];
    const newScanCount = (tag.scan_count || 0) + 1;

    // Increment scan_count and set first_scanned_at if first scan
    const patchData = { scan_count: newScanCount };
    if (tag.scan_count === 0) {
      patchData.first_scanned_at = new Date().toISOString();
    }

    const patchUrl = `${SUPABASE_URL}/rest/v1/nfc_tags?tag_uid=eq.${encodeURIComponent(uid)}`;
    await httpsPatch(patchUrl, {
      ...supabaseHeaders,
      'Prefer': 'return=minimal'
    }, patchData);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        authentic: tag.is_authentic === true,
        uid: tag.tag_uid,
        product_name: tag.product_name,
        batch_number: tag.batch_number,
        scan_count: newScanCount
      })
    };

  } catch (err) {
    console.error('verify_nfc error:', err.message, err.stack);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ authentic: false, error: 'Internal server error' })
    };
  }
};
