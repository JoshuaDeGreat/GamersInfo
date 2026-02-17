const sax = require('sax');
const { createInputStream } = require('./stream-utils');

const KNOWN_SKILLS = ['morale', 'piloting', 'management', 'engineering', 'boarding'];

function toAttrsObj(attrs) {
  return Object.fromEntries(Object.entries(attrs).map(([k, v]) => [k, String(v)]));
}

async function buildIndex(filePath) {
  return new Promise((resolve, reject) => {
    const parser = sax.createStream(true, { trim: true });
    const input = createInputStream(filePath);

    const model = {
      metadata: { filePath, parsedAt: new Date().toISOString(), saveName: '', saveDate: '', gameId: '', gameVersion: '', gameBuild: '', modified: null, time: '', code: '', original: '', originalBuild: '', start: '', seed: '', guid: '', playerName: '', extensions: { active: [], history: [] } },
      credits: { playerName: '', playerLocation: '', playerMoney: '', statMoneyPlayer: '', playerWalletAccountId: '', playerWalletAmount: '', walletAccountOccurrences: 0 },
      blueprints: { owned: [] },
      relations: { player: [], byFaction: {}, boostersByFaction: {}, playerBoosters: [] },
      licences: [],
      licencesModel: { playerFactionFound: false, licencesBlockFound: false, licencesByType: {}, allLicenceTypes: [], allFactionsInLicences: [] },
      inventory: { player: {}, playerList: [] },
      skillsModel: { npcsById: {}, postsByContainerId: {}, containerById: {}, supportedSkillKeys: [], hasSkillsAttributes: false, hasSkillNodes: false, npcAssignmentsById: {}, playerShips: {} },
      shipsModel: { allShipsById: {}, allShipIds: [], myShipIds: [] }
    };

    const stack = [];
    const componentStack = [];
    let currentFactionId = null;
    let inPlayerFaction = false;
    let inPlayerLicences = false;
    let inPlayerComponent = false;
    let playerComponentDepth = -1;
    let inPlayerInventory = false;
    let inInfo = false;
    let inInfoPatches = false;
    let inInfoPatchHistory = false;

    let currentNpcId = null;
    let inNpcTraits = false;
    const detectedSkillKeys = new Set();
    const shipsById = model.shipsModel.allShipsById;
    const partTagCounters = new Map();

    let currentShipPersonIndex = -1;
    let currentShipPeopleId = null;
    let currentOfficerId = null;

    function activeShipId() {
      for (let i = componentStack.length - 1; i >= 0; i -= 1) if (componentStack[i].isShip) return componentStack[i].id;
      return null;
    }

    function parseIntMaybe(value) {
      const num = Number(value);
      if (!Number.isFinite(num)) return null;
      return Math.trunc(num);
    }

    function ensureShip(attrs) {
      const id = String(attrs.id || '');
      const className = String(attrs.class || '');
      if (!id || !className.startsWith('ship_')) return null;
      if (!shipsById[id]) {
        shipsById[id] = {
          id,
          class: className,
          macro: String(attrs.macro || ''),
          code: String(attrs.code || ''),
          owner: String(attrs.owner || ''),
          name: String(attrs.name || id),
          crew: [],
          officers: [],
          modifications: [],
          partModifications: [],
          location: { spaceId: '', x: '', y: '', z: '' },
          docked: false
        };
      }
      const ship = shipsById[id];
      if (attrs.name !== undefined) ship.name = String(attrs.name || ship.name);
      if (attrs.owner !== undefined) ship.owner = String(attrs.owner || ship.owner);
      if (attrs.code !== undefined) ship.code = String(attrs.code || ship.code);
      if (attrs.macro !== undefined) ship.macro = String(attrs.macro || ship.macro);
      return ship;
    }

    parser.on('opentag', (node) => {
      const name = node.name.toLowerCase();
      const attrs = node.attributes;
      stack.push(name);

      if (name === 'info') inInfo = true;
      if (name === 'patches' && inInfo) inInfoPatches = true;
      if (name === 'history' && inInfoPatches) inInfoPatchHistory = true;
      if (name === 'save' && attrs.name !== undefined && inInfo) {
        model.metadata.saveName = String(attrs.name);
        model.metadata.saveDate = String(attrs.date ?? '');
      }
      if (name === 'game' && inInfo) {
        model.metadata.gameId = String(attrs.id ?? '');
        model.metadata.gameVersion = String(attrs.version ?? '');
        model.metadata.gameBuild = String(attrs.build ?? '');
        model.metadata.modified = attrs.modified === undefined ? null : String(attrs.modified) === '1';
        model.metadata.time = String(attrs.time ?? '');
        model.metadata.code = String(attrs.code ?? '');
        model.metadata.original = String(attrs.original ?? '');
        model.metadata.originalBuild = String(attrs.originalbuild ?? '');
        model.metadata.start = String(attrs.start ?? '');
        model.metadata.seed = String(attrs.seed ?? '');
        model.metadata.guid = String(attrs.guid ?? '');
      }
      if (name === 'player' && inInfo) model.metadata.playerName = String(attrs.name ?? '');
      if (name === 'patch' && inInfoPatches) {
        const extensionId = String(attrs.extension ?? '').trim();
        if (extensionId) {
          const patchInfo = { id: extensionId, version: String(attrs.version ?? ''), name: String(attrs.name ?? '') };
          if (inInfoPatchHistory) model.metadata.extensions.history.push(patchInfo);
          else model.metadata.extensions.active.push(patchInfo);
        }
      }

      if (name === 'player' && attrs.money !== undefined && !model.credits.playerMoney) {
        model.credits.playerName = String(attrs.name ?? '');
        model.credits.playerLocation = String(attrs.location ?? '');
        model.credits.playerMoney = String(attrs.money);
      }
      if (name === 'stat' && attrs.id === 'money_player') model.credits.statMoneyPlayer = String(attrs.value ?? '');

      if (name === 'faction') {
        currentFactionId = String(attrs.id ?? '');
        inPlayerFaction = currentFactionId === 'player';
        if (inPlayerFaction) model.licencesModel.playerFactionFound = true;
      }
      if (name === 'account') {
        const accountId = String(attrs.id ?? '');
        if (inPlayerFaction && !model.credits.playerWalletAccountId) {
          model.credits.playerWalletAccountId = accountId;
          model.credits.playerWalletAmount = String(attrs.amount ?? '');
        }
        if (model.credits.playerWalletAccountId && accountId === model.credits.playerWalletAccountId) model.credits.walletAccountOccurrences += 1;
      }

      if (name === 'blueprint' && stack[stack.length - 2] === 'blueprints') {
        const ware = String(attrs.ware ?? '');
        if (ware) model.blueprints.owned.push(ware);
      }

      if (name === 'relation' && stack.includes('relations') && currentFactionId) {
        const faction = String(attrs.faction ?? '');
        const relation = String(attrs.relation ?? '');
        if (!model.relations.byFaction[currentFactionId]) model.relations.byFaction[currentFactionId] = [];
        model.relations.byFaction[currentFactionId].push({ targetFactionId: faction, value: relation });
        if (currentFactionId === 'player') model.relations.player.push({ targetFactionId: faction, value: relation });
      }
      if (name === 'booster' && stack.includes('relations') && currentFactionId) {
        const faction = String(attrs.faction ?? '');
        const relation = String(attrs.relation ?? '');
        const time = String(attrs.time ?? '');
        if (!model.relations.boostersByFaction[currentFactionId]) model.relations.boostersByFaction[currentFactionId] = [];
        model.relations.boostersByFaction[currentFactionId].push({ targetFactionId: faction, value: relation, time });
        if (currentFactionId === 'player') model.relations.playerBoosters.push({ targetFactionId: faction, value: relation, time });
      }

      if (name === 'licences' && inPlayerFaction) {
        inPlayerLicences = true;
        model.licencesModel.licencesBlockFound = true;
      }

      if (name === 'component' && attrs.class === 'player' && !inPlayerComponent) {
        inPlayerComponent = true;
        playerComponentDepth = stack.length;
      }

      if (name === 'component') {
        const componentId = String(attrs.id ?? '');
        const className = String(attrs.class ?? '');
        const ship = ensureShip(attrs);
        const parentShipId = activeShipId();
        componentStack.push({ id: componentId, className, isShip: Boolean(ship), parentShipId, isOfficer: className === 'npc' || className === 'computer' });

        if (ship && parentShipId) ship.docked = true;

        if (componentId && className === 'npc') {
          currentNpcId = componentId;
          if (!model.skillsModel.npcsById[componentId]) model.skillsModel.npcsById[componentId] = { id: componentId, name: String(attrs.name || ''), owner: String(attrs.owner || ''), skills: {}, npcseed: '' };
        }

        if (componentId && (className.includes('ship') || className.includes('station'))) {
          model.skillsModel.containerById[componentId] = { id: componentId, class: className, macro: String(attrs.macro || ''), code: String(attrs.code || ''), owner: String(attrs.owner || ''), name: String(attrs.name || ''), bestEffortLocation: String(attrs.location || '') };
        }

        if (ship && ship.owner === 'player') model.skillsModel.playerShips[ship.id] = ship;

        if (componentId && (className === 'npc' || className === 'computer') && parentShipId && shipsById[parentShipId]) {
          const officer = { id: componentId, class: className, shipId: parentShipId, name: String(attrs.name || ''), code: String(attrs.code || ''), post: '', skills: {} };
          shipsById[parentShipId].officers.push(officer);
          currentOfficerId = componentId;
        }
      }

      const activeComponent = componentStack[componentStack.length - 1];
      const shipId = activeShipId();

      if (name === 'traits' && (activeComponent?.className === 'npc' || activeComponent?.className === 'computer')) inNpcTraits = true;
      if (name === 'npcseed' && activeComponent?.className === 'npc' && currentNpcId) model.skillsModel.npcsById[currentNpcId].npcseed = String(attrs.seed ?? '');
      if (name === 'skills' && inNpcTraits && activeComponent?.className === 'npc' && currentNpcId) {
        model.skillsModel.hasSkillsAttributes = true;
        for (const key of KNOWN_SKILLS) if (attrs[key] !== undefined) {
          const parsed = parseIntMaybe(attrs[key]);
          if (parsed !== null) model.skillsModel.npcsById[currentNpcId].skills[key] = parsed;
          detectedSkillKeys.add(key);
        }
      }
      if (name === 'skill' && inNpcTraits && activeComponent?.className === 'npc' && currentNpcId) {
        const type = String(attrs.type ?? '').trim();
        if (KNOWN_SKILLS.includes(type)) {
          const parsed = parseIntMaybe(attrs.value);
          if (parsed !== null) model.skillsModel.npcsById[currentNpcId].skills[type] = parsed;
          detectedSkillKeys.add(type);
          model.skillsModel.hasSkillNodes = true;
        }
      }

      if (name === 'entity' && currentOfficerId && shipId) {
        const officer = shipsById[shipId]?.officers?.find((o) => o.id === currentOfficerId);
        if (officer) officer.post = String(attrs.post || attrs.type || '');
      }
      if (name === 'skills' && currentOfficerId && inNpcTraits && shipId) {
        const officer = shipsById[shipId]?.officers?.find((o) => o.id === currentOfficerId);
        if (officer) {
          for (const key of KNOWN_SKILLS) if (attrs[key] !== undefined) officer.skills[key] = parseIntMaybe(attrs[key]) ?? 0;
        }
      }

      if (name === 'people' && shipId) currentShipPeopleId = shipId;
      if (name === 'person' && currentShipPeopleId && shipsById[currentShipPeopleId]) {
        const ship = shipsById[currentShipPeopleId];
        currentShipPersonIndex = ship.crew.length;
        ship.crew.push({ index: currentShipPersonIndex, role: String(attrs.role ?? ''), macro: String(attrs.macro ?? ''), npcseed: String(attrs.npcseed ?? ''), skills: {} });
      }
      if (name === 'skills' && currentShipPeopleId && currentShipPersonIndex >= 0) {
        const crew = shipsById[currentShipPeopleId]?.crew?.[currentShipPersonIndex];
        if (crew) for (const key of KNOWN_SKILLS) if (attrs[key] !== undefined) crew.skills[key] = parseIntMaybe(attrs[key]) ?? 0;
      }

      if (shipId && ['modification', 'engine', 'paint', 'ship', 'weapon'].includes(name)) {
        const partId = String(activeComponent?.id || shipId);
        const counterKey = `${partId}|${name}`;
        const localIndex = partTagCounters.get(counterKey) || 0;
        partTagCounters.set(counterKey, localIndex + 1);
        shipsById[shipId].partModifications.push({ shipId, partComponentId: partId, tagType: name, localIndex, attrs: toAttrsObj(attrs) });
        shipsById[shipId].modifications.push({ index: shipsById[shipId].modifications.length, kind: name, attrs: toAttrsObj(attrs) });
      }

      if (name === 'read' && shipId && attrs.space !== undefined) {
        const ship = shipsById[shipId];
        if (!ship.location.spaceId) ship.location.spaceId = String(attrs.space);
      }
      if (name === 'offset' && shipId && attrs.x !== undefined && attrs.y !== undefined && attrs.z !== undefined) {
        const ship = shipsById[shipId];
        if (!ship.location.x && !ship.location.y && !ship.location.z) {
          ship.location.x = String(attrs.x); ship.location.y = String(attrs.y); ship.location.z = String(attrs.z);
        }
      }

      if (name === 'post' && activeComponent?.id && stack.includes('control')) {
        const npcId = String(attrs.component ?? '').trim();
        const postId = String(attrs.id ?? '').trim();
        if (npcId) {
          if (!model.skillsModel.postsByContainerId[activeComponent.id]) model.skillsModel.postsByContainerId[activeComponent.id] = [];
          model.skillsModel.postsByContainerId[activeComponent.id].push({ postId, npcId });
        }
      }

      if (name === 'inventory' && inPlayerComponent) inPlayerInventory = true;
      if (name === 'ware' && inPlayerInventory) {
        const ware = String(attrs.ware ?? '');
        const amount = Number(attrs.amount ?? 0);
        if (ware) model.inventory.player[ware] = Number.isFinite(amount) ? amount : 0;
      }
      if (name === 'licence' && inPlayerLicences) {
        const type = String(attrs.type ?? '').trim();
        const factionsRaw = String(attrs.factions ?? '');
        model.licences.push({ type, factions: factionsRaw });
        if (type) {
          if (!model.licencesModel.licencesByType[type]) model.licencesModel.licencesByType[type] = new Set();
          factionsRaw.split(/\s+/).map((t) => t.trim()).filter(Boolean).forEach((f) => model.licencesModel.licencesByType[type].add(f));
        }
      }
    });

    parser.on('closetag', (tagName) => {
      const name = tagName.toLowerCase();
      stack.pop();

      if (name === 'licences') inPlayerLicences = false;
      if (name === 'history' && inInfoPatchHistory) inInfoPatchHistory = false;
      if (name === 'patches' && inInfoPatches) inInfoPatches = false;
      if (name === 'info') inInfo = false;
      if (name === 'inventory') inPlayerInventory = false;
      if (name === 'traits') inNpcTraits = false;
      if (name === 'people') currentShipPeopleId = null;
      if (name === 'person') currentShipPersonIndex = -1;
      if (name === 'component') {
        const popped = componentStack.pop();
        if (popped?.className === 'npc') currentNpcId = null;
        if (popped?.isOfficer) currentOfficerId = null;
      }
      if (name === 'component' && inPlayerComponent && stack.length < playerComponentDepth) {
        inPlayerComponent = false;
        playerComponentDepth = -1;
      }
      if (name === 'faction') {
        currentFactionId = null;
        inPlayerFaction = false;
      }
    });

    parser.on('error', reject);
    parser.on('end', () => {
      model.blueprints.owned = Array.from(new Set(model.blueprints.owned));
      model.metadata.extensions.active = Array.from(new Map(model.metadata.extensions.active.map((item) => [item.id, item])).values());
      model.metadata.extensions.history = Array.from(new Map(model.metadata.extensions.history.map((item) => [item.id, item])).values());
      model.inventory.playerList = Object.entries(model.inventory.player).map(([ware, amount]) => ({ ware, amount }));
      model.shipsModel.allShipIds = Object.keys(shipsById);
      model.shipsModel.myShipIds = model.shipsModel.allShipIds.filter((id) => shipsById[id].owner === 'player');

      const allFactions = new Set();
      const sortedTypes = Object.keys(model.licencesModel.licencesByType).sort();
      const licencesByType = {};
      for (const type of sortedTypes) {
        const sortedFactions = Array.from(model.licencesModel.licencesByType[type]).sort();
        sortedFactions.forEach((id) => allFactions.add(id));
        licencesByType[type] = sortedFactions;
      }
      model.licencesModel.licencesByType = licencesByType;
      model.licencesModel.allLicenceTypes = sortedTypes;
      model.licencesModel.allFactionsInLicences = Array.from(allFactions).sort();

      const contactFactions = new Set();
      for (const entry of model.relations.player) if (entry.targetFactionId) contactFactions.add(entry.targetFactionId);
      for (const entry of model.relations.playerBoosters) if (entry.targetFactionId) contactFactions.add(entry.targetFactionId);
      for (const [factionId, relationEntries] of Object.entries(model.relations.byFaction)) {
        for (const entry of relationEntries) if (entry.targetFactionId === 'player' && factionId) contactFactions.add(factionId);
      }
      for (const [factionId, boosterEntries] of Object.entries(model.relations.boostersByFaction)) {
        for (const entry of boosterEntries) if (entry.targetFactionId === 'player' && factionId) contactFactions.add(factionId);
      }
      model.licencesModel.playerContactFactions = Array.from(contactFactions).filter(Boolean).sort();

      model.skillsModel.supportedSkillKeys = Array.from(detectedSkillKeys).sort();
      for (const [containerId, posts] of Object.entries(model.skillsModel.postsByContainerId)) {
        for (const post of posts) {
          if (!model.skillsModel.npcAssignmentsById[post.npcId]) model.skillsModel.npcAssignmentsById[post.npcId] = [];
          model.skillsModel.npcAssignmentsById[post.npcId].push({ containerId, postId: post.postId, container: model.skillsModel.containerById[containerId] || null });
        }
      }

      resolve(model);
    });

    input.on('error', reject);
    input.pipe(parser);
  });
}

module.exports = { buildIndex };
