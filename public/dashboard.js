// Protect this page: if no login token exists, send them back to login
const accessToken = localStorage.getItem('access_token');
if (!accessToken) {
  window.location.href = '/index.html';
}

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
  document.getElementById('status').textContent = data.message;
});
async function loadShopStats() {
  const res = await fetch('/shop-stats', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await res.json();

  if (data.connected && data.shopTitle) {
    document.getElementById('status').textContent =
      `${data.shopTitle} — ${data.recentOrderCount} recent orders`;
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