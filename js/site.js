const root = document.documentElement;

function updateScrollProgress() {
  const total = document.documentElement.scrollHeight - window.innerHeight;
  const progress = total > 0 ? `${(window.scrollY / total) * 100}%` : '0%';
  root.style.setProperty('--scroll-progress', progress);
}

function setupReveal() {
  const revealItems = document.querySelectorAll('[data-reveal]');
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('revealed');
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.16 }
  );

  revealItems.forEach((item) => observer.observe(item));
}

function setupTilt() {
  const cards = document.querySelectorAll('[data-tilt]');
  cards.forEach((card) => {
    card.addEventListener('mousemove', (event) => {
      if (window.innerWidth < 900) return;
      const rect = card.getBoundingClientRect();
      const px = (event.clientX - rect.left) / rect.width;
      const py = (event.clientY - rect.top) / rect.height;
      const rotateY = (px - 0.5) * 10;
      const rotateX = (0.5 - py) * 10;
      card.style.transform = `perspective(1200px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateY(-4px)`;
    });

    card.addEventListener('mouseleave', () => {
      card.style.transform = '';
    });
  });
}

function setupCursorGlow() {
  if (window.matchMedia('(pointer: coarse)').matches) return;
  window.addEventListener('mousemove', (event) => {
    root.style.setProperty('--cursor-x', `${event.clientX}px`);
    root.style.setProperty('--cursor-y', `${event.clientY}px`);
  });
}

function setupNav() {
  const toggle = document.querySelector('.nav-toggle');
  if (!toggle) return;

  toggle.addEventListener('click', () => {
    document.body.classList.toggle('nav-open');
  });

  document.querySelectorAll('.nav-links a').forEach((link) => {
    link.addEventListener('click', () => document.body.classList.remove('nav-open'));
  });
}

function setupContactForms() {
  const forms = document.querySelectorAll('[data-formspree-form]');

  forms.forEach((form) => {
    const submitButton = form.querySelector('button[type="submit"]');
    const status = form.querySelector('[data-form-status]');
    if (!submitButton || !status) return;

    form.addEventListener('submit', async (event) => {
      event.preventDefault();

      submitButton.disabled = true;
      submitButton.textContent = 'Sending...';
      status.hidden = false;
      status.className = 'form-status';
      status.textContent = 'Sending your message...';

      try {
        const response = await fetch(form.action, {
          method: form.method || 'POST',
          body: new FormData(form),
          headers: {
            Accept: 'application/json'
          }
        });

        if (!response.ok) {
          let errorMessage = 'Something went wrong. Please try again in a moment.';

          try {
            const data = await response.json();
            if (Array.isArray(data?.errors) && data.errors.length > 0) {
              errorMessage = data.errors.map((item) => item.message).join(' ');
            }
          } catch (parseError) {
            // Keep the fallback message when the API does not return JSON.
          }

          throw new Error(errorMessage);
        }

        form.reset();
        status.className = 'form-status is-success';
        status.textContent = 'Message sent successfully. I will get back to you soon.';
      } catch (error) {
        status.className = 'form-status is-error';
        status.textContent = error.message || 'Unable to send the message right now. Please email me directly instead.';
      } finally {
        submitButton.disabled = false;
        submitButton.textContent = 'Send message';
      }
    });
  });
}

document.addEventListener('DOMContentLoaded', () => {
  updateScrollProgress();
  setupReveal();
  setupTilt();
  setupCursorGlow();
  setupNav();
  setupContactForms();
});

window.addEventListener('scroll', updateScrollProgress, { passive: true });
window.addEventListener('resize', updateScrollProgress);
