const sax = require('sax');
const fs = require('fs/promises');
const { createInputStream, createOutputStream } = require('./stream-utils');
const { normalizePatchList, validatePatch, parseFactionList, stringifyFactionList } = require('./patch-engine');
const { buildIndex } = require('./xml-indexer');

const esc = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const escText = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const SKILL_KEYS = ['morale', 'piloting', 'management', 'engineering', 'boarding'];
const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

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

function patchNpcComponentXml(componentXml, skillPatch) {
  const traitsMatch = componentXml.match(/<traits\b[^>]*>[\s\S]*?<\/traits>/i);
  if (!traitsMatch) return { xml: componentXml, applied: false, reason: 'no_traits' };
  const traitsXml = traitsMatch[0];

  if (/<skills\b/i.test(traitsXml)) {
    const patchedTraits = traitsXml.replace(/<skills\b([^>]*?)(\/?)>/i, (full, attrChunk, selfClose) => {
      const attrs = {};
      for (const match of attrChunk.matchAll(/([\w:-]+)="([^"]*)"/g)) attrs[match[1]] = match[2];
      for (const [key, value] of Object.entries(skillPatch)) attrs[key] = String(value);
      const serialized = Object.entries(attrs).map(([k, v]) => `${k}="${esc(v)}"`).join(' ');
      return `<skills${serialized ? ` ${serialized}` : ''}${selfClose ? '/>' : '>'}`;
    });
    return { xml: componentXml.replace(traitsXml, patchedTraits), applied: true, reason: 'skills_attributes' };
  }

  if (/<skill\b/i.test(traitsXml)) {
    const updated = { ...skillPatch };
    let patchedTraits = traitsXml.replace(/<skill\b([^>]*?)(\/?>\s*(?:<\/skill>)?)/gi, (full, attrChunk) => {
      const attrs = {};
      for (const match of attrChunk.matchAll(/([\w:-]+)="([^"]*)"/g)) attrs[match[1]] = match[2];
      const type = String(attrs.type || '').trim();
      if (Object.prototype.hasOwnProperty.call(updated, type)) {
        attrs.value = String(updated[type]);
        delete updated[type];
      }
      const serialized = Object.entries(attrs).map(([k, v]) => `${k}="${esc(v)}"`).join(' ');
      return `<skill ${serialized}/>`;
    });

    if (Object.keys(updated).length) {
      const inserts = Object.entries(updated).map(([type, value]) => `<skill type="${esc(type)}" value="${esc(value)}"/>`).join('');
      patchedTraits = patchedTraits.replace(/<\/traits>$/i, `${inserts}</traits>`);
    }

    return { xml: componentXml.replace(traitsXml, patchedTraits), applied: true, reason: 'skill_nodes' };
  }

  return { xml: componentXml, applied: false, reason: 'unknown_traits_structure' };
}


function patchShipComponentXml(componentXml, crewPatchesByIndex, modPatchesByIndex) {
  let xml = componentXml;
  let crewUpdated = 0;
  let modUpdated = 0;

  const peopleMatches = Array.from(xml.matchAll(/<person\b[^>]*>[\s\S]*?<\/person>/gi));
  for (const [crewIndex, skills] of (crewPatchesByIndex?.entries?.() || [])) {
    const match = peopleMatches[crewIndex];
    if (!match) continue;
    const personXml = match[0];
    const patchedPerson = personXml.replace(/<skills\b([^>]*?)(\/?)>/i, (full, attrChunk, selfClose) => {
      const attrs = {};
      for (const m of String(attrChunk || '').matchAll(/([\w:-]+)="([^"]*)"/g)) attrs[m[1]] = m[2];
      for (const [k, v] of Object.entries(skills || {})) attrs[k] = String(v);
      const serialized = Object.entries(attrs).map(([k, v]) => `${k}="${esc(v)}"`).join(' ');
      return `<skills${serialized ? ` ${serialized}` : ''}${selfClose ? '/>' : '>'}`;
    });
    if (patchedPerson !== personXml) {
      xml = xml.replace(personXml, patchedPerson);
      crewUpdated += 1;
    }
  }

  const modTagMatches = Array.from(xml.matchAll(/<(modification|engine|ship|weapon|paint)\b([^>]*)>/gi));
  for (const [modIndex, values] of (modPatchesByIndex?.entries?.() || [])) {
    const match = modTagMatches[modIndex];
    if (!match) continue;
    const fullTag = match[0];
    const tagName = match[1];
    const attrChunk = match[2] || '';
    const attrs = {};
    for (const m of String(attrChunk).matchAll(/([\w:-]+)="([^"]*)"/g)) attrs[m[1]] = m[2];
    for (const [k, v] of Object.entries(values || {})) attrs[k] = String(v);
    const serialized = Object.entries(attrs).map(([k, v]) => `${k}="${esc(v)}"`).join(' ');
    const replacement = `<${tagName}${serialized ? ` ${serialized}` : ''}>`;
    xml = xml.replace(fullTag, replacement);
    modUpdated += 1;
  }

  return { xml, crewUpdated, modUpdated };
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
    shipModificationValuesUpdated: 0
  };

  await new Promise((resolve, reject) => {
    const parser = sax.createStream(true, { trim: false });
    const input = createInputStream(sourcePath);
    const output = createOutputStream(tmp, compress);

    const stack = [];
    const skipStack = [];
    const relationFactionSeen = new Set();

    let currentFactionId = null;
    let inPlayerFaction = false;

    let inRelations = false;
    let currentRelationsFaction = null;
    let foundRelationTargets = new Set();
    let foundBoosterTargets = new Set();

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
    let npcCapture = null;
    let shipCapture = null;

    function emit(text) {
      if (npcCapture) npcCapture.parts.push(text);
      else if (shipCapture) shipCapture.parts.push(text);
      else if (!skipStack.length) output.write(text);
    }

    parser.on('processinginstruction', (pi) => {
      emit(`<?${pi.name} ${pi.body}?>`);
    });

    parser.on('opentag', (node) => {
      const n = node.name.toLowerCase();
      const attrs = { ...node.attributes };
      stack.push(n);
      const parent = stack[stack.length - 2];

      if (n === 'info') inInfo = true;

      if (npcCapture) {
        emit(serializeOpenTag(node.name, attrs));
        return;
      }
      if (shipCapture) {
        emit(serializeOpenTag(node.name, attrs));
        return;
      }

      if (skipStack.length) {
        skipStack.push(n);
        return;
      }

      if (n === 'component' && attrs.class === 'npc' && attrs.id && normalized.npcSkillOps.has(String(attrs.id))) {
        npcCapture = { depth: stack.length, npcId: String(attrs.id), parts: [serializeOpenTag(node.name, attrs)] };
        return;
      }
      if (n === 'component' && attrs.id && (normalized.shipCrewSkillOps.has(String(attrs.id)) || normalized.shipModificationOps.has(String(attrs.id)))) {
        shipCapture = { depth: stack.length, shipId: String(attrs.id), parts: [serializeOpenTag(node.name, attrs)] };
        return;
      }

      if (n === 'component' && attrs.class === 'player' && !inPlayerComponent) {
        inPlayerComponent = true;
        playerComponentDepth = stack.length;
      }
      if (n === 'inventory' && inPlayerComponent) {
        inPlayerInventory = true;
      }

      if (n === 'faction') {
        currentFactionId = String(attrs.id ?? '');
        inPlayerFaction = currentFactionId === 'player';
        if (inPlayerFaction) playerFactionSeen = true;
        if (normalized.relations.has(currentFactionId)) relationFactionSeen.add(currentFactionId);
      }

      if (n === 'player' && inInfo && normalized.setPlayerName !== null) {
        attrs.name = normalized.setPlayerName;
        stats.playerNamesUpdated += 1;
      }
      if (n === 'game' && inInfo && normalized.setModifiedFlag !== null) {
        attrs.modified = String(normalized.setModifiedFlag);
        stats.modifiedFlagsUpdated += 1;
      }

      if (n === 'player' && normalized.setCredits !== null && attrs.money !== undefined) {
        attrs.money = String(normalized.setCredits);
        stats.creditsAnchorsUpdated += 1;
      }
      if (n === 'stat' && normalized.setCredits !== null && attrs.id === 'money_player') {
        attrs.value = String(normalized.setCredits);
        stats.creditsAnchorsUpdated += 1;
      }
      if (n === 'account' && normalized.setCredits !== null && index.credits.playerWalletAccountId && attrs.id === index.credits.playerWalletAccountId) {
        attrs.amount = String(normalized.setCredits);
        stats.walletAccountsUpdated += 1;
      }

      if (n === 'blueprints') inBlueprints = true;
      if (n === 'blueprint' && inBlueprints && parent === 'blueprints') {
        const ware = String(attrs.ware ?? '');
        if (ware) seenBlueprintWares.add(ware);
      }

      if (n === 'relations' && currentFactionId) {
        inRelations = true;
        currentRelationsFaction = currentFactionId;
        foundRelationTargets = new Set();
        foundBoosterTargets = new Set();
      }
      if (n === 'relation' && inRelations && parent === 'relations') {
        const targetFaction = String(attrs.faction ?? '');
        foundRelationTargets.add(targetFaction);

        if (currentRelationsFaction === 'player' && normalized.relations.has(targetFaction)) {
          attrs.relation = normalized.relations.get(targetFaction).relation;
        } else if (normalized.relations.has(currentRelationsFaction) && targetFaction === 'player') {
          attrs.relation = normalized.relations.get(currentRelationsFaction).relation;
        }
      }

      if (n === 'booster' && inRelations && parent === 'relations') {
        const targetFaction = String(attrs.faction ?? '');
        foundBoosterTargets.add(targetFaction);

        if (currentRelationsFaction === 'player' && normalized.relations.has(targetFaction)) {
          const relationPatch = normalized.relations.get(targetFaction);
          if (relationPatch.mode === 'hard') {
            skipStack.push(n);
            stats.boostersDeleted += 1;
            return;
          }
        } else if (normalized.relations.has(currentRelationsFaction) && targetFaction === 'player') {
          const relationPatch = normalized.relations.get(currentRelationsFaction);
          if (relationPatch.mode === 'hard') {
            skipStack.push(n);
            stats.boostersDeleted += 1;
            return;
          }
        }
      }

      if (n === 'licences' && inPlayerFaction) {
        inPlayerLicences = true;
        playerLicencesSeen = true;
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

      emit(serializeOpenTag(node.name, attrs));
    });

    parser.on('text', (text) => { emit(escText(text)); });
    parser.on('cdata', (text) => { emit(`<![CDATA[${text}]]>`); });
    parser.on('comment', (text) => { emit(`<!--${text}-->`); });

    parser.on('closetag', (name) => {
      const n = name.toLowerCase();
      stack.pop();

      if (npcCapture) {
        npcCapture.parts.push(`</${name}>`);
        if (n === 'component' && stack.length < npcCapture.depth) {
          const patch = normalized.npcSkillOps.get(npcCapture.npcId) || {};
          const patched = patchNpcComponentXml(npcCapture.parts.join(''), patch);
          if (patched.applied) stats.npcSkillsUpdated += 1;
          if (!patched.applied && patched.reason === 'no_traits') stats.npcSkillsSkippedNoTraits += 1;
          output.write(patched.xml);
          npcCapture = null;
        }
        return;
      }

      if (shipCapture) {
        shipCapture.parts.push(`</${name}>`);
        if (n === 'component' && stack.length < shipCapture.depth) {
          const crewPatch = normalized.shipCrewSkillOps.get(shipCapture.shipId) || new Map();
          const modPatch = normalized.shipModificationOps.get(shipCapture.shipId) || new Map();
          const patched = patchShipComponentXml(shipCapture.parts.join(''), crewPatch, modPatch);
          output.write(patched.xml);
          shipCapture = null;
        }
        return;
      }

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
        inRelations = false;
        currentRelationsFaction = null;
        foundRelationTargets = new Set();
      }

      if (n === 'blueprints' && inBlueprints) {
        for (const ware of normalized.unlockBlueprintWares.values()) {
          if (!seenBlueprintWares.has(ware)) {
            output.write(`<blueprint ware="${esc(ware)}"></blueprint>`);
            stats.blueprintsInserted += 1;
          }
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
            if (normalized.licenceOps.addFactionsByType.has(typeName)) {
              normalized.licenceOps.addFactionsByType.get(typeName).forEach((id) => factions.add(id));
            }
            if (normalized.licenceOps.removeFactionsByType.has(typeName)) {
              normalized.licenceOps.removeFactionsByType.get(typeName).forEach((id) => factions.delete(id));
            }
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

      if (n === 'info') inInfo = false;

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
            if (normalized.licenceOps.addFactionsByType.has(typeName)) {
              normalized.licenceOps.addFactionsByType.get(typeName).forEach((id) => factions.add(id));
            }
            if (normalized.licenceOps.removeFactionsByType.has(typeName)) {
              normalized.licenceOps.removeFactionsByType.get(typeName).forEach((id) => factions.delete(id));
            }
            output.write(`<licence type="${esc(typeName)}" factions="${esc(stringifyFactionList(Array.from(factions)))}"/>`);
            stats.licencesInserted += 1;
          }

          output.write('</licences>');
        }
        currentFactionId = null;
        inPlayerFaction = false;
      }

      output.write(`</${name}>`);
      if (n === 'component' && inPlayerComponent && stack.length < playerComponentDepth) {
        inPlayerComponent = false;
        playerComponentDepth = -1;
      }
    });

    parser.on('end', () => {
      for (const factionId of normalized.relations.keys()) {
        if (!relationFactionSeen.has(factionId)) return reject(new Error(`Cannot set relation: faction '${factionId}' not found in save`));
      }
      if (hasLicencePatches(normalized) && !playerFactionSeen) {
        return reject(new Error('Cannot edit licences: <faction id="player"> not found in save'));
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

  if (normalized.shipCrewSkillOps.size || normalized.shipModificationOps.size) {
    let rewritten = await fs.readFile(outputPath, 'utf8');
    for (const shipId of new Set([...normalized.shipCrewSkillOps.keys(), ...normalized.shipModificationOps.keys()])) {
      const crewPatch = normalized.shipCrewSkillOps.get(shipId) || new Map();
      const modPatch = normalized.shipModificationOps.get(shipId) || new Map();
      const re = new RegExp(`<component\\b[^>]*id="${escapeRegExp(shipId)}"[^>]*>[\\s\\S]*?<\\/component>`, 'i');
      const m = rewritten.match(re);
      if (!m) continue;
      const patched = patchShipComponentXml(m[0], crewPatch, modPatch);
      stats.shipCrewSkillsUpdated += patched.crewUpdated;
      stats.shipModificationValuesUpdated += patched.modUpdated;
      rewritten = rewritten.replace(m[0], patched.xml);
    }
    await fs.writeFile(outputPath, rewritten, 'utf8');
  }

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
