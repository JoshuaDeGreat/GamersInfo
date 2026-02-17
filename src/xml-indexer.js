const sax = require('sax');
const { createInputStream } = require('./stream-utils');

async function buildIndex(filePath) {
  return new Promise((resolve, reject) => {
    const parser = sax.createStream(true, { trim: true });
    const input = createInputStream(filePath);

    const model = {
      metadata: {
        filePath,
        parsedAt: new Date().toISOString(),
        saveName: '',
        saveDate: '',
        gameId: '',
        gameVersion: '',
        gameBuild: '',
        modified: null,
        time: '',
        code: '',
        original: '',
        originalBuild: '',
        start: '',
        seed: '',
        guid: '',
        playerName: '',
        extensions: { active: [], history: [] }
      },
      credits: {
        playerName: '',
        playerLocation: '',
        playerMoney: '',
        statMoneyPlayer: '',
        playerWalletAccountId: '',
        playerWalletAmount: '',
        walletAccountOccurrences: 0
      },
      blueprints: { owned: [] },
      relations: { player: [], byFaction: {}, boostersByFaction: {}, playerBoosters: [] },
      licences: [],
      licencesModel: {
        playerFactionFound: false,
        licencesBlockFound: false,
        licencesByType: {},
        allLicenceTypes: [],
        allFactionsInLicences: []
      },
      inventory: { player: {}, playerList: [] }
      ,
      skillsModel: {
        npcsById: {},
        postsByContainerId: {},
        containerById: {},
        supportedSkillKeys: [],
        hasSkillsAttributes: false,
        hasSkillNodes: false,
        npcAssignmentsById: {}
      }
    };

    const stack = [];
    let currentFactionId = null;
    let inPlayerFaction = false;
    let inPlayerLicences = false;
    let inPlayerComponent = false;
    let playerComponentDepth = -1;
    let inPlayerInventory = false;

    let inInfo = false;
    let inInfoPatches = false;
    let inInfoPatchHistory = false;
    const knownSkillKeys = new Set(['morale', 'piloting', 'management', 'engineering', 'boarding']);
    const detectedSkillKeys = new Set();
    const componentStack = [];
    let currentNpcId = null;
    let inNpcTraits = false;

    function parseIntMaybe(value) {
      const num = Number(value);
      if (!Number.isFinite(num)) return null;
      return Math.trunc(num);
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

      if (name === 'player' && inInfo) {
        model.metadata.playerName = String(attrs.name ?? '');
      }

      if (name === 'patch' && inInfoPatches) {
        const extensionId = String(attrs.extension ?? '').trim();
        if (extensionId) {
          const patchInfo = {
            id: extensionId,
            version: String(attrs.version ?? ''),
            name: String(attrs.name ?? '')
          };
          if (inInfoPatchHistory) model.metadata.extensions.history.push(patchInfo);
          else model.metadata.extensions.active.push(patchInfo);
        }
      }

      if (name === 'player' && attrs.money !== undefined && !model.credits.playerMoney) {
        model.credits.playerName = String(attrs.name ?? '');
        model.credits.playerLocation = String(attrs.location ?? '');
        model.credits.playerMoney = String(attrs.money);
      }

      if (name === 'stat' && attrs.id === 'money_player') {
        model.credits.statMoneyPlayer = String(attrs.value ?? '');
      }

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

        if (model.credits.playerWalletAccountId && accountId === model.credits.playerWalletAccountId) {
          model.credits.walletAccountOccurrences += 1;
        }
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
        if (currentFactionId === 'player') {
          model.relations.player.push({ targetFactionId: faction, value: relation });
        }
      }

      if (name === 'booster' && stack.includes('relations') && currentFactionId) {
        const faction = String(attrs.faction ?? '');
        const relation = String(attrs.relation ?? '');
        const time = String(attrs.time ?? '');
        if (!model.relations.boostersByFaction[currentFactionId]) model.relations.boostersByFaction[currentFactionId] = [];
        model.relations.boostersByFaction[currentFactionId].push({ targetFactionId: faction, value: relation, time });
        if (currentFactionId === 'player') {
          model.relations.playerBoosters.push({ targetFactionId: faction, value: relation, time });
        }
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
        const componentInfo = {
          id: componentId,
          class: className,
          name: String(attrs.name ?? ''),
          macro: String(attrs.macro ?? ''),
          code: String(attrs.code ?? ''),
          owner: String(attrs.owner ?? ''),
          location: String(attrs.location ?? ''),
          isNpc: className === 'npc' && Boolean(componentId),
          isContainer: Boolean(componentId) && (className.includes('ship') || className.includes('station'))
        };
        componentStack.push(componentInfo);

        if (componentInfo.isNpc) {
          currentNpcId = componentId;
          if (!model.skillsModel.npcsById[currentNpcId]) {
            model.skillsModel.npcsById[currentNpcId] = {
              id: currentNpcId,
              name: componentInfo.name || '',
              owner: componentInfo.owner || '',
              skills: {},
              npcseed: ''
            };
          }
        }

        if (componentInfo.isContainer) {
          model.skillsModel.containerById[componentId] = {
            id: componentId,
            class: className,
            macro: componentInfo.macro || '',
            code: componentInfo.code || '',
            owner: componentInfo.owner || '',
            name: componentInfo.name || '',
            bestEffortLocation: componentInfo.location || ''
          };
        }
      }

      const activeComponent = componentStack[componentStack.length - 1];
      if (name === 'traits' && activeComponent?.isNpc) inNpcTraits = true;
      if (name === 'npcseed' && activeComponent?.isNpc && currentNpcId) {
        model.skillsModel.npcsById[currentNpcId].npcseed = String(attrs.seed ?? '');
      }
      if (name === 'skills' && inNpcTraits && activeComponent?.isNpc && currentNpcId) {
        model.skillsModel.hasSkillsAttributes = true;
        for (const key of knownSkillKeys) {
          if (attrs[key] !== undefined) {
            const parsed = parseIntMaybe(attrs[key]);
            if (parsed !== null) model.skillsModel.npcsById[currentNpcId].skills[key] = parsed;
            detectedSkillKeys.add(key);
          }
        }
      }

      if (name === 'skill' && inNpcTraits && activeComponent?.isNpc && currentNpcId) {
        const type = String(attrs.type ?? '').trim();
        if (knownSkillKeys.has(type)) {
          const parsed = parseIntMaybe(attrs.value);
          if (parsed !== null) model.skillsModel.npcsById[currentNpcId].skills[type] = parsed;
          detectedSkillKeys.add(type);
          model.skillsModel.hasSkillNodes = true;
        }
      }

      if (name === 'post' && activeComponent?.isContainer && stack.includes('control')) {
        const npcId = String(attrs.component ?? '').trim();
        const postId = String(attrs.id ?? '').trim();
        if (npcId) {
          if (!model.skillsModel.postsByContainerId[activeComponent.id]) model.skillsModel.postsByContainerId[activeComponent.id] = [];
          model.skillsModel.postsByContainerId[activeComponent.id].push({ postId, npcId });
        }
      }

      if (name === 'inventory' && inPlayerComponent) {
        inPlayerInventory = true;
      }

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
          factionsRaw
            .split(/\s+/)
            .map((token) => token.trim())
            .filter(Boolean)
            .forEach((factionId) => model.licencesModel.licencesByType[type].add(factionId));
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
      if (name === 'component' && inPlayerComponent && stack.length < playerComponentDepth) {
        inPlayerComponent = false;
        playerComponentDepth = -1;
      }
      if (name === 'component') {
        const popped = componentStack.pop();
        if (popped?.isNpc) currentNpcId = null;
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
      for (const entry of model.relations.player) {
        if (entry.targetFactionId) contactFactions.add(entry.targetFactionId);
      }
      for (const entry of model.relations.playerBoosters) {
        if (entry.targetFactionId) contactFactions.add(entry.targetFactionId);
      }
      for (const [factionId, relationEntries] of Object.entries(model.relations.byFaction)) {
        for (const entry of relationEntries) {
          if (entry.targetFactionId === 'player' && factionId) contactFactions.add(factionId);
        }
      }
      for (const [factionId, boosterEntries] of Object.entries(model.relations.boostersByFaction)) {
        for (const entry of boosterEntries) {
          if (entry.targetFactionId === 'player' && factionId) contactFactions.add(factionId);
        }
      }
      model.licencesModel.playerContactFactions = Array.from(contactFactions).filter(Boolean).sort();

      model.skillsModel.supportedSkillKeys = Array.from(detectedSkillKeys).sort();
      for (const [containerId, posts] of Object.entries(model.skillsModel.postsByContainerId)) {
        for (const post of posts) {
          if (!model.skillsModel.npcAssignmentsById[post.npcId]) model.skillsModel.npcAssignmentsById[post.npcId] = [];
          model.skillsModel.npcAssignmentsById[post.npcId].push({
            containerId,
            postId: post.postId,
            container: model.skillsModel.containerById[containerId] || null
          });
        }
      }

      resolve(model);
    });

    input.on('error', reject);
    input.pipe(parser);
  });
}

module.exports = { buildIndex };
