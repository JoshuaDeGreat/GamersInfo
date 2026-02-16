function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function repUiToFloatString(repUI) {
  const value = clamp(Number(repUI) / 30, -1, 1);
  if (Number.isInteger(value)) return String(value);
  return Number(value.toFixed(6)).toString();
}

function parseFactionList(value = '') {
  return value
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function stringifyFactionList(list) {
  return Array.from(new Set(list)).join(' ');
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
    case 'SetFactionRelation': {
      if (typeof patch.factionId !== 'string' || !patch.factionId.trim()) throw new Error('SetFactionRelation.factionId must be non-empty');
      if (typeof patch.repUI !== 'number' || Number.isNaN(patch.repUI) || patch.repUI < -30 || patch.repUI > 30) {
        throw new Error('SetFactionRelation.repUI must be a number in -30..30');
      }
      break;
    }
    case 'AddLicenceFaction':
    case 'RemoveLicenceFaction': {
      if (typeof patch.typeName !== 'string' || !patch.typeName.trim()) throw new Error(`${patch.type}.typeName must be non-empty`);
      if (typeof patch.factionId !== 'string' || !patch.factionId.trim()) throw new Error(`${patch.type}.factionId must be non-empty`);
      break;
    }
    case 'AddLicenceType': {
      if (typeof patch.typeName !== 'string' || !patch.typeName.trim()) throw new Error('AddLicenceType.typeName must be non-empty');
      if (!Array.isArray(patch.factions) || patch.factions.some((id) => typeof id !== 'string' || !id.trim())) {
        throw new Error('AddLicenceType.factions must be non-empty strings');
      }
      break;
    }
    case 'RemoveLicenceType': {
      if (typeof patch.typeName !== 'string' || !patch.typeName.trim()) throw new Error('RemoveLicenceType.typeName must be non-empty');
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
    }
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
      case 'SetFactionRelation':
        normalized.relations.set(patch.factionId, repUiToFloatString(patch.repUI));
        break;
      case 'AddLicenceFaction': {
        const key = patch.typeName;
        if (!normalized.licenceOps.addFactionsByType.has(key)) normalized.licenceOps.addFactionsByType.set(key, new Set());
        normalized.licenceOps.addFactionsByType.get(key).add(patch.factionId);
        break;
      }
      case 'RemoveLicenceFaction': {
        const key = patch.typeName;
        if (!normalized.licenceOps.removeFactionsByType.has(key)) normalized.licenceOps.removeFactionsByType.set(key, new Set());
        normalized.licenceOps.removeFactionsByType.get(key).add(patch.factionId);
        break;
      }
      case 'AddLicenceType':
        normalized.licenceOps.addTypes.set(patch.typeName, new Set(patch.factions));
        break;
      case 'RemoveLicenceType':
        normalized.licenceOps.removeTypes.add(patch.typeName);
        break;
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
  stringifyFactionList
};
