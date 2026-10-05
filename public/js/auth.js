// Session-based auth against the FastAPI backend, plus the sign-in / register modal.

const listeners = new Set();

async function api(path, options = {}) {
  const res = await fetch(path, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  let body = null;
  try { body = await res.json(); } catch { /* empty body */ }
  if (!res.ok) {
    const detail = body && body.detail;
    let message = 'Something went wrong. Please try again.';
    if (typeof detail === 'string') message = detail;
    else if (Array.isArray(detail)) message = describeValidation(detail);
    const err = new Error(message);
    err.status = res.status;
    throw err;
  }
  return body;
}

function describeValidation(errors) {
  const field = errors[0]?.loc?.at(-1);
  if (field === 'username') return 'Usernames are 3–20 letters, numbers or underscores.';
  if (field === 'password') return 'Passwords need at least 6 characters.';
  return errors[0]?.msg || 'Invalid input.';
}

export const auth = {
  user: null,

  onChange(cb) {
    listeners.add(cb);
    return () => listeners.delete(cb);
  },

  set(user) {
    this.user = user;
    listeners.forEach((cb) => cb(user));
  },

  async refresh() {
    try {
      const me = await api('/api/auth/me');
      this.set(me.authenticated ? { id: me.id, username: me.username } : null);
    } catch {
      this.set(null);
    }
    return this.user;
  },

  async login(username, password) {
    const res = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) });
    this.set(res.user);
    return res.user;
  },

  async register(username, password) {
    const res = await api('/api/auth/register', { method: 'POST', body: JSON.stringify({ username, password }) });
    this.set(res.user);
    return res.user;
  },

  async logout() {
    await api('/api/auth/logout', { method: 'POST' });
    this.set(null);
  },

  async submitScore(score) {
    return api('/api/scores', { method: 'POST', body: JSON.stringify({ score }) });
  },
};

// ---------------------------------------------------------------- modal UI

const $ = (sel) => document.querySelector(sel);
let mode = 'login';
let onCloseCb = null;

function setMode(next) {
  mode = next;
  const modal = $('#auth-modal');
  modal.querySelectorAll('[data-auth-tab]').forEach((tab) => {
    const active = tab.dataset.authTab === mode;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', String(active));
  });
  $('#auth-title').textContent = mode === 'login' ? 'Welcome back!' : 'Join the sleigh team';
  $('#auth-submit').textContent = mode === 'login' ? 'Sign in' : 'Create account';
  $('#auth-password').autocomplete = mode === 'login' ? 'current-password' : 'new-password';
  $('#auth-error').textContent = '';
}

export function openAuthModal(initialMode = 'login', onClose = null) {
  onCloseCb = onClose;
  setMode(initialMode);
  document.body.classList.add('modal-open');
  $('#auth-modal').hidden = false;
  $('#auth-username').focus();
}

export function closeAuthModal() {
  $('#auth-modal').hidden = true;
  document.body.classList.remove('modal-open');
  $('#auth-form').reset();
  const cb = onCloseCb;
  onCloseCb = null;
  if (cb) cb(auth.user);
}

export function initAuthUI() {
  const modal = $('#auth-modal');
  modal.querySelectorAll('[data-auth-tab]').forEach((tab) =>
    tab.addEventListener('click', () => setMode(tab.dataset.authTab)));
  modal.querySelector('[data-close]').addEventListener('click', closeAuthModal);
  modal.addEventListener('click', (e) => { if (e.target === modal) closeAuthModal(); });
  modal.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAuthModal(); });

  $('#auth-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = $('#auth-username').value.trim();
    const password = $('#auth-password').value;
    const submit = $('#auth-submit');
    submit.disabled = true;
    $('#auth-error').textContent = '';
    try {
      if (mode === 'login') await auth.login(username, password);
      else await auth.register(username, password);
      closeAuthModal();
    } catch (err) {
      $('#auth-error').textContent = err.message;
    } finally {
      submit.disabled = false;
    }
  });

  // HUD user chip.
  const chip = $('#user-chip');
  const render = (user) => {
    chip.querySelector('.user-name').textContent = user ? user.username : 'Guest';
    $('#login-btn').hidden = !!user;
    $('#logout-btn').hidden = !user;
  };
  auth.onChange(render);
  render(auth.user);
  $('#login-btn').addEventListener('click', () => openAuthModal('login'));
  $('#logout-btn').addEventListener('click', () => auth.logout());
}
