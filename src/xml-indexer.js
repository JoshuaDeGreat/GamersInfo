const sax = require('sax');
const { createInputStream } = require('./stream-utils');

async function buildIndex(filePath) {
  return new Promise((resolve, reject) => {
    const parser = sax.createStream(true, { trim: true });
    const input = createInputStream(filePath);

    const model = {
      metadata: { filePath, parsedAt: new Date().toISOString(), saveName: '', saveDate: '' },
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
      relations: { player: [], byFaction: {} },
      licences: [],
      licencesModel: {
        playerFactionFound: false,
        licencesBlockFound: false,
        licencesByType: {},
        allLicenceTypes: [],
        allFactionsInLicences: []
      },
      inventory: { player: {}, playerList: [] }
    };

    const stack = [];
    let currentFactionId = null;
    let inPlayerFaction = false;
    let inPlayerLicences = false;
    let inPlayerComponent = false;
    let playerComponentDepth = -1;
    let inPlayerInventory = false;

    parser.on('opentag', (node) => {
      const name = node.name.toLowerCase();
      const attrs = node.attributes;
      stack.push(name);

      if (name === 'save' && attrs.name !== undefined && stack.includes('info')) {
        model.metadata.saveName = String(attrs.name);
        model.metadata.saveDate = String(attrs.date ?? '');
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

      if (name === 'licences' && inPlayerFaction) {
        inPlayerLicences = true;
        model.licencesModel.licencesBlockFound = true;
      }

      if (name === 'component' && attrs.class === 'player' && !inPlayerComponent) {
        inPlayerComponent = true;
        playerComponentDepth = stack.length;
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
      if (name === 'inventory') inPlayerInventory = false;
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
      resolve(model);
    });

    input.on('error', reject);
    input.pipe(parser);
  });
}

module.exports = { buildIndex };
