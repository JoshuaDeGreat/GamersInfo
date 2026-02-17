const tabs = ['Overview', 'Credits', 'Blueprints', 'Inventory', 'Relations', 'Licences', 'Skills', 'Ships/Stations', 'Changes Preview', 'Export'];
const WARNING_COPY = 'Editing saves may mark them as modified and may affect online/venture features. Always keep backups.';

const state = {
  activeTab: 'Overview',
  sourcePath: '',
  model: null,
  patches: [],
  undo: [],
  redo: [],
  dicts: { blueprints: {}, items: {}, factionsById: {}, licenceTypes: [], presets: { modparts: { name: 'Common Mod Parts Pack', items: [] } }, helpText: '' },
  filters: { blueprintSearch: '', blueprintCategory: 'All', itemSearch: '', itemCategory: 'All', inventoryMode: 'set', relationMode: 'hard', skillsSearch: '' },
  ui: { selectedLicenceFactionId: '', licenceCatalogSearch: '', selectedNpcId: '', selectedShipId: '' },
  exportResult: null
};

const tabNav = document.getElementById('tabs');
const main = document.getElementById('main');

function setStatus(text) { document.getElementById('statusText').textContent = text; renderStatusBar(); }
function hasUnsaved() { return state.patches.length > 0; }
function hasPlayerFaction() { return Boolean(state.model?.licencesModel?.playerFactionFound); }

function xmlEscape(v) { return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
function currentMetadataPatches() {
  const playerName = [...state.patches].reverse().find((p) => p.type === 'SetPlayerName');
  const modified = [...state.patches].reverse().find((p) => p.type === 'SetModifiedFlag');
  return { playerName: playerName?.name ?? null, modified: modified?.value ?? null };
}

function renderStatusBar() {
  const m = state.model;
  const patchMeta = currentMetadataPatches();
  const modified = patchMeta.modified ?? m?.metadata?.modified;
  const activeExtensions = m?.metadata?.extensions?.active || [];

  document.getElementById('statusIndex').textContent = m ? 'Indexed: ✅' : 'Indexing: not started';
  document.getElementById('statusMeta').textContent = m ? `${m.metadata.saveName || '(unknown)'} · ${m.metadata.saveDate || ''}` : 'No save';
  document.getElementById('statusWarnings').textContent = `Warnings: ${m ? 1 : 0}`;
  document.getElementById('statusExtensions').textContent = m ? `Extensions detected: ${activeExtensions.length}` : '';
  document.getElementById('statusDirty').textContent = hasUnsaved() ? 'Unsaved changes' : 'No pending changes';

  document.getElementById('topSaveName').textContent = m ? `Save: ${m.metadata.saveName || '(unknown)'}` : '';
  document.getElementById('topPlayerName').textContent = m ? `Player: ${patchMeta.playerName ?? m.metadata.playerName ?? '(unknown)'}` : '';
  document.getElementById('topVersion').textContent = m ? `Version/Build: ${m.metadata.gameVersion || '?'} / ${m.metadata.gameBuild || '?'}` : '';
  document.getElementById('topModified').textContent = m ? `Modified: ${modified === true || modified === 1 ? 'Yes' : modified === false || modified === 0 ? 'No' : '?'}` : '';
}

function pushPatch(patch) { state.undo.push(structuredClone(state.patches)); state.redo = []; state.patches.push(patch); render(); }
function resetChanges() { state.patches = []; state.undo = []; state.redo = []; render(); }
function resetLicencePanel() {
  if (state.model?.licencesModel?.allFactionsInLicences?.length) {
    state.ui.selectedLicenceFactionId = state.model.licencesModel.allFactionsInLicences[0];
  } else {
    state.ui.selectedLicenceFactionId = '';
  }
  render();
}
function canEdit() { if (state.model) return true; setStatus('Import a save first.'); return false; }

function factionLabel(factionId) {
  return state.dicts.factionsById[factionId] || factionId;
}

function renderTabs() {
  tabNav.innerHTML = tabs.map((tab) => `<button class="tab-btn ${state.activeTab === tab ? 'active' : ''}" data-tab="${tab}">${tab}</button>`).join('');
  tabNav.querySelectorAll('[data-tab]').forEach((btn) => { btn.onclick = () => { state.activeTab = btn.dataset.tab; render(); }; });
}

function warningPanel() {
  return `<div class="banner">⚠ ${WARNING_COPY}</div><details class="card"><summary>Learn more</summary><p>Saves are XML (often gzipped). This tool edits specific nodes and always exports a new file + optional backup.</p></details>`;
}

function renderOverview() {
  if (!state.model) return '<div class="card">Import an XML/XML.GZ save to start indexing.</div>';
  const m = state.model;
  const patchMeta = currentMetadataPatches();
  const playerName = patchMeta.playerName ?? m.metadata.playerName ?? '';
  const modifiedValue = patchMeta.modified ?? m.metadata.modified;
  const modifiedBadge = modifiedValue === true || modifiedValue === 1 ? 'Yes' : modifiedValue === false || modifiedValue === 0 ? 'No' : 'Unknown';
  const extActive = m.metadata.extensions?.active || [];
  const extHistory = m.metadata.extensions?.history || [];
  const extDisplay = extActive.length ? extActive.map((ext) => `${xmlEscape(ext.name || ext.id)} (${xmlEscape(ext.id)})`).join(', ') : 'None detected';

  return `${warningPanel()}<div class="card"><h3>Save Metadata</h3>
    <p><strong>Save Name:</strong> ${xmlEscape(m.metadata.saveName || '(unknown)')}</p>
    <p><strong>Save Date:</strong> ${xmlEscape(m.metadata.saveDate || '(unknown)')}</p>
    <p><strong>File:</strong> ${xmlEscape(state.sourcePath)}</p>
    <p><strong>Game:</strong> ${xmlEscape(m.metadata.gameId || 'X4')} · <strong>Version/Build:</strong> ${xmlEscape(m.metadata.gameVersion || '?')} / ${xmlEscape(m.metadata.gameBuild || '?')}</p>
    <p><strong>GUID:</strong> ${xmlEscape(m.metadata.guid || '(unknown)')}</p>
    <p><strong>Game Time:</strong> ${xmlEscape(m.metadata.time || '(unknown)')}</p>
    <p><strong>Modified:</strong> <span class="badge">${modifiedBadge}</span></p>
    <p><strong>DLC detected (active):</strong> ${extDisplay}</p>
    ${extHistory.length ? `<p class="muted"><strong>DLC history:</strong> ${extHistory.map((ext) => `${xmlEscape(ext.name || ext.id)} (${xmlEscape(ext.id)})`).join(', ')}</p>` : ''}
    <div class="row"><label>Player Name <input id="playerNameInput" type="text" maxlength="64" value="${xmlEscape(playerName)}" placeholder="Player Name"/></label><button id="queuePlayerName">Queue SetPlayerName</button></div>
    <details class="card"><summary>Advanced: Modified Flag</summary>
      <p class="muted">Changing modified flag may not restore online/venture eligibility. Only change if you know what you’re doing.</p>
      <div class="row"><label class="switch-row">Modified override <input id="modifiedSlider" type="checkbox" ${(patchMeta.modified ?? (m.metadata.modified ? 1 : 0)) === 1 ? 'checked' : ''}/></label></div>
    </details>
  </div>`;
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
  return `<div class="card"><h3>Blueprints</h3><div class="row"><input id="bpSearch" placeholder="Search name or ware id" value="${state.filters.blueprintSearch}"/><select id="bpCategory">${categories.map((c) => `<option ${c === state.filters.blueprintCategory ? 'selected' : ''}>${c}</option>`).join('')}</select><button id="unlockAll">Unlock All</button><button id="unlockCategory">Unlock All in Category</button><button id="addBlueprintSingle">Add selected blueprint…</button></div><div class="thead"><span>Name</span><span>Ware ID</span><span>Category</span><span>Owned</span></div><div id="bpList" class="vlist"></div></div>`;
}

function renderInventory() {
  if (!state.model) return '<div class="card">Import a save to edit inventory.</div>';
  const categories = ['All', ...new Set(Object.values(state.dicts.items).map((item) => item.category))];
  return `<div class="card"><h3>Inventory</h3><div class="row"><input id="itemSearch" placeholder="Search name or ware id" value="${state.filters.itemSearch}"/><select id="itemCategory">${categories.map((c) => `<option ${c === state.filters.itemCategory ? 'selected' : ''}>${c}</option>`).join('')}</select><label><input type="radio" name="invMode" value="add" ${state.filters.inventoryMode === 'add' ? 'checked' : ''}/>Add</label><label><input type="radio" name="invMode" value="set" ${state.filters.inventoryMode === 'set' ? 'checked' : ''}/>Set</label><button id="modPack">Add common mod parts pack</button></div><div class="card help-card"><h4>Inventory mode help</h4><p><strong>Add</strong> increases the current amount by the value you enter. Example: if a ware is 2 and you queue 3 in Add mode, it becomes 5.</p><p><strong>Set</strong> overwrites the current amount to exactly the value you enter. Example: if a ware is 2 and you queue 3 in Set mode, it becomes 3.</p></div><div class="thead"><span>Name</span><span>Ware ID</span><span>Amount in save</span><span>Action</span></div><div id="itemList" class="vlist"></div></div>`;
}

function renderCredits() { if (!state.model) return '<div class="card">Import a save to edit credits.</div>'; const c = state.model.credits; return `<div class="card"><h3>Credits</h3><p>Player money: ${c.playerMoney}</p><input id="creditsValue" type="number" min="0" step="1" value="${c.playerMoney || 0}"/><button id="queueCredits">Queue SetCredits</button></div>`; }

function renderRelations() {
  if (!state.model) return '<div class="card">Import a save to edit relations.</div>';

  const factionIds = Array.from(new Set([
    ...Object.keys(state.model.relations.byFaction || {}),
    ...state.model.relations.player.map((entry) => entry.targetFactionId),
    ...Object.keys(state.dicts.factionsById || {})
  ].filter(Boolean))).sort();

  const playerBoosters = new Map((state.model.relations.playerBoosters || []).map((entry) => [entry.targetFactionId, Number(entry.value || 0)]));
  const reverseBase = new Map();
  const reverseBoosters = new Map();
  for (const [factionId, relEntries] of Object.entries(state.model.relations.byFaction || {})) {
    for (const entry of relEntries) {
      if (entry.targetFactionId === 'player') reverseBase.set(factionId, Number(entry.value || 0));
    }
  }
  for (const [factionId, boosterEntries] of Object.entries(state.model.relations.boostersByFaction || {})) {
    for (const entry of boosterEntries) {
      if (entry.targetFactionId === 'player') reverseBoosters.set(factionId, Number(entry.value || 0));
    }
  }

  const rows = state.model.relations.player
    .map((entry) => {
      const base = Number(entry.value || 0);
      const booster = playerBoosters.get(entry.targetFactionId);
      const repBase = Math.round(base * 30 * 1000) / 1000;
      const repEst = booster === undefined ? repBase : Math.round((base + booster) * 30 * 1000) / 1000;
      const reverseBaseValue = reverseBase.has(entry.targetFactionId) ? reverseBase.get(entry.targetFactionId) : null;
      const reverseBoosterValue = reverseBoosters.has(entry.targetFactionId) ? reverseBoosters.get(entry.targetFactionId) : null;
      return `<tr><td>${factionLabel(entry.targetFactionId)}</td><td>${base}</td><td>${booster === undefined ? '—' : booster}</td><td>${repBase}</td><td>${repEst} <span class="muted">(estimate)</span></td><td><input type="number" min="-30" max="30" data-rep="${entry.targetFactionId}" value="${Math.round(repBase)}"></td><td class="muted">Base back: ${reverseBaseValue === null ? 'missing' : reverseBaseValue}; Booster back: ${reverseBoosterValue === null ? '—' : reverseBoosterValue}</td></tr>`;
    })
    .join('');

  return `<div class="card"><h3>Set faction relation</h3><div class="row"><input id="relationFaction" list="relationFactions" placeholder="faction id"/><datalist id="relationFactions">${factionIds.map((id) => `<option value="${id}">${factionLabel(id)}</option>`).join('')}</datalist><input id="relationRep" type="number" min="-30" max="30" value="30"/><select id="relationMode"><option value="hard" ${state.filters.relationMode === 'hard' ? 'selected' : ''}>Hard Set (recommended)</option><option value="soft" ${state.filters.relationMode === 'soft' ? 'selected' : ''}>Soft Set (keep boosters)</option><option value="setBooster" ${state.filters.relationMode === 'setBooster' ? 'selected' : ''}>Set Booster Too (advanced)</option></select><button id="queueRelation">Queue SetFactionRep</button></div><p class="muted">Hard Set updates base both directions and deletes boosters both directions. Soft Set keeps boosters, so in-game relation may differ until boosters expire. Set Booster Too currently keeps existing boosters unchanged unless already present in save.</p><table class="table"><thead><tr><th>Faction</th><th>Base</th><th>Booster</th><th>Rep base</th><th>Rep est</th><th>Queue rep</th><th>Reverse link</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function licenceStateFromModelAndPatches() {
  const base = state.model?.licencesModel || { licencesByType: {}, allLicenceTypes: [], allFactionsInLicences: [] };
  const byType = new Map(Object.entries(base.licencesByType || {}).map(([typeName, ids]) => [typeName, new Set(ids)]));
  for (const patch of state.patches) {
    if (patch.type === 'AddLicenceType') {
      byType.set((patch.typeName || '').trim(), new Set(patch.factions || []));
    }
    if (patch.type === 'RemoveLicenceType') {
      byType.delete((patch.typeName || '').trim());
    }
    if (patch.type === 'AddLicenceFaction') {
      const typeName = (patch.typeName || '').trim();
      if (!byType.has(typeName)) byType.set(typeName, new Set());
      byType.get(typeName).add((patch.factionId || '').trim());
    }
    if (patch.type === 'RemoveLicenceFaction') {
      const typeName = (patch.typeName || '').trim();
      if (!byType.has(typeName)) byType.set(typeName, new Set());
      byType.get(typeName).delete((patch.factionId || '').trim());
    }
  }

  const allTypes = Array.from(byType.keys()).sort();
  const allFactions = new Set(base.allFactionsInLicences || []);
  for (const factionSet of byType.values()) for (const id of factionSet) allFactions.add(id);
  return { byType, allTypes, allFactions: Array.from(allFactions).filter(Boolean).sort() };
}

function renderLicences() {
  if (!state.model) return '<div class="card">Import a save to edit licences.</div>';
  if (!hasPlayerFaction()) return '<div class="card"><h3>Licences</h3><p>Cannot edit licences: &lt;faction id="player"&gt; not found in this save.</p></div>';

  const { byType, allTypes, allFactions } = licenceStateFromModelAndPatches();
  const contactFactions = state.model.licencesModel.playerContactFactions || [];
  const factionPool = contactFactions.length ? contactFactions : allFactions;
  if (!state.ui.selectedLicenceFactionId || !factionPool.includes(state.ui.selectedLicenceFactionId)) {
    state.ui.selectedLicenceFactionId = factionPool[0] || '';
  }

  const catalogueTypes = (state.dicts.licenceTypes || []).slice().sort();
  const search = state.ui.licenceCatalogSearch.trim().toLowerCase();
  const catalogueRows = catalogueTypes
    .filter((typeName) => !search || typeName.toLowerCase().includes(search))
    .map((typeName) => {
      const present = byType.has(typeName);
      return `<label class="licence-catalog-row"><div><strong>${typeName}</strong><div class="muted">${present ? 'Present in save' : 'Missing'}</div></div><button data-add-lic-catalog="${typeName}" ${present ? 'disabled' : ''}>Add to Save</button></label>`;
    }).join('');

  const factionButtons = factionPool.length
    ? factionPool.map((id) => `<button class="tab-btn ${state.ui.selectedLicenceFactionId === id ? 'active' : ''}" data-lic-faction="${id}">${factionLabel(id)}</button>`).join('')
    : '<p>No factions available.</p>';

  const typeRows = allTypes.length
    ? allTypes.map((typeName) => {
      const checked = byType.get(typeName)?.has(state.ui.selectedLicenceFactionId) ? 'checked' : '';
      return `<label class="licence-row"><input type="checkbox" data-lic-toggle="${typeName}" ${checked}/> <span>${typeName}</span></label>`;
    }).join('')
    : '<p>No licence types discovered.</p>';

  return `<div class="card"><h3>Licence Type Catalog</h3><input id="licCatalogSearch" placeholder="Search licence types" value="${state.ui.licenceCatalogSearch}"/><div id="licenceCatalogList" class="licence-catalog-list">${catalogueRows || '<p>No matching licence types.</p>'}</div><p class="muted">Some licence types may be DLC/faction dependent. Add only what you recognise.</p></div><div class="card licence-layout"><div class="licence-factions"><h3>Factions</h3>${factionButtons}</div><div><h3>Player Licences for ${factionLabel(state.ui.selectedLicenceFactionId) || '(select faction)'}</h3>${!state.model.licencesModel.licencesBlockFound ? '<p class="banner">No licences block found in source save. New licences will be inserted on export.</p>' : ''}${typeRows}<div class="row" style="margin-top:10px"><button id="resetLicPanel">Reset changes</button></div></div></div>`;
}


function npcRowsFromModel() {
  const skillsModel = state.model?.skillsModel;
  if (!skillsModel) return [];
  const search = state.filters.skillsSearch.trim().toLowerCase();
  return Object.values(skillsModel.npcsById || {}).filter((npc) => !search || String(npc.name || '').toLowerCase().includes(search));
}

function renderSkills() {
  if (!state.model) return '<div class="card">Import a save to edit NPC skills.</div>';
  const skillsModel = state.model.skillsModel || {};
  const supported = skillsModel.hasSkillsAttributes || skillsModel.hasSkillNodes;
  const rows = npcRowsFromModel();
  const selected = state.ui.selectedNpcId ? (skillsModel.npcsById || {})[state.ui.selectedNpcId] : rows[0];
  if (selected && !state.ui.selectedNpcId) state.ui.selectedNpcId = selected.id;

  const rowHtml = rows.map((npc) => {
    const assignments = (skillsModel.npcAssignmentsById || {})[npc.id] || [];
    const assignedTo = assignments.length ? assignments.map((a) => `${a.container?.name || a.containerId} (${a.postId})`).join(', ') : '<span class="badge">Unassigned</span>';
    const s = npc.skills || {};
    const isSelected = state.ui.selectedNpcId === npc.id ? 'active' : '';
    return `<tr data-npc-row="${npc.id}" class="${isSelected}"><td>${xmlEscape(npc.name || '(unnamed)')}</td><td>${xmlEscape(npc.id)}</td><td>${assignedTo}</td><td>${s.morale ?? '—'}</td><td>${s.piloting ?? '—'}</td><td>${s.management ?? '—'}</td><td>${s.engineering ?? '—'}</td><td>${s.boarding ?? '—'}</td></tr>`;
  }).join('');

  const editor = !selected ? '<p>Select an NPC to edit.</p>' : (() => {
    const hasSkills = Object.keys(selected.skills || {}).length > 0;
    if (!supported) return '<p class="banner">Skills editing disabled: no supported skills structures detected in this save.</p>';
    if (!hasSkills) return '<p class="banner">Skills not present for this NPC in save.</p>';
    return `<div class="skills-editor-grid">${['morale','piloting','management','engineering','boarding'].map((k) => `<label>${k}<input type="number" min="0" max="15" value="${selected.skills[k] ?? 0}" data-skill-key="${k}"/></label>`).join('')}</div><button id="queueNpcSkills" data-npc-id="${selected.id}">Queue SetNpcSkills</button>`;
  })();

  return `<div class="card"><h3>Skills</h3><input id="skillsSearch" placeholder="Search NPC name" value="${xmlEscape(state.filters.skillsSearch)}"/><table class="table"><thead><tr><th>Name</th><th>NPC ID</th><th>Assigned to</th><th>Morale</th><th>Piloting</th><th>Management</th><th>Engineering</th><th>Boarding</th></tr></thead><tbody>${rowHtml || '<tr><td colspan="8">No NPCs found.</td></tr>'}</tbody></table></div><div class="card"><h3>Editor</h3>${editor}</div>`;
}

function shipStateFromModelAndPatches() {
  const baseShips = structuredClone(state.model?.skillsModel?.playerShips || {});
  for (const patch of state.patches) {
    if (patch.type === 'SetShipCrewSkills') {
      const ship = baseShips[patch.shipId];
      const crew = ship?.crew?.[patch.crewIndex];
      if (!crew) continue;
      for (const [key, value] of Object.entries(patch.skills || {})) crew.skills[key] = Number(value);
    }
    if (patch.type === 'SetShipModificationValues') {
      const ship = baseShips[patch.shipId];
      const mod = ship?.modifications?.[patch.modIndex];
      if (!mod) continue;
      for (const [key, value] of Object.entries(patch.values || {})) mod.attrs[key] = String(value);
    }
  }
  return baseShips;
}

function renderShipsStations() {
  if (!state.model) return '<div class="card">Import a save to view ship/station links.</div>';
  const ships = shipStateFromModelAndPatches();
  const shipRows = Object.values(ships);
  if (shipRows.length && !state.ui.selectedShipId) state.ui.selectedShipId = shipRows[0].id;
  const selected = ships[state.ui.selectedShipId] || shipRows[0] || null;

  const list = shipRows.map((ship) => `<tr data-ship-row="${ship.id}" class="${state.ui.selectedShipId === ship.id ? 'active' : ''}"><td>${xmlEscape(ship.name || ship.id)}</td><td>${xmlEscape(ship.class)}</td><td>${xmlEscape(ship.code || '—')}</td></tr>`).join('');

  let details = '<p>Select a player-owned ship.</p>';
  if (selected) {
    const crewRows = (selected.crew || []).map((person) => {
      const skillInputs = ['morale','piloting','management','engineering','boarding'].map((k) => `<label>${k}<input type="number" min="0" max="15" value="${person.skills[k] ?? 0}" data-crew-skill="${k}" data-crew-index="${person.index}"/></label>`).join('');
      return `<div class="card"><p><strong>#${person.index + 1}</strong> ${xmlEscape(person.role || 'crew')} · ${xmlEscape(person.macro || '')}</p><div class="skills-editor-grid">${skillInputs}</div><button data-queue-crew="${person.index}">Queue Crew Skill Edit</button></div>`;
    }).join('') || '<p>No crew list found.</p>';

    const modRows = (selected.modifications || []).map((mod) => {
      const attrs = Object.entries(mod.attrs || {}).map(([k, v]) => {
        const val = Number(v);
        const editable = Number.isFinite(val);
        return `<label>${xmlEscape(k)}<input ${editable ? '' : 'disabled'} type="number" step="0.000001" value="${xmlEscape(v)}" data-mod-key="${xmlEscape(k)}" data-mod-index="${mod.index}"/></label>`;
      }).join('');
      return `<div class="card"><p><strong>Modification #${mod.index + 1}</strong> ${xmlEscape(mod.kind || 'entry')}</p><div class="skills-editor-grid">${attrs || '<span class="muted">No editable values</span>'}</div><button data-queue-mod="${mod.index}">Queue Modification Edit</button></div>`;
    }).join('') || '<p>No modifications found.</p>';

    details = `<div class="card"><h3>${xmlEscape(selected.name || selected.id)}</h3><p>ID: ${xmlEscape(selected.id)} · Macro: ${xmlEscape(selected.macro || '')}</p></div><div class="card"><h3>Crew</h3>${crewRows}</div><div class="card"><h3>Modifications</h3>${modRows}</div>`;
  }

  return `<div class="card"><h3>Ships/Stations</h3><table class="table"><thead><tr><th>Name</th><th>Class</th><th>Code</th></tr></thead><tbody>${list || '<tr><td colspan="3">No player-owned ships found.</td></tr>'}</tbody></table></div>${details}`;
}

function groupedPatches() {
  const groups = { Metadata: [], Credits: [], Relations: [], Blueprints: [], Inventory: [], Licences: [], Ships: [] };
  for (const patch of state.patches) {
    if (patch.type.includes('PlayerName') || patch.type.includes('ModifiedFlag')) groups.Metadata.push(patch);
    else if (patch.type.includes('Credit')) groups.Credits.push(patch);
    else if (patch.type.includes('Relation')) groups.Relations.push(patch);
    else if (patch.type.includes('Blueprint')) groups.Blueprints.push(patch);
    else if (patch.type.includes('Inventory')) groups.Inventory.push(patch);
    else if (patch.type.includes('Ship')) groups.Ships.push(patch);
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
  return `${warningPanel()}<div class="card"><h3>Export</h3><label><input id="compressOut" type="checkbox" checked> Output .xml.gz</label><br/><label><input id="backupOut" type="checkbox" checked> Create backup</label><br/><button id="exportBtn" ${disabled}>Export patched save</button>${state.exportResult ? `<p>Output: ${state.exportResult.outputPath}</p><p>Credits anchors updated: ${summary.creditsAnchorsUpdated}; Wallet accounts updated: ${summary.walletAccountsUpdated}; Blueprints inserted: ${summary.blueprintsInserted}; Relations inserted: ${summary.relationsInserted}; Boosters deleted: ${summary.boostersDeleted || 0}; Licences inserted: ${summary.licencesInserted}; Player names updated: ${summary.playerNamesUpdated || 0}; Modified flags updated: ${summary.modifiedFlagsUpdated || 0}</p>` : ''}</div>`;
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
  main.innerHTML = ({ Overview: renderOverview, Credits: renderCredits, Blueprints: renderBlueprints, Inventory: renderInventory, Relations: renderRelations, Licences: renderLicences, Skills: renderSkills, 'Ships/Stations': renderShipsStations, 'Changes Preview': renderChanges, Export: renderExport })[state.activeTab]();
  wireEvents();
  renderStatusBar();

  if (state.activeTab === 'Blueprints') {
    const rows = filteredBlueprintRows();
    const list = document.getElementById('bpList');
    const draw = () => renderVirtualRows('bpList', rows, (r) => `<span>${r.name}</span><span>${r.ware}</span><span>${r.category}</span><span>${r.owned ? 'Yes' : `<button data-add-blueprint="${r.ware}">Add</button>`}</span>`);
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
  document.getElementById('bpSearch')?.addEventListener('input', (e) => { state.filters.blueprintSearch = e.target.value; if (state.activeTab === 'Blueprints') { const rows = filteredBlueprintRows(); renderVirtualRows('bpList', rows, (r) => `<span>${r.name}</span><span>${r.ware}</span><span>${r.category}</span><span>${r.owned ? 'Yes' : `<button data-add-blueprint="${r.ware}">Add</button>`}</span>`); } });
  document.getElementById('bpCategory')?.addEventListener('change', (e) => { state.filters.blueprintCategory = e.target.value; render(); });
  document.getElementById('unlockAll')?.addEventListener('click', () => pushPatch({ type: 'UnlockBlueprintWares', wares: Object.keys(state.dicts.blueprints) }));
  document.getElementById('unlockCategory')?.addEventListener('click', () => pushPatch({ type: 'UnlockBlueprintWares', wares: filteredBlueprintRows().map((r) => r.ware) }));
  document.getElementById('bpList')?.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-add-blueprint]');
    if (!button) return;
    pushPatch({ type: 'UnlockBlueprintWares', wares: [button.dataset.addBlueprint] });
  });
  document.getElementById('addBlueprintSingle')?.addEventListener('click', () => {
    const ware = window.prompt('Enter blueprint ware id');
    if (!ware || !ware.trim()) return;
    pushPatch({ type: 'UnlockBlueprintWares', wares: [ware.trim()] });
  });

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
    const mode = document.getElementById('relationMode')?.value || state.filters.relationMode || 'hard';
    pushPatch({ type: 'SetFactionRep', factionId, repUI, mode });
  });
  document.getElementById('relationMode')?.addEventListener('change', (event) => { state.filters.relationMode = event.target.value; });
  document.querySelectorAll('input[data-rep]').forEach((input) => input.addEventListener('change', () => pushPatch({ type: 'SetFactionRep', factionId: input.dataset.rep, repUI: Number(input.value), mode: state.filters.relationMode })));

  document.querySelectorAll('button[data-lic-faction]').forEach((button) => button.addEventListener('click', () => {
    state.ui.selectedLicenceFactionId = button.dataset.licFaction;
    render();
  }));
  document.querySelectorAll('input[data-lic-toggle]').forEach((input) => input.addEventListener('change', () => {
    const typeName = input.dataset.licToggle;
    const factionId = state.ui.selectedLicenceFactionId;
    if (!typeName || !factionId) return;
    pushPatch({ type: input.checked ? 'AddLicenceFaction' : 'RemoveLicenceFaction', typeName, factionId });
  }));
  document.getElementById('licCatalogSearch')?.addEventListener('input', (event) => {
    state.ui.licenceCatalogSearch = event.target.value;
    const list = document.getElementById('licenceCatalogList');
    if (!list) return;
    const { byType } = licenceStateFromModelAndPatches();
    const catalogueTypes = (state.dicts.licenceTypes || []).slice().sort();
    const search = state.ui.licenceCatalogSearch.trim().toLowerCase();
    list.innerHTML = catalogueTypes.filter((typeName) => !search || typeName.toLowerCase().includes(search)).map((typeName) => {
      const present = byType.has(typeName);
      return `<label class="licence-catalog-row"><div><strong>${typeName}</strong><div class="muted">${present ? 'Present in save' : 'Missing'}</div></div><button data-add-lic-catalog="${typeName}" ${present ? 'disabled' : ''}>Add to Save</button></label>`;
    }).join('') || '<p>No matching licence types.</p>';
  });
  document.querySelectorAll('button[data-add-lic-catalog]').forEach((button) => button.addEventListener('click', () => {
    const typeName = (button.dataset.addLicCatalog || '').trim();
    if (!typeName) return;
    const { byType } = licenceStateFromModelAndPatches();
    if (byType.has(typeName)) return;
    pushPatch({ type: 'AddLicenceType', typeName, factions: [] });
  }));
  document.getElementById('resetLicPanel')?.addEventListener('click', resetLicencePanel);


  document.getElementById('queuePlayerName')?.addEventListener('click', () => {
    const value = (document.getElementById('playerNameInput')?.value || '').trim();
    if (!value || value.length > 64) {
      setStatus('Player name must be 1-64 characters.');
      return;
    }
    pushPatch({ type: 'SetPlayerName', name: value });
  });
  document.getElementById('modifiedSlider')?.addEventListener('change', (event) => {
    pushPatch({ type: 'SetModifiedFlag', value: event.target.checked ? 1 : 0 });
  });

  document.getElementById('skillsSearch')?.addEventListener('input', (event) => { state.filters.skillsSearch = event.target.value; render(); });
  document.querySelectorAll('tr[data-npc-row]').forEach((row) => row.addEventListener('click', () => { state.ui.selectedNpcId = row.dataset.npcRow; render(); }));
  document.getElementById('queueNpcSkills')?.addEventListener('click', (event) => {
    const npcId = event.target.dataset.npcId;
    if (!npcId) return;
    const skills = {};
    document.querySelectorAll('input[data-skill-key]').forEach((input) => { skills[input.dataset.skillKey] = Number(input.value); });
    pushPatch({ type: 'SetNpcSkills', npcId, skills });
  });

  document.querySelectorAll('tr[data-ship-row]').forEach((row) => row.addEventListener('click', () => { state.ui.selectedShipId = row.dataset.shipRow; render(); }));
  document.querySelectorAll('button[data-queue-crew]').forEach((button) => button.addEventListener('click', () => {
    const crewIndex = Number(button.dataset.queueCrew);
    const shipId = state.ui.selectedShipId;
    if (!shipId || !Number.isInteger(crewIndex)) return;
    const skills = {};
    document.querySelectorAll(`input[data-crew-index="${crewIndex}"]`).forEach((input) => { skills[input.dataset.crewSkill] = Number(input.value); });
    pushPatch({ type: 'SetShipCrewSkills', shipId, crewIndex, skills });
  }));
  document.querySelectorAll('button[data-queue-mod]').forEach((button) => button.addEventListener('click', () => {
    const modIndex = Number(button.dataset.queueMod);
    const shipId = state.ui.selectedShipId;
    if (!shipId || !Number.isInteger(modIndex)) return;
    const values = {};
    document.querySelectorAll(`input[data-mod-index="${modIndex}"]`).forEach((input) => { if (!input.disabled) values[input.dataset.modKey] = Number(input.value); });
    pushPatch({ type: 'SetShipModificationValues', shipId, modIndex, values });
  }));

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
  state.model = response.index;
  state.sourcePath = response.filePath;
  state.patches = [];
  state.undo = [];
  state.redo = [];
  state.exportResult = null;
  state.ui.licenceCatalogSearch = '';
  state.ui.selectedLicenceFactionId = response.index?.licencesModel?.playerContactFactions?.[0] || response.index?.licencesModel?.allFactionsInLicences?.[0] || '';
  document.getElementById('saveMeta').textContent = response.filePath;
  setStatus('Indexed save successfully.');
  render();
};

(async function init() {
  try { state.dicts = await window.x4api.loadDictionaries(); } catch (e) { setStatus(`Dictionary load failed: ${e.message}`); }
  render();
})();
