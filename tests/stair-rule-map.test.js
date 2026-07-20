import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createStairRuleTestMap,
  evaluateStairRuleTestMap
} from '../src/testing/stair-rule-map.js';

test('the isolated stair-rule tower passes every stair-only acceptance rule', () => {
  const map=createStairRuleTestMap();
  const report=evaluateStairRuleTestMap(map);

  assert.equal(report.pass,true,report.rules
    .filter(rule=>!rule.pass)
    .map(rule=>`${rule.label}: ${rule.detail}`)
    .join('\n'));
  assert.equal(map.floorCount,4);
  assert.equal(map.connectors.length,3);
  assert.deepEqual(map.connectors.map(connector=>connector.style),['l-turn','straight','l-turn']);
  assert.equal(map.connectors[1].width,3);
  assert.equal(map.errors.length,0);
  assert.equal(map.stairFailures.length,0);
  assert.equal(map.stairAudits.length,map.connectors.length);
  assert.ok(map.stairAudits.every(audit=>audit.pass&&audit.traversable&&audit.reachable
    &&audit.wallsComplete&&audit.slabsComplete));
});
