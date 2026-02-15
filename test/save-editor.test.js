const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { detectCompressed } = require('../src/stream-utils');
const { normalizePatchList } = require('../src/patch-engine');
const { buildIndex } = require('../src/xml-indexer');
const { exportPatchedSave } = require('../src/xml-rewriter');

const fixtureXml = `<?xml version="1.0"?><save><account id="a1" owner="player" money="100"/><relation faction="argon" source="player" value="5"/><npc id="n1" name="A" role="pilot" owner="player"><skill type="piloting" value="2"/></npc><blueprint id="bp_0001" unlocked="0" category="ship"/><item id="ware_001" amount="5" owner="player"/><object id="obj1" owner="argon" class="ship"/></save>`;

function writeFixture() {
  const dir = fs.mkdtempSync(path.join(process.cwd(), 'tmp-x4-'));
  const xmlPath = path.join(dir, 'sample.xml');
  const gzPath = path.join(dir, 'sample.xml.gz');
  fs.writeFileSync(xmlPath, fixtureXml);
  fs.writeFileSync(gzPath, zlib.gzipSync(Buffer.from(fixtureXml)));
  return { dir, xmlPath, gzPath };
}

test('gzip detection works', () => {
  const { xmlPath, gzPath, dir } = writeFixture();
  assert.equal(detectCompressed(xmlPath), false);
  assert.equal(detectCompressed(gzPath), true);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('indexing parses core entities', async () => {
  const { xmlPath, dir } = writeFixture();
  const model = await buildIndex(xmlPath);
  assert.equal(model.accounts.length, 1);
  assert.equal(model.relations.length, 1);
  assert.equal(model.npcs.length, 1);
  assert.equal(model.blueprints.length, 1);
  assert.equal(model.inventory.length, 1);
  assert.equal(model.objects.length, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('patch conflict resolution keeps last write', () => {
  const n = normalizePatchList([
    { type: 'SetFactionRep', factionId: 'argon', rep: 10 },
    { type: 'SetFactionRep', factionId: 'argon', rep: 20 }
  ]);
  assert.equal(n.factionRep.get('argon'), 20);
});

test('export applies patches and keeps file parseable', async () => {
  const { xmlPath, dir } = writeFixture();
  const outputPath = path.join(dir, 'edited.xml');
  await exportPatchedSave({
    sourcePath: xmlPath,
    outputPath,
    compress: false,
    createBackup: true,
    patches: [
      { type: 'SetCredits', scope: 'player', value: 999 },
      { type: 'SetFactionRep', factionId: 'argon', rep: 20 },
      { type: 'UnlockBlueprints', blueprintIds: ['bp_0001'] },
      { type: 'ChangeOwner', objectId: 'obj1', newOwnerFactionId: 'player' }
    ]
  });
  const edited = fs.readFileSync(outputPath, 'utf8');
  assert.match(edited, /money="999"/);
  assert.match(edited, /value="20"/);
  assert.match(edited, /blueprint id="bp_0001" unlocked="1"/);
  assert.match(edited, /object id="obj1" owner="player"/);
  const reparsed = await buildIndex(outputPath);
  assert.equal(reparsed.accounts[0].money, 999);
  fs.rmSync(dir, { recursive: true, force: true });
});
