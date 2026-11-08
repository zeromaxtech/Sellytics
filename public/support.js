// Sellytics Modern Support & Feedback Modal (elayadesign compliant)
(function() {
  function injectModalStyles() {
    if (document.getElementById('sellytics-support-styles')) return;
    const style = document.createElement('style');
    style.id = 'sellytics-support-styles';
    style.textContent = `
      .support-modal-backdrop {
        position: fixed !important;
        inset: 0 !important;
        width: 100vw !important;
        height: 100vh !important;
        background: rgba(15, 23, 42, 0.65) !important;
        backdrop-filter: blur(8px) !important;
        -webkit-backdrop-filter: blur(8px) !important;
        display: none !important;
        align-items: center !important;
        justify-content: center !important;
        z-index: 999999 !important;
        padding: 20px !important;
        box-sizing: border-box !important;
        opacity: 0;
        transition: opacity 0.2s cubic-bezier(0.16, 1, 0.3, 1) !important;
      }
      .support-modal-backdrop.active {
        display: flex !important;
        opacity: 1 !important;
      }
      .support-modal {
        background: #ffffff !important;
        border: 1px solid #e2e8f0 !important;
        border-radius: 18px !important;
        width: 100% !important;
        max-width: 480px !important;
        padding: 28px !important;
        box-shadow: 0 25px 50px -12px rgba(15, 23, 42, 0.25) !important;
        position: relative !important;
        font-family: 'Manrope', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
        box-sizing: border-box !important;
        transform: translateY(12px) scale(0.98);
        transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1) !important;
      }
      .support-modal-backdrop.active .support-modal {
        transform: translateY(0) scale(1) !important;
      }
      .support-modal-close {
        position: absolute !important;
        top: 18px !important;
        right: 18px !important;
        width: 32px !important;
        height: 32px !important;
        background: #f1f5f9 !important;
        border: none !important;
        font-size: 20px !important;
        line-height: 1 !important;
        color: #64748b !important;
        cursor: pointer !important;
        border-radius: 8px !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        transition: all 0.15s ease !important;
      }
      .support-modal-close:hover {
        color: #0f172a !important;
        background: #e2e8f0 !important;
      }
      .support-modal-header {
        margin-bottom: 20px !important;
      }
      .support-modal-header h2 {
        margin: 0 0 6px 0 !important;
        font-size: 1.25rem !important;
        font-weight: 800 !important;
        color: #0f172a !important;
        letter-spacing: -0.02em !important;
      }
      .support-modal-header p {
        font-size: 0.85rem !important;
        color: #64748b !important;
        margin: 0 !important;
        line-height: 1.5 !important;
      }
      .support-modal-badge {
        display: inline-flex !important;
        align-items: center !important;
        gap: 6px !important;
        font-size: 0.78rem !important;
        font-weight: 700 !important;
        color: #4f46e5 !important;
        background: #eef2ff !important;
        padding: 4px 10px !important;
        border-radius: 6px !important;
        margin-top: 8px !important;
      }
      .support-modal form {
        display: flex !important;
        flex-direction: column !important;
        gap: 14px !important;
      }
      .support-form-group {
        display: flex !important;
        flex-direction: column !important;
        gap: 6px !important;
      }
      .support-form-group label {
        font-size: 0.8rem !important;
        font-weight: 700 !important;
        color: #334155 !important;
      }
      .support-form-group input,
      .support-form-group textarea {
        width: 100% !important;
        box-sizing: border-box !important;
        padding: 10px 14px !important;
        border: 1px solid #cbd5e1 !important;
        border-radius: 10px !important;
        font-size: 0.9rem !important;
        font-family: inherit !important;
        color: #0f172a !important;
        background: #f8fafc !important;
        outline: none !important;
        transition: all 0.15s ease !important;
      }
      .support-form-group input:focus,
      .support-form-group textarea:focus {
        background: #ffffff !important;
        border-color: #4f46e5 !important;
        box-shadow: 0 0 0 3px rgba(79, 70, 229, 0.12) !important;
      }
      .support-form-group textarea {
        min-height: 95px !important;
        resize: vertical !important;
      }
      .support-submit-btn {
        margin-top: 6px !important;
        padding: 12px 18px !important;
        background: #4f46e5 !important;
        color: #ffffff !important;
        border: none !important;
        border-radius: 10px !important;
        font-size: 0.92rem !important;
        font-weight: 700 !important;
        cursor: pointer !important;
        transition: background 0.15s ease !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
      }
      .support-submit-btn:hover {
        background: #4338ca !important;
      }
      .support-submit-btn:disabled {
        opacity: 0.65 !important;
        cursor: not-allowed !important;
      }
      .support-modal-status {
        font-size: 0.85rem !important;
        margin: 4px 0 0 0 !important;
        text-align: center !important;
        font-weight: 700 !important;
        min-height: 1.2em !important;
      }
      .support-modal-status.success { color: #10b981 !important; }
      .support-modal-status.error { color: #ef4444 !important; }
    `;
    document.head.appendChild(style);
  }

  function initSupportModal() {
    // Only inject once
    if (document.getElementById('supportModalBackdrop')) {
      bindTriggers();
      return;
    }

    injectModalStyles();

    const modalHtml = `
      <div class="support-modal-backdrop" id="supportModalBackdrop" style="display: none !important;" role="dialog" aria-modal="true" aria-labelledby="supportModalTitle">
        <div class="support-modal">
          <button type="button" class="support-modal-close" id="supportModalCloseBtn" aria-label="Close modal">&times;</button>
          <div class="support-modal-header">
            <h2 id="supportModalTitle">Contact Merchant Support</h2>
            <p>Direct assistance with your Printify store sync, digest alerts, or account.</p>
            <div class="support-modal-badge">
              <span style="display:inline-block; width:6px; height:6px; background:#4f46e5; border-radius:50%;"></span>
              support.sellytics@gmail.com &bull; Replies within 24h
            </div>
          </div>
          <form id="supportModalForm">
            <div class="support-form-group">
              <label for="supportName">Your Name</label>
              <input type="text" id="supportName" placeholder="Alex Seller" required>
            </div>
            <div class="support-form-group">
              <label for="supportEmail">Your Email</label>
              <input type="email" id="supportEmail" placeholder="you@example.com" required>
            </div>
            <div class="support-form-group">
              <label for="supportSubject">Subject</label>
              <input type="text" id="supportSubject" placeholder="Help with my Printify store connection" required>
            </div>
            <div class="support-form-group">
              <label for="supportMessage">Message</label>
              <textarea id="supportMessage" placeholder="How can our support team assist you today?" required></textarea>
            </div>
            <button type="submit" id="supportSubmitBtn" class="support-submit-btn">Send Support Message</button>
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
      if (!backdrop) return;
      statusEl.textContent = '';
      statusEl.className = 'support-modal-status';
      
      // Auto pre-fill email if available in session
      const emailInput = document.getElementById('supportEmail');
      if (emailInput && !emailInput.value) {
        const sessionEmail = localStorage.getItem('sellytics_user_email') || '';
        if (sessionEmail) emailInput.value = sessionEmail;
      }

      backdrop.style.removeProperty('display');
      backdrop.classList.add('active');
    }

    function closeModal() {
      if (!backdrop) return;
      backdrop.classList.remove('active');
      backdrop.style.setProperty('display', 'none', 'important');
    }

    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) closeModal();
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && backdrop.classList.contains('active')) {
        closeModal();
      }
    });

    function bindTriggers() {
      // Connect openSupportModalBtn and any support links
      document.querySelectorAll('#openSupportModalBtn, a[href*="support.sellytics"], a[data-support-trigger="true"]').forEach((el) => {
        el.removeEventListener('click', triggerHandler);
        el.addEventListener('click', triggerHandler);
      });
    }

    function triggerHandler(e) {
      e.preventDefault();
      openModal();
    }

    bindTriggers();

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      submitBtn.disabled = true;
      submitBtn.textContent = 'Sending...';
      statusEl.textContent = 'Delivering your message to support...';
      statusEl.className = 'support-modal-status';
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
          statusEl.textContent = data.message || 'Message sent! We will reply via email shortly.';
          statusEl.className = 'support-modal-status success';
          form.reset();
          setTimeout(() => {
            closeModal();
          }, 2400);
        } else {
          statusEl.textContent = data.message || 'Failed to send message. Please email us directly.';
          statusEl.className = 'support-modal-status error';
        }
      } catch (err) {
        statusEl.textContent = 'Network error. Please try again or email support.sellytics@gmail.com.';
        statusEl.className = 'support-modal-status error';
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Send Support Message';
      }
    });

    // Make openModal available globally if needed
    window.openSellyticsSupport = openModal;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSupportModal);
  } else {
    initSupportModal();
  }
})();
