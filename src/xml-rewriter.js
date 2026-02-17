const sax = require('sax');
const fs = require('fs/promises');
const { createInputStream, createOutputStream } = require('./stream-utils');
const { normalizePatchList, validatePatch, parseFactionList, stringifyFactionList } = require('./patch-engine');
const { buildIndex } = require('./xml-indexer');

const esc = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const escText = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const SKILL_KEYS = ['morale', 'piloting', 'management', 'engineering', 'boarding'];

function hasLicencePatches(normalized) {
  return normalized.licenceOps.addFactionsByType.size > 0
    || normalized.licenceOps.removeFactionsByType.size > 0
    || normalized.licenceOps.addTypes.size > 0
    || normalized.licenceOps.removeTypes.size > 0;
}

function serializeOpenTag(nodeName, attrs) {
  const serialized = Object.entries(attrs).map(([k, v]) => `${k}="${esc(v)}"`).join(' ');
  return serialized ? `<${nodeName} ${serialized}>` : `<${nodeName}>`;
}

async function exportPatchedSave({ sourcePath, outputPath, patches, compress = true, createBackup = true }) {
  patches.forEach(validatePatch);
  const normalized = normalizePatchList(patches);
  const index = await buildIndex(sourcePath);

  const detectedSkillKeys = index.skillsModel?.supportedSkillKeys || [];
  const allowedSkillKeys = new Set([...SKILL_KEYS, ...detectedSkillKeys]);
  for (const [npcId, skillOps] of normalized.npcSkillOps.entries()) {
    for (const key of Object.keys(skillOps)) {
      if (!allowedSkillKeys.has(key)) throw new Error(`Cannot set NPC skill '${key}' for ${npcId}: key not detected in this save`);
    }
  }

  const tmp = `${outputPath}.tmp`;
  if (createBackup) await fs.copyFile(sourcePath, `${sourcePath}.backup`);

  const stats = {
    creditsAnchorsUpdated: 0,
    walletAccountsUpdated: 0,
    blueprintsInserted: 0,
    relationsInserted: 0,
    boostersDeleted: 0,
    licencesInserted: 0,
    playerNamesUpdated: 0,
    modifiedFlagsUpdated: 0,
    npcSkillsUpdated: 0,
    npcSkillsSkippedNoTraits: 0,
    shipCrewSkillsUpdated: 0,
    shipModificationValuesUpdated: 0,
    shipAttributesUpdated: 0,
    officerSkillsUpdated: 0
  };

  await new Promise((resolve, reject) => {
    const parser = sax.createStream(true, { trim: false });
    const input = createInputStream(sourcePath);
    const output = createOutputStream(tmp, compress);

    const stack = [];
    const skipStack = [];
    const relationFactionSeen = new Set();
    const componentStack = [];
    const partCounters = new Map();
    const shipModCounters = new Map();
    const personCounters = new Map();

    let currentFactionId = null;
    let inPlayerFaction = false;

    let inRelations = false;
    let currentRelationsFaction = null;
    let foundRelationTargets = new Set();

    let inBlueprints = false;
    const seenBlueprintWares = new Set();

    let inPlayerLicences = false;
    let playerLicencesSeen = false;
    let playerFactionSeen = false;
    const seenLicenceTypes = new Set();

    let inPlayerComponent = false;
    let playerComponentDepth = -1;
    let inPlayerInventory = false;
    const seenInventoryWares = new Set();

    let inInfo = false;
    let currentShipPeopleId = null;
    let currentShipPersonIndex = -1;
    let currentOfficerId = null;
    let inOfficerTraits = false;
    let currentNpcPatchId = null;
    let inNpcTraits = false;
    let npcSeenSkillTypes = new Set();

    function activeShipId() {
      for (let i = componentStack.length - 1; i >= 0; i -= 1) if (componentStack[i].isShip) return componentStack[i].id;
      return null;
    }

    parser.on('processinginstruction', (pi) => { if (!skipStack.length) output.write(`<?${pi.name} ${pi.body}?>`); });
    parser.on('text', (text) => { if (!skipStack.length) output.write(escText(text)); });
    parser.on('cdata', (text) => { if (!skipStack.length) output.write(`<![CDATA[${text}]]>`); });
    parser.on('comment', (text) => { if (!skipStack.length) output.write(`<!--${text}-->`); });

    parser.on('opentag', (node) => {
      const n = node.name.toLowerCase();
      const attrs = { ...node.attributes };
      stack.push(n);
      const parent = stack[stack.length - 2];

      if (skipStack.length) { skipStack.push(n); return; }

      if (n === 'info') inInfo = true;
      if (n === 'component' && attrs.class === 'player' && !inPlayerComponent) { inPlayerComponent = true; playerComponentDepth = stack.length; }
      if (n === 'inventory' && inPlayerComponent) inPlayerInventory = true;

      if (n === 'faction') {
        currentFactionId = String(attrs.id ?? '');
        inPlayerFaction = currentFactionId === 'player';
        if (inPlayerFaction) playerFactionSeen = true;
        if (normalized.relations.has(currentFactionId)) relationFactionSeen.add(currentFactionId);
      }

      if (n === 'component') {
        const componentId = String(attrs.id || '');
        const className = String(attrs.class || '');
        const isShip = className.startsWith('ship_') && Boolean(componentId);
        componentStack.push({ id: componentId, isShip, className });
        const shipOps = normalized.shipAttrOps.get(componentId);
        if (isShip && shipOps) {
          if (shipOps.owner !== undefined) attrs.owner = shipOps.owner;
          if (shipOps.name !== undefined) attrs.name = shipOps.name;
          if (shipOps.code !== undefined) attrs.code = shipOps.code;
          stats.shipAttributesUpdated += 1;
        }
        if ((className === 'npc' || className === 'computer') && normalized.officerSkillOps.has(componentId)) currentOfficerId = componentId;
        if (className === 'npc' && normalized.npcSkillOps.has(componentId)) { currentNpcPatchId = componentId; npcSeenSkillTypes = new Set(); }
      }

      const shipId = activeShipId();

      if (n === 'player' && inInfo && normalized.setPlayerName !== null) { attrs.name = normalized.setPlayerName; stats.playerNamesUpdated += 1; }
      if (n === 'game' && inInfo && normalized.setModifiedFlag !== null) { attrs.modified = String(normalized.setModifiedFlag); stats.modifiedFlagsUpdated += 1; }
      if (n === 'player' && normalized.setCredits !== null && attrs.money !== undefined) { attrs.money = String(normalized.setCredits); stats.creditsAnchorsUpdated += 1; }
      if (n === 'stat' && normalized.setCredits !== null && attrs.id === 'money_player') { attrs.value = String(normalized.setCredits); stats.creditsAnchorsUpdated += 1; }
      if (n === 'account' && normalized.setCredits !== null && index.credits.playerWalletAccountId && attrs.id === index.credits.playerWalletAccountId) { attrs.amount = String(normalized.setCredits); stats.walletAccountsUpdated += 1; }

      if (n === 'blueprints') inBlueprints = true;
      if (n === 'blueprint' && inBlueprints && parent === 'blueprints') { const ware = String(attrs.ware ?? ''); if (ware) seenBlueprintWares.add(ware); }

      if (n === 'relations' && currentFactionId) { inRelations = true; currentRelationsFaction = currentFactionId; foundRelationTargets = new Set(); }
      if (n === 'relation' && inRelations && parent === 'relations') {
        const targetFaction = String(attrs.faction ?? '');
        foundRelationTargets.add(targetFaction);
        if (currentRelationsFaction === 'player' && normalized.relations.has(targetFaction)) attrs.relation = normalized.relations.get(targetFaction).relation;
        else if (normalized.relations.has(currentRelationsFaction) && targetFaction === 'player') attrs.relation = normalized.relations.get(currentRelationsFaction).relation;
      }
      if (n === 'booster' && inRelations && parent === 'relations') {
        const targetFaction = String(attrs.faction ?? '');
        if (currentRelationsFaction === 'player' && normalized.relations.has(targetFaction)) {
          const relationPatch = normalized.relations.get(targetFaction);
          if (relationPatch.mode === 'hard') { skipStack.push(n); stats.boostersDeleted += 1; return; }
        } else if (normalized.relations.has(currentRelationsFaction) && targetFaction === 'player') {
          const relationPatch = normalized.relations.get(currentRelationsFaction);
          if (relationPatch.mode === 'hard') { skipStack.push(n); stats.boostersDeleted += 1; return; }
        }
      }

      if (n === 'licences' && inPlayerFaction) { inPlayerLicences = true; playerLicencesSeen = true; }
      if (n === 'licence' && inPlayerLicences && parent === 'licences') {
        const typeName = String(attrs.type ?? '');
        seenLicenceTypes.add(typeName);
        if (normalized.licenceOps.removeTypes.has(typeName)) { skipStack.push(n); return; }
        const factions = new Set(parseFactionList(attrs.factions));
        if (normalized.licenceOps.addTypes.has(typeName)) normalized.licenceOps.addTypes.get(typeName).forEach((id) => factions.add(id));
        if (normalized.licenceOps.addFactionsByType.has(typeName)) normalized.licenceOps.addFactionsByType.get(typeName).forEach((id) => factions.add(id));
        if (normalized.licenceOps.removeFactionsByType.has(typeName)) normalized.licenceOps.removeFactionsByType.get(typeName).forEach((id) => factions.delete(id));
        attrs.factions = stringifyFactionList(Array.from(factions));
      }

      if (n === 'ware' && inPlayerInventory && parent === 'inventory') {
        const ware = String(attrs.ware ?? '');
        seenInventoryWares.add(ware);
        if (normalized.inventoryOps.has(ware)) {
          const op = normalized.inventoryOps.get(ware);
          const currentAmount = Number(attrs.amount ?? 0);
          const base = op.set !== null ? op.set : (Number.isFinite(currentAmount) ? currentAmount : 0);
          attrs.amount = String(base + op.add);
        }
      }

      if (n === 'people' && shipId) { currentShipPeopleId = shipId; if (!personCounters.has(shipId)) personCounters.set(shipId, 0); }
      if (n === 'person' && currentShipPeopleId) { currentShipPersonIndex = personCounters.get(currentShipPeopleId) || 0; personCounters.set(currentShipPeopleId, currentShipPersonIndex + 1); }
      if (n === 'skills' && currentShipPeopleId && currentShipPersonIndex >= 0) {
        const shipPatch = normalized.shipCrewSkillOps.get(currentShipPeopleId);
        const patch = shipPatch?.get(currentShipPersonIndex);
        if (patch) {
          for (const [k, v] of Object.entries(patch)) attrs[k] = String(v);
          stats.shipCrewSkillsUpdated += 1;
        }
      }

      if (n === 'traits' && currentOfficerId) inOfficerTraits = true;
      if (n === 'traits' && currentNpcPatchId) inNpcTraits = true;
      if (n === 'skills' && currentOfficerId && inOfficerTraits) {
        const patch = normalized.officerSkillOps.get(currentOfficerId);
        if (patch) {
          for (const [k, v] of Object.entries(patch)) attrs[k] = String(v);
          stats.officerSkillsUpdated += 1;
        }
      }
      if (n === 'skills' && currentNpcPatchId && inNpcTraits) {
        const patch = normalized.npcSkillOps.get(currentNpcPatchId);
        if (patch) {
          for (const [k, v] of Object.entries(patch)) attrs[k] = String(v);
          stats.npcSkillsUpdated += 1;
        }
      }
      if (n === 'skill' && currentNpcPatchId && inNpcTraits) {
        const type = String(attrs.type || '').trim();
        const patch = normalized.npcSkillOps.get(currentNpcPatchId);
        if (type) npcSeenSkillTypes.add(type);
        if (patch && Object.prototype.hasOwnProperty.call(patch, type)) {
          attrs.value = String(patch[type]);
          stats.npcSkillsUpdated += 1;
        }
      }

      if (shipId && ['modification', 'engine', 'paint', 'ship', 'weapon'].includes(n)) {
        const activePartId = componentStack[componentStack.length - 1]?.id || shipId;
        const key = `${activePartId}|${n}`;
        const localIndex = partCounters.get(key) || 0;
        partCounters.set(key, localIndex + 1);

        const globalModIndex = shipModCounters.get(shipId) || 0;
        shipModCounters.set(shipId, globalModIndex + 1);

        const corePatch = normalized.shipCoreModOps.get(shipId)?.[n];
        if (corePatch && activePartId === shipId && ['engine', 'paint', 'ship'].includes(n)) {
          Object.assign(attrs, Object.fromEntries(Object.entries(corePatch).map(([k, v]) => [k, String(v)])));
          stats.shipModificationValuesUpdated += 1;
        }

        const legacyPatch = normalized.shipModificationOps.get(shipId)?.get(globalModIndex);
        if (legacyPatch) {
          Object.assign(attrs, Object.fromEntries(Object.entries(legacyPatch).map(([k, v]) => [k, String(v)])));
          stats.shipModificationValuesUpdated += 1;
        }

        const partPatch = normalized.partModificationOps.get(activePartId)?.get(n)?.get(localIndex);
        if (partPatch) {
          Object.assign(attrs, Object.fromEntries(Object.entries(partPatch).map(([k, v]) => [k, String(v)])));
          stats.shipModificationValuesUpdated += 1;
        }
      }

      output.write(serializeOpenTag(node.name, attrs));
    });

    parser.on('closetag', (name) => {
      const n = name.toLowerCase();
      stack.pop();

      if (skipStack.length) {
        const skipped = skipStack.pop();
        if (skipped !== n) reject(new Error('Internal skip stack mismatch'));
        return;
      }

      if (n === 'relations' && inRelations) {
        if (currentRelationsFaction === 'player') {
          for (const [factionId, relationPatch] of normalized.relations.entries()) {
            if (!foundRelationTargets.has(factionId)) {
              output.write(`<relation faction="${esc(factionId)}" relation="${esc(relationPatch.relation)}"></relation>`);
              stats.relationsInserted += 1;
            }
          }
        } else if (normalized.relations.has(currentRelationsFaction) && !foundRelationTargets.has('player')) {
          output.write(`<relation faction="player" relation="${esc(normalized.relations.get(currentRelationsFaction).relation)}"></relation>`);
          stats.relationsInserted += 1;
        }
        inRelations = false; currentRelationsFaction = null; foundRelationTargets = new Set();
      }

      if (n === 'blueprints' && inBlueprints) {
        for (const ware of normalized.unlockBlueprintWares.values()) {
          if (!seenBlueprintWares.has(ware)) { output.write(`<blueprint ware="${esc(ware)}"></blueprint>`); stats.blueprintsInserted += 1; }
        }
        inBlueprints = false;
      }

      if (n === 'inventory' && inPlayerInventory) {
        for (const [ware, op] of normalized.inventoryOps.entries()) {
          if (!seenInventoryWares.has(ware)) {
            const amount = (op.set !== null ? op.set : 0) + op.add;
            output.write(`<ware ware="${esc(ware)}" amount="${esc(amount)}"></ware>`);
          }
        }
        inPlayerInventory = false;
      }

      if (n === 'licences' && inPlayerLicences) {
        for (const [typeName, factionsSet] of normalized.licenceOps.addTypes.entries()) {
          if (!seenLicenceTypes.has(typeName) && !normalized.licenceOps.removeTypes.has(typeName)) {
            const factions = new Set(factionsSet);
            if (normalized.licenceOps.addFactionsByType.has(typeName)) normalized.licenceOps.addFactionsByType.get(typeName).forEach((id) => factions.add(id));
            if (normalized.licenceOps.removeFactionsByType.has(typeName)) normalized.licenceOps.removeFactionsByType.get(typeName).forEach((id) => factions.delete(id));
            output.write(`<licence type="${esc(typeName)}" factions="${esc(stringifyFactionList(Array.from(factions)))}"/>`);
            stats.licencesInserted += 1;
          }
        }
        for (const [typeName, addSet] of normalized.licenceOps.addFactionsByType.entries()) {
          if (!seenLicenceTypes.has(typeName) && !normalized.licenceOps.removeTypes.has(typeName) && !normalized.licenceOps.addTypes.has(typeName)) {
            output.write(`<licence type="${esc(typeName)}" factions="${esc(stringifyFactionList(Array.from(addSet)))}"/>`);
            stats.licencesInserted += 1;
          }
        }
        inPlayerLicences = false;
      }

      if (n === 'faction') {
        if (inPlayerFaction && !playerLicencesSeen && hasLicencePatches(normalized)) {
          const createdTypes = new Set();
          output.write('<licences>');
          for (const [typeName, addSet] of normalized.licenceOps.addFactionsByType.entries()) {
            if (normalized.licenceOps.removeTypes.has(typeName)) continue;
            output.write(`<licence type="${esc(typeName)}" factions="${esc(stringifyFactionList(Array.from(addSet)))}"/>`);
            createdTypes.add(typeName);
            stats.licencesInserted += 1;
          }
          for (const [typeName, factionsSet] of normalized.licenceOps.addTypes.entries()) {
            if (createdTypes.has(typeName) || normalized.licenceOps.removeTypes.has(typeName)) continue;
            const factions = new Set(factionsSet);
            if (normalized.licenceOps.addFactionsByType.has(typeName)) normalized.licenceOps.addFactionsByType.get(typeName).forEach((id) => factions.add(id));
            if (normalized.licenceOps.removeFactionsByType.has(typeName)) normalized.licenceOps.removeFactionsByType.get(typeName).forEach((id) => factions.delete(id));
            output.write(`<licence type="${esc(typeName)}" factions="${esc(stringifyFactionList(Array.from(factions)))}"/>`);
            stats.licencesInserted += 1;
          }
          output.write('</licences>');
        }
        currentFactionId = null; inPlayerFaction = false;
      }

      if (n === 'traits' && currentNpcPatchId && inNpcTraits) {
        const patch = normalized.npcSkillOps.get(currentNpcPatchId) || {};
        for (const [skillType, value] of Object.entries(patch)) {
          if (!npcSeenSkillTypes.has(skillType)) {
            output.write(`<skill type="${esc(skillType)}" value="${esc(value)}"></skill>`);
            stats.npcSkillsUpdated += 1;
          }
        }
        inNpcTraits = false;
      }
      if (n === 'component') {
        const popped = componentStack.pop();
        if ((popped?.className === 'npc' || popped?.className === 'computer') && currentOfficerId === popped.id) currentOfficerId = null;
        if (popped?.className === 'npc' && currentNpcPatchId === popped.id) { currentNpcPatchId = null; inNpcTraits = false; npcSeenSkillTypes = new Set(); }
      }
      if (n === 'component' && inPlayerComponent && stack.length < playerComponentDepth) { inPlayerComponent = false; playerComponentDepth = -1; }
      if (n === 'person') currentShipPersonIndex = -1;
      if (n === 'people') currentShipPeopleId = null;
      if (n === 'traits') inOfficerTraits = false;
      if (n === 'info') inInfo = false;

      output.write(`</${name}>`);
    });

    parser.on('end', () => {
      for (const factionId of normalized.relations.keys()) if (!relationFactionSeen.has(factionId)) return reject(new Error(`Cannot set relation: faction '${factionId}' not found in save`));
      if (hasLicencePatches(normalized) && !playerFactionSeen) return reject(new Error('Cannot edit licences: <faction id="player"> not found in save'));
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
    walletAccountOccurrences: index.credits.walletAccountOccurrences,
    playerNamePatched: normalized.setPlayerName !== null,
    modifiedFlagPatched: normalized.setModifiedFlag !== null,
    summary: stats
  };
}

module.exports = { exportPatchedSave };
