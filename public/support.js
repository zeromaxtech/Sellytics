// Support modal & inline form helper injected across site pages
(function() {
  function injectModalStyles() {
    if (document.getElementById('supportModalInjectedStyles')) return;
    const style = document.createElement('style');
    style.id = 'supportModalInjectedStyles';
    style.textContent = `
      .support-modal-backdrop {
        position: fixed;
        inset: 0;
        width: 100vw;
        height: 100vh;
        background: rgba(15, 23, 42, 0.65);
        backdrop-filter: blur(6px);
        -webkit-backdrop-filter: blur(6px);
        display: none;
        align-items: center;
        justify-content: center;
        z-index: 99999;
        opacity: 0;
        transition: opacity 0.2s cubic-bezier(0.16, 1, 0.3, 1);
        padding: 16px;
        box-sizing: border-box;
      }
      .support-modal-backdrop.active {
        display: flex;
        opacity: 1;
      }
      .support-modal {
        background: #ffffff;
        border: 1px solid #e2e8f0;
        border-radius: 16px;
        width: 100%;
        max-width: 480px;
        padding: 28px;
        box-shadow: 0 25px 50px -12px rgba(15, 23, 42, 0.25);
        position: relative;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        box-sizing: border-box;
      }
      .support-modal-close {
        position: absolute;
        top: 16px;
        right: 18px;
        background: transparent;
        border: none;
        font-size: 24px;
        line-height: 1;
        color: #94a3b8;
        cursor: pointer;
        padding: 4px 8px;
        border-radius: 6px;
      }
      .support-modal-close:hover {
        color: #0f172a;
        background: #f1f5f9;
      }
      .support-modal h2 {
        margin: 0 0 6px 0;
        font-size: 1.25rem;
        font-weight: 700;
        color: #0f172a;
      }
      .support-modal-info {
        font-size: 0.85rem;
        color: #64748b;
        margin: 0 0 18px 0;
      }
      .support-modal-info strong {
        color: #4f46e5;
      }
      .support-modal form {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .support-modal form label {
        display: block;
        font-size: 0.8rem;
        font-weight: 600;
        color: #475569;
        margin-bottom: -6px;
      }
      .support-modal form input,
      .support-modal form textarea {
        width: 100%;
        box-sizing: border-box;
        padding: 10px 14px;
        border: 1px solid #cbd5e1;
        border-radius: 8px;
        font-size: 0.9rem;
        font-family: inherit;
        color: #0f172a;
        background: #ffffff;
        outline: none;
      }
      .support-modal form input:focus,
      .support-modal form textarea:focus {
        border-color: #4f46e5;
        box-shadow: 0 0 0 3px rgba(79, 70, 229, 0.12);
      }
      .support-modal form textarea {
        min-height: 90px;
        resize: vertical;
      }
      .support-modal form button[type="submit"] {
        margin-top: 8px;
        padding: 11px 16px;
        background: #4f46e5;
        color: #ffffff;
        border: none;
        border-radius: 8px;
        font-size: 0.92rem;
        font-weight: 600;
        cursor: pointer;
        transition: background 0.15s ease;
      }
      .support-modal form button[type="submit"]:hover {
        background: #4338ca;
      }
      .support-modal-status {
        font-size: 0.85rem;
        margin: 6px 0 0 0;
        text-align: center;
        font-weight: 600;
        min-height: 1.2em;
      }
      .support-modal-status.success { color: #166534; }
      .support-modal-status.error { color: #dc2626; }
    `;
    document.head.appendChild(style);
  }

  function initSupportModal() {
    // If inline form is present on the page (like dashboard), hook it directly
    const inlineForm = document.getElementById('inlineSupportForm');
    if (inlineForm) {
      inlineForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const submitBtn = document.getElementById('supportSubmitBtn');
        const statusEl = document.getElementById('supportModalStatus');
        submitBtn.disabled = true;
        submitBtn.textContent = 'Sending...';
        statusEl.textContent = 'Delivering your message...';
        statusEl.style.color = '#4f46e5';

        const payload = {
          name: document.getElementById('supportName').value.trim(),
          email: document.getElementById('supportEmail').value.trim(),
          subject: document.getElementById('supportSubject').value.trim(),
          message: document.getElementById('supportMessage').value.trim(),
        };

        try {
          const res = await fetch('/contact', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
          const data = await res.json();
          if (res.ok) {
            statusEl.textContent = data.message || 'Message sent successfully!';
            statusEl.style.color = '#10b981';
            inlineForm.reset();
          } else {
            statusEl.textContent = data.message || 'Failed to send message.';
            statusEl.style.color = '#ef4444';
          }
        } catch (err) {
          statusEl.textContent = 'Network error. Please try again.';
          statusEl.style.color = '#ef4444';
        } finally {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Send Support Message';
        }
      });

      // Also allow clicking mailto links to scroll to the inline form
      document.querySelectorAll('a[href*="support.sellytics"]').forEach((link) => {
        link.addEventListener('click', (e) => {
          e.preventDefault();
          inlineForm.scrollIntoView({ behavior: 'smooth', block: 'center' });
          const nameInput = document.getElementById('supportName');
          if (nameInput) nameInput.focus();
        });
      });

      return; // Do not inject modal if inline form is used
    }

    // Only inject once for standalone pages
    if (document.getElementById('supportModalBackdrop')) return;

    injectModalStyles();

    const modalHtml = `
      <div class="support-modal-backdrop" id="supportModalBackdrop" role="dialog" aria-modal="true" aria-labelledby="supportModalTitle">
        <div class="support-modal">
          <button type="button" class="support-modal-close" id="supportModalCloseBtn" aria-label="Close">&times;</button>
          <h2 id="supportModalTitle">Contact Support</h2>
          <p class="support-modal-info">Official address: <strong>support.sellytics@gmail.com</strong></p>
          <form id="supportModalForm">
            <div>
              <label for="supportName">Your Name</label>
              <input type="text" id="supportName" placeholder="Alex Seller" required>
            </div>
            <div>
              <label for="supportEmail">Your Email</label>
              <input type="email" id="supportEmail" placeholder="you@example.com" required>
            </div>
            <div>
              <label for="supportSubject">Subject</label>
              <input type="text" id="supportSubject" placeholder="Help with my store digest" required>
            </div>
            <div>
              <label for="supportMessage">Message</label>
              <textarea id="supportMessage" placeholder="How can we help you today?" required></textarea>
            </div>
            <button type="submit" id="supportSubmitBtn">Send Message</button>
            <p class="support-modal-status" id="supportModalStatus"></p>
          </form>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHtml);

    const backdrop = document.getElementById('supportModalBackdrop');
    const closeBtn = document.getElementById('supportModalCloseBtn');
    const form = document.getElementById('supportModalForm');
    const statusEl = document.getElementById('supportModalStatus');
    const submitBtn = document.getElementById('supportSubmitBtn');

    function openModal() {
      statusEl.textContent = '';
      statusEl.className = 'support-modal-status';
      backdrop.classList.add('active');
    }

    function closeModal() {
      backdrop.classList.remove('active');
    }

    closeBtn.addEventListener('click', closeModal);
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) closeModal();
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && backdrop.classList.contains('active')) {
        closeModal();
      }
    });

    // Intercept clicks on any support links or mailto buttons
    document.querySelectorAll('a[href*="support.sellytics"], a[href*="supportselltyics"], a[data-support-trigger="true"]').forEach((link) => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        openModal();
      });
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      submitBtn.disabled = true;
      submitBtn.textContent = 'Sending...';
      statusEl.textContent = 'Delivering your message...';
      statusEl.className = 'support-modal-status';

      const payload = {
        name: document.getElementById('supportName').value.trim(),
        email: document.getElementById('supportEmail').value.trim(),
        subject: document.getElementById('supportSubject').value.trim(),
        message: document.getElementById('supportMessage').value.trim(),
      };

      try {
        const res = await fetch('/contact', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        const data = await res.json();
        if (res.ok) {
          statusEl.textContent = data.message || 'Message sent successfully!';
          statusEl.className = 'support-modal-status success';
          form.reset();
          setTimeout(() => {
            closeModal();
          }, 2500);
        } else {
          statusEl.textContent = data.message || 'Failed to send message.';
          statusEl.className = 'support-modal-status error';
        }
      } catch (err) {
        statusEl.textContent = 'Network error. Please try again.';
        statusEl.className = 'support-modal-status error';
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Send Message';
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSupportModal);
  } else {
    initSupportModal();
  }
})();
