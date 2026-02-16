const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const { buildIndex, exportPatchedSave } = require('./src/save-service');

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('save:import', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [{ name: 'X4 Saves', extensions: ['xml', 'gz'] }]
  });

  if (result.canceled || !result.filePaths[0]) return null;
  const filePath = result.filePaths[0];
  const index = await buildIndex(filePath);
  return { filePath, index };
});

ipcMain.handle('save:export', async (_event, payload) => {
  const { sourcePath, patches, compress, createBackup } = payload;
  const defaultPath = sourcePath.replace(/(\.xml(\.gz)?)$/i, compress ? '.edited.xml.gz' : '.edited.xml');

  const saveResult = await dialog.showSaveDialog({
    defaultPath,
    filters: [{ name: compress ? 'Compressed XML' : 'XML', extensions: compress ? ['gz'] : ['xml'] }]
  });

  if (saveResult.canceled || !saveResult.filePath) return null;

  return exportPatchedSave({
    sourcePath,
    outputPath: saveResult.filePath,
    patches,
    compress,
    createBackup
  });
});

ipcMain.handle('dict:load', async () => {
  const roots = Array.from(new Set([app.getAppPath(), process.resourcesPath].filter(Boolean)));
  const readFromAppRoots = async (...segments) => {
    const errors = [];
    for (const root of roots) {
      try {
        return await fs.readFile(path.join(root, ...segments), 'utf8');
      } catch (error) {
        errors.push(error);
      }
    }
    throw errors[0];
  };

  const [factionsById, blueprints, items, licenceTypes, modpartsPreset, helpText] = await Promise.all([
    readFromAppRoots('assets', 'dicts', 'factions.json'),
    readFromAppRoots('assets', 'dicts', 'blueprints.json'),
    readFromAppRoots('assets', 'dicts', 'items.json'),
    readFromAppRoots('assets', 'dicts', 'licence-types.json'),
    readFromAppRoots('assets', 'presets', 'modparts.json'),
    readFromAppRoots('docs', 'cheats-savegame-editing.md')
  ]);

  return {
    factionsById: JSON.parse(factionsById),
    blueprints: JSON.parse(blueprints),
    items: JSON.parse(items),
    licenceTypes: JSON.parse(licenceTypes).types || [],
    presets: { modparts: JSON.parse(modpartsPreset) },
    helpText
  };
});
