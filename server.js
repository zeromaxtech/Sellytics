require('dotenv').config();
const nodemailer = require('nodemailer');
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { encrypt, decrypt } = require('./crypto');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD },
});

const app = express();
app.use(express.json());
app.use(express.static('public'));

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY
);

function getAdminClient() {
  const serviceRoleKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  if (!serviceRoleKey) return null;
  return createClient(process.env.SUPABASE_URL, serviceRoleKey);
}

function todayString() {
  return new Date().toISOString().slice(0, 10);
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
    console.error('Error reading daily tips from Supabase:', err.message);
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
    console.error('Daily tips generation failed:', err.message);
    return null;
  }
}

// ---------- Routes ----------

app.post('/register', async (req, res) => {
  const { email, password } = req.body;

  // Consent gate: the register form's checkbox starts unchecked,
  // so registration is blocked (client- and server-side) until
  // the user ticks it.
  if (!req.body.agreeTerms) {
    return res.status(400).json({
      message: 'Please agree to the Terms and Privacy Policy first.',
    });
  }

  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) return res.status(400).json({ message: error.message });
  res.json({ message: 'Registered! Check your email to confirm.' });
});

app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return res.status(400).json({ message: error.message });
  res.json({ message: 'Logged in', session: data.session });
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
  res.json({ message: 'Printify connected!' });
});

// Shared by /shop-stats and /send-digest: loads the user's Printify
// connection, decrypts the token, then fetches the first shop along
// with its recent order count.
async function fetchShopData(userClient, userId) {
  let query = userClient
    .from('store_connections')
    .select('encrypted_token')
    .eq('platform', 'printify');
  if (userId) query = query.eq('user_id', userId);

  const { data: connection } = await query.single();

  if (!connection) return null;

  const token = decrypt(connection.encrypted_token);

  const shopsRes = await fetch('https://api.printify.com/v1/shops.json', {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!shopsRes.ok) {
    throw new Error(`Printify shops request failed (status ${shopsRes.status})`);
  }
  const shops = await shopsRes.json();
  if (!Array.isArray(shops) || shops.length === 0) {
    throw new Error('No shops found for this token');
  }

  const shop = shops[0];
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

  await transporter.sendMail({
    from: process.env.SMTP_USER,
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
  if (!cached) {
    // First request of the day: generate and save to Supabase
    cached = await generateDailyTips();
  }

  if (cached && cached.date === today) {
    return res.json({
      date: cached.date,
      tips: cached.tips,
      social: cached.social || null,
    });
  }
  res.json({ date: null, tips: null, social: null });
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
// 'supportselltyics@gmail.com' to users while securely delivering to
// the destination mailbox without exposing it on the client.
app.post('/contact', async (req, res) => {
  const { name, email, subject, message } = req.body || {};

  if (!email || !message) {
    return res.status(400).json({ message: 'Email and message are required.' });
  }

  const destination = process.env.SUPPORT_DESTINATION_EMAIL || 'nike64813@gmail.com';
  const displaySender = 'supportselltyics@gmail.com';

  try {
    await transporter.sendMail({
      from: `"${displaySender}" <${process.env.SMTP_USER}>`,
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
    console.error('Contact email sending error:', err.message);
    res.status(500).json({ message: 'Could not send message. Please try again later.' });
  }
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
