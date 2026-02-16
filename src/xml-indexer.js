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
      licences: []
    };

    const stack = [];
    let currentFactionId = null;
    let inPlayerFaction = false;
    let inPlayerLicences = false;

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
      }

      if (name === 'licence' && inPlayerLicences) {
        model.licences.push({
          type: String(attrs.type ?? ''),
          factions: String(attrs.factions ?? '')
        });
      }
    });

    parser.on('closetag', (tagName) => {
      const name = tagName.toLowerCase();
      stack.pop();

      if (name === 'licences') inPlayerLicences = false;
      if (name === 'faction') {
        currentFactionId = null;
        inPlayerFaction = false;
      }
    });

    parser.on('error', reject);
    parser.on('end', () => {
      model.blueprints.owned = Array.from(new Set(model.blueprints.owned));
      resolve(model);
    });

    input.on('error', reject);
    input.pipe(parser);
  });
}

module.exports = { buildIndex };
