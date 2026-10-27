// Support modal helper injected across site pages
(function() {
  function initSupportModal() {
    // Only inject once
    if (document.getElementById('supportModalBackdrop')) return;

    const modalHtml = `
      <div class="support-modal-backdrop" id="supportModalBackdrop" role="dialog" aria-modal="true" aria-labelledby="supportModalTitle">
        <div class="support-modal">
          <button type="button" class="support-modal-close" id="supportModalCloseBtn" aria-label="Close">&times;</button>
          <h2 id="supportModalTitle">Contact Support</h2>
          <p class="support-modal-info">Official address: <strong>support.sellytics@gmail.com</strong></p>
          <form id="supportModalForm">
            <label for="supportName">Your Name</label>
            <input type="text" id="supportName" placeholder="Alex Seller" required>

            <label for="supportEmail">Your Email</label>
            <input type="email" id="supportEmail" placeholder="you@example.com" required>

            <label for="supportSubject">Subject</label>
            <input type="text" id="supportSubject" placeholder="Help with my store digest" required>

            <label for="supportMessage">Message</label>
            <textarea id="supportMessage" placeholder="How can we help you today?" required></textarea>

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
