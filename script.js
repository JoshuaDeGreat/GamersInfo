// Header hide/reveal on scroll
(function () {
  const header = document.getElementById('site-header');
  if (!header) return;
  let prev = window.pageYOffset || document.documentElement.scrollTop;
  window.addEventListener('scroll', () => {
    const curr = window.pageYOffset || document.documentElement.scrollTop;
    if (curr > prev && curr > 80) header.classList.add('header-hidden');
    else header.classList.remove('header-hidden');
    prev = curr;
  }, { passive: true });
})();

// Mobile nav hamburger
(function () {
  const toggle = document.getElementById('nav-toggle');
  const nav = document.getElementById('primary-nav');
  if (!toggle || !nav) return;
  toggle.addEventListener('click', () => {
    const open = nav.classList.toggle('open');
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
  nav.addEventListener('click', (e) => {
    if (e.target.closest('a')) {
      nav.classList.remove('open');
      toggle.setAttribute('aria-expanded','false');
    }
  });
})();

// Smooth-scroll for in-page anchors (offset for fixed header)
(function () {
  const links = document.querySelectorAll('a[href^="#"]');
  links.forEach(link => {
    link.addEventListener('click', (e) => {
      const href = link.getAttribute('href');
      if (!href || href === '#' || !href.startsWith('#')) return;
      const id = href.slice(1);
      const target = document.getElementById(id);
      if (target) {
        e.preventDefault();
        const y = target.getBoundingClientRect().top + window.scrollY - 80;
        window.scrollTo({ top: y, behavior: 'smooth' });
        history.pushState(null, '', '#' + id);
      }
    });
  });
})();

// Signup form: static-only (localStorage). Set BACKEND_URL to use a remote API later.
const BACKEND_URL = ""; // e.g., 'https://your-api.example.com'
(function () {
  const form = document.getElementById('signup-form');
  if (!form) return;
  const successEl = document.getElementById('signup-success');

  async function saveRemote(email){
    if (!BACKEND_URL) throw new Error('No backend configured');
    const res = await fetch(BACKEND_URL + '/api/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    if (!res.ok) throw new Error('Network not ok');
    return res.json().catch(()=>({}));
  }
  function saveLocal(email){
    const list = JSON.parse(localStorage.getItem('gi_signups') || '[]');
    if (!list.includes(email)) list.push(email);
    localStorage.setItem('gi_signups', JSON.stringify(list));
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = new FormData(form);
    const email = (data.get('email') || '').toString().trim();
    if (!email) return;

    try {
      let msg = 'Thanks! Check your inbox to confirm.';
      if (BACKEND_URL) {
        const json = await saveRemote(email);
        if (json && json.message) msg = json.message;
      } else {
        saveLocal(email);
        msg = 'Thanks! (Saved locally for demo)';
      }
      if (successEl) { successEl.hidden = false; successEl.textContent = msg; }
      form.reset();
    } catch (err) {
      // fallback
      saveLocal(email);
      if (successEl) { successEl.hidden = false; successEl.textContent = 'Thanks! (Saved locally for demo)'; }
      console.error(err);
    }
  });
})();
