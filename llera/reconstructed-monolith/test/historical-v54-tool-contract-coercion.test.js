'use strict';

const assert = require('node:assert');
const { HISTORICAL_V54_AGENT_TOOLS, compareToolSurface } = require('../src/historical-v54-tool-contract');

const exact = compareToolSurface([...HISTORICAL_V54_AGENT_TOOLS]);
assert.strictEqual(exact.exactIdentityParity, true);
assert.strictEqual(exact.historicalCount, 62);
assert.strictEqual(exact.candidateCount, 62);
assert.strictEqual(exact.uniqueCandidateCount, 62);
assert.strictEqual(exact.duplicateCount, 0);
assert.deepStrictEqual(exact.missingHistorical, []);
assert.deepStrictEqual(exact.nonHistorical, []);

let coercionCalls = 0;
const coerciveTool = {
  toString() {
    coercionCalls += 1;
    return 'write_file';
  },
  valueOf() {
    coercionCalls += 1;
    return 'write_file';
  }
};
assert.throws(
  () => compareToolSurface([...HISTORICAL_V54_AGENT_TOOLS.slice(0, -1), coerciveTool]),
  /tool identity must be a string/
);
assert.strictEqual(coercionCalls, 0, 'tool-surface parity must reject objects without coercing them');

const duplicate = compareToolSurface([...HISTORICAL_V54_AGENT_TOOLS, 'write_file']);
assert.strictEqual(duplicate.exactIdentityParity, false);
assert.strictEqual(duplicate.duplicateCount, 1);

const extra = compareToolSurface([...HISTORICAL_V54_AGENT_TOOLS, 'future_tool']);
assert.strictEqual(extra.exactIdentityParity, false);
assert.deepStrictEqual(extra.nonHistorical, ['future_tool']);

console.log('historical V5.4 tool identity coercion boundary regression PASS');
