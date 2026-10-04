document.getElementById('authForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  await callAuth('/login');
});

document.getElementById('registerBtn').addEventListener('click', async () => {
  await callAuth('/register');
});

async function callAuth(endpoint) {
  const email = document.getElementById('email').value;
  const password = document.getElementById('password').value;
  const messageEl = document.getElementById('message');

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json();
  messageEl.textContent = data.message;

  if (endpoint === '/login' && data.session) {
    localStorage.setItem('access_token', data.session.access_token);
    window.location.href = '/dashboard.html';
  }
}