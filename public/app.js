document.getElementById('authForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  await callAuth('/login');
});

document.getElementById('registerBtn').addEventListener('click', async () => {
  // Client-side consent gate: the checkbox starts unchecked, so
  // registration is blocked until the user ticks it. The server
  // enforces the same rule.
  const consent = document.getElementById('agreeTerms');
  if (!consent.checked) {
    document.getElementById('message').textContent =
      'Please agree to the Terms and Privacy Policy first.';
    return;
  }
  await callAuth('/register', { agreeTerms: true });
});

async function callAuth(endpoint, extra = {}) {
  const email = document.getElementById('email').value;
  const password = document.getElementById('password').value;
  const messageEl = document.getElementById('message');
  messageEl.textContent = 'Please wait...';
  messageEl.style.color = '';

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, ...extra }),
    });

    let data;
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      data = await res.json();
    } else {
      const text = await res.text();
      if (res.status === 401 && text.includes('edge-access')) {
        messageEl.style.color = '#ef4444';
        messageEl.textContent = 'Netlify Site Protection is enabled. Disable Site Protection in your Netlify dashboard under Site Settings > Access management.';
        return;
      }
      data = { message: `Server error (${res.status})` };
    }

    messageEl.textContent = data.message || 'An error occurred';
    if (!res.ok) {
      messageEl.style.color = '#ef4444';
    }

    if (endpoint === '/login' && data.session) {
      localStorage.setItem('access_token', data.session.access_token);
      window.location.href = '/dashboard.html';
    }
  } catch (err) {
    messageEl.style.color = '#ef4444';
    messageEl.textContent = 'Connection error: ' + err.message;
  }
}
