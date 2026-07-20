import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

import { stairRunCenter, stairTurnPlatformMetrics } from '../domain/stair-contract.js';
import { stairRailProtectionSegments, stairWallFinishSegments } from '../render/stair-style.js';
import { STAIR_RULE_TEST_TILES } from './stair-rule-map.js';

const COLORS=Object.freeze({
  background:0x07101b,
  floor:0x53647e,
  floorEdge:0x8da3c4,
  wall:0x69758b,
  wallCap:0x9ba8bd,
  stair:0xf0a64a,
  stairCap:0xffd38a,
  landing:0xd98b35,
  rail:0x65e0d9,
  wallRail:0xff7b72,
  opening:0x4cc9f0,
  access:0x65ee9b
});

function worldX(map,x){ return x-map.W/2+.5; }
function worldZ(map,y){ return y-map.H/2+.5; }

function material(color,{opacity=1,metalness=0,roughness=.72,emissive=0}={}){
  return new THREE.MeshStandardMaterial({
    color,
    emissive,
    emissiveIntensity:emissive ? .18 : 0,
    metalness,
    roughness,
    transparent:opacity<1,
    opacity,
    depthWrite:opacity>=1
  });
}

function beamBetween(root,start,end,beamMaterial,thickness=.06){
  const a=new THREE.Vector3(start.x,start.y,start.z);
  const b=new THREE.Vector3(end.x,end.y,end.z);
  const direction=b.clone().sub(a);
  const length=direction.length();
  if(length<.001) return;
  const mesh=new THREE.Mesh(new THREE.BoxGeometry(1,1,1),beamMaterial);
  mesh.position.copy(a).add(b).multiplyScalar(.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(1,0,0),direction.normalize());
  mesh.scale.set(length,thickness,thickness);
  mesh.castShadow=true;
  root.add(mesh);
}

function railPost(root,map,point,baseY,height,postMaterial){
  const post=new THREE.Mesh(new THREE.CylinderGeometry(.045,.055,height,8),postMaterial);
  post.position.set(worldX(map,point.x),baseY+height/2,worldZ(map,point.z));
  post.castShadow=true;
  root.add(post);
}

function addHorizontalGuard(root,map,edge,baseY,railMaterial){
  const height=.82;
  const start={x:worldX(map,edge.x1),y:baseY+height,z:worldZ(map,edge.y1)};
  const end={x:worldX(map,edge.x2),y:baseY+height,z:worldZ(map,edge.y2)};
  beamBetween(root,start,end,railMaterial,.065);
  railPost(root,map,{x:edge.x1,z:edge.y1},baseY,height,railMaterial);
  railPost(root,map,{x:edge.x2,z:edge.y2},baseY,height,railMaterial);
}

function openingLine(root,map,edge,y,lineMaterial){
  const geometry=new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(worldX(map,edge.x1),y,worldZ(map,edge.y1)),
    new THREE.Vector3(worldX(map,edge.x2),y,worldZ(map,edge.y2))
  ]);
  root.add(new THREE.Line(geometry,lineMaterial));
}

function addWallFinishPanel(root,map,segment,panelMaterial){
  const normal=segment.wallNormal || {x:0,y:0};
  const half=segment.finishThickness/2;
  const vertices=[];
  const add=(point,side,top)=>vertices.push(
    worldX(map,point.x+normal.x*half*side),
    point.y+(top?segment.finishHeight:0),
    worldZ(map,point.z+normal.y*half*side)
  );
  add(segment.start,-1,false);add(segment.end,-1,false);
  add(segment.end,-1,true);add(segment.start,-1,true);
  add(segment.start,1,false);add(segment.end,1,false);
  add(segment.end,1,true);add(segment.start,1,true);
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));
  geometry.setIndex([
    0,1,2,0,2,3, 5,4,7,5,7,6,
    4,0,3,4,3,7, 1,5,6,1,6,2,
    3,2,6,3,6,7, 4,5,1,4,1,0
  ]);
  geometry.computeVertexNormals();
  const mesh=new THREE.Mesh(geometry,panelMaterial);
  mesh.castShadow=true;
  mesh.receiveShadow=true;
  root.add(mesh);
}

function wallCellSets(map,floor){
  const doubleHeight=new Set();
  const coveredUpper=new Set();
  for(const connector of map.connectors || []){
    if(connector.wallHeightPolicy!=='double-floor-lower-wall') continue;
    if(connector.fromFloor===floor){
      for(const segment of connector.stairwellLowerWallSegments || []){
        if(segment.neighborCell>=0) doubleHeight.add(segment.neighborCell);
      }
    }
    if(connector.toFloor===floor){
      for(const segment of connector.stairwellLowerWallSegments || []){
        if(segment.neighborCell>=0) coveredUpper.add(segment.neighborCell);
      }
    }
  }
  return {doubleHeight,coveredUpper};
}

function buildFloorStructure(map,layer,materials){
  const root=new THREE.Group();
  root.name=`floor-${layer.floor+1}`;
  const baseY=layer.floor*map.floorHeight;
  const {doubleHeight,coveredUpper}=wallCellSets(map,layer.floor);
  const slabGeometry=new THREE.BoxGeometry(.94,.12,.94);
  const wallGeometry=new THREE.BoxGeometry(.96,1,.96);
  const floorCells=[];
  const wallCells=[];
  for(let cell=0;cell<layer.grid.length;cell++){
    if(layer.grid[cell]===STAIR_RULE_TEST_TILES.FLOOR
      && !layer.stairMask[cell]
      && !layer.slabOpening[cell]) floorCells.push(cell);
    if(layer.grid[cell]===STAIR_RULE_TEST_TILES.WALL && !coveredUpper.has(cell)) wallCells.push(cell);
  }
  const slabs=new THREE.InstancedMesh(slabGeometry,materials.floor,floorCells.length);
  const walls=new THREE.InstancedMesh(wallGeometry,materials.wall,wallCells.length);
  const matrix=new THREE.Matrix4();
  const position=new THREE.Vector3();
  const quaternion=new THREE.Quaternion();
  const scale=new THREE.Vector3(1,1,1);
  floorCells.forEach((cell,index)=>{
    const x=cell%map.W,z=Math.floor(cell/map.W);
    position.set(worldX(map,x),baseY-.06,worldZ(map,z));
    scale.set(1,1,1);
    matrix.compose(position,quaternion,scale);
    slabs.setMatrixAt(index,matrix);
  });
  wallCells.forEach((cell,index)=>{
    const x=cell%map.W,z=Math.floor(cell/map.W);
    const height=doubleHeight.has(cell)?map.floorHeight+1.2:1.2;
    position.set(worldX(map,x),baseY+height/2,worldZ(map,z));
    scale.set(1,height,1);
    matrix.compose(position,quaternion,scale);
    walls.setMatrixAt(index,matrix);
  });
  slabs.receiveShadow=true;
  walls.castShadow=true;
  walls.receiveShadow=true;
  root.add(slabs,walls);
  return root;
}

function addStep(root,map,connector,origin,direction,along,depth,top,baseY,materials){
  const x=origin.x+direction.x*along;
  const z=origin.y+direction.y*along;
  const mesh=new THREE.Mesh(new THREE.BoxGeometry(
    direction.x ? depth : connector.width,
    top,
    direction.x ? connector.width : depth
  ),materials.stair);
  mesh.position.set(worldX(map,x),baseY+top/2,worldZ(map,z));
  mesh.castShadow=true;
  mesh.receiveShadow=true;
  root.add(mesh);
  const cap=new THREE.Mesh(new THREE.BoxGeometry(
    direction.x ? depth*.92 : connector.width*.96,
    .045,
    direction.x ? connector.width*.96 : depth*.92
  ),materials.stairCap);
  cap.position.set(worldX(map,x),baseY+top+.018,worldZ(map,z));
  cap.receiveShadow=true;
  root.add(cap);
}

function buildStair(map,connector,materials){
  const root=new THREE.Group();
  root.name=`stair-${connector.id+1}`;
  const baseY=connector.fromFloor*map.floorHeight;
  const rise=connector.rise || map.floorHeight;
  const steps=connector.stepCount || 12;
  if(connector.style==='l-turn'){
    const platform=stairTurnPlatformMetrics(connector);
    const firstSteps=connector.firstFlightSteps;
    const secondSteps=connector.secondFlightSteps;
    const tread1=connector.firstRun/Math.max(1,firstSteps);
    const tread2=connector.secondRun/Math.max(1,secondSteps);
    for(let i=0;i<firstSteps;i++) addStep(root,map,connector,platform.first.start,
      connector.directionVector,(i+.5)*tread1,tread1,rise*(i+1)/steps,baseY,materials);
    for(let i=0;i<secondSteps;i++) addStep(root,map,connector,platform.second.start,
      connector.secondDirectionVector,(i+.5)*tread2,tread2,rise*(firstSteps+i+1)/steps,baseY,materials);
    const landingY=baseY+rise*firstSteps/steps;
    const landing=new THREE.Mesh(new THREE.BoxGeometry(platform.visualSpan,.14,platform.visualSpan),materials.landing);
    landing.position.set(worldX(map,platform.center.x),landingY-.07,worldZ(map,platform.center.y));
    landing.castShadow=true;
    landing.receiveShadow=true;
    root.add(landing);
  }else{
    const direction=connector.directionVector;
    const origin=stairRunCenter(connector.lower,direction,connector.width,connector.lateralCenterOffset);
    const tread=connector.length/steps;
    for(let i=0;i<steps;i++) addStep(root,map,connector,origin,direction,
      (i+.5)*tread,tread,rise*(i+1)/steps,baseY,materials);
  }

  const railOffset=connector.width/2+.08;
  const wallFinishes=stairWallFinishSegments(connector,rise,baseY,railOffset,{
    wallInset:.025,finishHeight:.24,finishThickness:.065
  });
  for(const finish of wallFinishes) addWallFinishPanel(root,map,finish,materials.wallFinish);
  const rails=stairRailProtectionSegments(connector,rise,baseY,railOffset,{wallInset:.18});
  for(const rail of rails){
    if(rail.protection==='wall-blocked') continue;
    const railMaterial=rail.protection==='wall-handrail'?materials.wallRail:materials.rail;
    const height=rail.protection==='wall-handrail'?.72:.82;
    const start={x:worldX(map,rail.start.x),y:rail.start.y+height,z:worldZ(map,rail.start.z)};
    const end={x:worldX(map,rail.end.x),y:rail.end.y+height,z:worldZ(map,rail.end.z)};
    beamBetween(root,start,end,railMaterial,.065);
    if(rail.protection!=='wall-handrail'){
      railPost(root,map,rail.start,rail.start.y,height,railMaterial);
      railPost(root,map,rail.end,rail.end.y,height,railMaterial);
    }
  }

  const upperY=connector.toFloor*map.floorHeight+.02;
  for(const edge of connector.openingGuardSegments || []) addHorizontalGuard(root,map,edge,upperY,materials.rail);
  for(const edge of connector.openingBoundaryEdges || []) openingLine(root,map,edge,upperY+.03,materials.openingLine);
  for(const edge of connector.openingAccessEdges || []) openingLine(root,map,edge,upperY+.055,materials.accessLine);
  return root;
}

export function mountStairRuleScene(container,map){
  const scene=new THREE.Scene();
  scene.background=new THREE.Color(COLORS.background);
  scene.fog=new THREE.FogExp2(COLORS.background,.012);
  const camera=new THREE.PerspectiveCamera(45,1,.1,180);
  camera.position.set(29,22,32);
  const renderer=new THREE.WebGLRenderer({antialias:true,alpha:false});
  renderer.setPixelRatio(Math.min(2,window.devicePixelRatio || 1));
  renderer.shadowMap.enabled=true;
  renderer.shadowMap.type=THREE.PCFShadowMap;
  renderer.outputColorSpace=THREE.SRGBColorSpace;
  renderer.toneMapping=THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure=1.12;
  container.append(renderer.domElement);

  const controls=new OrbitControls(camera,renderer.domElement);
  controls.enableDamping=true;
  controls.dampingFactor=.06;
  controls.target.set(0,4.5,0);
  controls.minDistance=8;
  controls.maxDistance=85;
  controls.maxPolarAngle=Math.PI*.49;

  scene.add(new THREE.HemisphereLight(0xa8c8ff,0x172034,1.45));
  const key=new THREE.DirectionalLight(0xffeed7,3.4);
  key.position.set(18,34,22);
  key.castShadow=true;
  key.shadow.mapSize.set(2048,2048);
  key.shadow.camera.left=-40;key.shadow.camera.right=40;
  key.shadow.camera.top=40;key.shadow.camera.bottom=-40;
  scene.add(key);
  const rim=new THREE.DirectionalLight(0x4cc9f0,1.6);
  rim.position.set(-24,16,-18);
  scene.add(rim);

  const materials={
    floor:material(COLORS.floor,{opacity:.34,roughness:.88}),
    wall:material(COLORS.wall,{opacity:.48,roughness:.9}),
    stair:material(COLORS.stair,{roughness:.62}),
    stairCap:material(COLORS.stairCap,{metalness:.08,roughness:.42}),
    landing:material(COLORS.landing,{roughness:.68}),
    rail:material(COLORS.rail,{metalness:.7,roughness:.26,emissive:0x133e42}),
    wallRail:material(COLORS.wallRail,{metalness:.55,roughness:.32}),
    wallFinish:material(0xd18d48,{metalness:.04,roughness:.7}),
    openingLine:new THREE.LineBasicMaterial({color:COLORS.opening,transparent:true,opacity:.95}),
    accessLine:new THREE.LineBasicMaterial({color:COLORS.access})
  };
  const floorRoots=map.layers.map(layer=>buildFloorStructure(map,layer,materials));
  const stairRoots=map.connectors.map(connector=>buildStair(map,connector,materials));
  floorRoots.forEach(root=>scene.add(root));
  stairRoots.forEach(root=>scene.add(root));

  const grid=new THREE.GridHelper(64,64,0x263b57,0x142033);
  grid.position.y=-.13;
  scene.add(grid);

  const resize=()=>{
    const width=Math.max(1,container.clientWidth);
    const height=Math.max(1,container.clientHeight);
    renderer.setSize(width,height,false);
    camera.aspect=width/height;
    camera.updateProjectionMatrix();
  };
  const resizeObserver=new ResizeObserver(resize);
  resizeObserver.observe(container);
  resize();

  let focus='all';
  const setFocus=value=>{
    focus=value;
    const index=value==='all'?-1:Number(value);
    floorRoots.forEach((root,floor)=>{
      root.visible=index<0 || floor===map.connectors[index].fromFloor || floor===map.connectors[index].toFloor;
    });
    stairRoots.forEach((root,stairIndex)=>{ root.visible=index<0 || stairIndex===index; });
    if(index<0){
      camera.position.set(29,22,32);
      controls.target.set(0,4.5,0);
    }else{
      const connector=map.connectors[index];
      const centerX=worldX(map,(connector.lower.x+connector.upper.x)/2);
      const centerZ=worldZ(map,(connector.lower.y+connector.upper.y)/2);
      const centerY=(connector.fromFloor+.5)*map.floorHeight;
      camera.position.set(centerX+12,centerY+9,centerZ+13);
      controls.target.set(centerX,centerY,centerZ);
    }
    controls.update();
  };

  renderer.setAnimationLoop(()=>{
    controls.update();
    renderer.render(scene,camera);
  });
  return {
    renderer,
    setFocus,
    getFocus:()=>focus,
    dispose(){
      resizeObserver.disconnect();
      renderer.setAnimationLoop(null);
      controls.dispose();
      renderer.dispose();
      container.replaceChildren();
    }
  };
}
