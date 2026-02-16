#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

function readLines(filePath) {
  return fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function parseBlueprints(filePath) {
  const dict = {};
  let category = 'Uncategorized';
  for (const line of readLines(filePath)) {
    const heading = line.match(/<!--\s*Category:\s*(.*?)\s*-->/i);
    if (heading) {
      category = heading[1].trim() || 'Uncategorized';
      continue;
    }
    const entry = line.match(/<blueprint\s+ware="([^"]+)"\s*\/>\s*(?:<!--\s*(.*?)\s*-->)?/i);
    if (!entry) continue;
    const ware = entry[1].trim();
    dict[ware] = { name: (entry[2] || ware).trim(), category };
  }
  return dict;
}

function parseItems(filePath) {
  const dict = {};
  let category = 'Uncategorized';
  for (const line of readLines(filePath)) {
    const heading = line.match(/<!--\s*(.*?)\s*-->/);
    if (heading && !line.includes('<ware')) {
      category = heading[1].trim() || 'Uncategorized';
      continue;
    }
    const entry = line.match(/<ware\s+ware="([^"]+)"(?:\s+amount="(\d+)")?\s*\/>\s*(?:<!--\s*(.*?)\s*-->)?/i);
    if (!entry) continue;
    const ware = entry[1].trim();
    const suggestedAmount = entry[2] ? Number(entry[2]) : undefined;
    dict[ware] = { name: (entry[3] || ware).trim(), category };
    if (Number.isFinite(suggestedAmount)) dict[ware].suggestedAmount = suggestedAmount;
  }
  return dict;
}

function parseModparts(filePath) {
  const items = [];
  for (const line of readLines(filePath)) {
    const entry = line.match(/<ware\s+ware="([^"]+)"\s+amount="(\d+)"\s*\/>/i);
    if (!entry) continue;
    items.push({ ware: entry[1].trim(), amount: Number(entry[2]) });
  }
  return { name: 'Common Mod Parts Pack', items };
}

const repoRoot = path.resolve(__dirname, '..');

function resolveInput(name) {
  const inputPath = path.join(repoRoot, 'assets', 'source', name);
  if (!fs.existsSync(inputPath)) throw new Error(`Could not locate input file: ${inputPath}`);
  return inputPath;
}

function main() {
  const outBlueprints = path.join(repoRoot, 'assets', 'dicts', 'blueprints.json');
  const outItems = path.join(repoRoot, 'assets', 'dicts', 'items.json');
  const outModparts = path.join(repoRoot, 'assets', 'presets', 'modparts.json');
  ensureDir(path.dirname(outBlueprints));
  ensureDir(path.dirname(outItems));
  ensureDir(path.dirname(outModparts));

  fs.writeFileSync(outBlueprints, JSON.stringify(parseBlueprints(resolveInput('blueprint-ids.xml')), null, 2));
  fs.writeFileSync(outItems, JSON.stringify(parseItems(resolveInput('inventory-items.xml')), null, 2));
  fs.writeFileSync(outModparts, JSON.stringify(parseModparts(resolveInput('modparts.xml')), null, 2));

  console.log('Generated dictionaries and presets.');
}

main();
