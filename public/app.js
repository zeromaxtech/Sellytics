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

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, ...extra }),
  });
  const data = await res.json();
  messageEl.textContent = data.message;

  if (endpoint === '/login' && data.session) {
    localStorage.setItem('access_token', data.session.access_token);
    window.location.href = '/dashboard.html';
  }
}
