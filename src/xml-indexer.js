const sax = require('sax');
const { createInputStream } = require('./stream-utils');

async function buildIndex(filePath) {
  return new Promise((resolve, reject) => {
    const parser = sax.createStream(true, { trim: true });
    const input = createInputStream(filePath);
    const model = {
      metadata: { filePath, parsedAt: new Date().toISOString() },
      accounts: [],
      relations: [],
      npcs: [],
      blueprints: [],
      inventory: [],
      objects: []
    };

    let currentNpc = null;

    parser.on('opentag', (node) => {
      const n = node.name.toLowerCase();
      const a = node.attributes;

      if (n === 'account') {
        model.accounts.push({
          id: a.id || '',
          owner: a.owner || '',
          money: Number(a.money || a.credits || 0),
          type: a.type || 'unknown'
        });
      }

      if (n === 'relation' && (a.source === 'player' || a.target === 'player' || a.owner === 'player')) {
        model.relations.push({
          factionId: a.faction || a.target || a.source || '',
          value: Number(a.value || 0)
        });
      }

      if (n === 'npc' || n === 'person' || n === 'crew') {
        currentNpc = {
          id: a.id || '',
          name: a.name || 'Unnamed',
          role: a.role || 'crew',
          owner: a.owner || '',
          assignedTo: a.assignedto || a.ship || a.station || '',
          skills: {}
        };
      }

      if (currentNpc && n === 'skill') {
        currentNpc.skills[(a.type || 'unknown').toLowerCase()] = Number(a.value || 0);
      }

      if (n === 'blueprint') {
        model.blueprints.push({ id: a.id || '', unlocked: (a.unlocked || a.owned || '0') === '1', category: a.category || 'other' });
      }

      if (n === 'item' && (a.container === 'inventory' || a.owner === 'player')) {
        model.inventory.push({ itemId: a.id || '', amount: Number(a.amount || 0) });
      }

      if (['object', 'component', 'ship', 'station'].includes(n)) {
        const id = a.id || a.component || a.code;
        if (id) {
          model.objects.push({
            objectId: id,
            code: a.code || id,
            class: a.class || n,
            owner: a.owner || '',
            sector: a.sector || 'unknown'
          });
        }
      }
    });

    parser.on('closetag', (name) => {
      const n = name.toLowerCase();
      if (currentNpc && (n === 'npc' || n === 'person' || n === 'crew')) {
        model.npcs.push(currentNpc);
        currentNpc = null;
      }
    });

    parser.on('error', reject);
    parser.on('end', () => resolve(model));

    input.on('error', reject);
    input.pipe(parser);
  });
}

module.exports = { buildIndex };
