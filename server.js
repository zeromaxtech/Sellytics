require('dotenv').config();
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const express = require('express');
const webpush = require('web-push');
const { createClient } = require('@supabase/supabase-js');
const { encrypt, decrypt } = require('./crypto');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD },
});

const app = express();
// Netlify terminates TLS in front of the function, so trust the
// first proxy hop to get the real client IP for rate limiting.
app.set('trust proxy', 1);
app.disable('x-powered-by');

// Keep the raw body so webhook signatures can be verified later.
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf;
  },
}));

// Request ids make it possible to correlate a client error with a log line.
app.use((req, res, next) => {
  req.id = req.headers['x-request-id'] || crypto.randomUUID();
  res.setHeader('x-request-id', req.id);
  next();
});

app.use(express.static('public'));

// ---------- Structured logging ----------
// Logs are JSON lines with no request bodies, tokens or email contents.
function logEvent(level, message, fields = {}) {
  const entry = {
    ts: new Date().toISOString(),
    level,
    message,
    ...fields,
  };
  const line = JSON.stringify(entry);
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

// ---------- Contact rate limit (5 requests / hour / IP) ----------
// Preferred path: Supabase function check_rate_limit(), which works across
// serverless instances. If the DB check fails we fall back to a per-instance
// in-memory bucket so the endpoint is never left unprotected.
const contactRateBuckets = new Map();

function checkContactRateLimitMemory(ip, limit = 5, windowMs = 60 * 60 * 1000) {
  const now = Date.now();

  // Opportunistic cleanup so a long-running local server does not grow
  // this Map forever with one-off IPs.
  if (contactRateBuckets.size > 5000) {
    for (const [key, bucket] of contactRateBuckets) {
      if (now >= bucket.resetAt) contactRateBuckets.delete(key);
    }
  }

  const bucket = contactRateBuckets.get(ip);

  if (!bucket || now >= bucket.resetAt) {
    contactRateBuckets.set(ip, { count: 1, resetAt: now + windowMs });
    return true;
  }

  bucket.count += 1;
  return bucket.count <= limit;
}

async function checkContactRateLimit(ipHash) {
  const adminClient = getAdminClient();
  if (adminClient) {
    try {
      const { data, error } = await adminClient.rpc('check_rate_limit', {
        p_key: `contact:${ipHash}`,
        p_limit: 5,
        p_window_seconds: 3600,
      });
      if (!error && typeof data === 'boolean') return data;
      if (error) {
        logEvent('warn', 'Contact rate limit DB check failed; using memory fallback', {
          error: error.message,
        });
      }
    } catch (err) {
      logEvent('warn', 'Contact rate limit DB check threw; using memory fallback', {
        error: err.message,
      });
    }
  }
  return checkContactRateLimitMemory(ipHash);
}

async function contactRateLimiter(req, res, next) {
  const forwarded = req.headers['x-forwarded-for'];
  const ip = (forwarded ? String(forwarded).split(',')[0].trim() : req.ip) || 'unknown';
  // Never store or log the raw IP for rate limiting. A keyed hash is enough
  // to count requests and is much less useful if the table is exposed.
  const ipHash = crypto
    .createHmac('sha256', process.env.ENCRYPTION_KEY || 'sellytics-rate-limit')
    .update(String(ip))
    .digest('hex');

  try {
    const allowed = await checkContactRateLimit(ipHash);
    if (!allowed) {
      logEvent('warn', 'Contact rate limit exceeded', {
        requestId: req.id,
        ipHash,
        path: req.originalUrl,
      });
      return res.status(429).json({
        message: 'Too many requests. Please try again in about an hour.',
      });
    }
  } catch (err) {
    // Never block a support message because the limiter itself failed.
    logEvent('error', 'Contact rate limiter error', {
      requestId: req.id,
      error: err.message,
    });
  }

  next();
}

function getAnonKey() {
  return process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;
}

let _supabaseClient = null;
function getSupabaseClient() {
  const url = process.env.SUPABASE_URL;
  const key = getAnonKey();
  if (!url || !key) {
    throw new Error(
      `Missing Supabase configuration: SUPABASE_URL=${url ? 'defined' : 'MISSING'}, SUPABASE_PUBLISHABLE_KEY/ANON_KEY=${key ? 'defined' : 'MISSING'}`
    );
  }
  if (!_supabaseClient) {
    _supabaseClient = createClient(url, key);
  }
  return _supabaseClient;
}

// Lazy Supabase client proxy prevents fatal startup crashes if env vars are unset
const supabase = new Proxy({}, {
  get(target, prop) {
    return getSupabaseClient()[prop];
  },
});

function getAdminClient() {
  const serviceRoleKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  if (!serviceRoleKey) return null;
  return createClient(process.env.SUPABASE_URL, serviceRoleKey);
}

function getUserClient(accessToken) {
  return createClient(process.env.SUPABASE_URL, getAnonKey(), {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

// New routes share this helper: it validates the bearer token and sends
// the 401 itself, so each handler only has to check for null.
async function getAuthContext(req, res) {
  const accessToken = req.headers.authorization?.split(' ')[1];
  if (!accessToken) {
    res.status(401).json({ message: 'Not logged in' });
    return null;
  }

  const userClient = getUserClient(accessToken);
  const { data: { user }, error } = await userClient.auth.getUser(accessToken);
  if (error || !user) {
    res.status(401).json({ message: 'Invalid session' });
    return null;
  }

  return { accessToken, userClient, user };
}

// ---------- Printify helpers (verified against developers.printify.com) ----------
const PRINTIFY_BASE_URL = 'https://api.printify.com/v1';

function printifyHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    'User-Agent': 'Sellytics/1.0',
    'Content-Type': 'application/json',
  };
}

async function printifyRequest(path, token, options = {}) {
  const res = await fetch(`${PRINTIFY_BASE_URL}${path}`, {
    ...options,
    headers: { ...printifyHeaders(token), ...(options.headers || {}) },
    // Keep webhook handling well inside Netlify's function timeout.
    signal: AbortSignal.timeout(8000),
  });

  const text = await res.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch (err) {
      body = text;
    }
  }

  if (!res.ok) {
    const error = new Error(`Printify request failed (status ${res.status})`);
    error.status = res.status;
    error.body = body;
    throw error;
  }

  return body;
}

async function getFirstShop(token) {
  const shops = await printifyRequest('/shops.json', token);
  if (!Array.isArray(shops) || shops.length === 0) {
    throw new Error('No shops found for this token');
  }
  return shops[0];
}

async function getShopIdForConnection(token, connection) {
  if (connection.shop_id) return String(connection.shop_id);
  const shop = await getFirstShop(token);
  return String(shop.id);
}

// Save the shop id with the user's own client first (respects RLS), then
// fall back to the service role so webhook routing still works if the
// store_connections update policy is missing.
async function saveShopIdForConnection(userClient, userId, shop) {
  const payload = { shop_id: String(shop.id), shop_title: shop.title };

  const { error: userError } = await userClient
    .from('store_connections')
    .update(payload)
    .eq('user_id', userId)
    .eq('platform', 'printify');

  if (!userError) return true;

  const adminClient = getAdminClient();
  if (adminClient) {
    const { error: adminError } = await adminClient
      .from('store_connections')
      .update(payload)
      .eq('user_id', userId)
      .eq('platform', 'printify');

    if (!adminError) return true;
    logEvent('warn', 'Could not save Printify shop id with service role', {
      userId,
      error: adminError.message,
    });
    return false;
  }

  logEvent('warn', 'Could not save Printify shop id', {
    userId,
    error: userError.message,
  });
  return false;
}

function fetchPrintifyOrder(token, shopId, orderId) {
  return printifyRequest(
    `/shops/${encodeURIComponent(shopId)}/orders/${encodeURIComponent(orderId)}.json`,
    token,
  );
}

// Printify order statuses documented at developers.printify.com.
// "new" is our friendly label for pre-production states.
function mapPrintifyStatus(status) {
  const value = String(status || '').toLowerCase();

  if (['pending', 'cost-calculation', 'sending-to-production',
    'sending_to_production_delegate', 'sending_to_production_delegate_sync'].includes(value)) {
    return 'new';
  }
  if (['in-production', 'partially-fulfilled'].includes(value)) {
    return 'in_production';
  }
  if (value === 'fulfilled') {
    return 'shipped';
  }
  if (['canceled', 'cancelled'].includes(value)) {
    return 'canceled';
  }
  if (['on-hold', 'payment-not-received', 'has-issues', 'unfulfillable', 'source-check-failed'].includes(value)) {
    return 'problem';
  }
  return 'new';
}

function parsePrintifyDate(value) {
  if (!value) return null;
  const date = new Date(String(value).replace(' ', 'T'));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function mapEventToStatus(eventType, data, printifyOrder) {
  switch (eventType) {
    case 'order:created':
      return 'new';
    case 'order:sent-to-production':
      return 'in_production';
    case 'order:shipment:created':
      return 'shipped';
    case 'order:shipment:delivered':
      return 'delivered';
    case 'order:line-item:canceled': {
      // Printify sends this for merchant/support/system cancellations too.
      // Only the documented issue reasons should raise a problem alert.
      const reason = String(data.status_details || '').toLowerCase();
      return ['out_of_stock', 'item_is_canceled_by_ip_detection'].includes(reason)
        ? 'problem'
        : 'new';
    }
    case 'order:updated':
      return mapPrintifyStatus(data.status || printifyOrder?.status);
    default:
      return null;
  }
}

function serializeOrder(row) {
  const rawStatus = String(row.raw?.status || '').toLowerCase();
  // Documented Printify rule: cancel is accepted only for on-hold and
  // payment-not-received orders.
  const cancellable =
    ['on-hold', 'payment-not-received'].includes(rawStatus) &&
    !['delivered', 'canceled'].includes(String(row.status || '').toLowerCase());

  return {
    id: row.id,
    storeId: row.store_id,
    printifyOrderId: row.printify_order_id,
    status: row.status,
    printifyStatus: row.raw?.status || null,
    trackingNumber: row.tracking_number,
    carrier: row.carrier,
    total: row.total,
    currency: row.currency,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    cancellable,
  };
}

// ---------- Web push ----------
function getWebPushClient() {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return null;

  try {
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT || 'mailto:no-reply@example.com',
      publicKey,
      privateKey,
    );
    return webpush;
  } catch (err) {
    logEvent('error', 'Invalid VAPID configuration', { error: err.message });
    return null;
  }
}

async function sendPushToUser(userId, payload) {
  const webPushClient = getWebPushClient();
  if (!webPushClient) {
    logEvent('warn', 'Web push skipped: VAPID keys are not configured', { userId });
    return { sent: 0, skipped: true };
  }

  const adminClient = getAdminClient();
  if (!adminClient) return { sent: 0, skipped: true };

  const { data: subscriptions, error } = await adminClient
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth')
    .eq('user_id', userId);

  if (error) {
    logEvent('error', 'Could not load push subscriptions', {
      userId,
      error: error.message,
    });
    return { sent: 0, error: error.message };
  }

  let sent = 0;
  let removed = 0;

  for (const subscription of subscriptions || []) {
    try {
      await webPushClient.sendNotification(
        {
          endpoint: subscription.endpoint,
          keys: { p256dh: subscription.p256dh, auth: subscription.auth },
        },
        JSON.stringify(payload),
      );
      sent += 1;
    } catch (err) {
      // 404/410 means the browser subscription is gone; clean it up.
      if (err.statusCode === 404 || err.statusCode === 410) {
        await adminClient
          .from('push_subscriptions')
          .delete()
          .eq('endpoint', subscription.endpoint);
        removed += 1;
      } else {
        logEvent('warn', 'Web push delivery failed', {
          userId,
          status: err.statusCode,
          error: err.message,
        });
      }
    }
  }

  return { sent, removed };
}

function delayedShippingDays() {
  const value = Number(process.env.DELAYED_SHIPPING_DAYS || 10);
  return Number.isFinite(value) && value > 0 ? value : 10;
}

function isDelayedShipping(printifyOrder) {
  if (!printifyOrder) return false;
  if (Array.isArray(printifyOrder.shipments) && printifyOrder.shipments.length > 0) {
    return false;
  }

  const createdAt = parsePrintifyDate(printifyOrder.created_at);
  if (!createdAt) return false;

  return (
    Date.now() - new Date(createdAt).getTime() >
    delayedShippingDays() * 24 * 60 * 60 * 1000
  );
}

function describeProblem(eventType, data, printifyOrder, orderId, delayed) {
  const status = String(printifyOrder?.status || data.status || '').toLowerCase();
  const label = `#${String(orderId).slice(-8)}`;

  if (delayed) {
    return {
      type: 'delayed_shipping',
      message: `Order ${label} has been in production for more than ${delayedShippingDays()} days.`,
    };
  }

  if (String(data.status_details || '').toLowerCase() === 'out_of_stock') {
    return {
      type: 'out_of_stock',
      message: `Order ${label} has a variant that went out of stock.`,
    };
  }

  if (String(data.status_details || '').toLowerCase() === 'item_is_canceled_by_ip_detection') {
    return {
      type: 'canceled_by_ip_detection',
      message: `Order ${label} had a line item canceled by Printify's IP detection.`,
    };
  }

  if (status === 'source-check-failed') {
    return {
      type: 'rejected',
      message: `Order ${label} was rejected by Printify because the source file check failed.`,
    };
  }

  if (status === 'unfulfillable') {
    return {
      type: 'failed',
      message: `Order ${label} cannot be fulfilled due to inventory or a technical issue.`,
    };
  }

  if (status === 'has-issues') {
    return {
      type: 'failed',
      message: `Order ${label} has a Printify issue and needs attention.`,
    };
  }

  if (status === 'payment-not-received') {
    return {
      type: 'payment',
      message: `Payment for order ${label} was not received. Check it in Printify.`,
    };
  }

  if (status === 'on-hold') {
    return {
      type: 'on_hold',
      message: `Order ${label} is on hold in Printify — a variant may be out of stock or discontinued.`,
    };
  }

  return {
    type: eventType === 'order:line-item:canceled' ? 'line_item_canceled' : 'problem',
    message: `Order ${label} needs attention in Printify.`,
  };
}

async function createProblemAlert(adminClient, alert) {
  const { data, error } = await adminClient
    .from('alerts')
    .upsert(
      {
        user_id: alert.userId,
        order_id: alert.orderId || null,
        printify_order_id: alert.printifyOrderId,
        type: alert.type,
        message: alert.message,
        created_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,printify_order_id,type', ignoreDuplicates: true },
    )
    .select('id');

  if (error) throw error;

  // ignoreDuplicates returns no row when the alert already existed, which
  // prevents duplicate push notifications for webhook retries.
  return Array.isArray(data) && data.length > 0;
}

// The raw payload is kept for debugging, but buyer PII (address, email,
// phone, name) is removed. This matters because Supabase Realtime sends
// the row to the browser, and the client must not receive buyer data.
function sanitizeRawOrder(value) {
  if (!value || typeof value !== 'object') return value;

  let clone;
  try {
    clone = JSON.parse(JSON.stringify(value));
  } catch (err) {
    return null;
  }

  const removeBuyerPii = (node) => {
    if (!node || typeof node !== 'object') return;
    delete node.address_to;
    delete node.addressTo;
    delete node.email;
    delete node.phone;
    delete node.first_name;
    delete node.last_name;
    Object.values(node).forEach(removeBuyerPii);
  };

  removeBuyerPii(clone);
  return clone;
}

function verifyPrintifySignature(req) {
  const secret = process.env.PRINTIFY_WEBHOOK_SECRET;
  if (!secret) {
    // Secret is optional in Printify. Without it we cannot authenticate
    // the sender, so log loudly but keep the endpoint usable.
    logEvent('warn', 'PRINTIFY_WEBHOOK_SECRET is not set; webhook signature not verified', {
      requestId: req.id,
    });
    return true;
  }

  const received = req.headers['x-pfy-signature'];
  if (!received || !req.rawBody) return false;

  const expected =
    'sha256=' + crypto.createHmac('sha256', secret).update(req.rawBody).digest('hex');
  const receivedBuffer = Buffer.from(String(received));
  const expectedBuffer = Buffer.from(expected);

  return (
    receivedBuffer.length === expectedBuffer.length &&
    crypto.timingSafeEqual(receivedBuffer, expectedBuffer)
  );
}

function todayString() {
  return new Date().toISOString().slice(0, 10);
}

// Evergreen fallback used when OpenRouter is missing, slow, or returns
// an unusable answer. The dashboard must always have something to show.
const STATIC_TIPS = {
  productTips: [
    'Refresh one best-selling design in a new colourway instead of starting from scratch.',
    'Add a seasonal variant now so it is indexed before the buying window opens.',
    'Bundle a tee with a mug or tote to raise average order value without new artwork.',
    'Check your top three listings and rewrite the first line of each description.',
    'Ask five past buyers which product they would buy next, then make that one.',
  ],
  youtubeTips: [
    'Show the product in use — 15–60 second demos beat talking-head videos.',
    'Put the words buyers actually search in the title and first two description lines.',
    'Post on the same day each week; consistency beats frequency.',
    'End every video with one clear link to your shop.',
    'Cut long videos into Shorts — same footage, twice the reach.',
  ],
  instagramTips: [
    'Lead with Reels — short video gets priority in the algorithm.',
    'Use 5–10 focused hashtags, mixing big and niche ones.',
    'Run polls and Q&A stickers in Stories to learn what to design next.',
    'Share behind-the-scenes: making, packing, shipping — it builds trust.',
    'Tag your products so shoppable posts send traffic straight to checkout.',
  ],
};

function buildStaticTips() {
  return {
    date: todayString(),
    tips: STATIC_TIPS.productTips,
    social: {
      youtube: STATIC_TIPS.youtubeTips,
      instagram: STATIC_TIPS.instagramTips,
    },
  };
}

// ---------- Daily tips: stored in Supabase 'daily_tips' table (zero local file I/O) ----------
async function readTipsFromDb(today) {
  try {
    const { data, error } = await supabase
      .from('daily_tips')
      .select('content')
      .eq('date', today)
      .maybeSingle();

    if (error || !data) return null;
    return data.content;
  } catch (err) {
    logEvent('error', 'Error reading daily tips from Supabase', { error: err.message });
    return null;
  }
}

// Last-known good tips, used as a fallback when today's generation fails.
async function readLatestTipsFromDb() {
  try {
    const { data, error } = await supabase
      .from('daily_tips')
      .select('content')
      .order('date', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !data) return null;
    return data.content;
  } catch (err) {
    logEvent('error', 'Error reading latest cached tips from Supabase', { error: err.message });
    return null;
  }
}

async function writeTipsToDb(today, content) {
  const adminClient = getAdminClient() || supabase;
  try {
    const { error } = await adminClient.from('daily_tips').upsert(
      {
        date: today,
        content: content,
        created_at: new Date().toISOString(),
      },
      { onConflict: 'date' }
    );
    if (error) {
      console.error('Error writing daily tips to Supabase:', error.message);
    }
  } catch (err) {
    console.error('Error saving daily tips to Supabase:', err.message);
  }
}

// Asks OpenRouter for 5 short, date-aware seller tips and caches them in Supabase.
// No-op when today's tips already exist or the API key is not configured.
async function generateDailyTips() {
  if (!process.env.OPENROUTER_API_KEY) {
    console.warn('OPENROUTER_API_KEY not set — skipping daily tips generation');
    return null;
  }

  const today = todayString();
  const existing = await readTipsFromDb(today);
  if (existing) return existing;

  const prompt =
    `Today is ${new Date().toDateString()}. Give print-on-demand seller ` +
    `guidance for this date and season. If any holidays or shopping events ` +
    `fall within the next 8 weeks, mention them. Return ONLY a JSON object ` +
    `with three keys, no markdown or explanation: "productTips" (an array of ` +
    `5 short strings about what to build or sell next), "youtubeTips" (an ` +
    `array of 5 short strings about growing reach on YouTube), and ` +
    `"instagramTips" (an array of 5 short strings about growing reach on ` +
    `Instagram).`;

  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
      }),
      // Never let a hung AI request hold the dashboard open.
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`OpenRouter request failed (status ${res.status})`);

    const data = await res.json();
    const text = data.choices?.[0]?.message?.content || '';
    const match = text.match(/\{[\s\S]*\}/); // tolerate markdown code fences
    const parsed = JSON.parse(match ? match[0] : text);

    const isStringArray = (v) =>
      Array.isArray(v) && v.length > 0 && v.every((t) => typeof t === 'string');

    if (
      !isStringArray(parsed.productTips) ||
      !isStringArray(parsed.youtubeTips) ||
      !isStringArray(parsed.instagramTips)
    ) {
      throw new Error('OpenRouter returned an unexpected tips format');
    }

    const payload = {
      date: today,
      tips: parsed.productTips.slice(0, 5),
      social: {
        youtube: parsed.youtubeTips.slice(0, 5),
        instagram: parsed.instagramTips.slice(0, 5),
      },
    };

    await writeTipsToDb(today, payload);
    console.log(`Daily tips generated and saved for ${today}`);
    return payload;
  } catch (err) {
    logEvent('error', 'Daily tips generation failed', {
      error: err.message,
      timeout: err.name === 'TimeoutError',
    });
    return null;
  }
}

// ---------- Routes ----------

app.post('/register', async (req, res) => {
  try {
    const { email, password, agreeTerms } = req.body || {};

    // Consent gate: the register form's checkbox starts unchecked,
    // so registration is blocked (client- and server-side) until
    // the user ticks it.
    if (!agreeTerms) {
      return res.status(400).json({
        message: 'Please agree to the Terms and Privacy Policy first.',
      });
    }

    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }

    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) {
      logEvent('warn', 'Registration failed', { email, error: error.message });
      return res.status(error.status || 400).json({ message: error.message });
    }

    logEvent('info', 'Registration successful', { email });
    return res.json({ message: 'Registered! Check your email to confirm.' });
  } catch (err) {
    logEvent('error', 'Unhandled error in /register', { error: err.message, stack: err.stack });
    return res.status(500).json({
      message: err.message || 'Internal server error during registration',
    });
  }
});

app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }

    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      logEvent('warn', 'Login failed', { email, error: error.message });
      return res.status(error.status || 401).json({ message: error.message });
    }

    logEvent('info', 'Login successful', { userId: data.user?.id });
    return res.json({ message: 'Logged in', session: data.session });
  } catch (err) {
    logEvent('error', 'Unhandled error in /login', { error: err.message, stack: err.stack });
    return res.status(500).json({
      message: err.message || 'Internal server error during login',
    });
  }
});

app.post('/connect-printify', async (req, res) => {
  const authHeader = req.headers.authorization;
  const accessToken = authHeader?.split(' ')[1];
  if (!accessToken) return res.status(401).json({ message: 'Not logged in' });

  // Create a request-scoped client that carries THIS user's identity,
  // so Supabase's Row Level Security knows who's asking.
  const userClient = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY,
    {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    }
  );

  const { data: { user }, error: userError } = await userClient.auth.getUser(accessToken);
  if (userError || !user) return res.status(401).json({ message: 'Invalid session' });

  const encryptedToken = encrypt(req.body.printifyToken);

  const { error } = await userClient.from('store_connections').upsert({
    user_id: user.id,
    platform: 'printify',
    encrypted_token: encryptedToken,
  }, { onConflict: 'user_id,platform' });

  if (error) return res.status(400).json({ message: error.message });

  // Best effort: store the Printify shop id now so webhooks can be routed
  // immediately. A token without shop read scope still connects fine.
  try {
    const shop = await getFirstShop(req.body.printifyToken);
    await saveShopIdForConnection(userClient, user.id, shop);
  } catch (err) {
    logEvent('warn', 'Could not read Printify shops after connect', {
      userId: user.id,
      error: err.message,
    });
  }

  res.json({ message: 'Printify connected!' });
});

// Shared by /shop-stats and /send-digest: loads the user's Printify
// connection, decrypts the token, then fetches the first shop along
// with its recent order count.
async function fetchShopData(userClient, userId) {
  let query = userClient
    .from('store_connections')
    .select('*')
    .eq('platform', 'printify');
  if (userId) query = query.eq('user_id', userId);

  const { data: connection } = await query.single();

  if (!connection) return null;

  const token = decrypt(connection.encrypted_token);

  const shopsRes = await fetch('https://api.printify.com/v1/shops.json', {
    headers: printifyHeaders(token),
  });
  if (!shopsRes.ok) {
    throw new Error(`Printify shops request failed (status ${shopsRes.status})`);
  }
  const shops = await shopsRes.json();
  if (!Array.isArray(shops) || shops.length === 0) {
    throw new Error('No shops found for this token');
  }

  const shop = shops[0];

  // Remember which shop belongs to this user so incoming Printify
  // webhooks (which only carry shop_id) can be routed reliably.
  if (userId && connection.shop_id !== String(shop.id)) {
    await saveShopIdForConnection(userClient, userId, shop);
  }
  const ordersRes = await fetch(
    `https://api.printify.com/v1/shops/${shop.id}/orders.json?limit=10`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!ordersRes.ok) {
    throw new Error(`Printify orders request failed (status ${ordersRes.status})`);
  }
  const orders = await ordersRes.json();

  return { shop, orderCount: orders.data?.length || 0 };
}

app.get('/shop-stats', async (req, res) => {
  const accessToken = req.headers.authorization?.split(' ')[1];
  if (!accessToken) return res.status(401).json({ message: 'Not logged in' });

  const userClient = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY,
    {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    }
  );
  const { data: { user } } = await userClient.auth.getUser(accessToken);
  if (!user) return res.status(401).json({ message: 'Invalid session' });

  try {
    const shopData = await fetchShopData(userClient, user.id);
    if (!shopData) return res.json({ connected: false });

    res.json({
      connected: true,
      shopTitle: shopData.shop.title,
      recentOrderCount: shopData.orderCount,
    });
  } catch (err) {
    res.json({ connected: true, error: err.message });
  }
});

// Shared by the /send-digest button and the daily scheduled
// function: loads the user's shop data and emails them the digest.
async function sendDigestEmail(userClient, user) {
  const shopData = await fetchShopData(userClient, user.id);
  if (!shopData) return { message: 'No store connected yet', emailed: false };

  const senderEmail = process.env.SUPPORT_FROM_EMAIL || 'support.sellytics@gmail.com';

  await transporter.sendMail({
    from: `"Sellytics" <${senderEmail}>`,
    replyTo: senderEmail,
    to: user.email,
    subject: `Sellytics — ${shopData.shop.title}`,
    text: `Your shop "${shopData.shop.title}" has ${shopData.orderCount} recent orders.`,
  });

  return { message: `Digest emailed to ${user.email}`, emailed: true };
}

app.post('/send-digest', async (req, res) => {
  const accessToken = req.headers.authorization?.split(' ')[1];
  if (!accessToken) return res.status(401).json({ message: 'Not logged in' });

  const userClient = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY,
    {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    }
  );
  const { data: { user } } = await userClient.auth.getUser(accessToken);
  if (!user) return res.status(401).json({ message: 'Invalid session' });

  try {
    const result = await sendDigestEmail(userClient, user);
    res.json({ message: result.message });
  } catch (err) {
    res.status(502).json({ message: err.message });
  }
});

// ---------- Account deletion ----------
// Deletes the signed-in user. Supabase cascades the delete to the
// user's store_connections rows (FK is ON DELETE CASCADE), so the
// encrypted Printify token goes with the account.
async function deleteSignedInUser(userClient, accessToken) {
  const { data: { user }, error: authError } = await userClient.auth.getUser(accessToken);
  if (authError || !user) {
    return { status: 401, message: 'Invalid session' };
  }

  const adminClient = getAdminClient();
  if (!adminClient) {
    return { status: 500, message: 'Account deletion is not configured on this server' };
  }

  const { error: deleteError } = await adminClient.auth.admin.deleteUser(user.id);
  if (deleteError) {
    return { status: 400, message: deleteError.message };
  }

  return { status: 200, message: 'Account and data deleted' };
}

app.post('/delete-account', async (req, res) => {
  const accessToken = req.headers.authorization?.split(' ')[1];
  if (!accessToken) return res.status(401).json({ message: 'Not logged in' });

  const userClient = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY,
    {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    }
  );

  const result = await deleteSignedInUser(userClient, accessToken);
  res.status(result.status).json({ message: result.message });
});

// ---------- Daily tips endpoint: serves from Supabase, generates if missing ----------
app.get('/daily-tips', async (req, res) => {
  const accessToken = req.headers.authorization?.split(' ')[1];
  if (!accessToken) return res.status(401).json({ message: 'Not logged in' });

  const userClient = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY,
    {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    }
  );
  const { data: { user } } = await userClient.auth.getUser(accessToken);
  if (!user) return res.status(401).json({ message: 'Invalid session' });

  const today = todayString();
  let cached = await readTipsFromDb(today);
  let source = 'live';

  if (!cached) {
    // First request of the day: generate and save to Supabase
    cached = await generateDailyTips();
  }

  if (!cached) {
    // OpenRouter is unavailable, timed out or not configured. Serve the
    // most recent cached tips, then the built-in evergreen tips.
    cached = await readLatestTipsFromDb();
    source = 'cache';
  }

  if (!cached) {
    cached = buildStaticTips();
    source = 'static';
  }

  res.json({
    date: today,
    tips: cached.tips || STATIC_TIPS.productTips,
    social: cached.social || {
      youtube: STATIC_TIPS.youtubeTips,
      instagram: STATIC_TIPS.instagramTips,
    },
    fallback: source !== 'live',
    source,
  });
});

// ---------- Shared digest runner for all connected users ----------
async function runDigestsForAllUsers() {
  const adminClient = getAdminClient();
  if (!adminClient) {
    console.warn('No service role key (SUPABASE_SERVICE_ROLE_KEY / SUPABASE_SECRET_KEY) — skipping digest run');
    return { sent: 0, note: 'no service role key' };
  }

  const { data: connections, error } = await adminClient
    .from('store_connections')
    .select('user_id')
    .eq('platform', 'printify');

  if (error) {
    console.error('Digest run: could not list connections —', error.message);
    return { sent: 0, note: error.message };
  }

  const userIds = [...new Set(connections.map((c) => c.user_id))];
  let sent = 0;
  for (const userId of userIds) {
    try {
      const { data: { user } } = await adminClient.auth.admin.getUserById(userId);
      if (!user) continue;

      const result = await sendDigestEmail(adminClient, user);
      console.log(`Digest run (${userId}): ${result.message}`);
      if (result.emailed) sent++;
    } catch (err) {
      console.error(`Digest run failed for ${userId}:`, err.message);
    }
  }
  return { sent };
}

// ---------- For external schedulers (e.g. Cloud Scheduler, webhooks) ----------
app.post('/run-digest', async (req, res) => {
  const provided = req.headers['x-cron-secret'];
  if (!process.env.CRON_SECRET || provided !== process.env.CRON_SECRET) {
    return res.status(401).json({ message: 'Invalid cron secret' });
  }

  const result = await runDigestsForAllUsers();
  res.json({ message: `Digest run finished — ${result.sent} digest(s) sent` });
});

// ---------- Support Contact endpoint ----------
// Accepts messages sent from the support modal/forms, displaying
// 'support.sellytics@gmail.com' to users while securely delivering to
// the destination mailbox without exposing it on the client.
app.post('/contact', contactRateLimiter, async (req, res) => {
  const { name, email, subject, message } = req.body || {};

  if (!email || !message) {
    return res.status(400).json({ message: 'Email and message are required.' });
  }

  const destination = process.env.SUPPORT_DESTINATION_EMAIL || 'nike64813@gmail.com';
  const displaySender = 'support.sellytics@gmail.com';

  try {
    await transporter.sendMail({
      from: `"Sellytics Support" <${displaySender}>`,
      replyTo: email,
      to: destination,
      subject: `[Sellytics Support] ${subject || 'New Support Message'} from ${name || email}`,
      text: `Support Message Received:
-------------------------
From: ${name || 'Anonymous'} <${email}>
Reply-To: ${email}
Public Support Address: ${displaySender}

Message:
${message}
`,
    });

    res.json({ message: 'Thank you! Your message has been sent to support.' });
  } catch (err) {
    logEvent('error', 'Contact email sending error', {
      requestId: req.id,
      error: err.message,
    });
    res.status(500).json({ message: 'Could not send message. Please try again later.' });
  }
});

// ---------- Public client configuration ----------
// Only public values are returned. The service-role key, encryption key
// and webhook secret never leave the server.
app.get('/public-config', (req, res) => {
  res.json({
    supabaseUrl: process.env.SUPABASE_URL || null,
    supabaseAnonKey: getAnonKey() || null,
    vapidPublicKey: process.env.VAPID_PUBLIC_KEY || null,
    realtimeEnabled: Boolean(process.env.SUPABASE_URL && getAnonKey()),
  });
});

// ---------- Live order feed ----------
app.get('/orders', async (req, res) => {
  const auth = await getAuthContext(req, res);
  if (!auth) return;

  const { data, error } = await auth.userClient
    .from('orders_feed')
    .select('id, user_id, store_id, printify_order_id, status, tracking_number, carrier, total, currency, created_at, updated_at, raw')
    .eq('user_id', auth.user.id)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) {
    logEvent('error', 'Could not load orders feed', {
      requestId: req.id,
      userId: auth.user.id,
      error: error.message,
    });
    return res.status(500).json({ message: 'Could not load orders right now.' });
  }

  // raw is intentionally stripped by serializeOrder: it can contain the
  // buyer's address and must never reach the browser.
  res.json({
    userId: auth.user.id,
    orders: (data || []).map(serializeOrder),
  });
});

// ---------- Printify webhook receiver ----------
app.post('/webhooks/printify', async (req, res) => {
  if (!verifyPrintifySignature(req)) {
    logEvent('warn', 'Rejected Printify webhook with invalid signature', {
      requestId: req.id,
      ip: req.ip,
    });
    return res.status(401).json({ message: 'Invalid webhook signature' });
  }

  const event = req.body || {};
  const eventType = event.type;
  const orderId = event.resource?.id;
  const data = event.resource?.data || {};
  const shopId = data.shop_id;

  if (!eventType || !orderId || !shopId) {
    return res.status(400).json({ message: 'Malformed Printify webhook payload' });
  }

  const adminClient = getAdminClient();
  if (!adminClient) {
    logEvent('error', 'Printify webhook received but service role key is missing', {
      requestId: req.id,
    });
    return res.status(503).json({ message: 'Webhook storage is not configured' });
  }

  // A webhook only carries shop_id. Match it to the user who connected
  // that shop; never guess when there are multiple connections.
  const { data: connection, error: connectionError } = await adminClient
    .from('store_connections')
    .select('user_id, encrypted_token, shop_id')
    .eq('platform', 'printify')
    .eq('shop_id', String(shopId))
    .maybeSingle();

  if (connectionError) {
    logEvent('error', 'Webhook could not look up store connection', {
      requestId: req.id,
      shopId,
      error: connectionError.message,
    });
    return res.status(500).json({ message: 'Could not resolve shop' });
  }

  if (!connection) {
    logEvent('warn', 'Webhook ignored: no user connected to this shop', {
      requestId: req.id,
      shopId,
      eventType,
    });
    return res.status(202).json({ message: 'No matching shop connection' });
  }

  const status = mapEventToStatus(eventType, data);
  if (!status) {
    return res.status(202).json({ message: 'Event type ignored' });
  }

  let token = null;
  try {
    token = decrypt(connection.encrypted_token);
  } catch (err) {
    logEvent('error', 'Webhook could not decrypt store token', {
      requestId: req.id,
      shopId,
      error: err.message,
    });
    return res.status(500).json({ message: 'Could not read store credentials' });
  }

  // Enrich with the current order so tracking, totals and the real
  // Printify status are available. If this call fails we still store the
  // event data, so the feed does not go silent.
  let printifyOrder = null;
  try {
    printifyOrder = await fetchPrintifyOrder(token, shopId, orderId);
  } catch (err) {
    logEvent('warn', 'Webhook order enrichment failed', {
      requestId: req.id,
      shopId,
      orderId,
      error: err.message,
    });
  }

  // Event type wins for shipment/delivery because the order-level status
  // may still be "fulfilled" after a delivery webhook.
  let effectiveStatus;
  if (eventType === 'order:shipment:delivered') {
    effectiveStatus = 'delivered';
  } else if (eventType === 'order:shipment:created') {
    effectiveStatus = 'shipped';
  } else if (eventType === 'order:line-item:canceled') {
    // Only out-of-stock / IP-detection cancellations are problems. A
    // merchant-initiated line-item cancellation should keep the order's
    // real production status and should not trigger an alert.
    const reason = String(data.status_details || '').toLowerCase();
    if (['out_of_stock', 'item_is_canceled_by_ip_detection'].includes(reason)) {
      effectiveStatus = 'problem';
    } else if (printifyOrder?.status) {
      effectiveStatus = mapPrintifyStatus(printifyOrder.status);
    } else {
      effectiveStatus = 'new';
    }
  } else if (printifyOrder?.status) {
    effectiveStatus = mapPrintifyStatus(printifyOrder.status);
  } else {
    effectiveStatus = mapEventToStatus(eventType, data);
  }

  // A production order with no shipment after DELAYED_SHIPPING_DAYS needs
  // attention too. This is deliberately configurable instead of a hidden
  // hard-coded SLA. TODO(product): tune the default with real shop data.
  const delayed = effectiveStatus === 'in_production' && isDelayedShipping(printifyOrder);
  if (delayed) effectiveStatus = 'problem';

  const shipment = Array.isArray(printifyOrder?.shipments)
    ? printifyOrder.shipments.find((item) => item && (item.number || item.tracking_number))
    : null;

  const totalCents = Number(printifyOrder?.total_price);
  const total = Number.isFinite(totalCents) ? totalCents / 100 : null;
  const createdAt = parsePrintifyDate(printifyOrder?.created_at || event.created_at) ||
    new Date().toISOString();

  const row = {
    user_id: connection.user_id,
    store_id: String(shopId),
    printify_order_id: String(orderId),
    status: effectiveStatus || 'new',
    tracking_number:
      data.carrier?.tracking_number || shipment?.number || shipment?.tracking_number || null,
    carrier: data.carrier?.code || shipment?.carrier || null,
    total,
    // TODO(verify): Printify's order response sample does not include a
    // currency field. Keep the row usable with USD until confirmed.
    currency: printifyOrder?.currency || data.currency || 'USD',
    created_at: createdAt,
    updated_at: new Date().toISOString(),
    raw: sanitizeRawOrder(printifyOrder || event),
  };

  // Idempotency guard: never move a delivered or canceled order backwards
  // when an older webhook arrives late or Printify retries a delivery.
  const { data: existing } = await adminClient
    .from('orders_feed')
    .select('status')
    .eq('printify_order_id', String(orderId))
    .maybeSingle();

  if (
    existing?.status &&
    ['delivered', 'canceled'].includes(existing.status) &&
    row.status !== existing.status
  ) {
    return res.status(200).json({ received: true, ignored: 'terminal-status' });
  }

  const { data: saved, error: upsertError } = await adminClient
    .from('orders_feed')
    .upsert(row, { onConflict: 'printify_order_id' })
    .select('id, status')
    .single();

  if (upsertError) {
    logEvent('error', 'Could not upsert order feed row', {
      requestId: req.id,
      shopId,
      orderId,
      error: upsertError.message,
    });
    return res.status(500).json({ message: 'Could not save order' });
  }

  // Alert only on a transition into "problem", not on every webhook retry.
  // The unique (user_id, printify_order_id, type) index is a second guard
  // against duplicate pushes.
  if (row.status === 'problem' && existing?.status !== 'problem') {
    try {
      const problem = describeProblem(eventType, data, printifyOrder, orderId, delayed);
      const inserted = await createProblemAlert(adminClient, {
        userId: connection.user_id,
        orderId: saved?.id || null,
        printifyOrderId: String(orderId),
        type: problem.type,
        message: problem.message,
      });

      if (inserted) {
        await sendPushToUser(connection.user_id, {
          title: 'Order needs attention',
          body: problem.message,
          url: '/dashboard.html',
          tag: `order-${orderId}`,
        });
      }
    } catch (alertError) {
      // Never fail the webhook because an alert or push failed.
      logEvent('error', 'Could not create order alert', {
        requestId: req.id,
        shopId,
        orderId,
        error: alertError.message,
      });
    }
  }

  res.json({
    received: true,
    id: saved?.id || null,
    status: saved?.status || row.status,
  });
});

// ---------- Register Printify webhooks from the dashboard ----------
app.post('/webhooks/register', async (req, res) => {
  const auth = await getAuthContext(req, res);
  if (!auth) return;

  const { data: connection, error: connectionError } = await auth.userClient
    .from('store_connections')
    .select('*')
    .eq('user_id', auth.user.id)
    .eq('platform', 'printify')
    .maybeSingle();

  if (connectionError || !connection) {
    return res.status(400).json({ message: 'Connect a Printify store first.' });
  }

  let token;
  try {
    token = decrypt(connection.encrypted_token);
  } catch (err) {
    logEvent('error', 'Webhook registration could not decrypt token', {
      requestId: req.id,
      userId: auth.user.id,
      error: err.message,
    });
    return res.status(500).json({ message: 'Could not read store credentials.' });
  }

  let shopId;
  try {
    shopId = await getShopIdForConnection(token, connection);
  } catch (err) {
    return res.status(502).json({ message: `Could not read Printify shops: ${err.message}` });
  }

  const baseUrl = (process.env.APP_BASE_URL ||
    `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
  const webhookUrl = `${baseUrl}/webhooks/printify`;
  const secret = process.env.PRINTIFY_WEBHOOK_SECRET || null;

  const topics = [
    'order:created',
    'order:updated',
    'order:line-item:canceled',
    'order:sent-to-production',
    'order:shipment:created',
    'order:shipment:delivered',
  ];

  let existing = [];
  try {
    const existingResponse = await printifyRequest(
      `/shops/${encodeURIComponent(shopId)}/webhooks.json`,
      token,
    );
    existing = Array.isArray(existingResponse) ? existingResponse : [];
  } catch (err) {
    return res.status(502).json({
      message: `Could not list Printify webhooks: ${err.message}`,
    });
  }

  const created = [];
  const skipped = [];
  const errors = [];

  for (const topic of topics) {
    const sameTopic = existing.filter((webhook) => webhook.topic === topic);
    if (sameTopic.some((webhook) => webhook.url === webhookUrl)) {
      skipped.push(topic);
      continue;
    }

    const body = { topic, url: webhookUrl };
    if (secret) body.secret = secret;

    try {
      await printifyRequest(
        `/shops/${encodeURIComponent(shopId)}/webhooks.json`,
        token,
        { method: 'POST', body: JSON.stringify(body) },
      );
      created.push(topic);
    } catch (err) {
      errors.push({ topic, error: err.message });
    }
  }

  logEvent('info', 'Printify webhook registration finished', {
    requestId: req.id,
    userId: auth.user.id,
    shopId,
    created: created.length,
    skipped: skipped.length,
    errors: errors.length,
  });

  res.json({
    shopId,
    webhookUrl,
    created,
    skipped,
    errors,
    secretConfigured: Boolean(secret),
    note: secret
      ? 'Webhook signatures will be verified with PRINTIFY_WEBHOOK_SECRET.'
      : 'PRINTIFY_WEBHOOK_SECRET is not set, so incoming signatures will not be verified.',
  });
});

// ---------- Cancel an order (Printify only allows two stages) ----------
app.post('/orders/:id/cancel', async (req, res) => {
  const auth = await getAuthContext(req, res);
  if (!auth) return;

  const { data: order, error: orderError } = await auth.userClient
    .from('orders_feed')
    .select('id, store_id, printify_order_id, status, raw')
    .eq('id', req.params.id)
    .eq('user_id', auth.user.id)
    .maybeSingle();

  if (orderError || !order) {
    return res.status(404).json({ message: 'Order not found.' });
  }

  if (['delivered', 'canceled'].includes(String(order.status).toLowerCase())) {
    return res.status(409).json({
      message: `This order is already ${order.status} and cannot be canceled.`,
    });
  }

  const { data: connection, error: connectionError } = await auth.userClient
    .from('store_connections')
    .select('*')
    .eq('user_id', auth.user.id)
    .eq('platform', 'printify')
    .maybeSingle();

  if (connectionError || !connection) {
    return res.status(400).json({ message: 'No Printify store connected.' });
  }

  let token;
  try {
    token = decrypt(connection.encrypted_token);
  } catch (err) {
    logEvent('error', 'Cancel order could not decrypt token', {
      requestId: req.id,
      userId: auth.user.id,
      orderId: order.id,
      error: err.message,
    });
    return res.status(500).json({ message: 'Could not read store credentials.' });
  }

  let shopId;
  try {
    shopId = order.store_id || await getShopIdForConnection(token, connection);
  } catch (err) {
    return res.status(502).json({ message: `Could not read Printify shop: ${err.message}` });
  }

  // Check the live Printify status before calling cancel. The documented
  // cancel endpoint only accepts "on-hold" and "payment-not-received".
  let liveOrder;
  try {
    liveOrder = await fetchPrintifyOrder(token, shopId, order.printify_order_id);
  } catch (err) {
    return res.status(502).json({ message: `Could not read order from Printify: ${err.message}` });
  }

  const liveStatus = String(liveOrder?.status || '').toLowerCase();
  if (!['on-hold', 'payment-not-received'].includes(liveStatus)) {
    return res.status(409).json({
      message: `Printify does not allow cancellation at status "${liveOrder?.status || 'unknown'}".`,
      printifyStatus: liveOrder?.status || null,
    });
  }

  let canceledOrder;
  try {
    canceledOrder = await printifyRequest(
      `/shops/${encodeURIComponent(shopId)}/orders/${encodeURIComponent(order.printify_order_id)}/cancel.json`,
      token,
      { method: 'POST' },
    );
  } catch (err) {
    logEvent('warn', 'Printify cancel request failed', {
      requestId: req.id,
      userId: auth.user.id,
      orderId: order.id,
      status: err.status,
      error: err.message,
    });
    return res.status(err.status === 400 ? 409 : 502).json({
      message: err.body?.message || err.body?.errors?.reason || err.message,
    });
  }

  const adminClient = getAdminClient();
  if (!adminClient) {
    return res.status(503).json({
      message: 'Order was canceled at Printify, but the local feed could not be updated.',
    });
  }

  const { error: updateError } = await adminClient
    .from('orders_feed')
    .update({
      status: 'canceled',
      updated_at: new Date().toISOString(),
      raw: sanitizeRawOrder(canceledOrder || { ...order.raw, status: 'canceled' }),
    })
    .eq('id', order.id);

  if (updateError) {
    logEvent('error', 'Order canceled at Printify but feed update failed', {
      requestId: req.id,
      orderId: order.id,
      error: updateError.message,
    });
  }

  res.json({ message: 'Order canceled at Printify.', orderId: order.id, status: 'canceled' });
});

// ---------- Web push subscriptions ----------
app.post('/push/subscribe', async (req, res) => {
  const auth = await getAuthContext(req, res);
  if (!auth) return;

  const subscription = req.body?.subscription || req.body || {};
  const endpoint = subscription.endpoint;
  const keys = subscription.keys || {};

  if (!endpoint || !keys.p256dh || !keys.auth) {
    return res.status(400).json({ message: 'A valid push subscription is required.' });
  }

  const adminClient = getAdminClient();
  if (!adminClient) {
    return res.status(503).json({ message: 'Push storage is not configured.' });
  }

  const { error } = await adminClient
    .from('push_subscriptions')
    .upsert(
      {
        user_id: auth.user.id,
        endpoint,
        p256dh: keys.p256dh,
        auth: keys.auth,
        user_agent: req.headers['user-agent'] || null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'endpoint' },
    );

  if (error) {
    logEvent('error', 'Could not save push subscription', {
      requestId: req.id,
      userId: auth.user.id,
      error: error.message,
    });
    return res.status(500).json({ message: 'Could not save the push subscription.' });
  }

  res.json({ message: 'Push notifications enabled.' });
});

app.post('/push/unsubscribe', async (req, res) => {
  const auth = await getAuthContext(req, res);
  if (!auth) return;

  const endpoint = req.body?.endpoint || req.body?.subscription?.endpoint;
  if (!endpoint) {
    return res.status(400).json({ message: 'A push endpoint is required.' });
  }

  const adminClient = getAdminClient();
  if (!adminClient) {
    return res.status(503).json({ message: 'Push storage is not configured.' });
  }

  const { error } = await adminClient
    .from('push_subscriptions')
    .delete()
    .eq('endpoint', endpoint)
    .eq('user_id', auth.user.id);

  if (error) {
    logEvent('error', 'Could not remove push subscription', {
      requestId: req.id,
      userId: auth.user.id,
      error: error.message,
    });
    return res.status(500).json({ message: 'Could not remove the push subscription.' });
  }

  res.json({ message: 'Push notifications disabled.' });
});

// ---------- Central error handling ----------
// Express 5 forwards rejected async handlers here automatically. Log a
// structured line (never the request body) and return a safe JSON error.
app.use((req, res) => {
  res.status(404).json({ message: 'Not found', requestId: req.id });
});

app.use((err, req, res, next) => {
  const status = err.status || err.statusCode || 500;
  logEvent('error', 'Unhandled request error', {
    requestId: req.id,
    method: req.method,
    path: req.originalUrl,
    status,
    ip: req.ip,
    error: err.message,
    stack: process.env.NODE_ENV === 'production' ? undefined : err.stack,
  });

  if (res.headersSent) return next(err);
  res.status(status).json({
    message: status >= 500 ? 'Something went wrong. Please try again.' : err.message,
    requestId: req.id,
  });
});

// ---------- Local development vs Netlify serverless ----------
// On Netlify the daily job (06:00 UTC) is a scheduled function
// (netlify/functions/daily-digest.js, schedule in netlify.toml) —
// node-cron is not used. Locally, trigger the same work with:
//   curl -X POST localhost:3000/run-digest -H "x-cron-secret: $CRON_SECRET"
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));

  // Backfill on startup if running locally
  generateDailyTips().catch((err) => console.error('Startup tips error:', err.message));
}

module.exports = app;
module.exports.app = app;
module.exports.generateDailyTips = generateDailyTips;
module.exports.runDigestsForAllUsers = runDigestsForAllUsers;
module.exports.sendDigestEmail = sendDigestEmail;
module.exports.buildStaticTips = buildStaticTips;
module.exports.checkContactRateLimitMemory = checkContactRateLimitMemory;
module.exports.logEvent = logEvent;
module.exports.mapPrintifyStatus = mapPrintifyStatus;
module.exports.mapEventToStatus = mapEventToStatus;
module.exports.serializeOrder = serializeOrder;
module.exports.sanitizeRawOrder = sanitizeRawOrder;
module.exports.isDelayedShipping = isDelayedShipping;
module.exports.describeProblem = describeProblem;
