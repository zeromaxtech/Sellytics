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
  return div.innerHTML;
}

// Tips come from the server's once-per-day cache; the hardcoded
// evergreen content stays as the fallback when the cache is empty.
async function loadDailyTips() {
  try {
    const res = await fetch('/daily-tips', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const data = await res.json();

    if (data.tips && data.tips.length) {
      document.getElementById('insightGrid').innerHTML = data.tips.map(
        (tip, i) =>
          `<div class="insight-card"><span class="tip-num">${i + 1}</span>` +
          `<p>${escapeHtml(tip)}</p></div>`,
      ).join('');
      document.getElementById('insightsNote').textContent =
        `Fresh picks for ${data.date} — regenerated every morning at 8am.`;
    }

    if (data.social) {
      renderTipList('youtubeTips', data.social.youtube);
      renderTipList('instagramTips', data.social.instagram);
      document.getElementById('reachNote').textContent =
        `Fresh reach ideas for ${data.date} — regenerated every morning at 8am.`;
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

