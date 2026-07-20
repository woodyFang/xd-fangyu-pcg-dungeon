import {
  FLOOR_HEIGHT,
  buildMultiFloorLayout
} from '../generation/multifloor.js';

export const STAIR_RULE_TEST_TILES = Object.freeze({ VOID:0, FLOOR:1, WALL:2, POOL:3 });

export const STAIR_RULE_TEST_MAP = Object.freeze({
  id:'stair-rule-tower-v1',
  name:'楼梯 PCG 规则测试塔',
  seed:170717,
  width:64,
  height:48,
  floorCount:4
});

function testRoom(id, floor) {
  return {
    id,
    cx:32,
    cy:24,
    w:44,
    h:32,
    floor,
    depth:floor,
    roleHint:floor===0 ? 'entrance' : null
  };
}

function stairEdge(id, from, to, stairSpec) {
  return {
    id,
    a:from,
    b:to,
    isLoop:false,
    isCritical:true,
    isManual:true,
    stairSpec:{
      id:`stair-rule-${id + 1}`,
      mode:'locked',
      landingDepth:2,
      wallMode:'wall-backed',
      ...stairSpec
    }
  };
}

export function createStairRuleTestMap() {
  const rooms=Array.from({length:STAIR_RULE_TEST_MAP.floorCount},(_,floor)=>testRoom(floor,floor));
  const edges=[
    stairEdge(0,0,1,{
      label:'贴墙 L 型',
      style:'l-turn',
      anchor:{x:20,y:8},
      direction:'east',
      width:2,
      length:8
    }),
    stairEdge(1,1,2,{
      label:'宽直跑',
      style:'straight',
      anchor:{x:22,y:24},
      direction:'east',
      width:3,
      length:8
    }),
    stairEdge(2,2,3,{
      label:'开放区 L 型',
      style:'l-turn',
      width:2,
      length:8
    })
  ];
  const layout=buildMultiFloorLayout({
    W:STAIR_RULE_TEST_MAP.width,
    H:STAIR_RULE_TEST_MAP.height,
    floorCount:STAIR_RULE_TEST_MAP.floorCount,
    rooms,
    edges,
    entrance:0,
    tiles:STAIR_RULE_TEST_TILES,
    legacy:{}
  });
  return {
    ...layout,
    id:STAIR_RULE_TEST_MAP.id,
    name:STAIR_RULE_TEST_MAP.name,
    seed:STAIR_RULE_TEST_MAP.seed,
    W:STAIR_RULE_TEST_MAP.width,
    H:STAIR_RULE_TEST_MAP.height,
    floorCount:STAIR_RULE_TEST_MAP.floorCount,
    floorHeight:FLOOR_HEIGHT,
    rooms,
    sourceEdges:edges
  };
}

function edgeKey(edge) {
  return [edge.x1,edge.y1,edge.x2,edge.y2].join(',');
}

function sameCellSet(actual, expected) {
  const actualSet=new Set(actual || []);
  const expectedSet=new Set(expected || []);
  return actualSet.size===expectedSet.size && [...actualSet].every(cell=>expectedSet.has(cell));
}

function boundaryPartitioned(boundary, accessField, walls, guards, mandatoryOpenField = null) {
  const wallKeys=new Set((walls || []).map(edgeKey));
  const guardKeys=new Set((guards || []).map(edgeKey));
  return (boundary || []).every(edge=>{
    const key=edgeKey(edge);
    if(edge[accessField]||(mandatoryOpenField&&edge[mandatoryOpenField])){
      return !wallKeys.has(key) && !guardKeys.has(key);
    }
    return Number(wallKeys.has(key))+Number(guardKeys.has(key))===1;
  });
}

function lTurnSeamsStayOpen(connector, lowerLayer, upperLayer) {
  if(connector.style!=='l-turn') return true;
  const footprint=new Set(connector.sharedFootprintCells || []);
  const transitionCells=(connector.stairwellBoundaryEdges || [])
    .filter(edge=>edge.neighborCell>=0
      && footprint.has(edge.neighborCell)
      && !edge.structuralSpine)
    .map(edge=>edge.neighborCell);
  return transitionCells.length>0 && transitionCells.every(cell=>
    lowerLayer.grid[cell]!==STAIR_RULE_TEST_TILES.WALL
    && upperLayer.grid[cell]!==STAIR_RULE_TEST_TILES.WALL
  );
}

export function evaluateStairRuleTestMap(map) {
  const connectors=map.connectors || [];
  const connectorChecks=connectors.map(connector=>{
    const lowerLayer=map.layers[connector.fromFloor];
    const upperLayer=map.layers[connector.toFloor];
    const expectedOpenings=(connector.sweptClearanceCells || [])
      .filter(record=>record.intersectsUpperSlab)
      .map(record=>record.cell);
    return {
      id:connector.id,
      adjacentFloor:connector.toFloor-connector.fromFloor===1,
      reservedOnBothFloors:(connector.sharedFootprintCells || []).every(cell=>
        lowerLayer.stairwellMask[cell]===1 && upperLayer.stairwellMask[cell]===1),
      headroomTight:(connector.openingCells || []).length>0
        && connector.openingCells.length<connector.stairFootprintCells.length
        && sameCellSet(connector.openingCells,expectedOpenings),
      landingsOpen:(connector.lowerApproachCells || []).every(cell=>
        lowerLayer.stairLanding[cell]===1 && lowerLayer.grid[cell]===STAIR_RULE_TEST_TILES.FLOOR)
        && (connector.upperApproachCells || []).every(cell=>
          upperLayer.stairLanding[cell]===1 && upperLayer.grid[cell]===STAIR_RULE_TEST_TILES.FLOOR),
      openingProtected:boundaryPartitioned(
        connector.openingBoundaryEdges,'access',connector.openingWallSegments,
        connector.openingGuardSegments,'stairPassage'),
      lowerWellProtected:boundaryPartitioned(
        connector.stairwellBoundaryEdges,'lowerAccess',connector.stairwellLowerWallSegments,connector.stairwellLowerGuardSegments),
      upperWellProtected:boundaryPartitioned(
        connector.stairwellBoundaryEdges,'upperAccess',connector.stairwellUpperWallSegments,connector.stairwellUpperGuardSegments),
      lTurnSeamsOpen:lTurnSeamsStayOpen(connector,lowerLayer,upperLayer),
      doubleHeightWallPolicy:connector.wallHeightPolicy==='opening-span-classified',
      stepContract:connector.stepCount===20
        && connector.stepRise===0.25
        && Math.abs(connector.stepCount*connector.stepRise-connector.rise)<1e-9
    };
  });

  const allConnectorChecks=connectorChecks.every(check=>
    Object.entries(check).every(([key,value])=>key==='id' || value===true));
  const styles=new Set(connectors.map(connector=>connector.style));
  const straight=connectors.find(connector=>connector.style==='straight');
  const wallBacked=connectors.some(connector=>{
    const walls=(connector.stairwellLowerWallSegments || []).length
      +(connector.stairwellUpperWallSegments || []).length
      +(connector.openingWallSegments || []).length;
    const guards=(connector.stairwellLowerGuardSegments || []).length
      +(connector.stairwellUpperGuardSegments || []).length
      +(connector.openingGuardSegments || []).length;
    return walls>0&&guards>0;
  });
  const rules=[
    {id:'layout',label:'测试塔生成成功',pass:map.valid && connectors.length===3,
      detail:`${map.floorCount} 层 / ${connectors.length} 部楼梯 / ${map.errors.length} 个错误`},
    {id:'styles',label:'直跑与 L 型同时覆盖',pass:styles.has('straight')&&styles.has('l-turn'),
      detail:'2 部 L 型 + 1 部直跑'},
    {id:'width',label:'1m 地砖卡尺缩放',pass:straight?.width===3,
      detail:`直跑楼梯宽度 ${straight?.width ?? '缺失'}`},
    {id:'reservation',label:'双层楼梯井占位正确',pass:connectorChecks.every(check=>check.reservedOnBothFloors),
      detail:'sharedFootprint 在上下层同步'},
    {id:'slab',label:'楼板按净高精确开洞',pass:connectorChecks.every(check=>check.headroomTight),
      detail:'只开与 2.5m 净空相交的上层楼板'},
    {id:'landing',label:'上下落地与定向入口畅通',pass:connectorChecks.every(check=>check.landingsOpen),
      detail:'入口保持 FLOOR，侧向边界不作为入口'},
    {id:'protection',label:'墙体与护栏完整互斥',pass:connectorChecks.every(check=>
      check.openingProtected&&check.lowerWellProtected&&check.upperWellProtected),
      detail:'落脚入口与梯段净空入口必须留空，其余边界只能归属墙或护栏'},
    {id:'wall-backed',label:'贴墙楼梯同时产生墙与护栏',pass:wallBacked,
      detail:'实体结构侧用墙，开放侧用护栏'},
    {id:'turn-seam',label:'L 型转角内部无横墙',pass:connectorChecks.every(check=>check.lTurnSeamsOpen),
      detail:'两段梯跑与转角平台保持连通'},
    {id:'steps',label:'层高与梯级契约一致',pass:connectorChecks.every(check=>check.stepContract),
      detail:'5m 层高 / 20 级 / 0.25m 级高'},
    {id:'reachability',label:'跨层连通验证通过',pass:map.valid
      && map.stairFailures.length===0
      && map.errors.length===0,
      detail:'仅验证测试塔的楼梯链路'},
    {id:'per-stair-audit',label:'逐楼梯生成验收通过',pass:(map.stairAudits || []).length===connectors.length
      && map.stairAudits.every(audit=>audit.pass&&audit.traversable&&audit.reachable
        &&audit.wallsComplete&&audit.slabsComplete),
      detail:'每部楼梯均检查通行、墙体/护栏与上下层楼板洞口'}
  ];
  return {
    pass:rules.every(rule=>rule.pass) && allConnectorChecks,
    rules,
    connectorChecks
  };
}
