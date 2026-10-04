require('dotenv').config();
const nodemailer = require('nodemailer');
const { encrypt, decrypt } = require('./crypto');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD },
});  

const express = require('express');
const { createClient } = require('@supabase/supabase-js');


const app = express();
app.use(express.json());
app.use(express.static('public'));

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_PUBLISHABLE_KEY);

app.post('/register', async (req, res) => {
  const { email, password } = req.body;
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

app.listen(3000, () => console.log('Server running on http://localhost:3000'));



app.post('/connect-printify', async (req, res) => {
  const authHeader = req.headers.authorization;
  const accessToken = authHeader?.split(' ')[1];
  if (!accessToken) return res.status(401).json({ message: 'Not logged in' });

  // Create a request-scoped client that carries THIS user's identity,
  // so Supabase's Row Level Security knows who's asking.
  const userClient = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_PUBLISHABLE_KEY, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });

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
// Returns null when no Printify store is connected, and throws when a
// Printify API call fails.
async function fetchShopData(userClient) {
  const { data: connection } = await userClient
    .from('store_connections')
    .select('encrypted_token')
    .eq('platform', 'printify')
    .single();

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

  const userClient = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_PUBLISHABLE_KEY, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
  const { data: { user } } = await userClient.auth.getUser(accessToken);
  if (!user) return res.status(401).json({ message: 'Invalid session' });

  try {
    const shopData = await fetchShopData(userClient);
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
app.post('/send-digest', async (req, res) => {
  const accessToken = req.headers.authorization?.split(' ')[1];
  if (!accessToken) return res.status(401).json({ message: 'Not logged in' });

  const userClient = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_PUBLISHABLE_KEY, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
  const { data: { user } } = await userClient.auth.getUser(accessToken);
  if (!user) return res.status(401).json({ message: 'Invalid session' });

  try {
    const shopData = await fetchShopData(userClient);
    if (!shopData) return res.json({ message: 'No store connected yet' });

    await transporter.sendMail({
      from: process.env.SMTP_USER,
      to: user.email,
      subject: `Shop Digest — ${shopData.shop.title}`,
      text: `Your shop "${shopData.shop.title}" has ${shopData.orderCount} recent orders.`,
    });

    res.json({ message: `Digest emailed to ${user.email}` });
  } catch (err) {
    res.status(502).json({ message: err.message });
  }
});