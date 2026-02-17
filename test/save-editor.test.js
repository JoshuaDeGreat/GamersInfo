const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const sax = require('sax');

const { buildIndex } = require('../src/xml-indexer');
const { exportPatchedSave } = require('../src/xml-rewriter');

const fixtureXml = `<?xml version="1.0"?><savegame><info><save name="#010" date="1543674469"></save></info><player name="Val Selton" location="{20004,60011}" money="999910000"></player><components><component class="player"><inventory><ware ware="inv_remotedetonator" amount="2"></ware></inventory></component></components><statistics><stat id="money_player" value="999910000"></stat></statistics><factions><faction id="player"><relations><relation faction="criminal" relation="-0.5"></relation><relation faction="scaleplate" relation="-0.0032"></relation></relations><account id="[0x79]" amount="999910000"></account><licences><licence type="station_gen_basic" factions="paranid teladi"></licence><licence type="station_illegal" factions="scaleplate hatikvah"></licence></licences></faction><faction id="argon"><relations><relation faction="alliance" relation="0.1"></relation></relations></faction><faction id="scaleplate"><relations><relation faction="player" relation="-0.0032"></relation></relations></faction></factions><accounts><account id="[0x79]" amount="999910000"></account></accounts><blueprints><blueprint ware="module_gen_prod_energycells_01"></blueprint><blueprint ware="paintmod_0050"></blueprint></blueprints></savegame>`;

function writeFixture() {
  const dir = fs.mkdtempSync(path.join(process.cwd(), 'tmp-x4-'));
  const xmlPath = path.join(dir, 'sample.xml');
  fs.writeFileSync(xmlPath, fixtureXml);
  return { dir, xmlPath };
}

function parseXmlString(xml) {
  return new Promise((resolve, reject) => {
    const parser = sax.createStream(true, { trim: true });
    parser.on('error', reject);
    parser.on('end', () => resolve(true));
    parser.end(xml);
  });
}

test('indexing reads verified anchors', async () => {
  const { dir, xmlPath } = writeFixture();
  const model = await buildIndex(xmlPath);

  assert.equal(model.metadata.saveName, '#010');
  assert.equal(model.metadata.saveDate, '1543674469');
  assert.equal(model.credits.playerMoney, '999910000');
  assert.equal(model.credits.statMoneyPlayer, '999910000');
  assert.equal(model.credits.playerWalletAccountId, '[0x79]');
  assert.equal(model.credits.walletAccountOccurrences, 2);
  assert.equal(model.blueprints.owned.length, 2);
  assert.equal(model.inventory.player.inv_remotedetonator, 2);
  assert.equal(model.relations.byFaction.argon.some((item) => item.targetFactionId === 'player'), false);
  assert.equal(model.licencesModel.playerFactionFound, true);
  assert.equal(model.licencesModel.licencesBlockFound, true);
  assert.deepEqual(model.licencesModel.allLicenceTypes, ['station_gen_basic', 'station_illegal']);
  assert.deepEqual(model.licencesModel.allFactionsInLicences, ['hatikvah', 'paranid', 'scaleplate', 'teladi']);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('export with no edits keeps valid XML', async () => {
  const { dir, xmlPath } = writeFixture();
  const outputPath = path.join(dir, 'same.xml');

  await exportPatchedSave({ sourcePath: xmlPath, outputPath, patches: [], compress: false, createBackup: false });
  const xml = fs.readFileSync(outputPath, 'utf8');
  await parseXmlString(xml);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('SetCredits updates player money, stat, and all wallet accounts', async () => {
  const { dir, xmlPath } = writeFixture();
  const outputPath = path.join(dir, 'credits.xml');

  await exportPatchedSave({
    sourcePath: xmlPath,
    outputPath,
    patches: [{ type: 'SetCredits', value: 123456 }],
    compress: false,
    createBackup: false
  });

  const edited = fs.readFileSync(outputPath, 'utf8');
  assert.match(edited, /<player[^>]*money="123456"/);
  assert.match(edited, /<stat id="money_player" value="123456">/);
  const walletMatches = edited.match(/<account id="\[0x79\]" amount="123456">/g) || [];
  assert.equal(walletMatches.length, 2);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('UnlockBlueprintWares inserts missing ware without duplicates', async () => {
  const { dir, xmlPath } = writeFixture();
  const outputPath = path.join(dir, 'blueprints.xml');

  await exportPatchedSave({
    sourcePath: xmlPath,
    outputPath,
    patches: [{ type: 'UnlockBlueprintWares', wares: ['paintmod_0050', 'module_arg_dock_m_01_lowtech'] }],
    compress: false,
    createBackup: false
  });

  const edited = fs.readFileSync(outputPath, 'utf8');
  assert.equal((edited.match(/ware="paintmod_0050"/g) || []).length, 1);
  assert.equal((edited.match(/ware="module_arg_dock_m_01_lowtech"/g) || []).length, 1);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('SetFactionRelation creates missing player↔argon and updates existing player↔scaleplate', async () => {
  const { dir, xmlPath } = writeFixture();
  const outputPath = path.join(dir, 'relations.xml');

  await exportPatchedSave({
    sourcePath: xmlPath,
    outputPath,
    patches: [
      { type: 'SetFactionRelation', factionId: 'argon', repUI: 30 },
      { type: 'SetFactionRelation', factionId: 'scaleplate', repUI: -15 }
    ],
    compress: false,
    createBackup: false
  });

  const edited = fs.readFileSync(outputPath, 'utf8');
  assert.match(edited, /<relation faction="argon" relation="1"><\/relation>/);
  assert.match(edited, /<faction id="argon">[\s\S]*<relation faction="player" relation="1"><\/relation>/);
  assert.match(edited, /<faction id="scaleplate">[\s\S]*<relation faction="player" relation="-0.5"><\/relation>/);
  assert.match(edited, /<relation faction="scaleplate" relation="-0.5"><\/relation>/);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('licence operations add and remove factions deterministically', async () => {
  const { dir, xmlPath } = writeFixture();
  const outputPath = path.join(dir, 'licences.xml');

  await exportPatchedSave({
    sourcePath: xmlPath,
    outputPath,
    patches: [
      { type: 'AddLicenceFaction', typeName: 'station_gen_basic', factionId: 'argon' },
      { type: 'RemoveLicenceFaction', typeName: 'station_illegal', factionId: 'hatikvah' }
    ],
    compress: false,
    createBackup: false
  });

  const edited = fs.readFileSync(outputPath, 'utf8');
  assert.match(edited, /type="station_gen_basic" factions="argon paranid teladi"/);
  assert.match(edited, /type="station_illegal" factions="scaleplate"/);

  fs.rmSync(dir, { recursive: true, force: true });
});


test('Inventory set/add updates existing and inserts missing ware', async () => {
  const { dir, xmlPath } = writeFixture();
  const outputPath = path.join(dir, 'inventory.xml');

  await exportPatchedSave({
    sourcePath: xmlPath,
    outputPath,
    patches: [
      { type: 'AddInventoryItem', ware: 'inv_remotedetonator', amount: 3 },
      { type: 'SetInventoryItem', ware: 'inv_new_item', amount: 5 }
    ],
    compress: false,
    createBackup: false
  });

  const edited = fs.readFileSync(outputPath, 'utf8');
  assert.match(edited, /ware="inv_remotedetonator" amount="5"/);
  assert.match(edited, /ware="inv_new_item" amount="5"/);

  fs.rmSync(dir, { recursive: true, force: true });
});


test('licence add/remove operations are idempotent and sorted', async () => {
  const { dir, xmlPath } = writeFixture();
  const outputPath = path.join(dir, 'licences-idempotent.xml');

  await exportPatchedSave({
    sourcePath: xmlPath,
    outputPath,
    patches: [
      { type: 'AddLicenceFaction', typeName: 'station_gen_basic', factionId: 'argon' },
      { type: 'AddLicenceFaction', typeName: 'station_gen_basic', factionId: 'argon' },
      { type: 'RemoveLicenceFaction', typeName: 'station_illegal', factionId: 'hatikvah' },
      { type: 'RemoveLicenceFaction', typeName: 'station_illegal', factionId: 'hatikvah' }
    ],
    compress: false,
    createBackup: false
  });

  const edited = fs.readFileSync(outputPath, 'utf8');
  assert.match(edited, /type="station_gen_basic" factions="argon paranid teladi"/);
  assert.match(edited, /type="station_illegal" factions="scaleplate"/);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('creates licences block when missing in player faction', async () => {
  const xml = `<?xml version="1.0"?><savegame><factions><faction id="player"><account id="[0x1]" amount="10"></account></faction></factions></savegame>`;
  const dir = fs.mkdtempSync(path.join(process.cwd(), 'tmp-x4-'));
  const xmlPath = path.join(dir, 'nolic.xml');
  fs.writeFileSync(xmlPath, xml);
  const outputPath = path.join(dir, 'nolic-out.xml');

  await exportPatchedSave({
    sourcePath: xmlPath,
    outputPath,
    patches: [{ type: 'AddLicenceFaction', typeName: 'station_gen_basic', factionId: 'argon' }],
    compress: false,
    createBackup: false
  });

  const edited = fs.readFileSync(outputPath, 'utf8');
  assert.match(edited, /<faction id="player">[\s\S]*<licences><licence type="station_gen_basic" factions="argon"\/><\/licences><\/faction>/);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('licence edits fail when player faction is missing', async () => {
  const xml = `<?xml version="1.0"?><savegame><factions><faction id="argon"></faction></factions></savegame>`;
  const dir = fs.mkdtempSync(path.join(process.cwd(), 'tmp-x4-'));
  const xmlPath = path.join(dir, 'nofaction.xml');
  fs.writeFileSync(xmlPath, xml);
  const outputPath = path.join(dir, 'nofaction-out.xml');

  await assert.rejects(() => exportPatchedSave({
    sourcePath: xmlPath,
    outputPath,
    patches: [{ type: 'AddLicenceFaction', typeName: 'station_gen_basic', factionId: 'argon' }],
    compress: false,
    createBackup: false
  }), /Cannot edit licences/);

  fs.rmSync(dir, { recursive: true, force: true });
});


test('AddLicenceType inserts self-closing empty-factions licence in existing licences block', async () => {
  const xml = `<?xml version="1.0"?><savegame><factions><faction id="player"><licences><licence type="station_gen_basic" factions="paranid"></licence></licences></faction></factions></savegame>`;
  const dir = fs.mkdtempSync(path.join(process.cwd(), 'tmp-x4-'));
  const xmlPath = path.join(dir, 'catalog-a.xml');
  fs.writeFileSync(xmlPath, xml);
  const outputPath = path.join(dir, 'catalog-a-out.xml');

  await exportPatchedSave({
    sourcePath: xmlPath,
    outputPath,
    patches: [{ type: 'AddLicenceType', typeName: 'capitalship', factions: [] }],
    compress: false,
    createBackup: false
  });

  const edited = fs.readFileSync(outputPath, 'utf8');
  assert.match(edited, /<licences>[\s\S]*<licence type="capitalship" factions=""\/>[\s\S]*<\/licences>/);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('AddLicenceType inserts licences block when missing on player faction', async () => {
  const xml = `<?xml version="1.0"?><savegame><factions><faction id="player"><account id="[0x1]" amount="10"></account></faction></factions></savegame>`;
  const dir = fs.mkdtempSync(path.join(process.cwd(), 'tmp-x4-'));
  const xmlPath = path.join(dir, 'catalog-b.xml');
  fs.writeFileSync(xmlPath, xml);
  const outputPath = path.join(dir, 'catalog-b-out.xml');

  await exportPatchedSave({
    sourcePath: xmlPath,
    outputPath,
    patches: [{ type: 'AddLicenceType', typeName: 'capitalship', factions: [] }],
    compress: false,
    createBackup: false
  });

  const edited = fs.readFileSync(outputPath, 'utf8');
  assert.match(edited, /<faction id="player">[\s\S]*<licences><licence type="capitalship" factions=""\/><\/licences><\/faction>/);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('AddLicenceFaction and RemoveLicenceFaction update inserted type factions list', async () => {
  const xml = `<?xml version="1.0"?><savegame><factions><faction id="player"><licences></licences></faction></factions></savegame>`;
  const dir = fs.mkdtempSync(path.join(process.cwd(), 'tmp-x4-'));
  const xmlPath = path.join(dir, 'catalog-factions.xml');
  fs.writeFileSync(xmlPath, xml);
  const outputPath = path.join(dir, 'catalog-factions-out.xml');

  await exportPatchedSave({
    sourcePath: xmlPath,
    outputPath,
    patches: [
      { type: 'AddLicenceType', typeName: 'capitalship', factions: [] },
      { type: 'AddLicenceFaction', typeName: 'capitalship', factionId: 'argon' },
      { type: 'AddLicenceFaction', typeName: 'capitalship', factionId: 'teladi' },
      { type: 'RemoveLicenceFaction', typeName: 'capitalship', factionId: 'argon' }
    ],
    compress: false,
    createBackup: false
  });

  const edited = fs.readFileSync(outputPath, 'utf8');
  assert.match(edited, /<licence type="capitalship" factions="teladi"\/>/);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('adding same licence type twice does not duplicate nodes', async () => {
  const xml = `<?xml version="1.0"?><savegame><factions><faction id="player"><licences></licences></faction></factions></savegame>`;
  const dir = fs.mkdtempSync(path.join(process.cwd(), 'tmp-x4-'));
  const xmlPath = path.join(dir, 'catalog-idempotent.xml');
  fs.writeFileSync(xmlPath, xml);
  const outputPath = path.join(dir, 'catalog-idempotent-out.xml');

  await exportPatchedSave({
    sourcePath: xmlPath,
    outputPath,
    patches: [
      { type: 'AddLicenceType', typeName: 'capitalship', factions: [] },
      { type: 'AddLicenceType', typeName: 'capitalship', factions: [] }
    ],
    compress: false,
    createBackup: false
  });

  const edited = fs.readFileSync(outputPath, 'utf8');
  assert.equal((edited.match(/<licence type="capitalship" factions=""\/>/g) || []).length, 1);

  fs.rmSync(dir, { recursive: true, force: true });
});


test('indexing captures relation boosters and player contact factions', async () => {
  const xml = `<?xml version="1.0"?><savegame><factions><faction id="player"><relations><relation faction="argon" relation="0.1"></relation><booster faction="argon" relation="0.2" time="100"></booster></relations></faction><faction id="argon"><relations><relation faction="player" relation="0.1"></relation><booster faction="player" relation="0.05" time="88"></booster></relations></faction></factions></savegame>`;
  const dir = fs.mkdtempSync(path.join(process.cwd(), 'tmp-x4-'));
  const xmlPath = path.join(dir, 'boosters-index.xml');
  fs.writeFileSync(xmlPath, xml);

  const model = await buildIndex(xmlPath);
  assert.equal(model.relations.playerBoosters.length, 1);
  assert.equal(model.relations.playerBoosters[0].targetFactionId, 'argon');
  assert.equal(model.relations.playerBoosters[0].value, '0.2');
  assert.deepEqual(model.licencesModel.playerContactFactions, ['argon']);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('SetFactionRep hard mode updates base both ways and removes boosters', async () => {
  const xml = `<?xml version="1.0"?><savegame><factions><faction id="player"><relations><relation faction="argon" relation="0.2"></relation><booster faction="argon" relation="0.4" time="100"></booster></relations></faction><faction id="argon"><relations><relation faction="player" relation="0.2"></relation><booster faction="player" relation="0.1" time="50"></booster></relations></faction></factions></savegame>`;
  const dir = fs.mkdtempSync(path.join(process.cwd(), 'tmp-x4-'));
  const xmlPath = path.join(dir, 'boosters-hard.xml');
  fs.writeFileSync(xmlPath, xml);
  const outputPath = path.join(dir, 'boosters-hard-out.xml');

  await exportPatchedSave({
    sourcePath: xmlPath,
    outputPath,
    patches: [{ type: 'SetFactionRep', factionId: 'argon', repUI: 24, mode: 'hard' }],
    compress: false,
    createBackup: false
  });

  const edited = fs.readFileSync(outputPath, 'utf8');
  assert.match(edited, /<faction id="player">[\s\S]*<relation faction="argon" relation="0.8"><\/relation>/);
  assert.match(edited, /<faction id="argon">[\s\S]*<relation faction="player" relation="0.8"><\/relation>/);
  assert.equal((edited.match(/<booster faction="argon"/g) || []).length, 0);
  assert.equal((edited.match(/<booster faction="player"/g) || []).length, 0);
  await parseXmlString(edited);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('SetFactionRep soft mode updates base both ways and keeps boosters', async () => {
  const xml = `<?xml version="1.0"?><savegame><factions><faction id="player"><relations><relation faction="argon" relation="0.2"></relation><booster faction="argon" relation="0.4" time="100"></booster></relations></faction><faction id="argon"><relations><relation faction="player" relation="0.2"></relation><booster faction="player" relation="0.1" time="50"></booster></relations></faction></factions></savegame>`;
  const dir = fs.mkdtempSync(path.join(process.cwd(), 'tmp-x4-'));
  const xmlPath = path.join(dir, 'boosters-soft.xml');
  fs.writeFileSync(xmlPath, xml);
  const outputPath = path.join(dir, 'boosters-soft-out.xml');

  await exportPatchedSave({
    sourcePath: xmlPath,
    outputPath,
    patches: [{ type: 'SetFactionRep', factionId: 'argon', repUI: -12, mode: 'soft' }],
    compress: false,
    createBackup: false
  });

  const edited = fs.readFileSync(outputPath, 'utf8');
  assert.match(edited, /<faction id="player">[\s\S]*<relation faction="argon" relation="-0.4"><\/relation>/);
  assert.match(edited, /<faction id="argon">[\s\S]*<relation faction="player" relation="-0.4"><\/relation>/);
  assert.equal((edited.match(/<booster faction="argon" relation="0.4" time="100">/g) || []).length, 1);
  assert.equal((edited.match(/<booster faction="player" relation="0.1" time="50">/g) || []).length, 1);
  await parseXmlString(edited);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('SetFactionRep inserts missing reverse and player relation nodes', async () => {
  const xml = `<?xml version="1.0"?><savegame><factions><faction id="player"><relations></relations></faction><faction id="argon"><relations></relations></faction></factions></savegame>`;
  const dir = fs.mkdtempSync(path.join(process.cwd(), 'tmp-x4-'));
  const xmlPath = path.join(dir, 'relations-insert.xml');
  fs.writeFileSync(xmlPath, xml);
  const outputPath = path.join(dir, 'relations-insert-out.xml');

  await exportPatchedSave({
    sourcePath: xmlPath,
    outputPath,
    patches: [{ type: 'SetFactionRep', factionId: 'argon', repUI: 6 }],
    compress: false,
    createBackup: false
  });

  const edited = fs.readFileSync(outputPath, 'utf8');
  assert.match(edited, /<faction id="player">[\s\S]*<relation faction="argon" relation="0.2"><\/relation>/);
  assert.match(edited, /<faction id="argon">[\s\S]*<relation faction="player" relation="0.2"><\/relation>/);
  await parseXmlString(edited);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('indexer extracts save metadata and extensions from info block', async () => {
  const fixturePath = path.join(process.cwd(), 'test', 'fixtures', 'save-info.xml');
  const model = await buildIndex(fixturePath);

  assert.equal(model.metadata.saveName, '#002');
  assert.equal(model.metadata.saveDate, '1771111771');
  assert.equal(model.metadata.gameVersion, '800');
  assert.equal(model.metadata.gameBuild, '590967');
  assert.equal(model.metadata.modified, true);
  assert.equal(model.metadata.guid, '161925A7-6EBC-4535-8AD9-440834D2DEDE');
  assert.equal(model.metadata.playerName, 'Juro Topeka');
  assert.deepEqual(model.metadata.extensions.active, [
    { id: 'ego_dlc_mini_02', version: '800', name: 'Envoy Pack' },
    { id: 'ego_dlc_mini_01', version: '800', name: 'Hyperion Pack' }
  ]);
  assert.deepEqual(model.metadata.extensions.history, [
    { id: 'ego_dlc_mini_02', version: '800', name: 'Envoy Pack' }
  ]);
});

test('rewriter SetPlayerName and SetModifiedFlag patch only info attributes', async () => {
  const dir = fs.mkdtempSync(path.join(process.cwd(), 'tmp-x4-'));
  const fixturePath = path.join(process.cwd(), 'test', 'fixtures', 'save-info.xml');
  const outputPath = path.join(dir, 'metadata-out.xml');

  await exportPatchedSave({
    sourcePath: fixturePath,
    outputPath,
    patches: [
      { type: 'SetPlayerName', name: 'Captain Boso' },
      { type: 'SetModifiedFlag', value: 0 }
    ],
    compress: false,
    createBackup: false
  });

  const edited = fs.readFileSync(outputPath, 'utf8');
  assert.match(edited, /<info>[\s\S]*<player name="Captain Boso"/);
  assert.match(edited, /<info>[\s\S]*<game[^>]*modified="0"/);
  assert.equal((edited.match(/name="Captain Boso"/g) || []).length, 1);
  assert.equal((edited.match(/modified="0"/g) || []).length, 1);
  await parseXmlString(edited);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('indexer reads npc skills from attributes and skill nodes fixtures', async () => {
  const attrsPath = path.join(process.cwd(), 'test/fixtures/skills/npc_component_skills_attributes.xml');
  const nodesPath = path.join(process.cwd(), 'test/fixtures/skills/npc_component_skill_nodes.xml');

  const attrsModel = await buildIndex(attrsPath);
  assert.equal(attrsModel.skillsModel.npcsById['[0xAAA]'].name, 'Mina Talis');
  assert.equal(attrsModel.skillsModel.npcsById['[0xAAA]'].skills.piloting, 6);
  assert.equal(attrsModel.skillsModel.npcsById['[0xAAA]'].npcseed, '123456');

  const nodesModel = await buildIndex(nodesPath);
  assert.equal(nodesModel.skillsModel.npcsById['[0xBBB]'].skills.piloting, 7);
  assert.equal(nodesModel.skillsModel.npcsById['[0xBBB]'].skills.management, 5);
});

test('indexer links ship/station posts to npc components', async () => {
  const shipPath = path.join(process.cwd(), 'test/fixtures/skills/ship_with_posts.xml');
  const stationPath = path.join(process.cwd(), 'test/fixtures/skills/station_with_manager_post.xml');
  const shipModel = await buildIndex(shipPath);
  const stationModel = await buildIndex(stationPath);

  assert.equal(shipModel.skillsModel.postsByContainerId['[0xSHIP]'].length, 2);
  assert.equal(shipModel.skillsModel.npcAssignmentsById['[0xAAA]'][0].postId, 'aipilot');
  assert.equal(shipModel.skillsModel.containerById['[0xSHIP]'].name, 'Pioneer');

  assert.equal(stationModel.skillsModel.postsByContainerId['[0xSTN]'][0].postId, 'manager');
  assert.equal(stationModel.skillsModel.npcAssignmentsById['[0xCCC]'][0].containerId, '[0xSTN]');
});

test('SetNpcSkills updates attributes and node-based skills and is idempotent', async () => {
  const xml = `<?xml version="1.0"?><savegame><components>
  <component class="npc" id="[0xAAA]" name="Mina"><traits><skills morale="1" piloting="2"/></traits></component>
  <component class="npc" id="[0xBBB]" name="Iren"><traits><skill type="piloting" value="3"/></traits></component>
  </components></savegame>`;
  const dir = fs.mkdtempSync(path.join(process.cwd(), 'tmp-x4-'));
  const xmlPath = path.join(dir, 'npc.xml');
  fs.writeFileSync(xmlPath, xml);

  const out1 = path.join(dir, 'npc-out-1.xml');
  const out2 = path.join(dir, 'npc-out-2.xml');
  const patches = [
    { type: 'SetNpcSkills', npcId: '[0xAAA]', skills: { piloting: 10, engineering: 4 } },
    { type: 'SetNpcSkills', npcId: '[0xBBB]', skills: { piloting: 8, management: 6 } }
  ];

  await exportPatchedSave({ sourcePath: xmlPath, outputPath: out1, patches, compress: false, createBackup: false });
  await exportPatchedSave({ sourcePath: out1, outputPath: out2, patches, compress: false, createBackup: false });

  const first = fs.readFileSync(out1, 'utf8');
  const second = fs.readFileSync(out2, 'utf8');

  assert.match(first, /id="\[0xAAA\]"[\s\S]*<skills[^>]*piloting="10"[^>]*engineering="4"/);
  assert.match(first, /id="\[0xBBB\]"[\s\S]*<skill type="piloting" value="8">/);
  assert.match(first, /id="\[0xBBB\]"[\s\S]*<skill type="management" value="6">/);
  assert.equal(first, second);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('streaming implementation has no DOM parser dependency', () => {
  const indexer = fs.readFileSync(path.join(process.cwd(), 'src/xml-indexer.js'), 'utf8');
  const rewriter = fs.readFileSync(path.join(process.cwd(), 'src/xml-rewriter.js'), 'utf8');
  assert.equal(/DOMParser|xmldom|fast-xml-parser/i.test(indexer), false);
  assert.equal(/DOMParser|xmldom|fast-xml-parser/i.test(rewriter), false);
});
