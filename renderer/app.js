const tabs = ['Overview', 'Credits', 'Blueprints', 'Inventory', 'Relations', 'Licences', 'Changes Preview', 'Export'];
const WARNING_COPY = 'Editing saves may mark them as modified and may affect online/venture features. Always keep backups.';

const state = {
  activeTab: 'Overview',
  sourcePath: '',
  model: null,
  patches: [],
  undo: [],
  redo: [],
  dicts: { blueprints: {}, items: {}, factions: [], presets: { modparts: { name: 'Common Mod Parts Pack', items: [] } }, helpText: '' },
  filters: { blueprintSearch: '', blueprintCategory: 'All', itemSearch: '', itemCategory: 'All', inventoryMode: 'set' },
  exportResult: null
};

const tabNav = document.getElementById('tabs');
const main = document.getElementById('main');

function setStatus(text) { document.getElementById('statusText').textContent = text; renderStatusBar(); }
function hasUnsaved() { return state.patches.length > 0; }

function renderStatusBar() {
  const m = state.model;
  document.getElementById('statusIndex').textContent = m ? 'Indexed' : 'Indexing: not started';
  document.getElementById('statusMeta').textContent = m ? `${m.metadata.saveName || '(unknown)'} · ${m.metadata.saveDate || ''}` : 'No save';
  document.getElementById('statusWarnings').textContent = `Warnings: ${m ? 1 : 0}`;
  document.getElementById('statusDirty').textContent = hasUnsaved() ? 'Unsaved changes' : 'No pending changes';
}

function pushPatch(patch) { state.undo.push(structuredClone(state.patches)); state.redo = []; state.patches.push(patch); render(); }
function resetChanges() { state.patches = []; state.undo = []; state.redo = []; render(); }
function canEdit() { if (state.model) return true; setStatus('Import a save first.'); return false; }

function renderTabs() {
  tabNav.innerHTML = tabs.map((tab) => `<button class="tab-btn ${state.activeTab === tab ? 'active' : ''}" data-tab="${tab}">${tab}</button>`).join('');
  tabNav.querySelectorAll('[data-tab]').forEach((btn) => { btn.onclick = () => { state.activeTab = btn.dataset.tab; render(); }; });
}

function warningPanel() {
  return `<div class="banner">⚠ ${WARNING_COPY}</div><details class="card"><summary>Learn more</summary><p>Saves are XML (often gzipped). This tool edits specific nodes and always exports a new file + optional backup.</p></details>`;
}

function renderOverview() {
  if (!state.model) return `<div class="card">Import an XML/XML.GZ save to start indexing.</div>`;
  const m = state.model;
  return `${warningPanel()}<div class="card"><h3>Save Header</h3><p><strong>Name:</strong> ${m.metadata.saveName || '(unknown)'}</p><p><strong>Date:</strong> ${m.metadata.saveDate || '(unknown)'}</p><p><strong>File:</strong> ${state.sourcePath}</p></div>`;
}

function filteredBlueprintRows() {
  const list = Object.entries(state.dicts.blueprints).map(([ware, info]) => ({ ware, ...info, owned: state.model ? state.model.blueprints.owned.includes(ware) : false }));
  return list.filter((row) => (state.filters.blueprintCategory === 'All' || row.category === state.filters.blueprintCategory) && (`${row.name} ${row.ware}`.toLowerCase().includes(state.filters.blueprintSearch.toLowerCase())));
}

function filteredItemRows() {
  const inv = state.model?.inventory?.player || {};
  const list = Object.entries(state.dicts.items).map(([ware, info]) => ({ ware, ...info, amount: inv[ware] || 0 }));
  return list.filter((row) => (state.filters.itemCategory === 'All' || row.category === state.filters.itemCategory) && (`${row.name} ${row.ware}`.toLowerCase().includes(state.filters.itemSearch.toLowerCase())));
}

function renderVirtualRows(containerId, rows, renderRow) {
  const viewport = document.getElementById(containerId);
  if (!viewport) return;
  const rowHeight = 40;
  const totalHeight = rows.length * rowHeight;
  const scrollTop = viewport.scrollTop;
  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - 5);
  const visible = Math.ceil(viewport.clientHeight / rowHeight) + 10;
  const end = Math.min(rows.length, start + visible);
  const html = [];
  for (let i = start; i < end; i += 1) html.push(`<div class="vrow" style="top:${i * rowHeight}px">${renderRow(rows[i])}</div>`);
  viewport.innerHTML = `<div class="vinner" style="height:${totalHeight}px">${html.join('')}</div>`;
}

function renderBlueprints() {
  if (!state.model) return '<div class="card">Import a save to edit blueprints.</div>';
  const categories = ['All', ...new Set(Object.values(state.dicts.blueprints).map((item) => item.category))];
  return `<div class="card"><h3>Blueprints</h3><div class="row"><input id="bpSearch" placeholder="Search name or ware id" value="${state.filters.blueprintSearch}"/><select id="bpCategory">${categories.map((c) => `<option ${c === state.filters.blueprintCategory ? 'selected' : ''}>${c}</option>`).join('')}</select><button id="unlockAll">Unlock All</button><button id="unlockCategory">Unlock All in Category</button></div><div class="thead"><span>Name</span><span>Ware ID</span><span>Category</span><span>Owned</span></div><div id="bpList" class="vlist"></div></div>`;
}

function renderInventory() {
  if (!state.model) return '<div class="card">Import a save to edit inventory.</div>';
  const categories = ['All', ...new Set(Object.values(state.dicts.items).map((item) => item.category))];
  return `<div class="card"><h3>Inventory</h3><div class="row"><input id="itemSearch" placeholder="Search name or ware id" value="${state.filters.itemSearch}"/><select id="itemCategory">${categories.map((c) => `<option ${c === state.filters.itemCategory ? 'selected' : ''}>${c}</option>`).join('')}</select><label><input type="radio" name="invMode" value="add" ${state.filters.inventoryMode === 'add' ? 'checked' : ''}/>Add</label><label><input type="radio" name="invMode" value="set" ${state.filters.inventoryMode === 'set' ? 'checked' : ''}/>Set</label><button id="modPack">Add common mod parts pack</button></div><div class="card help-card"><h4>Inventory mode help</h4><p><strong>Add</strong> increases the current amount by the value you enter. Example: if a ware is 2 and you queue 3 in Add mode, it becomes 5.</p><p><strong>Set</strong> overwrites the current amount to exactly the value you enter. Example: if a ware is 2 and you queue 3 in Set mode, it becomes 3.</p></div><div class="thead"><span>Name</span><span>Ware ID</span><span>Amount in save</span><span>Action</span></div><div id="itemList" class="vlist"></div></div>`;
}

function renderCredits() { if (!state.model) return '<div class="card">Import a save to edit credits.</div>'; const c = state.model.credits; return `<div class="card"><h3>Credits</h3><p>Player money: ${c.playerMoney}</p><input id="creditsValue" type="number" min="0" step="1" value="${c.playerMoney || 0}"/><button id="queueCredits">Queue SetCredits</button></div>`; }
function renderRelations() {
  if (!state.model) return '<div class="card">Import a save to edit relations.</div>';
  const rows = state.model.relations.player.map((entry) => `<tr><td>${entry.targetFactionId}</td><td>${entry.value}</td><td><input type="number" min="-30" max="30" data-rep="${entry.targetFactionId}" value="${Math.round(Number(entry.value) * 30)}"></td></tr>`).join('');
  return `<div class="card"><h3>Set faction relation</h3><input id="relationFaction" placeholder="faction id"/><input id="relationRep" type="number" min="-30" max="30" value="30"/><button id="queueRelation">Queue SetFactionRelation</button><table class="table"><thead><tr><th>Faction</th><th>File</th><th>Queue rep</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}
function renderLicences() {
  if (!state.model) return '<div class="card">Import a save to edit licences.</div>';
  const rows = state.model.licences.map((l) => `<tr><td>${l.type}</td><td>${l.factions}</td></tr>`).join('');
  return `<div class="card"><h3>Player licences</h3><table class="table"><thead><tr><th>Type</th><th>Factions</th></tr></thead><tbody>${rows}</tbody></table></div><div class="card"><input id="licType" placeholder="licence type"/> <input id="licFaction" placeholder="faction id"/><button id="addLicFaction">AddLicenceFaction</button><button id="removeLicFaction">RemoveLicenceFaction</button><br/><input id="newLicType" placeholder="new licence type"/> <input id="newLicFactions" placeholder="factions"/><button id="addLicType">AddLicenceType</button><button id="removeLicType">RemoveLicenceType</button></div>`;
}

function groupedPatches() {
  const groups = { Credits: [], Relations: [], Blueprints: [], Inventory: [], Licences: [] };
  for (const patch of state.patches) {
    if (patch.type.includes('Credit')) groups.Credits.push(patch);
    else if (patch.type.includes('Relation')) groups.Relations.push(patch);
    else if (patch.type.includes('Blueprint')) groups.Blueprints.push(patch);
    else if (patch.type.includes('Inventory')) groups.Inventory.push(patch);
    else groups.Licences.push(patch);
  }
  return groups;
}

function renderChanges() {
  const groups = groupedPatches();
  return `<div class="card"><h3>Queued changes (${state.patches.length})</h3>${Object.entries(groups).map(([k, v]) => `<h4>${k}</h4><ul>${v.map((p) => `<li>${p.type} · ${p.factionId || p.ware || p.typeName || 'global'} ${p.repUI !== undefined ? `(${p.repUI})` : ''} ${p.amount !== undefined ? `(${p.amount})` : ''}</li>`).join('') || '<li>None</li>'}</ul>`).join('')}<button id="clearPatches">Reset all changes</button></div>`;
}

function renderExport() {
  const disabled = state.model ? '' : 'disabled';
  const summary = state.exportResult?.summary;
  return `${warningPanel()}<div class="card"><h3>Export</h3><label><input id="compressOut" type="checkbox" checked> Output .xml.gz</label><br/><label><input id="backupOut" type="checkbox" checked> Create backup</label><br/><button id="exportBtn" ${disabled}>Export patched save</button>${state.exportResult ? `<p>Output: ${state.exportResult.outputPath}</p><p>Credits anchors updated: ${summary.creditsAnchorsUpdated}; Wallet accounts updated: ${summary.walletAccountsUpdated}; Blueprints inserted: ${summary.blueprintsInserted}; Relations inserted: ${summary.relationsInserted}</p>` : ''}</div>`;
}

function queueInventoryPatch(ware, amount) {
  const safeAmount = Number.isInteger(amount) && amount >= 0 ? amount : 1;
  pushPatch({ type: state.filters.inventoryMode === 'add' ? 'AddInventoryItem' : 'SetInventoryItem', ware, amount: safeAmount });
}

function renderInventoryList() {
  if (state.activeTab !== 'Inventory') return;
  const rows = filteredItemRows();
  renderVirtualRows('itemList', rows, (r) => `<span>${r.name}</span><span>${r.ware}</span><span>${r.amount}</span><span class="inv-action"><input type="number" data-qty="${r.ware}" value="${r.suggestedAmount || 1}" min="0"/><button data-add="${r.ware}">Queue</button><button class="add-one-btn" data-add-one="${r.ware}">+1</button></span>`);
}

function render() {
  renderTabs();
  main.innerHTML = ({ Overview: renderOverview, Credits: renderCredits, Blueprints: renderBlueprints, Inventory: renderInventory, Relations: renderRelations, Licences: renderLicences, 'Changes Preview': renderChanges, Export: renderExport })[state.activeTab]();
  wireEvents();
  renderStatusBar();

  if (state.activeTab === 'Blueprints') {
    const rows = filteredBlueprintRows();
    const list = document.getElementById('bpList');
    const draw = () => renderVirtualRows('bpList', rows, (r) => `<span>${r.name}</span><span>${r.ware}</span><span>${r.category}</span><span>${r.owned ? 'Yes' : 'No'}</span>`);
    list.addEventListener('scroll', draw);
    draw();
  }
  if (state.activeTab === 'Inventory') {
    const list = document.getElementById('itemList');
    if (list && !list.dataset.scrollBound) {
      list.addEventListener('scroll', renderInventoryList);
      list.dataset.scrollBound = '1';
    }
    renderInventoryList();
  }
}

function wireEvents() {
  document.getElementById('queueCredits')?.addEventListener('click', () => { const value = Number(document.getElementById('creditsValue').value); if (!Number.isInteger(value) || value < 0) return; pushPatch({ type: 'SetCredits', value }); });
  document.getElementById('bpSearch')?.addEventListener('input', (e) => { state.filters.blueprintSearch = e.target.value; render(); });
  document.getElementById('bpCategory')?.addEventListener('change', (e) => { state.filters.blueprintCategory = e.target.value; render(); });
  document.getElementById('unlockAll')?.addEventListener('click', () => pushPatch({ type: 'UnlockBlueprintWares', wares: Object.keys(state.dicts.blueprints) }));
  document.getElementById('unlockCategory')?.addEventListener('click', () => pushPatch({ type: 'UnlockBlueprintWares', wares: filteredBlueprintRows().map((r) => r.ware) }));

  document.getElementById('itemSearch')?.addEventListener('input', (e) => { state.filters.itemSearch = e.target.value; renderInventoryList(); });
  document.getElementById('itemCategory')?.addEventListener('change', (e) => { state.filters.itemCategory = e.target.value; renderInventoryList(); });
  document.querySelectorAll('input[name="invMode"]').forEach((el) => el.addEventListener('change', () => { state.filters.inventoryMode = el.value; }));
  document.getElementById('itemList')?.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-add], button[data-add-one]');
    if (!button) return;

    if (button.dataset.addOne) {
      queueInventoryPatch(button.dataset.addOne, 1);
      return;
    }

    const ware = button.dataset.add;
    const row = button.closest('.vrow');
    const amount = Number(row?.querySelector('input[data-qty]')?.value || 1);
    queueInventoryPatch(ware, amount);
  });
  document.getElementById('modPack')?.addEventListener('click', () => {
    for (const item of state.dicts.presets.modparts.items) {
      queueInventoryPatch(item.ware, item.amount);
    }
  });


  document.getElementById('queueRelation')?.addEventListener('click', () => {
    if (!canEdit()) return;
    const factionId = document.getElementById('relationFaction').value.trim();
    const repUI = Number(document.getElementById('relationRep').value);
    if (!factionId) return;
    pushPatch({ type: 'SetFactionRelation', factionId, repUI });
  });
  document.querySelectorAll('input[data-rep]').forEach((input) => input.addEventListener('change', () => pushPatch({ type: 'SetFactionRelation', factionId: input.dataset.rep, repUI: Number(input.value) })));

  document.getElementById('addLicFaction')?.addEventListener('click', () => pushPatch({ type: 'AddLicenceFaction', typeName: document.getElementById('licType').value.trim(), factionId: document.getElementById('licFaction').value.trim() }));
  document.getElementById('removeLicFaction')?.addEventListener('click', () => pushPatch({ type: 'RemoveLicenceFaction', typeName: document.getElementById('licType').value.trim(), factionId: document.getElementById('licFaction').value.trim() }));
  document.getElementById('addLicType')?.addEventListener('click', () => pushPatch({ type: 'AddLicenceType', typeName: document.getElementById('newLicType').value.trim(), factions: document.getElementById('newLicFactions').value.split(/\s+/).filter(Boolean) }));
  document.getElementById('removeLicType')?.addEventListener('click', () => pushPatch({ type: 'RemoveLicenceType', typeName: document.getElementById('newLicType').value.trim() }));

  document.getElementById('clearPatches')?.addEventListener('click', resetChanges);

  document.getElementById('exportBtn')?.addEventListener('click', async () => {
    if (!canEdit()) return;
    const result = await window.x4api.exportSave({ sourcePath: state.sourcePath, patches: state.patches, compress: document.getElementById('compressOut').checked, createBackup: document.getElementById('backupOut').checked });
    if (result) { state.exportResult = result; setStatus(`Exported to ${result.outputPath}`); render(); }
  });
}

document.getElementById('undoBtn').onclick = () => { if (!state.undo.length) return; state.redo.push(structuredClone(state.patches)); state.patches = state.undo.pop(); render(); };
document.getElementById('redoBtn').onclick = () => { if (!state.redo.length) return; state.undo.push(structuredClone(state.patches)); state.patches = state.redo.pop(); render(); };
document.getElementById('resetAllBtn').onclick = resetChanges;

document.getElementById('importBtn').onclick = async () => {
  setStatus('Importing...');
  const response = await window.x4api.importSave();
  if (!response) return setStatus('Import canceled');
  state.model = response.index; state.sourcePath = response.filePath; state.patches = []; state.undo = []; state.redo = []; state.exportResult = null;
  document.getElementById('saveMeta').textContent = response.filePath; setStatus('Indexed save successfully.'); render();
};

(async function init() {
  try { state.dicts = await window.x4api.loadDictionaries(); } catch (e) { setStatus(`Dictionary load failed: ${e.message}`); }
  render();
})();
