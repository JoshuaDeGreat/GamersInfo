const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const sax = require('sax');

const { buildIndex } = require('../src/xml-indexer');
const { exportPatchedSave } = require('../src/xml-rewriter');

const fixtureXml = `<?xml version="1.0"?><savegame><info><save name="#010" date="1543674469"></save></info><player name="Val Selton" location="{20004,60011}" money="999910000"></player><statistics><stat id="money_player" value="999910000"></stat></statistics><factions><faction id="player"><relations><relation faction="criminal" relation="-0.5"></relation><relation faction="scaleplate" relation="-0.0032"></relation></relations><account id="[0x79]" amount="999910000"></account><licences><licence type="station_gen_basic" factions="paranid teladi"></licence><licence type="station_illegal" factions="scaleplate hatikvah"></licence></licences></faction><faction id="argon"><relations><relation faction="alliance" relation="0.1"></relation></relations></faction><faction id="scaleplate"><relations><relation faction="player" relation="-0.0032"></relation></relations></faction></factions><accounts><account id="[0x79]" amount="999910000"></account></accounts><blueprints><blueprint ware="module_gen_prod_energycells_01"></blueprint><blueprint ware="paintmod_0050"></blueprint></blueprints></savegame>`;

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
  assert.equal(model.relations.byFaction.argon.some((item) => item.targetFactionId === 'player'), false);

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
  assert.match(edited, /type="station_gen_basic" factions="paranid teladi argon"/);
  assert.match(edited, /type="station_illegal" factions="scaleplate"/);

  fs.rmSync(dir, { recursive: true, force: true });
});
