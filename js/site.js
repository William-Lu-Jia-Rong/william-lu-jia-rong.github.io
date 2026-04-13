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

document.addEventListener('DOMContentLoaded', () => {
  updateScrollProgress();
  setupReveal();
  setupTilt();
  setupCursorGlow();
  setupNav();
});

window.addEventListener('scroll', updateScrollProgress, { passive: true });
window.addEventListener('resize', updateScrollProgress);
