// Protect this page: if no login token exists, send them back to login
const accessToken = localStorage.getItem('access_token');
if (!accessToken) {
  window.location.href = '/index.html';
}

const connectView = document.getElementById('connectView');
const storeView = document.getElementById('storeView');
const statusEl = document.getElementById('status');

document.getElementById('connectPrintifyBtn').addEventListener('click', () => {
  document.getElementById('printifyForm').style.display = 'block';
});

document.getElementById('savePrintifyBtn').addEventListener('click', async () => {
  const token = document.getElementById('printifyToken').value;

  const res = await fetch('/connect-printify', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ printifyToken: token }),
  });
  const data = await res.json();
  statusEl.textContent = data.message;

  // Refresh so the dashboard switches to the store view once connected
  if (res.ok) loadShopStats();
});

async function loadShopStats() {
  try {
    const res = await fetch('/shop-stats', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const data = await res.json();

    if (data.connected && data.shopTitle) {
      renderStore(data);
    } else if (data.error) {
      statusEl.textContent = data.error;
    } else {
      statusEl.textContent = 'No stores connected yet.';
    }
  } catch (err) {
    // Offline PWA: keep the cached shell visible instead of leaving an
    // unhandled promise rejection.
    statusEl.textContent = 'Could not reach the server. Check your connection and try again.';
  }
}

// A connected store fills the dashboard with its own view
function renderStore(data) {
  connectView.style.display = 'none';
  storeView.style.display = 'block';
  document.getElementById('storeName').textContent = data.shopTitle;
  document.getElementById('orderCount').textContent = data.recentOrderCount;

  const errorEl = document.getElementById('storeError');
  if (data.error) {
    errorEl.textContent = data.error;
    errorEl.style.display = 'block';
  }
}

loadShopStats();

// --- Live Orders ---
const STATUS_LABELS = {
  new: 'New',
  in_production: 'In production',
  shipped: 'Shipped',
  delivered: 'Delivered',
  problem: 'Needs attention',
  canceled: 'Canceled',
};

let orders = [];
let ordersUserId = null;
let ordersPollTimer = null;
let ordersRealtimeOk = false;
let ordersChannel = null;
let appConfig = null;

function setLiveStatus(message) {
  const el = document.getElementById('liveOrdersStatus');
  if (el) el.textContent = message;
}

function formatOrderDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatOrderMoney(total, currency) {
  if (total === null || total === undefined || Number.isNaN(Number(total))) return '—';
  return `${Number(total).toFixed(2)} ${currency || ''}`.trim();
}

function orderCard(order) {
  const status = order.status || 'new';
  const statusLabel = STATUS_LABELS[status] || status;
  const orderNumber = String(order.printifyOrderId || '').slice(-8) || '—';
  const tracking = order.trackingNumber
    ? `<span>Tracking: <strong>${escapeHtml(order.trackingNumber)}</strong></span>`
    : '';
  const carrier = order.carrier
    ? `<span>Carrier: <strong>${escapeHtml(order.carrier)}</strong></span>`
    : '';
  const printifyStatus = order.printifyStatus
    ? `<span>Printify: <strong>${escapeHtml(order.printifyStatus)}</strong></span>`
    : '';
  const cancelButton = order.cancellable
    ? `<div class="order-actions">
         <button type="button" class="order-cancel-btn"
           data-order-id="${escapeHtml(order.id)}"
           data-order-label="#${escapeHtml(orderNumber)}">Cancel order</button>
       </div>`
    : '';

  return `
    <article class="order-card">
      <div class="order-card-top">
        <div>
          <div class="order-id">Order #${escapeHtml(orderNumber)}</div>
          <div class="order-date">${escapeHtml(formatOrderDate(order.createdAt))}</div>
        </div>
        <span class="order-status status-${escapeHtml(status.replace(/[^a-z_]/g, ''))}">${escapeHtml(statusLabel)}</span>
      </div>
      <div class="order-meta">
        <span>Total: <strong>${escapeHtml(formatOrderMoney(order.total, order.currency))}</strong></span>
        ${tracking}
        ${carrier}
        ${printifyStatus}
      </div>
      ${cancelButton}
    </article>
  `;
}

function renderOrders() {
  const list = document.getElementById('liveOrdersList');
  if (!list) return;

  const sorted = [...orders].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  if (!sorted.length) {
    list.innerHTML =
      '<p class="orders-empty">No orders yet. New Printify orders will appear here.</p>';
    return;
  }

  list.innerHTML = sorted.map(orderCard).join('');
  list.querySelectorAll('.order-cancel-btn').forEach((button) => {
    button.addEventListener('click', () => {
      cancelOrder(button.dataset.orderId, button.dataset.orderLabel, button);
    });
  });
}

function dbRowToOrder(row) {
  return {
    id: row.id,
    storeId: row.store_id,
    printifyOrderId: row.printify_order_id,
    status: row.status,
    printifyStatus: row.raw && row.raw.status ? row.raw.status : null,
    trackingNumber: row.tracking_number,
    carrier: row.carrier,
    total: row.total,
    currency: row.currency,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    cancellable: false,
  };
}

function upsertOrder(order) {
  const index = orders.findIndex(
    (item) => item.id === order.id || item.printifyOrderId === order.printifyOrderId,
  );
  if (index >= 0) {
    orders[index] = { ...orders[index], ...order };
  } else {
    orders.push(order);
  }
  renderOrders();
}

async function loadOrders() {
  try {
    const res = await fetch('/orders', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || 'Could not load orders');

    ordersUserId = data.userId;
    orders = data.orders || [];
    renderOrders();
    return data;
  } catch (err) {
    setLiveStatus(`Could not load orders: ${err.message}`);
    return null;
  }
}

function startOrdersPolling() {
  if (ordersPollTimer) return;
  ordersPollTimer = setInterval(loadOrders, 30000);
}

function stopOrdersPolling() {
  if (!ordersPollTimer) return;
  clearInterval(ordersPollTimer);
  ordersPollTimer = null;
}

async function setupOrdersRealtime() {
  let config = null;
  try {
    const res = await fetch('/public-config');
    config = await res.json();
    appConfig = config;
  } catch (err) {
    config = appConfig;
  }

  if (
    !config ||
    !config.supabaseUrl ||
    !config.supabaseAnonKey ||
    !window.supabase ||
    !ordersUserId
  ) {
    setLiveStatus('Live updates unavailable — refreshing every 30 seconds.');
    startOrdersPolling();
    return;
  }

  const client = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);

  try {
    if (client.realtime && client.realtime.setAuth) {
      await client.realtime.setAuth(accessToken);
    }
  } catch (err) {
    // Realtime auth is best effort; RLS still blocks unauthorised rows.
  }

  ordersChannel = client
    .channel(`orders-feed-${ordersUserId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'orders_feed',
        filter: `user_id=eq.${ordersUserId}`,
      },
      (payload) => {
        if (payload.eventType === 'DELETE' && payload.old) {
          orders = orders.filter((order) => order.id !== payload.old.id);
          renderOrders();
        } else if (payload.new) {
          upsertOrder(dbRowToOrder(payload.new));
        }
      },
    )
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        ordersRealtimeOk = true;
        stopOrdersPolling();
        setLiveStatus('Live — new order updates appear automatically.');
      } else if (['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(status)) {
        ordersRealtimeOk = false;
        setLiveStatus('Live updates reconnecting — refreshing every 30 seconds.');
        startOrdersPolling();
      }
    });

  // If Realtime never subscribes, polling keeps the feed usable.
  setTimeout(() => {
    if (!ordersRealtimeOk) startOrdersPolling();
  }, 8000);
}

async function cancelOrder(orderId, orderLabel, button) {
  if (!orderId) return;
  if (!confirm(`Cancel ${orderLabel || 'this order'} at Printify? This cannot be undone.`)) {
    return;
  }

  button.disabled = true;
  button.textContent = 'Canceling…';

  try {
    const res = await fetch(`/orders/${encodeURIComponent(orderId)}/cancel`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || 'Could not cancel this order');

    const existing = orders.find((order) => order.id === orderId) || {
      id: orderId,
      printifyOrderId: orderId,
    };
    upsertOrder({
      ...existing,
      status: 'canceled',
      printifyStatus: 'canceled',
      cancellable: false,
      updatedAt: new Date().toISOString(),
    });
    setLiveStatus(data.message || 'Order canceled.');
  } catch (err) {
    alert(err.message);
    button.disabled = false;
    button.textContent = 'Cancel order';
  }
}

async function initLiveOrders() {
  const data = await loadOrders();
  if (!data) return;

  if (!data.orders.length) {
    setLiveStatus('No orders yet. Enable live updates to receive new ones.');
  } else {
    setLiveStatus('Orders loaded. Connecting to live updates…');
  }

  await setupOrdersRealtime();
}

// --- Web push alerts ---
function pushSupported() {
  return (
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

function setPushButton(label, disabled) {
  const button = document.getElementById('enablePushBtn');
  if (!button) return;
  button.textContent = label;
  button.disabled = Boolean(disabled);
}

async function getAppConfig() {
  if (appConfig) return appConfig;
  try {
    const res = await fetch('/public-config');
    appConfig = await res.json();
  } catch (err) {
    appConfig = null;
  }
  return appConfig;
}

async function refreshPushButton() {
  if (!document.getElementById('enablePushBtn')) return;

  if (!pushSupported()) {
    setPushButton('Alerts not supported', true);
    return;
  }

  if (Notification.permission === 'denied') {
    setPushButton('Alerts blocked', true);
    return;
  }

  try {
    const registration = await navigator.serviceWorker.getRegistration();
    const subscription = registration
      ? await registration.pushManager.getSubscription()
      : null;

    if (subscription) {
      // Keep it clickable: re-posting the existing subscription repairs
      // the server row if the browser was previously pruned (410/404).
      setPushButton('Alerts on', false);
    } else {
      setPushButton('Enable alerts', false);
    }
  } catch (err) {
    setPushButton('Enable alerts', false);
  }
}

async function enablePushNotifications() {
  if (!pushSupported()) {
    alert('This browser does not support web push notifications.');
    return;
  }

  if (
    window.SellyticsPWA &&
    window.SellyticsPWA.isIOS() &&
    !window.SellyticsPWA.isStandalone()
  ) {
    alert(
      'On iPhone, first add Sellytics to your Home Screen (Share → Add to Home Screen), then open it from there and tap Enable alerts again.',
    );
    return;
  }

  const config = await getAppConfig();
  if (!config || !config.vapidPublicKey) {
    alert('Push notifications are not configured on the server yet. Add VAPID keys in Netlify and redeploy.');
    return;
  }

  setPushButton('Enabling…', true);

  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      setPushButton(permission === 'denied' ? 'Alerts blocked' : 'Enable alerts', permission === 'denied');
      setLiveStatus('Notifications were not enabled.');
      return;
    }

    const registration = await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();

    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: window.SellyticsPWA.urlBase64ToUint8Array(
          config.vapidPublicKey,
        ),
      });
    }

    const res = await fetch('/push/subscribe', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ subscription: subscription.toJSON() }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || 'Could not save the push subscription');

    setPushButton('Alerts on', false);
    setLiveStatus('Push alerts are enabled for this browser.');
  } catch (err) {
    alert(err.message);
    setPushButton('Enable alerts', false);
  }
}

document.getElementById('registerWebhooksBtn')?.addEventListener('click', async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  button.textContent = 'Enabling…';
  setLiveStatus('Registering Printify webhooks…');

  try {
    const res = await fetch('/webhooks/register', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || 'Could not register webhooks');

    const parts = [
      `${data.created.length} created`,
      `${data.skipped.length} already active`,
    ];
    if (data.errors && data.errors.length) parts.push(`${data.errors.length} failed`);
    setLiveStatus(`Webhooks: ${parts.join(', ')}. ${data.note || ''}`.trim());
  } catch (err) {
    setLiveStatus(`Webhook registration failed: ${err.message}`);
  } finally {
    button.disabled = false;
    button.textContent = 'Enable live updates';
  }
});

document.getElementById('enablePushBtn')?.addEventListener('click', enablePushNotifications);
refreshPushButton();

initLiveOrders();

document.getElementById('sendDigestBtn').addEventListener('click', async () => {
  const res = await fetch('/send-digest', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await res.json();
  alert(data.message);
});

// --- Add another store ---
document.getElementById('addStoreBtn').addEventListener('click', () => {
  const form = document.getElementById('addStoreForm');
  form.style.display = form.style.display === 'none' ? 'block' : 'none';
});

document.getElementById('connectNewStoreBtn').addEventListener('click', async () => {
  const token = document.getElementById('newStoreApiKey').value;

  const res = await fetch('/connect-printify', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ printifyToken: token }),
  });
  const data = await res.json();
  document.getElementById('addStoreStatus').textContent = data.message;

  if (res.ok) loadShopStats();
});

// --- Daily tips ---
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  // innerHTML escapes &, < and > but not quotes; quote-escape as well so
  // the same helper is safe inside attributes.
  return div.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Tips come from the server's once-per-day cache; the hardcoded
// evergreen content stays as the fallback when the cache is empty.
async function loadDailyTips() {
  try {
    const res = await fetch('/daily-tips', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const data = await res.json();

    const insightGrid = document.getElementById('insightGrid');
    if (data.tips && data.tips.length && insightGrid) {
      insightGrid.innerHTML = data.tips.map(
        (tip, i) =>
          `<div class="insight-card"><span class="tip-num">${i + 1}</span>` +
          `<p>${escapeHtml(tip)}</p></div>`,
      ).join('');

      const insightsNote = document.getElementById('insightsNote');
      if (insightsNote) {
        insightsNote.textContent =
          `Fresh picks for ${data.date} — regenerated every morning at 8am.`;
      }
    }

    if (data.social) {
      renderTipList('youtubeTips', data.social.youtube);
      renderTipList('instagramTips', data.social.instagram);

      const reachNote = document.getElementById('reachNote');
      if (reachNote) {
        reachNote.textContent = data.fallback
          ? 'Fresh AI tips are unavailable right now — showing evergreen tips.'
          : `Fresh reach ideas for ${data.date} — regenerated every morning at 8am.`;
      }
    }
  } catch (err) {
    // Keep the evergreen fallback content
  }
}

function renderTipList(id, items) {
  if (!items || !items.length) return;
  document.getElementById(id).innerHTML = items
    .map((tip) => `<li>${escapeHtml(tip)}</li>`)
    .join('');
}

loadDailyTips();

// --- Log out ---
function logoutUser() {
  localStorage.removeItem('access_token');
  sessionStorage.clear();
  window.location.href = '/index.html';
}

const logoutBtn = document.getElementById('logoutBtn');
if (logoutBtn) logoutBtn.addEventListener('click', logoutUser);

const accountLogoutBtn = document.getElementById('accountLogoutBtn');
if (accountLogoutBtn) accountLogoutBtn.addEventListener('click', logoutUser);

// --- Delete account and data ---
document.getElementById('deleteAccountBtn').addEventListener('click', async () => {
  if (!confirm('Delete your account and all stored data? This cannot be undone.')) return;

  const res = await fetch('/delete-account', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await res.json();

  if (res.ok) {
    localStorage.removeItem('access_token');
    window.location.href = '/index.html';
  } else {
    alert(data.message || 'Account deletion failed');
  }
});

// --- iOS "Add to Home Screen" hint ---
const iosInstallHint = document.getElementById('iosInstallHint');
if (
  iosInstallHint &&
  window.SellyticsPWA &&
  window.SellyticsPWA.isIOS() &&
  !window.SellyticsPWA.isStandalone() &&
  localStorage.getItem('ios-install-hint-dismissed') !== '1'
) {
  iosInstallHint.style.display = 'flex';
}

const iosInstallDismiss = document.getElementById('iosInstallDismiss');
if (iosInstallDismiss) {
  iosInstallDismiss.addEventListener('click', () => {
    localStorage.setItem('ios-install-hint-dismissed', '1');
    iosInstallHint.style.display = 'none';
  });
}

// --- Horizontal T-Shirt Showcase Scroll Controls ---
const tshirtContainer = document.getElementById('tshirtScrollContainer');
const scrollLeftBtn = document.getElementById('tshirtScrollLeft');
const scrollRightBtn = document.getElementById('tshirtScrollRight');

if (tshirtContainer && scrollLeftBtn && scrollRightBtn) {
  scrollLeftBtn.addEventListener('click', () => {
    tshirtContainer.scrollBy({ left: -260, behavior: 'smooth' });
  });

  scrollRightBtn.addEventListener('click', () => {
    tshirtContainer.scrollBy({ left: 260, behavior: 'smooth' });
  });
}

