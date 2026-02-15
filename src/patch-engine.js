function normalizePatchList(patches = []) {
  const normalized = {
    credits: new Map(),
    factionRep: new Map(),
    skillRules: [],
    unlockBlueprints: new Set(),
    inventory: new Map(),
    ownerChanges: new Map(),
    deletes: new Set()
  };

  for (const patch of patches) {
    switch (patch.type) {
      case 'SetCredits':
        normalized.credits.set(patch.scope, patch.value);
        break;
      case 'SetFactionRep':
        normalized.factionRep.set(patch.factionId, patch.rep);
        break;
      case 'SetSkills':
        normalized.skillRules.push(patch);
        break;
      case 'UnlockBlueprints':
        patch.blueprintIds.forEach((id) => normalized.unlockBlueprints.add(id));
        break;
      case 'SetInventoryItem':
      case 'AddInventoryItem':
        normalized.inventory.set(patch.itemId, patch.amount);
        break;
      case 'RemoveInventoryItem':
        normalized.inventory.set(patch.itemId, 0);
        break;
      case 'ChangeOwner':
        normalized.ownerChanges.set(patch.objectId, patch.newOwnerFactionId);
        break;
      case 'DeleteObject':
        normalized.deletes.add(patch.objectId);
        break;
      default:
        break;
    }
  }
  return normalized;
}

function validatePatch(patch) {
  if (patch.type === 'SetCredits' && patch.value < 0) throw new Error('Credits cannot be negative');
  if (patch.type === 'SetFactionRep' && (patch.rep < -30 || patch.rep > 30)) throw new Error('Reputation must be -30..30');
}

module.exports = {
  normalizePatchList,
  validatePatch
};
