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
  return value
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function stringifyFactionList(list) {
  return Array.from(new Set(list)).sort().join(' ');
}

function resolveLicenceTypeName(patch) {
  return String(patch.typeName ?? patch.licenceType ?? patch.targetType ?? '').trim();
}

function validateLicenceTypeName(opName, typeName) {
  if (!typeName) throw new Error(`${opName}.type must be non-empty`);
  if (/["]/.test(typeName)) throw new Error(`${opName}.type must not contain quotes`);
}

function validatePatch(patch) {
  if (!patch || typeof patch !== 'object') throw new Error('Patch must be an object');

  switch (patch.type) {
    case 'SetCredits': {
      if (!Number.isInteger(patch.value) || patch.value < 0) throw new Error('SetCredits.value must be an integer >= 0');
      break;
    }
    case 'UnlockBlueprintWares': {
      if (!Array.isArray(patch.wares) || patch.wares.some((ware) => typeof ware !== 'string' || !ware.trim())) {
        throw new Error('UnlockBlueprintWares.wares must be non-empty strings');
      }
      break;
    }
    case 'SetFactionRep':
    case 'SetFactionRelation': {
      if (typeof patch.factionId !== 'string' || !patch.factionId.trim()) throw new Error('SetFactionRelation.factionId must be non-empty');
      if (typeof patch.repUI !== 'number' || Number.isNaN(patch.repUI) || patch.repUI < -30 || patch.repUI > 30) {
        throw new Error('SetFactionRelation.repUI must be a number in -30..30');
      }
      if (patch.mode !== undefined && !['hard', 'soft', 'setBooster'].includes(patch.mode)) {
        throw new Error('SetFactionRelation.mode must be hard|soft|setBooster when provided');
      }
      break;
    }
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
      if (!Array.isArray(patch.factions) || patch.factions.some((id) => typeof id !== 'string' || !id.trim())) {
        throw new Error('AddLicenceType.factions must be strings when provided');
      }
      break;
    }
    case 'RemoveLicenceType': {
      const typeName = resolveLicenceTypeName(patch);
      validateLicenceTypeName('RemoveLicenceType', typeName);
      break;
    }
    case 'SetInventoryItem':
    case 'AddInventoryItem': {
      if (typeof patch.ware !== 'string' || !patch.ware.trim()) throw new Error(`${patch.type}.ware must be non-empty`);
      if (!Number.isInteger(patch.amount) || patch.amount < 0) throw new Error(`${patch.type}.amount must be integer >= 0`);
      break;
    }
    case 'SetPlayerName': {
      if (typeof patch.name !== 'string') throw new Error('SetPlayerName.name must be a string');
      const name = patch.name.trim();
      if (!name) throw new Error('SetPlayerName.name must be non-empty');
      if (name.length > 64) throw new Error('SetPlayerName.name must be 1-64 chars');
      break;
    }
    case 'SetModifiedFlag': {
      if (!(patch.value === 0 || patch.value === 1)) throw new Error('SetModifiedFlag.value must be 0 or 1');
      break;
    }
    case 'SetNpcSkills': {
      if (typeof patch.npcId !== 'string' || !patch.npcId.trim()) throw new Error('SetNpcSkills.npcId must be non-empty');
      if (!patch.skills || typeof patch.skills !== 'object') throw new Error('SetNpcSkills.skills must be an object');
      const allowed = new Set(['morale', 'piloting', 'management', 'engineering', 'boarding']);
      for (const [key, value] of Object.entries(patch.skills)) {
        if (!allowed.has(key)) throw new Error(`SetNpcSkills.skills has unsupported key: ${key}`);
        if (!Number.isFinite(Number(value))) throw new Error(`SetNpcSkills.skills.${key} must be numeric`);
      }
      break;
    }
    default:
      throw new Error(`Unsupported patch type: ${patch.type}`);
  }
}

function normalizePatchList(patches = []) {
  const normalized = {
    setCredits: null,
      unlockBlueprintWares: new Set(),
    relations: new Map(),
    licenceOps: {
      addFactionsByType: new Map(),
      removeFactionsByType: new Map(),
      addTypes: new Map(),
      removeTypes: new Set()
    },
    inventoryOps: new Map(),
    setPlayerName: null,
    setModifiedFlag: null,
    npcSkillOps: new Map()
  };

  for (const patch of patches) {
    validatePatch(patch);

    switch (patch.type) {
      case 'SetCredits':
        normalized.setCredits = patch.value;
        break;
      case 'UnlockBlueprintWares':
        patch.wares.forEach((ware) => normalized.unlockBlueprintWares.add(ware));
        break;
      case 'SetFactionRep':
      case 'SetFactionRelation':
        normalized.relations.set(patch.factionId, {
          relation: repUiToFloatString(patch.repUI),
          mode: normalizeRelationMode(patch.mode)
        });
        break;
      case 'AddLicenceFaction': {
        const key = resolveLicenceTypeName(patch);
        if (!normalized.licenceOps.addFactionsByType.has(key)) normalized.licenceOps.addFactionsByType.set(key, new Set());
        normalized.licenceOps.addFactionsByType.get(key).add(patch.factionId);
        break;
      }
      case 'RemoveLicenceFaction': {
        const key = resolveLicenceTypeName(patch);
        if (!normalized.licenceOps.removeFactionsByType.has(key)) normalized.licenceOps.removeFactionsByType.set(key, new Set());
        normalized.licenceOps.removeFactionsByType.get(key).add(patch.factionId);
        break;
      }
      case 'AddLicenceType':
        normalized.licenceOps.addTypes.set(resolveLicenceTypeName(patch), new Set(patch.factions));
        break;
      case 'RemoveLicenceType':
        normalized.licenceOps.removeTypes.add(resolveLicenceTypeName(patch));
        break;
      case 'SetInventoryItem': {
        const current = normalized.inventoryOps.get(patch.ware) || { set: null, add: 0 };
        current.set = patch.amount;
        normalized.inventoryOps.set(patch.ware, current);
        break;
      }
      case 'AddInventoryItem': {
        const current = normalized.inventoryOps.get(patch.ware) || { set: null, add: 0 };
        current.add += patch.amount;
        normalized.inventoryOps.set(patch.ware, current);
        break;
      }
      case 'SetPlayerName':
        normalized.setPlayerName = patch.name.trim();
        break;
      case 'SetModifiedFlag':
        normalized.setModifiedFlag = patch.value;
        break;
      case 'SetNpcSkills': {
        const npcId = patch.npcId.trim();
        if (!normalized.npcSkillOps.has(npcId)) normalized.npcSkillOps.set(npcId, {});
        const current = normalized.npcSkillOps.get(npcId);
        for (const [key, value] of Object.entries(patch.skills)) {
          // Conservative clamp: fixtures show small integer skill values; we cap to 0..20 for safety.
          current[key] = clamp(Math.trunc(Number(value)), 0, 20);
        }
        break;
      }
      default:
        break;
    }
  }

  return normalized;
}

module.exports = {
  normalizePatchList,
  validatePatch,
  repUiToFloatString,
  parseFactionList,
  stringifyFactionList,
  normalizeRelationMode
};
