// Admin view: manage the built-in card catalog (the `cards` table) — create,
// edit, delete lore cards. Gated server-side by isAdmin; the nav button only
// shows for admins (toggled in auth.ts). Mirrors routes/admin.ts.

import { $, esc, toast, tradeBtn } from './dom.ts';
import { state } from './state.ts';
import { api, refreshCatalog } from './api.ts';
import { registerView } from './nav.ts';

// Populate the series/rarity selects from the catalog fetched on boot.
function fillSelects() {
  const series = $('#ac-series');
  if (!series.children.length) series.replaceChildren(...Object.entries(state.series).map(([id, s]: any) => {
    const o = document.createElement('option'); o.value = id; o.textContent = s.label; return o;
  }));
  const rarity = $('#ac-rarity');
  if (!rarity.children.length) rarity.replaceChildren(...Object.keys(state.rarities).map((id) => {
    const o = document.createElement('option'); o.value = id; o.textContent = id; return o;
  }));
}

function resetForm() {
  $('#admin-card-form').reset();
  $('#ac-edit-id').value = '';
  $('#admin-form-title').textContent = 'New card';
  $('#ac-save').textContent = 'Create card';
  $('#ac-cancel').classList.add('hidden');
  $('#ac-id').disabled = false;
}

function editCard(c) {
  fillSelects();
  $('#admin-form-title').textContent = `Edit · ${c.name}`;
  $('#ac-save').textContent = 'Save';
  $('#ac-cancel').classList.remove('hidden');
  $('#ac-edit-id').value = c.id;
  $('#ac-id').value = c.id; $('#ac-id').disabled = true; // id is immutable post-create
  $('#ac-name').value = c.name;
  $('#ac-series').value = c.series;
  $('#ac-rarity').value = c.rarity;
  $('#ac-emoji').value = c.emoji || '';
  $('#ac-flavor').value = c.flavor || '';
  $('#ac-image').value = c.image || '';
  $('#view-admin').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

$('#ac-cancel').addEventListener('click', resetForm);

$('#admin-card-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const editId = $('#ac-edit-id').value;
  const body = {
    id: $('#ac-id').value,
    name: $('#ac-name').value,
    series: $('#ac-series').value,
    rarity: $('#ac-rarity').value,
    emoji: $('#ac-emoji').value,
    flavor: $('#ac-flavor').value,
    image: $('#ac-image').value,
  };
  const btn = $('#ac-save'); btn.disabled = true;
  try {
    if (editId) await api(`/api/admin/cards/${encodeURIComponent(editId)}`, { method: 'POST', body });
    else await api('/api/admin/cards', { method: 'POST', body });
    toast(editId ? 'card updated' : 'card created');
    resetForm();
    await refreshCatalog();
    await renderAdmin();
  } catch (err) { toast(err.message, true); }
  btn.disabled = false;
});

async function renderAdmin() {
  if (!state.me?.isAdmin) return;
  fillSelects();
  resetForm();
  const { cards } = await api('/api/admin/cards');
  $('#ac-count').textContent = cards.length;
  $('#admin-cards').replaceChildren(...cards.map((c) => {
    const row = document.createElement('div');
    row.className = 'admin-card-row';
    row.innerHTML = `
      <div class="admin-emoji">${esc(c.emoji || '🃏')}</div>
      <div class="admin-card-info">
        <b>${esc(c.name)}</b> <code>${esc(c.id)}</code>
        <span><span class="r-${c.rarity}">${c.rarity}</span> · ${esc(state.series[c.series]?.label || c.series)}</span>
      </div>`;
    const actions = document.createElement('div');
    actions.className = 'trade-actions';
    actions.append(
      tradeBtn('Edit', 'btn-ghost', () => editCard(c)),
      tradeBtn('Delete', 'btn-ghost', async () => {
        if (!confirm(`Delete "${c.name}"? Any owned copies become a retired placeholder.`)) return;
        try {
          await api(`/api/admin/cards/${encodeURIComponent(c.id)}/delete`, { method: 'POST' });
          toast('card deleted');
          await refreshCatalog();
          await renderAdmin();
        } catch (err) { toast(err.message, true); }
      }),
    );
    row.append(actions);
    return row;
  }));
}

registerView('admin', renderAdmin);
