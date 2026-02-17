function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function repUiToFloatString(repUI) {
  const value = clamp(Number(repUI) / 30, -1, 1);
  if (Number.isInteger(value)) return String(value);
  return Number(value.toFixed(6)).toString();
}

function normalizeRelationMode(mode) {
  if (mode === 'soft' || mode === 'setBooster') return mode;
  return 'hard';
}

function parseFactionList(value = '') {
  return value.split(/\s+/).map((item) => item.trim()).filter(Boolean);
}

function stringifyFactionList(list) {
  return Array.from(new Set(list)).sort().join(' ');
}

function resolveLicenceTypeName(patch) {
  return String(patch.typeName ?? patch.licenceType ?? patch.targetType ?? '').trim();
}

function validateLicenceTypeName(opName, typeName) {
  if (!typeName) throw new Error(`${opName}.type must be non-empty`);
  if (/[\"]/ .test(typeName)) throw new Error(`${opName}.type must not contain quotes`);
}

function validateSkillMap(opName, skills) {
  if (!skills || typeof skills !== 'object') throw new Error(`${opName}.skills must be an object`);
  const allowed = new Set(['morale', 'piloting', 'management', 'engineering', 'boarding']);
  for (const [key, value] of Object.entries(skills)) {
    if (!allowed.has(key)) throw new Error(`${opName}.skills has unsupported key: ${key}`);
    if (!Number.isFinite(Number(value))) throw new Error(`${opName}.skills.${key} must be numeric`);
  }
}

function validatePatch(patch) {
  if (!patch || typeof patch !== 'object') throw new Error('Patch must be an object');

  switch (patch.type) {
    case 'SetCredits':
      if (!Number.isInteger(patch.value) || patch.value < 0) throw new Error('SetCredits.value must be an integer >= 0');
      break;
    case 'UnlockBlueprintWares':
      if (!Array.isArray(patch.wares) || patch.wares.some((ware) => typeof ware !== 'string' || !ware.trim())) throw new Error('UnlockBlueprintWares.wares must be non-empty strings');
      break;
    case 'SetFactionRep':
    case 'SetFactionRelation':
      if (typeof patch.factionId !== 'string' || !patch.factionId.trim()) throw new Error('SetFactionRelation.factionId must be non-empty');
      if (typeof patch.repUI !== 'number' || Number.isNaN(patch.repUI) || patch.repUI < -30 || patch.repUI > 30) throw new Error('SetFactionRelation.repUI must be a number in -30..30');
      if (patch.mode !== undefined && !['hard', 'soft', 'setBooster'].includes(patch.mode)) throw new Error('SetFactionRelation.mode must be hard|soft|setBooster when provided');
      break;
    case 'AddLicenceFaction':
    case 'RemoveLicenceFaction': {
      const typeName = resolveLicenceTypeName(patch);
      validateLicenceTypeName(patch.type, typeName);
      if (typeof patch.factionId !== 'string' || !patch.factionId.trim()) throw new Error(`${patch.type}.factionId must be non-empty`);
      break;
    }
    case 'AddLicenceType': {
      const typeName = resolveLicenceTypeName(patch);
      validateLicenceTypeName('AddLicenceType', typeName);
      if (!Array.isArray(patch.factions) || patch.factions.some((id) => typeof id !== 'string' || !id.trim())) throw new Error('AddLicenceType.factions must be strings when provided');
      break;
    }
    case 'RemoveLicenceType':
      validateLicenceTypeName('RemoveLicenceType', resolveLicenceTypeName(patch));
      break;
    case 'SetInventoryItem':
    case 'AddInventoryItem':
      if (typeof patch.ware !== 'string' || !patch.ware.trim()) throw new Error(`${patch.type}.ware must be non-empty`);
      if (!Number.isInteger(patch.amount) || patch.amount < 0) throw new Error(`${patch.type}.amount must be integer >= 0`);
      break;
    case 'SetPlayerName': {
      if (typeof patch.name !== 'string') throw new Error('SetPlayerName.name must be a string');
      const name = patch.name.trim();
      if (!name) throw new Error('SetPlayerName.name must be non-empty');
      if (name.length > 64) throw new Error('SetPlayerName.name must be 1-64 chars');
      break;
    }
    case 'SetModifiedFlag':
      if (!(patch.value === 0 || patch.value === 1)) throw new Error('SetModifiedFlag.value must be 0 or 1');
      break;
    case 'SetNpcSkills':
      if (typeof patch.npcId !== 'string' || !patch.npcId.trim()) throw new Error('SetNpcSkills.npcId must be non-empty');
      validateSkillMap('SetNpcSkills', patch.skills);
      break;
    case 'SetShipCrewSkills':
    case 'SetCrewSkills':
      if (typeof patch.shipId !== 'string' || !patch.shipId.trim()) throw new Error(`${patch.type}.shipId must be non-empty`);
      if (!Number.isInteger(patch.personIndex ?? patch.crewIndex) || (patch.personIndex ?? patch.crewIndex) < 0) throw new Error(`${patch.type}.personIndex/crewIndex must be integer >= 0`);
      validateSkillMap(patch.type, patch.skills);
      break;
    case 'SetOfficerSkills':
      if (typeof patch.officerComponentId !== 'string' || !patch.officerComponentId.trim()) throw new Error('SetOfficerSkills.officerComponentId must be non-empty');
      validateSkillMap('SetOfficerSkills', patch.skills);
      break;
    case 'ChangeOwner':
      if (typeof patch.objectId !== 'string' || !patch.objectId.trim()) throw new Error('ChangeOwner.objectId must be non-empty');
      if (typeof patch.newOwnerFactionId !== 'string' || !patch.newOwnerFactionId.trim()) throw new Error('ChangeOwner.newOwnerFactionId must be non-empty');
      break;
    case 'SetShipName':
      if (typeof patch.shipId !== 'string' || !patch.shipId.trim()) throw new Error('SetShipName.shipId must be non-empty');
      if (typeof patch.name !== 'string') throw new Error('SetShipName.name must be string');
      break;
    case 'SetShipCode':
      if (typeof patch.shipId !== 'string' || !patch.shipId.trim()) throw new Error('SetShipCode.shipId must be non-empty');
      if (typeof patch.code !== 'string') throw new Error('SetShipCode.code must be string');
      break;
    case 'SetShipCoreMods':
      if (typeof patch.shipId !== 'string' || !patch.shipId.trim()) throw new Error('SetShipCoreMods.shipId must be non-empty');
      if (!patch.core || typeof patch.core !== 'object') throw new Error('SetShipCoreMods.core must be an object');
      break;
    case 'SetPartModification':
      if (typeof patch.partComponentId !== 'string' || !patch.partComponentId.trim()) throw new Error('SetPartModification.partComponentId must be non-empty');
      if (typeof patch.tagType !== 'string' || !patch.tagType.trim()) throw new Error('SetPartModification.tagType must be non-empty');
      if (!Number.isInteger(patch.localIndex) || patch.localIndex < 0) throw new Error('SetPartModification.localIndex must be integer >= 0');
      if (!patch.attrs || typeof patch.attrs !== 'object') throw new Error('SetPartModification.attrs must be object');
      break;
    case 'SetShipModificationValues':
      if (typeof patch.shipId !== 'string' || !patch.shipId.trim()) throw new Error('SetShipModificationValues.shipId must be non-empty');
      if (!Number.isInteger(patch.modIndex) || patch.modIndex < 0) throw new Error('SetShipModificationValues.modIndex must be integer >= 0');
      if (!patch.values || typeof patch.values !== 'object') throw new Error('SetShipModificationValues.values must be an object');
      break;
    default:
      throw new Error(`Unsupported patch type: ${patch.type}`);
  }
}

function normalizePatchList(patches = []) {
  const normalized = {
    setCredits: null,
    unlockBlueprintWares: new Set(),
    relations: new Map(),
    licenceOps: { addFactionsByType: new Map(), removeFactionsByType: new Map(), addTypes: new Map(), removeTypes: new Set() },
    inventoryOps: new Map(),
    setPlayerName: null,
    setModifiedFlag: null,
    npcSkillOps: new Map(),
    shipCrewSkillOps: new Map(),
    shipModificationOps: new Map(),
    shipAttrOps: new Map(),
    officerSkillOps: new Map(),
    shipCoreModOps: new Map(),
    partModificationOps: new Map()
  };

  for (const patch of patches) {
    validatePatch(patch);
    switch (patch.type) {
      case 'SetCredits': normalized.setCredits = patch.value; break;
      case 'UnlockBlueprintWares': patch.wares.forEach((ware) => normalized.unlockBlueprintWares.add(ware)); break;
      case 'SetFactionRep':
      case 'SetFactionRelation': normalized.relations.set(patch.factionId, { relation: repUiToFloatString(patch.repUI), mode: normalizeRelationMode(patch.mode) }); break;
      case 'AddLicenceFaction': {
        const key = resolveLicenceTypeName(patch); if (!normalized.licenceOps.addFactionsByType.has(key)) normalized.licenceOps.addFactionsByType.set(key, new Set()); normalized.licenceOps.addFactionsByType.get(key).add(patch.factionId); break;
      }
      case 'RemoveLicenceFaction': {
        const key = resolveLicenceTypeName(patch); if (!normalized.licenceOps.removeFactionsByType.has(key)) normalized.licenceOps.removeFactionsByType.set(key, new Set()); normalized.licenceOps.removeFactionsByType.get(key).add(patch.factionId); break;
      }
      case 'AddLicenceType': normalized.licenceOps.addTypes.set(resolveLicenceTypeName(patch), new Set(patch.factions)); break;
      case 'RemoveLicenceType': normalized.licenceOps.removeTypes.add(resolveLicenceTypeName(patch)); break;
      case 'SetInventoryItem': {
        const current = normalized.inventoryOps.get(patch.ware) || { set: null, add: 0 }; current.set = patch.amount; normalized.inventoryOps.set(patch.ware, current); break;
      }
      case 'AddInventoryItem': {
        const current = normalized.inventoryOps.get(patch.ware) || { set: null, add: 0 }; current.add += patch.amount; normalized.inventoryOps.set(patch.ware, current); break;
      }
      case 'SetPlayerName': normalized.setPlayerName = patch.name.trim(); break;
      case 'SetModifiedFlag': normalized.setModifiedFlag = patch.value; break;
      case 'SetNpcSkills': {
        const npcId = patch.npcId.trim(); if (!normalized.npcSkillOps.has(npcId)) normalized.npcSkillOps.set(npcId, {});
        const current = normalized.npcSkillOps.get(npcId); for (const [key, value] of Object.entries(patch.skills)) current[key] = clamp(Math.trunc(Number(value)), 0, 15); break;
      }
      case 'SetShipCrewSkills':
      case 'SetCrewSkills': {
        const shipId = patch.shipId.trim(); const idx = patch.personIndex ?? patch.crewIndex;
        if (!normalized.shipCrewSkillOps.has(shipId)) normalized.shipCrewSkillOps.set(shipId, new Map());
        const byIndex = normalized.shipCrewSkillOps.get(shipId); if (!byIndex.has(idx)) byIndex.set(idx, {});
        const current = byIndex.get(idx); for (const [key, value] of Object.entries(patch.skills)) current[key] = clamp(Math.trunc(Number(value)), 0, 15); break;
      }
      case 'SetOfficerSkills': {
        const id = patch.officerComponentId.trim(); if (!normalized.officerSkillOps.has(id)) normalized.officerSkillOps.set(id, {});
        const current = normalized.officerSkillOps.get(id); for (const [key, value] of Object.entries(patch.skills)) current[key] = clamp(Math.trunc(Number(value)), 0, 15); break;
      }
      case 'ChangeOwner': {
        const id = patch.objectId.trim(); if (!normalized.shipAttrOps.has(id)) normalized.shipAttrOps.set(id, {}); normalized.shipAttrOps.get(id).owner = patch.newOwnerFactionId.trim(); break;
      }
      case 'SetShipName': {
        const id = patch.shipId.trim(); if (!normalized.shipAttrOps.has(id)) normalized.shipAttrOps.set(id, {}); normalized.shipAttrOps.get(id).name = patch.name; break;
      }
      case 'SetShipCode': {
        const id = patch.shipId.trim(); if (!normalized.shipAttrOps.has(id)) normalized.shipAttrOps.set(id, {}); normalized.shipAttrOps.get(id).code = patch.code; break;
      }
      case 'SetShipCoreMods': {
        const id = patch.shipId.trim(); if (!normalized.shipCoreModOps.has(id)) normalized.shipCoreModOps.set(id, {});
        const cur = normalized.shipCoreModOps.get(id);
        for (const key of ['engine', 'paint', 'ship']) if (patch.core[key] && typeof patch.core[key] === 'object') cur[key] = { ...(cur[key] || {}), ...patch.core[key] };
        break;
      }
      case 'SetPartModification': {
        const partId = patch.partComponentId.trim(); const tag = patch.tagType.trim();
        if (!normalized.partModificationOps.has(partId)) normalized.partModificationOps.set(partId, new Map());
        const byTag = normalized.partModificationOps.get(partId);
        if (!byTag.has(tag)) byTag.set(tag, new Map());
        byTag.get(tag).set(patch.localIndex, { ...(byTag.get(tag).get(patch.localIndex) || {}), ...patch.attrs });
        break;
      }
      case 'SetShipModificationValues': {
        const shipId = patch.shipId.trim(); if (!normalized.shipModificationOps.has(shipId)) normalized.shipModificationOps.set(shipId, new Map());
        const byIndex = normalized.shipModificationOps.get(shipId); if (!byIndex.has(patch.modIndex)) byIndex.set(patch.modIndex, {});
        const current = byIndex.get(patch.modIndex); for (const [key, value] of Object.entries(patch.values)) current[key] = Number(value); break;
      }
      default: break;
    }
  }

  return normalized;
}

module.exports = { normalizePatchList, validatePatch, repUiToFloatString, parseFactionList, stringifyFactionList, normalizeRelationMode };
