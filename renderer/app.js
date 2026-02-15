const tabs = ['Overview', 'Credits', 'Relations', 'Skills', 'Blueprints', 'Inventory', 'Objects', 'Changes', 'Export'];
const state = {
  activeTab: 'Overview',
  model: null,
  dictionaries: null,
  patches: [],
  undo: [],
  redo: []
};

const tabNav = document.getElementById('tabs');
const main = document.getElementById('main');
const statusEl = document.getElementById('status');

function setStatus(message) { statusEl.textContent = message; }

function hasModelLoaded() {
  return Boolean(state.model);
}

function requireModelLoaded(actionLabel) {
  if (hasModelLoaded()) return true;
  setStatus(`Import a save before using ${actionLabel}.`);
  return false;
}

function pushPatch(patch) {
  state.undo.push(structuredClone(state.patches));
  state.redo = [];
  state.patches.push(patch);
  setStatus(`Queued patch: ${patch.type}`);
  render();
}

function replacePatches(next) {
  state.undo.push(structuredClone(state.patches));
  state.patches = next;
  state.redo = [];
  render();
}

function renderTabs() {
  tabNav.innerHTML = tabs.map((t) => `<button class="tab-btn ${state.activeTab === t ? 'active' : ''}" data-tab="${t}">${t}</button>`).join('');
  tabNav.querySelectorAll('button').forEach((btn) => btn.onclick = () => { state.activeTab = btn.dataset.tab; render(); });
}

function rowTable(headers, rows) {
  return `<table class="table"><thead><tr>${headers.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table>`;
}

function renderOverview() {
  if (!state.model) return `<div class='card'>Import a save to begin.</div>`;
  const m = state.model;
  return `<div class='grid2'>${['accounts','relations','npcs','blueprints','inventory','objects'].map((k)=>`<div class='card'><h3>${k}</h3><div class='pill'>${m[k].length}</div></div>`).join('')}</div>`;
}

function renderCredits() {
  const accounts = state.model?.accounts || [];
  const playerAccounts = accounts.filter((a) => (a.owner || '').toLowerCase() === 'player');
  const playerCredits = playerAccounts.reduce((sum, account) => sum + Number(account.money || 0), 0);
  return `<div class='card'><h3>Credits / Accounts</h3>
    <p>Found ${accounts.length} accounts.</p>
    <p><strong>Player credits currently in save:</strong> ${playerCredits.toLocaleString()} (${playerAccounts.length} player account${playerAccounts.length === 1 ? '' : 's'})</p>
    <input id='playerCredits' type='number' min='0' placeholder='Player credits' value='${playerCredits}' />
    <button id='setPlayerCredits'>Set Player Credits</button>
    <button id='setAllAccounts'>Set All Owned Accounts</button>
  </div>` + rowTable(['ID','Owner','Money'], accounts.slice(0,300).map(a=>`<tr><td>${a.id}</td><td>${a.owner}</td><td>${a.money}</td></tr>`));
}

function renderRelations() {
  const rel = state.model?.relations || [];
  return `<div class='card'><h3>Faction Relations</h3>
  <button data-bulk='20'>Set all Friendly (+20)</button>
  <button data-bulk='0'>Set all Neutral (0)</button>
  </div>` + rowTable(['Faction','Current','New'], rel.map(r=>`<tr><td>${r.factionId}</td><td>${r.value}</td><td><input data-faction='${r.factionId}' type='number' min='-30' max='30' value='${r.value}' /></td></tr>`));
}

function renderSkills() {
  const npcs = state.model?.npcs || [];
  const disabled = npcs.length === 0 ? 'disabled' : '';
  return `<div class='card'><h3>Crew Skills</h3>
  <button id='pilots5' ${disabled}>Set all pilots to 5★ piloting</button>
  <button id='managers5' ${disabled}>Set all managers to 5★ management</button>
  <button id='morale5' ${disabled}>Set morale 5★ all</button>
  </div>` + rowTable(['Name','Role','Owner','Piloting','Management','Morale'], npcs.slice(0,1000).map(n=>`<tr><td>${n.name}</td><td>${n.role}</td><td>${n.owner}</td><td>${n.skills.piloting||0}</td><td>${n.skills.management||0}</td><td>${n.skills.morale||0}</td></tr>`));
}

function renderBlueprints() {
  const b = state.model?.blueprints || [];
  const disabled = b.length === 0 ? 'disabled' : '';
  return `<div class='card'><h3>Blueprints</h3>
  <button data-unlock='station' ${disabled}>Unlock station modules</button>
  <button data-unlock='ship' ${disabled}>Unlock ship blueprints</button>
  <button data-unlock='equipment' ${disabled}>Unlock equipment</button>
  <button data-unlock='all' ${disabled}>Unlock everything</button>
  </div>` + rowTable(['Blueprint','Category','Unlocked'], b.slice(0,1500).map(x=>`<tr><td>${x.id}</td><td>${x.category}</td><td>${x.unlocked}</td></tr>`));
}

function renderInventory() {
  const inv = state.model?.inventory || [];
  const dictionaryItems = state.dictionaries?.items || [];
  const knownItemIds = [...new Set([...dictionaryItems.map((item) => item.id), ...inv.map((item) => item.itemId)])].sort();
  const itemSuggestions = knownItemIds.slice(0, 500).map((id) => `<option value='${id}'></option>`).join('');

  return `<div class='card'><h3>Inventory</h3>
    <p>You can type an item ID manually, or pick from known IDs in the dropdown suggestions.</p>
    <input id='itemId' list='itemIds' placeholder='item id' />
    <datalist id='itemIds'>${itemSuggestions}</datalist>
    <input id='itemAmount' type='number' min='0' placeholder='amount' />
    <button id='setItem'>Set item amount</button>
  </div>` + rowTable(['Item','Amount'], inv.map(i=>`<tr><td>${i.itemId}</td><td>${i.amount}</td></tr>`));
}

function renderObjects() {
  const objects = state.model?.objects || [];
  return `<div class='card'><h3>Objects</h3><p>Danger zone actions require confirmation in UI event.</p></div>` + rowTable(['Object','Code','Class','Owner','Sector','Actions'], objects.slice(0,2000).map(o=>`<tr><td>${o.objectId}</td><td>${o.code}</td><td>${o.class}</td><td>${o.owner}</td><td>${o.sector}</td><td><button data-owner='${o.objectId}'>Change owner</button> <button class='danger' data-delete='${o.objectId}'>Delete</button></td></tr>`));
}

function renderChanges() {
  return `<div class='card'><h3>Diff Preview / Patches</h3><button id='resetChanges'>Reset all changes</button>
  ${rowTable(['Type','Patch'], state.patches.map((p)=>`<tr><td>${p.type}</td><td><code>${JSON.stringify(p)}</code></td></tr>`))}</div>`;
}

function renderExport() {
  return `<div class='card'><h3>Export</h3>
  <label><input type='checkbox' id='compressOut' checked /> Export as .xml.gz</label><br/>
  <label><input type='checkbox' id='backupOut' checked /> Create backup</label><br/>
  <button id='exportBtn'>Export modified save</button>
  <p>Warnings: this can mark saves as modified. Always keep backups.</p>
  </div>`;
}

function render() {
  renderTabs();
  const map = { Overview: renderOverview, Credits: renderCredits, Relations: renderRelations, Skills: renderSkills, Blueprints: renderBlueprints, Inventory: renderInventory, Objects: renderObjects, Changes: renderChanges, Export: renderExport };
  main.innerHTML = map[state.activeTab]();
  wireEvents();
}

function wireEvents() {
  document.querySelector('#setPlayerCredits')?.addEventListener('click', () => {
    const value = Number(document.querySelector('#playerCredits').value);
    pushPatch({ type: 'SetCredits', scope: 'player', value });
  });
  document.querySelector('#setAllAccounts')?.addEventListener('click', () => {
    const value = Number(document.querySelector('#playerCredits').value);
    pushPatch({ type: 'SetCredits', scope: 'allOwnedAccounts', value });
  });
  document.querySelectorAll('input[data-faction]').forEach((el)=>el.addEventListener('change', ()=>pushPatch({type:'SetFactionRep', factionId: el.dataset.faction, rep:Number(el.value)})));
  document.querySelectorAll('button[data-bulk]').forEach((btn)=>btn.addEventListener('click', ()=>{
    if (!requireModelLoaded('bulk relation actions')) return;
    replacePatches([...state.patches, ...state.model.relations.map(r=>({type:'SetFactionRep', factionId:r.factionId, rep:Number(btn.dataset.bulk)}))]);
    setStatus('Queued bulk relation patches');
  }));
  document.querySelector('#pilots5')?.addEventListener('click', ()=>{
    if (!requireModelLoaded('crew skill actions')) return;
    pushPatch({type:'SetSkills', filter:{role:'pilot'}, changes:{piloting:5}});
  });
  document.querySelector('#managers5')?.addEventListener('click', ()=>{
    if (!requireModelLoaded('crew skill actions')) return;
    pushPatch({type:'SetSkills', filter:{role:'manager'}, changes:{management:5}});
  });
  document.querySelector('#morale5')?.addEventListener('click', ()=>{
    if (!requireModelLoaded('crew skill actions')) return;
    pushPatch({type:'SetSkills', filter:{role:'all'}, changes:{morale:5}});
  });
  document.querySelectorAll('button[data-unlock]').forEach((btn)=>btn.addEventListener('click', ()=>{
    if (!requireModelLoaded('blueprint actions')) return;
    const kind = btn.dataset.unlock;
    const ids = state.model.blueprints.filter((b)=>kind==='all'||b.category===kind).map((b)=>b.id);
    if (ids.length === 0) {
      setStatus(`No blueprints found for category: ${kind}`);
      return;
    }
    pushPatch({type:'UnlockBlueprints', blueprintIds:ids});
    setStatus(`Queued unlock for ${ids.length} blueprint(s)`);
  }));
  document.querySelector('#setItem')?.addEventListener('click', ()=>pushPatch({type:'SetInventoryItem', itemId:document.querySelector('#itemId').value, amount:Number(document.querySelector('#itemAmount').value)}));
  document.querySelectorAll('button[data-owner]').forEach((btn)=>btn.addEventListener('click', ()=>{
    const nextOwner = prompt('Enter new owner faction ID');
    if (nextOwner) pushPatch({type:'ChangeOwner', objectId:btn.dataset.owner, newOwnerFactionId:nextOwner});
  }));
  document.querySelectorAll('button[data-delete]').forEach((btn)=>btn.addEventListener('click', ()=>{
    const confirmText = prompt('Type DELETE to confirm object deletion');
    if (confirmText === 'DELETE') pushPatch({type:'DeleteObject', objectId:btn.dataset.delete});
  }));
  document.querySelector('#resetChanges')?.addEventListener('click', ()=>{ state.patches=[]; state.undo=[]; state.redo=[]; render(); });
  document.querySelector('#exportBtn')?.addEventListener('click', async ()=>{
    if (!state.model) return;
    const compress = document.querySelector('#compressOut').checked;
    const createBackup = document.querySelector('#backupOut').checked;
    setStatus('Exporting...');
    const result = await window.x4api.exportSave({ sourcePath: state.sourcePath, patches: state.patches, compress, createBackup });
    setStatus(result ? `Exported to ${result.outputPath}` : 'Export canceled');
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
  setStatus('Importing and indexing...');
  const response = await window.x4api.importSave();
  if (!response) return setStatus('Import canceled');
  state.model = response.index;
  state.sourcePath = response.filePath;
  document.getElementById('saveMeta').textContent = response.filePath;
  setStatus('Index built successfully');
  render();
};

window.x4api.loadDictionaries().then((dict) => { state.dictionaries = dict; setStatus('Dictionaries loaded'); render(); });
render();
