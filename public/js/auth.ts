// Auth & header: session refresh, login/logout buttons, the daily claim.

import { $, toast } from './dom.ts';
import { state } from './state.ts';
import { api, handleUnlocks } from './api.ts';
import { updateNavOverflow } from './nav.ts';

export async function refreshMe() {
  const { user } = await api('/api/me');
  state.me = user;
  const authed = Boolean(user);
  $('#wallet').classList.toggle('hidden', !authed);
  $('#user-chip').classList.toggle('hidden', !authed);
  $('#guest-nav').classList.toggle('hidden', authed);
  $('#main-nav').classList.toggle('hidden', !authed);
  const admin = Boolean(authed && user && user.isAdmin);
  $('#nav-admin').classList.toggle('hidden', !admin);
  $('#nav-mod').classList.toggle('hidden', !admin);
  $('#login-btn').classList.toggle('hidden', authed || !state.config.discord);
  $('#hero-login').classList.toggle('hidden', authed || !state.config.discord);
  $('#dev-login').classList.toggle('hidden', authed || !state.config.devLogin);
  if (authed) {
    $('#neuro-count').textContent = user.neuros;
    $('#user-name').textContent = user.name;
    $('#user-avatar').src = user.avatar;
    $('#daily-btn').classList.toggle('hidden', !user.dailyReady);
    const pending = user.modPending || 0;     // pending meme count, admins only
    $('#mod-badge').textContent = pending ? String(pending) : '';
    $('#mod-badge').classList.toggle('hidden', !pending);
  }
  updateNavOverflow(); // nav content just changed (guest vs full nav) — re-measure
  return authed;
}

const discordLogin = () => { location.href = '/auth/discord'; };
$('#login-btn').addEventListener('click', discordLogin);
$('#hero-login').addEventListener('click', discordLogin);
$('#logout-btn').addEventListener('click', async () => { await api('/auth/logout', { method: 'POST' }); location.reload(); });

$('#dev-login').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('/auth/dev', { method: 'POST', body: { name: $('#dev-name').value } });
    location.reload();
  } catch (err) { toast(err.message, true); }
});

$('#daily-btn').addEventListener('click', async () => {
  try {
    const r = await api('/api/daily', { method: 'POST' });
    $('#daily-btn').classList.add('hidden');
    toast(`⚡ +${r.gained} daily neuros claimed!`);
    handleUnlocks(r);
  } catch (err) { toast(err.message, true); }
});
