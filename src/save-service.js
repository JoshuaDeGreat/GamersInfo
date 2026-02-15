const { buildIndex } = require('./xml-indexer');
const { exportPatchedSave } = require('./xml-rewriter');

module.exports = {
  buildIndex,
  exportPatchedSave
};
