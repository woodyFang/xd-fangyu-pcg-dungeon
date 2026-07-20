import {
  createStairRuleTestMap,
  evaluateStairRuleTestMap
} from './testing/stair-rule-map.js';
import { mountStairRuleScene } from './testing/stair-rule-scene.js';

const map=createStairRuleTestMap();
const report=evaluateStairRuleTestMap(map);
const $=id=>document.getElementById(id);

function metric(value,label) {
  return `<article class="metric"><strong>${value}</strong><span>${label}</span></article>`;
}

function renderSummary() {
  $('summary').innerHTML=[
    metric(map.floorCount,'测试楼层'),
    metric(map.connectors.length,'楼梯连接器'),
    metric(report.rules.filter(rule=>rule.pass).length+'/'+report.rules.length,'规则通过'),
    metric(map.errors.length,'生成错误')
  ].join('');
  const status=$('overallStatus');
  status.className=`status ${report.pass?'pass':'fail'}`;
  status.textContent=report.pass?'全部楼梯规则通过':'存在楼梯规则失败';
}

function renderRules() {
  $('rules').innerHTML=report.rules.map(rule=>`
    <article class="rule ${rule.pass?'pass':'fail'}">
      <div class="mark">${rule.pass?'✓':'×'}</div>
      <div><strong>${rule.label}</strong><p>${rule.detail}</p></div>
    </article>
  `).join('');
}

function renderConnectors() {
  $('connectorList').innerHTML=map.connectors.map((connector,index)=>{
    const wallCount=(connector.stairwellLowerWallSegments?.length || 0)+(connector.stairwellUpperWallSegments?.length || 0);
    const guardCount=(connector.stairwellLowerGuardSegments?.length || 0)+(connector.stairwellUpperGuardSegments?.length || 0)+(connector.openingGuardSegments?.length || 0);
    return `<article class="connector">
      <strong>#${index+1} · F${connector.fromFloor+1} → F${connector.toFloor+1} · ${connector.style==='straight'?'直跑':'L 型'}</strong>
      <p>宽 ${connector.width} · 长 ${connector.length} · ${connector.stepCount} 级<br>洞口 ${connector.openingCells.length} 格 · 墙段 ${wallCount} · 护栏段 ${guardCount}</p>
    </article>`;
  }).join('');
}

renderSummary();
renderRules();
renderConnectors();

const sceneController=mountStairRuleScene($('scene3d'),map);
document.querySelectorAll('[data-stair-focus]').forEach(button=>{
  button.addEventListener('click',()=>{
    document.querySelectorAll('[data-stair-focus]').forEach(other=>other.classList.toggle('on',other===button));
    sceneController.setFocus(button.dataset.stairFocus);
  });
});

window.__STAIR_RULE_TEST__={map,report,sceneController};
