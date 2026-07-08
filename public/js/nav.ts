// View switching. Views register themselves here (registerView) so this
// module doesn't have to import every view — that's what keeps the module
// graph cycle-free: everything imports nav.ts, nav.ts imports almost nothing.

import { $, $$ } from './dom.ts';
import { state } from './state.ts';

// Views that get a #hash so they survive a reload
const HASH_VIEWS = ['binder', 'packs', 'swarm', 'arena', 'market', 'auction', 'ranks', 'trades', 'submit', 'modqueue', 'admin'];

type Renderer = () => void | Promise<void>;
const views: Record<string, Renderer> = {};
export function registerView(name: string, render: Renderer): void { views[name] = render; }

// Called with the target view on every navigation, before it renders — lets
// views stop their timers (battle poll, auction countdown) when left.
const navListeners: ((view: string) => void)[] = [];
export function onNav(fn: (view: string) => void): void { navListeners.push(fn); }

export function nav(view) {
  state.view = view;
  for (const fn of navListeners) fn(view);
  if (HASH_VIEWS.includes(view)) history.replaceState(null, '', '#' + view);
  $$('.view').forEach((v) => v.classList.add('hidden'));
  $(`#view-${view}`)?.classList.remove('hidden');
  $$('#main-nav button, #guest-nav button').forEach((b) => b.classList.toggle('active', b.dataset.nav === view));
  views[view]?.();
}

// Not logged in: send the visitor to the login CTA on the home view and pull
// focus to whichever method is actually configured (Discord button, or the
// dev-login field if Discord isn't set up) — otherwise clicking a nav item
// while already on home does nothing visible.
function goToLogin() {
  nav('home');
  const target = state.config.discord ? $('#hero-login') : state.config.devLogin ? $('#dev-name') : null;
  target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  target?.focus({ preventScroll: true });
}

document.addEventListener('click', (e) => {
  const t = (e.target as HTMLElement).closest<HTMLElement>('[data-nav]');
  if (!t) return;
  e.preventDefault();
  closeNavPanel();
  const target = t.dataset.nav;
  if (target === 'home') return nav('home'); // Home always goes home, logged in or not
  if (!state.me) return goToLogin(); // not logged in: send them to log in, not a no-op
  nav(target);
});

// ─── Responsive nav: collapse into a hamburger if the topbar can't fit it ───
// Rather than guessing a fixed breakpoint (item count varies with auth state
// and the admin-only Queue button), measure whether the topbar's content
// actually overflows and toggle the collapsed layout based on that.
function closeNavPanel() {
  const panel = $('#nav-panel');
  if (!panel.classList.contains('open')) return;
  panel.classList.remove('open');
  $('#nav-toggle').setAttribute('aria-expanded', 'false');
  $('#nav-toggle').textContent = '☰';
}
export function updateNavOverflow() {
  const topbar = $('#topbar');
  topbar.classList.remove('nav-collapsed');
  closeNavPanel();
  requestAnimationFrame(() => {
    if (topbar.scrollWidth > topbar.clientWidth + 1) topbar.classList.add('nav-collapsed');
  });
}
$('#nav-toggle').addEventListener('click', (e) => {
  e.stopPropagation();
  const panel = $('#nav-panel');
  const open = panel.classList.toggle('open');
  $('#nav-toggle').setAttribute('aria-expanded', String(open));
  $('#nav-toggle').textContent = open ? '✕' : '☰';
});
document.addEventListener('click', (e) => {
  const panel = $('#nav-panel');
  if (!panel.classList.contains('open')) return;
  if (panel.contains(e.target) || $('#nav-toggle').contains(e.target)) return;
  closeNavPanel();
});
let navResizeT;
window.addEventListener('resize', () => {
  clearTimeout(navResizeT);
  navResizeT = setTimeout(updateNavOverflow, 120);
});
