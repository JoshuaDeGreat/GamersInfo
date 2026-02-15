# X4: Foundations Save Editor (Electron)

This tool edits X4 saves; always backup.

## Features
- Offline Electron desktop app with HTML/CSS GUI tabs for Overview, Credits, Relations, Skills, Blueprints, Inventory, Objects, Changes, and Export.
- Imports `.xml.gz` and `.xml` save files.
- Streaming XML index pass (SAX) for large save files.
- Structured patch engine with undo/redo and diff preview panel.
- Streaming export pass with deterministic patching.
- Backup support (`<source>.backup.<ext>`), safe temp-file export, and optional gzip output.
- Bundled dictionaries for factions, blueprints, and items.

## Install & Run
1. Install dependencies:
   ```bash
   npm install
   ```
2. Start app:
   ```bash
   npm start
   ```
3. In app:
   - Click **Import Save**.
   - Make edits in tabs.
   - Review pending patches in **Changes**.
   - Go to **Export** and export as `.xml.gz` (default) or `.xml`.

## Supported Formats
- `.xml.gz` (gzip compressed XML)
- `.xml` (plain XML)

## Warnings
- Save editing can mark saves as modified/cheated depending on game behavior.
- Always keep your original save and backup.

## Troubleshooting: "Save won’t load"
1. Revert backup file.
2. Export uncompressed `.xml` and retest.
3. Try a smaller patch set to isolate problematic changes.
4. Re-import the edited file to verify XML parse succeeds before loading in game.

## Test
```bash
npm test
```
