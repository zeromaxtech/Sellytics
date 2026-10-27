// If user is already authenticated with a valid token, take them to the dashboard
if (localStorage.getItem('access_token')) {
  // Allow them to visit login/register if they explicitly want to, but avoid auto-redirect loops
}

const loginForm = document.getElementById('loginForm');
if (loginForm) {
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;
    await callAuth('/login', { email, password });
  });
}

const registerForm = document.getElementById('registerForm');
if (registerForm) {
  registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('regEmail').value.trim();
    const password = document.getElementById('regPassword').value;
    const confirmPassword = document.getElementById('regPasswordConfirm').value;
    const consent = document.getElementById('agreeTerms');
    const messageEl = document.getElementById('message');

    if (password !== confirmPassword) {
      messageEl.style.color = '#ef4444';
      messageEl.textContent = 'Passwords do not match. Please re-enter.';
      return;
    }

    if (!consent || !consent.checked) {
      messageEl.style.color = '#ef4444';
      messageEl.textContent = 'Please agree to the Terms and Privacy Policy first.';
      return;
    }

    await callAuth('/register', { email, password, agreeTerms: true });
  });
}

async function callAuth(endpoint, payload) {
  const messageEl = document.getElementById('message');
  messageEl.textContent = 'Please wait...';
  messageEl.style.color = '#64748b';

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
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
    } else {
      messageEl.style.color = '#10b981';
    }

    if (endpoint === '/login' && data.session) {
      localStorage.setItem('access_token', data.session.access_token);
      window.location.href = '/dashboard.html';
    } else if (endpoint === '/register' && res.ok) {
      messageEl.textContent = 'Account created! Check your email to confirm, then click Log In.';
      setTimeout(() => {
        window.location.href = '/index.html';
      }, 2500);
    }
  } catch (err) {
    messageEl.style.color = '#ef4444';
    messageEl.textContent = 'Connection error: ' + err.message;
  }
}
