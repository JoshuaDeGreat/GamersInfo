const tabs = ['Overview', 'Credits', 'Blueprints', 'Relations', 'Licences', 'Changes Preview', 'Export'];

const state = {
  activeTab: 'Overview',
  sourcePath: '',
  model: null,
  patches: [],
  undo: [],
  redo: []
};

const tabNav = document.getElementById('tabs');
const main = document.getElementById('main');
const statusEl = document.getElementById('status');

function setStatus(text) {
  statusEl.textContent = text;
}

function pushPatch(patch) {
  state.undo.push(structuredClone(state.patches));
  state.redo = [];
  state.patches.push(patch);
  render();
}

function canEdit() {
  if (state.model) return true;
  setStatus('Import a save first.');
  return false;
}

function renderTabs() {
  tabNav.innerHTML = tabs.map((tab) => `<button class="tab-btn ${state.activeTab === tab ? 'active' : ''}" data-tab="${tab}">${tab}</button>`).join('');
  tabNav.querySelectorAll('[data-tab]').forEach((btn) => {
    btn.onclick = () => {
      state.activeTab = btn.dataset.tab;
      render();
    };
  });
}

function renderOverview() {
  if (!state.model) return `<div class="card">Import an XML/XML.GZ save to start indexing.</div>`;
  const m = state.model;
  return `
    <div class="card">
      <h3>Save Header</h3>
      <p><strong>Name:</strong> ${m.metadata.saveName || '(unknown)'}</p>
      <p><strong>Date:</strong> ${m.metadata.saveDate || '(unknown)'}</p>
      <p><strong>File:</strong> ${state.sourcePath}</p>
    </div>
    <div class="grid2">
      <div class="card"><h3>Blueprints owned</h3><div class="pill">${m.blueprints.owned.length}</div></div>
      <div class="card"><h3>Player relations</h3><div class="pill">${m.relations.player.length}</div></div>
      <div class="card"><h3>Player licences</h3><div class="pill">${m.licences.length}</div></div>
      <div class="card"><h3>Wallet account matches</h3><div class="pill">${m.credits.walletAccountOccurrences}</div></div>
    </div>
  `;
}

function renderCredits() {
  if (!state.model) return '<div class="card">Import a save to edit credits.</div>';
  const c = state.model.credits;
  return `
    <div class="card">
      <h3>Verified credits anchors</h3>
      <p>Player: <strong>${c.playerName || '(unknown)'}</strong> @ ${c.playerLocation || '(unknown)'}</p>
      <p>Anchor A - player money: <code>${c.playerMoney || '(missing)'}</code></p>
      <p>Anchor B - stat money_player: <code>${c.statMoneyPlayer || '(missing)'}</code></p>
      <p>Anchor C - wallet account id: <code>${c.playerWalletAccountId || '(missing)'}</code></p>
      <p>Anchor D - wallet occurrences: <code>${c.walletAccountOccurrences}</code></p>
      <label>New credits <input id="creditsValue" type="number" min="0" step="1" value="${c.playerMoney || 0}"/></label>
      <button id="queueCredits">Queue SetCredits</button>
    </div>
  `;
}

function renderBlueprints() {
  if (!state.model) return '<div class="card">Import a save to edit blueprints.</div>';
  return `
    <div class="card">
      <h3>Blueprint unlock (idempotent)</h3>
      <p>Owned wares: ${state.model.blueprints.owned.length}</p>
      <textarea id="blueprintWares" rows="4" style="width:100%" placeholder="ware ids, one per line"></textarea>
      <button id="queueBlueprints">Queue UnlockBlueprintWares</button>
    </div>
  `;
}

function renderRelations() {
  if (!state.model) return '<div class="card">Import a save to edit relations.</div>';
  const rows = state.model.relations.player.map((entry) => `
    <tr>
      <td>${entry.targetFactionId}</td>
      <td>${entry.value}</td>
      <td><input type="number" min="-30" max="30" data-rep="${entry.targetFactionId}" value="${Math.round(Number(entry.value) * 30)}"></td>
    </tr>
  `).join('');

  return `
    <div class="card">
      <h3>Set faction relation (player↔faction)</h3>
      <div>
        <input id="relationFaction" placeholder="faction id e.g. argon"/>
        <input id="relationRep" type="number" min="-30" max="30" value="30"/>
        <button id="queueRelation">Queue SetFactionRelation</button>
      </div>
      <table class="table"><thead><tr><th>Faction</th><th>File value [-1..1]</th><th>Queue repUI [-30..30]</th></tr></thead><tbody>${rows}</tbody></table>
    </div>
  `;
}

function renderLicences() {
  if (!state.model) return '<div class="card">Import a save to edit licences.</div>';
  const rows = state.model.licences.map((licence) => `<tr><td>${licence.type}</td><td>${licence.factions}</td></tr>`).join('');
  return `
    <div class="card">
      <h3>Player licences</h3>
      <table class="table"><thead><tr><th>Type</th><th>Factions</th></tr></thead><tbody>${rows}</tbody></table>
    </div>
    <div class="card">
      <h3>Licence operations</h3>
      <div><input id="licType" placeholder="licence type"/> <input id="licFaction" placeholder="faction id"/></div>
      <button id="addLicFaction">AddLicenceFaction</button>
      <button id="removeLicFaction">RemoveLicenceFaction</button>
      <hr/>
      <div><input id="newLicType" placeholder="new licence type"/> <input id="newLicFactions" placeholder="factions space-separated" style="min-width:260px"/></div>
      <button id="addLicType">AddLicenceType</button>
      <button id="removeLicType">RemoveLicenceType</button>
    </div>
  `;
}

function renderChanges() {
  return `<div class="card"><h3>Queued changes (${state.patches.length})</h3><pre>${JSON.stringify(state.patches, null, 2)}</pre><button id="clearPatches">Clear changes</button></div>`;
}

function renderExport() {
  const disabled = state.model ? '' : 'disabled';
  return `
    <div class="card">
      <h3>Export</h3>
      <label><input id="compressOut" type="checkbox" checked> GZip output</label><br/>
      <label><input id="backupOut" type="checkbox" checked> Create source backup (.backup)</label><br/>
      <button id="exportBtn" ${disabled}>Export patched save</button>
    </div>
  `;
}

function render() {
  renderTabs();
  const content = {
    Overview: renderOverview,
    Credits: renderCredits,
    Blueprints: renderBlueprints,
    Relations: renderRelations,
    Licences: renderLicences,
    'Changes Preview': renderChanges,
    Export: renderExport
  }[state.activeTab]();
  main.innerHTML = content;
  wireEvents();
}

function wireEvents() {
  document.getElementById('queueCredits')?.addEventListener('click', () => {
    if (!canEdit()) return;
    const value = Number(document.getElementById('creditsValue').value);
    if (!Number.isInteger(value) || value < 0) return setStatus('Credits must be integer >= 0');
    pushPatch({ type: 'SetCredits', value });
    setStatus('Queued SetCredits');
  });

  document.getElementById('queueBlueprints')?.addEventListener('click', () => {
    if (!canEdit()) return;
    const wares = document.getElementById('blueprintWares').value.split('\n').map((s) => s.trim()).filter(Boolean);
    if (!wares.length) return setStatus('Provide at least one ware id.');
    pushPatch({ type: 'UnlockBlueprintWares', wares });
    setStatus(`Queued ${wares.length} blueprint unlock(s)`);
  });

  document.getElementById('queueRelation')?.addEventListener('click', () => {
    if (!canEdit()) return;
    const factionId = document.getElementById('relationFaction').value.trim();
    const repUI = Number(document.getElementById('relationRep').value);
    if (!factionId) return setStatus('Faction id is required.');
    pushPatch({ type: 'SetFactionRelation', factionId, repUI });
    setStatus(`Queued relation patch for ${factionId}`);
  });

  document.querySelectorAll('input[data-rep]').forEach((input) => {
    input.addEventListener('change', () => {
      if (!canEdit()) return;
      pushPatch({ type: 'SetFactionRelation', factionId: input.dataset.rep, repUI: Number(input.value) });
      setStatus(`Queued relation patch for ${input.dataset.rep}`);
    });
  });

  document.getElementById('addLicFaction')?.addEventListener('click', () => {
    if (!canEdit()) return;
    pushPatch({ type: 'AddLicenceFaction', typeName: document.getElementById('licType').value.trim(), factionId: document.getElementById('licFaction').value.trim() });
  });
  document.getElementById('removeLicFaction')?.addEventListener('click', () => {
    if (!canEdit()) return;
    pushPatch({ type: 'RemoveLicenceFaction', typeName: document.getElementById('licType').value.trim(), factionId: document.getElementById('licFaction').value.trim() });
  });
  document.getElementById('addLicType')?.addEventListener('click', () => {
    if (!canEdit()) return;
    const factions = document.getElementById('newLicFactions').value.split(/\s+/).map((s) => s.trim()).filter(Boolean);
    pushPatch({ type: 'AddLicenceType', typeName: document.getElementById('newLicType').value.trim(), factions });
  });
  document.getElementById('removeLicType')?.addEventListener('click', () => {
    if (!canEdit()) return;
    pushPatch({ type: 'RemoveLicenceType', typeName: document.getElementById('newLicType').value.trim() });
  });

  document.getElementById('clearPatches')?.addEventListener('click', () => {
    state.patches = [];
    state.undo = [];
    state.redo = [];
    setStatus('Cleared queued changes.');
    render();
  });

  document.getElementById('exportBtn')?.addEventListener('click', async () => {
    if (!canEdit()) return;
    try {
      setStatus('Exporting...');
      const result = await window.x4api.exportSave({
        sourcePath: state.sourcePath,
        patches: state.patches,
        compress: document.getElementById('compressOut').checked,
        createBackup: document.getElementById('backupOut').checked
      });
      setStatus(result ? `Exported to ${result.outputPath}` : 'Export canceled');
    } catch (err) {
      setStatus(`Export failed: ${err.message}`);
    }
  });
}

document.getElementById('undoBtn').onclick = () => {
  if (!state.undo.length) return;
  state.redo.push(structuredClone(state.patches));
  state.patches = state.undo.pop();
  render();
};

document.getElementById('redoBtn').onclick = () => {
  if (!state.redo.length) return;
  state.undo.push(structuredClone(state.patches));
  state.patches = state.redo.pop();
  render();
};

document.getElementById('importBtn').onclick = async () => {
  setStatus('Importing...');
  try {
    const response = await window.x4api.importSave();
    if (!response) return setStatus('Import canceled');
    state.model = response.index;
    state.sourcePath = response.filePath;
    state.patches = [];
    state.undo = [];
    state.redo = [];
    document.getElementById('saveMeta').textContent = response.filePath;
    setStatus('Indexed save successfully.');
    render();
  } catch (err) {
    setStatus(`Import failed: ${err.message}`);
  }
};

render();
