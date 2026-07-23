// ── CONFIG ────────────────────────────────────────────
const API_URL = 'http://localhost:5000/api';

// ── MODAL HELPERS ─────────────────────────────────────
function openModal(id) {
  const el = document.getElementById('modal-' + id);
  if (el) el.classList.add('open');
}
function closeModal(id) {
  const el = document.getElementById('modal-' + id);
  if (el) el.classList.remove('open');
}
function closeIfOverlay(e, id) {
  if (e.target === document.getElementById(id))
    closeModal(id.replace('modal-', ''));
}

// ── TOAST ─────────────────────────────────────────────
function showToast(message, type = 'info') {
  let wrap = document.getElementById('toast-wrap');
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.id = 'toast-wrap';
    wrap.className = 'toast-wrap';
    document.body.appendChild(wrap);
  }
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = message;
  wrap.appendChild(t);
  setTimeout(() => {
    t.classList.add('fade-out');
    setTimeout(() => t.remove(), 300);
  }, 3200);
}

// ── AUTH HELPERS ──────────────────────────────────────
function getToken() { return localStorage.getItem('dt_token'); }
function getUser()  {
  try { return JSON.parse(localStorage.getItem('dt_user')); } catch { return null; }
}
function authHeader() {
  return { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getToken()}` };
}
function logout() {
  localStorage.removeItem('dt_token');
  localStorage.removeItem('dt_user');
  showToast('Signed out successfully', 'success');
  setTimeout(() => window.location.href = 'index.html', 600);
}

// ── TIME FORMATTER ────────────────────────────────────
function formatTime(t) {
  if (!t) return '';
  const [h, m] = t.split(':');
  const hr = parseInt(h);
  return `${hr % 12 || 12}:${m} ${hr >= 12 ? 'PM' : 'AM'}`;
}
function formatDate(d) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ── AVATAR COLOR HELPER ───────────────────────────────
const AV_CLASSES = ['av-teal','av-gold','av-blue','av-coral','av-purple','av-green'];
function avClass(i) { return AV_CLASSES[i % AV_CLASSES.length]; }
function initials(name) {
  return (name || '').split(' ').map(n => n[0]).join('').toUpperCase().slice(0,2);
}

// ── VIDEO CALL ────────────────────────────────────────
function joinVideoCall(meetingId) {
  const u = getUser();
  if (!u || !meetingId) return;
  window.open(
    `video-call.html?meetingId=${meetingId}&userId=${u.id}&userName=${encodeURIComponent(u.name)}&role=${u.role}`,
    '_blank'
  );
}

// Export for inline scripts
window.openModal = openModal;
window.closeModal = closeModal;
window.closeIfOverlay = closeIfOverlay;
window.showToast = showToast;
window.logout = logout;
window.joinVideoCall = joinVideoCall;
window.formatTime = formatTime;
window.formatDate = formatDate;
window.avClass = avClass;
window.initials = initials;
window.getToken = getToken;
window.getUser = getUser;
window.authHeader = authHeader;
window.API_URL = API_URL;