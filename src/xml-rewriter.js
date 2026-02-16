const sax = require('sax');
const fs = require('fs/promises');
const { createInputStream, createOutputStream } = require('./stream-utils');
const { normalizePatchList, validatePatch, parseFactionList, stringifyFactionList } = require('./patch-engine');
const { buildIndex } = require('./xml-indexer');

const esc = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const escText = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;');

function serializeOpenTag(nodeName, attrs) {
  const serialized = Object.entries(attrs).map(([k, v]) => `${k}="${esc(v)}"`).join(' ');
  return serialized ? `<${nodeName} ${serialized}>` : `<${nodeName}>`;
}

async function exportPatchedSave({ sourcePath, outputPath, patches, compress = true, createBackup = true }) {
  patches.forEach(validatePatch);
  const normalized = normalizePatchList(patches);
  const index = await buildIndex(sourcePath);

  const tmp = `${outputPath}.tmp`;
  if (createBackup) {
    await fs.copyFile(sourcePath, `${sourcePath}.backup`);
  }

  await new Promise((resolve, reject) => {
    const parser = sax.createStream(true, { trim: false });
    const input = createInputStream(sourcePath);
    const output = createOutputStream(tmp, compress);

    const stack = [];
    const skipStack = [];

    const relationPatches = normalized.relations;
    const relationFactionSeen = new Set();

    let currentFactionId = null;
    let inPlayerFaction = false;

    let inRelations = false;
    let currentRelationsFaction = null;
    let foundRelationTargets = new Set();

    let inBlueprints = false;
    const seenBlueprintWares = new Set();

    let inPlayerLicences = false;
    const seenLicenceTypes = new Set();

    parser.on('processinginstruction', (pi) => {
      if (skipStack.length) return;
      output.write(`<?${pi.name} ${pi.body}?>`);
    });

    parser.on('opentag', (node) => {
      const n = node.name.toLowerCase();
      const attrs = { ...node.attributes };
      stack.push(n);

      const parent = stack[stack.length - 2];

      if (skipStack.length) {
        skipStack.push(n);
        return;
      }

      if (n === 'faction') {
        currentFactionId = String(attrs.id ?? '');
        inPlayerFaction = currentFactionId === 'player';
        if (relationPatches.has(currentFactionId)) relationFactionSeen.add(currentFactionId);
      }

      if (n === 'player' && normalized.setCredits !== null && attrs.money !== undefined) {
        attrs.money = String(normalized.setCredits);
      }

      if (n === 'stat' && normalized.setCredits !== null && attrs.id === 'money_player') {
        attrs.value = String(normalized.setCredits);
      }

      if (n === 'account' && normalized.setCredits !== null && index.credits.playerWalletAccountId && attrs.id === index.credits.playerWalletAccountId) {
        attrs.amount = String(normalized.setCredits);
      }

      if (n === 'blueprints') {
        inBlueprints = true;
      }

      if (n === 'blueprint' && inBlueprints && parent === 'blueprints') {
        const ware = String(attrs.ware ?? '');
        if (ware) seenBlueprintWares.add(ware);
      }

      if (n === 'relations' && currentFactionId) {
        inRelations = true;
        currentRelationsFaction = currentFactionId;
        foundRelationTargets = new Set();
      }

      if (n === 'relation' && inRelations && parent === 'relations') {
        const targetFaction = String(attrs.faction ?? '');
        foundRelationTargets.add(targetFaction);

        if (currentRelationsFaction === 'player' && relationPatches.has(targetFaction)) {
          attrs.relation = relationPatches.get(targetFaction);
        } else if (relationPatches.has(currentRelationsFaction) && targetFaction === 'player') {
          attrs.relation = relationPatches.get(currentRelationsFaction);
        }
      }

      if (n === 'licences' && inPlayerFaction) {
        inPlayerLicences = true;
      }

      if (n === 'licence' && inPlayerLicences && parent === 'licences') {
        const typeName = String(attrs.type ?? '');
        seenLicenceTypes.add(typeName);

        if (normalized.licenceOps.removeTypes.has(typeName)) {
          skipStack.push(n);
          return;
        }

        const factions = new Set(parseFactionList(attrs.factions));
        if (normalized.licenceOps.addTypes.has(typeName)) {
          normalized.licenceOps.addTypes.get(typeName).forEach((id) => factions.add(id));
        }
        if (normalized.licenceOps.addFactionsByType.has(typeName)) {
          normalized.licenceOps.addFactionsByType.get(typeName).forEach((id) => factions.add(id));
        }
        if (normalized.licenceOps.removeFactionsByType.has(typeName)) {
          normalized.licenceOps.removeFactionsByType.get(typeName).forEach((id) => factions.delete(id));
        }

        attrs.factions = stringifyFactionList(Array.from(factions));
      }

      output.write(serializeOpenTag(node.name, attrs));
    });

    parser.on('text', (text) => {
      if (!skipStack.length) output.write(escText(text));
    });

    parser.on('cdata', (text) => {
      if (!skipStack.length) output.write(`<![CDATA[${text}]]>`);
    });

    parser.on('comment', (text) => {
      if (!skipStack.length) output.write(`<!--${text}-->`);
    });

    parser.on('closetag', (name) => {
      const n = name.toLowerCase();
      stack.pop();

      if (skipStack.length) {
        const skipped = skipStack.pop();
        if (skipped !== n) {
          reject(new Error('Internal skip stack mismatch'));
        }
        return;
      }

      if (n === 'relations' && inRelations) {
        if (currentRelationsFaction === 'player') {
          for (const [factionId, relationValue] of relationPatches.entries()) {
            if (!foundRelationTargets.has(factionId)) {
              output.write(`<relation faction="${esc(factionId)}" relation="${esc(relationValue)}"></relation>`);
            }
          }
        } else if (relationPatches.has(currentRelationsFaction) && !foundRelationTargets.has('player')) {
          output.write(`<relation faction="player" relation="${esc(relationPatches.get(currentRelationsFaction))}"></relation>`);
        }

        inRelations = false;
        currentRelationsFaction = null;
        foundRelationTargets = new Set();
      }

      if (n === 'blueprints' && inBlueprints) {
        for (const ware of normalized.unlockBlueprintWares.values()) {
          if (!seenBlueprintWares.has(ware)) {
            output.write(`<blueprint ware="${esc(ware)}"></blueprint>`);
          }
        }
        inBlueprints = false;
      }

      if (n === 'licences' && inPlayerLicences) {
        for (const [typeName, factionsSet] of normalized.licenceOps.addTypes.entries()) {
          if (!seenLicenceTypes.has(typeName) && !normalized.licenceOps.removeTypes.has(typeName)) {
            output.write(`<licence type="${esc(typeName)}" factions="${esc(stringifyFactionList(Array.from(factionsSet)))}"></licence>`);
          }
        }
        for (const [typeName, addSet] of normalized.licenceOps.addFactionsByType.entries()) {
          if (!seenLicenceTypes.has(typeName) && !normalized.licenceOps.removeTypes.has(typeName)) {
            output.write(`<licence type="${esc(typeName)}" factions="${esc(stringifyFactionList(Array.from(addSet)))}"></licence>`);
          }
        }
        inPlayerLicences = false;
      }

      output.write(`</${name}>`);

      if (n === 'faction') {
        currentFactionId = null;
        inPlayerFaction = false;
      }
    });

    parser.on('end', () => {
      for (const factionId of relationPatches.keys()) {
        if (!relationFactionSeen.has(factionId)) {
          reject(new Error(`Cannot set relation: faction '${factionId}' not found in save`));
          return;
        }
      }
      output.end();
    });

    parser.on('error', reject);
    input.on('error', reject);
    output.on('error', reject);
    output.on('finish', resolve);

    input.pipe(parser);
  }).catch(async (err) => {
    await fs.rm(tmp, { force: true });
    throw err;
  });

  await fs.rename(tmp, outputPath);

  return {
    outputPath,
    backupCreated: createBackup,
    creditsPatched: normalized.setCredits !== null,
    walletAccountId: index.credits.playerWalletAccountId,
    walletAccountOccurrences: index.credits.walletAccountOccurrences
  };
}

module.exports = { exportPatchedSave };
