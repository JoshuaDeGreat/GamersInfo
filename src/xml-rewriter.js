const sax = require('sax');
const fs = require('fs/promises');
const path = require('path');
const { createInputStream, createOutputStream } = require('./stream-utils');
const { normalizePatchList, validatePatch } = require('./patch-engine');

const esc = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const escText = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;');

async function exportPatchedSave({ sourcePath, outputPath, patches, compress = true, createBackup = true }) {
  patches.forEach(validatePatch);
  const normalized = normalizePatchList(patches);

  const tmp = `${outputPath}.tmp`;
  if (createBackup) {
    const ext = path.extname(sourcePath);
    const backupPath = `${sourcePath}.backup${ext}`;
    await fs.copyFile(sourcePath, backupPath);
  }

  await new Promise((resolve, reject) => {
    const parser = sax.createStream(true, { trim: false });
    const input = createInputStream(sourcePath);
    const output = createOutputStream(tmp, compress);

    let skipDepth = 0;
    const stack = [];

    parser.on('processinginstruction', (pi) => {
      if (skipDepth) return;
      output.write(`<?${pi.name} ${pi.body}?>`);
    });

    parser.on('opentag', (node) => {
      stack.push(node.name.toLowerCase());
      if (skipDepth > 0) {
        skipDepth += 1;
        return;
      }

      const attrs = { ...node.attributes };
      const n = node.name.toLowerCase();

      if (['object', 'component', 'ship', 'station'].includes(n)) {
        const objectId = attrs.id || attrs.component || attrs.code;
        if (normalized.deletes.has(objectId)) {
          skipDepth = 1;
          return;
        }
        if (normalized.ownerChanges.has(objectId)) {
          attrs.owner = normalized.ownerChanges.get(objectId);
        }
      }

      if (n === 'account') {
        const owner = (attrs.owner || '').toLowerCase();
        if (owner === 'player' && normalized.credits.has('player')) attrs.money = normalized.credits.get('player');
        if (owner !== 'player' && normalized.credits.has('allOwnedAccounts')) attrs.money = normalized.credits.get('allOwnedAccounts');
      }

      if (n === 'relation') {
        const factionId = attrs.faction || attrs.target || attrs.source;
        if (normalized.factionRep.has(factionId)) attrs.value = normalized.factionRep.get(factionId);
      }

      if (n === 'blueprint' && normalized.unlockBlueprints.has(attrs.id)) {
        attrs.unlocked = '1';
        attrs.owned = '1';
      }

      if (n === 'item' && normalized.inventory.has(attrs.id)) {
        attrs.amount = String(normalized.inventory.get(attrs.id));
      }

      if (n === 'skill') {
        const skillType = (attrs.type || '').toLowerCase();
        for (const rule of normalized.skillRules) {
          if (rule.changes[skillType] !== undefined) attrs.value = String(rule.changes[skillType]);
        }
      }

      const serialized = Object.entries(attrs).map(([k, v]) => `${k}="${esc(v)}"`).join(' ');
      output.write(serialized ? `<${node.name} ${serialized}>` : `<${node.name}>`);
    });

    parser.on('text', (text) => {
      if (!skipDepth) output.write(escText(text));
    });
    parser.on('cdata', (text) => {
      if (!skipDepth) output.write(`<![CDATA[${text}]]>`);
    });
    parser.on('comment', (text) => {
      if (!skipDepth) output.write(`<!--${text}-->`);
    });
    parser.on('closetag', (name) => {
      const _ = stack.pop();
      if (skipDepth > 0) {
        skipDepth -= 1;
        return;
      }
      output.write(`</${name}>`);
    });

    parser.on('end', () => output.end());
    parser.on('error', reject);
    input.on('error', reject);
    output.on('error', reject);
    output.on('finish', resolve);

    input.pipe(parser);
  });

  await fs.rename(tmp, outputPath);
  return { outputPath, backupCreated: createBackup };
}

module.exports = { exportPatchedSave };
