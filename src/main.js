/**
 * DUNGEON FORGE — entry point.
 *
 * A self-contained procedural dungeon generator + real-time showcase.
 * The whole pipeline (scatter → separate → Delaunay → MST+loops → semantics
 * → carve → rasterize+BFS → decorate → instanced render) lives in this module,
 * driven by a single deterministic mulberry32 stream so any seed rebuilds the
 * exact same dungeon.
 *
 * Rendering targets Three.js r128 (see README → "A note on the Three.js
 * version"). The named-export namespace import below is the ESM equivalent of
 * the global `THREE` the original prototype pulled from a CDN.
 */
import * as THREE from 'three';

/* ================================================================
   DUNGEON FORGE — procedural dungeon generator core + showcase
   Pipeline: scatter → separate → Delaunay → MST+loops → semantics
             → carve → rasterize+BFS → decorate → instanced render
   Deterministic: mulberry32 threaded through every stage.
   ================================================================ */

/* ---------------- RNG ---------------- */
function mulberry32(seed){
  let a = seed >>> 0;
  return function(){
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function makeRng(seed){
  const r = mulberry32(seed);
  return {
    f:(a,b)=> a + r()*(b-a),
    i:(a,b)=> a + Math.floor(r()*(b-a+1)),
    pick:(arr)=> arr[Math.floor(r()*arr.length)],
    chance:(p)=> r() < p,
    raw:r,
    gauss(mu,sig){ let u=0,v=0; while(u===0)u=r(); while(v===0)v=r();
      return mu + sig*Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v); }
  };
}

/* ---------------- constants ---------------- */
const VOID=0, FLOOR=1, WALL=2, POOL=3;
const TYPE = { ENTRANCE:'entrance', COMBAT:'combat', ELITE:'elite', TREASURE:'treasure', SHRINE:'shrine', BOSS:'boss' };
const TINT = { entrance:0x3fd0bb, combat:0x8f95a3, elite:0x9b6cf0, treasure:0xd9a441, shrine:0x5a8fe8, boss:0xd8433a };

/* ---------------- setting + palette specs ----------------
   Settings choose the asset kit and room dressing; palettes choose colour,
   lighting, liquids, particles, and environmental overlays. */
const SETTINGS = {
  dungeon: {
    label:'遗迹', kit:'dungeon',
    nameA:null, nameB:null
  },
  hospital: {
    label:'医院', kit:'hospital',
    nameA:['废弃','静默','隔离','苍白','失序','封锁','无菌','深夜'],
    nameB:['病区','诊疗楼','手术区','急诊层','隔离舱','住院部','地下病房','档案室']
  }
};
const PALETTES = {
  ancient: {
    label:'暖灰', accent:'#e8973f',
    bg:0x07080d, fog:0x07080d, fogD:0.0021,
    hemi:[0x2e3a52, 0x0a0b10, 0.55], dir:[0xffe8c8, 0.85],
    floor:0x8a8f9c, corridor:0x6d7380, wall:0x5c626e, cap:0x757b88,
    pillar:0x6a707e, debris:[0x4c515e, 0x60584a],
    flame:0xffa640, flameCore:0xfff3c8, torchLight:[0xff8c3a, 1.5, 9.5],
    cloth:0x7d2c26,
    pools:null, particles:{kind:0, color:0xaab4cc, n:110},
    nameA:['沉没','遗忘','寂静','空洞','古老','破碎','无名','陨落'],
    nameB:['大厅','库区','中庭','深层','节点','场域','核心区','资料库']
  },
  molten: {
    label:'暖橙', accent:'#ff8642',
    bg:0x0c0605, fog:0x1a0b04, fogD:0.0028,
    hemi:[0x6b3419, 0x160503, 0.55], dir:[0xffd9b0, 0.5],
    floor:0x7a685c, corridor:0x614f44, wall:0x503e34, cap:0x6b5546,
    pillar:0x5e4a3e, debris:[0x4a382e, 0x60462f],
    flame:0xff8c26, flameCore:0xffe9b0, torchLight:[0xff7326, 1.7, 10],
    cloth:0x7d2416,
    pools:{mode:0, colA:0x2b0d05, colB:0xff5a1f, glow:1.55, amount:0.16, pits:2},
    particles:{kind:1, color:0xffa050, n:240},
    nameA:['熔火','灰烬','焦痕','闷燃','炭化','燃烧','余烬','灼烧'],
    nameB:['熔炉','火膛','炼狱池','铸造厂','窑穴','裂隙','坩埚','深处']
  },
  frost: {
    label:'冷蓝', accent:'#7fd4ff',
    bg:0x060a12, fog:0x0b1522, fogD:0.0024,
    hemi:[0x3a5a80, 0x0a0e18, 0.5], dir:[0xcfe4ff, 0.82],
    floor:0x93a0b2, corridor:0x78848f, wall:0x60708a, cap:0x8194ac,
    pillar:0x70809a, debris:[0x55617a, 0x6d7a90],
    flame:0x86d9ff, flameCore:0xe8f7ff, torchLight:[0x6fc4ff, 1.35, 9.5],
    cloth:0x2b4d70,
    pools:{mode:1, colA:0x4a86c0, colB:0xbfe4ff, glow:0.55, amount:0},
    lakes:true, icicles:true, particles:{kind:2, color:0xdff0ff, n:260},
    nameA:['冰封','霜缚','冰川','呼啸','苍白','战栗','凛冬','白锁'],
    nameB:['冰室','冰窟','空洞','长廊','冷区','巢穴','寒域','冰喉']
  },
  grim: {
    label:'暗绿', accent:'#9fe66a',
    bg:0x070a07, fog:0x0a130a, fogD:0.0030,
    hemi:[0x2c4030, 0x070a06, 0.52], dir:[0xbfd8b0, 0.45],
    floor:0x7c8276, corridor:0x62685c, wall:0x4f5549, cap:0x666c5e,
    pillar:0x5c6254, debris:[0x4a4f44, 0x5e5c48],
    flame:0x8fe05a, flameCore:0xe9ffd0, torchLight:[0x77d94a, 1.35, 9],
    cloth:0x33461f,
    pools:{mode:3, colA:0x0a1207, colB:0x41602c, glow:0.6, amount:0.05, pits:1},
    graveyards:true, bones:true, particles:{kind:3, color:0x9fe66a, n:150},
    nameA:['枯萎','啜泣','腐朽','诅咒','幽影','瘟疫','哀恸','阴森'],
    nameB:['废城','残区','遗址','暗窖','荒地','暗区','封存间','地下层']
  },
  verdant: {
    label:'青绿', accent:'#59d68f',
    bg:0x060c09, fog:0x091510, fogD:0.0023,
    hemi:[0x2f5a46, 0x08120c, 0.6], dir:[0xd8f0c8, 0.8],
    floor:0x848e7e, corridor:0x6a7560, wall:0x556050, cap:0x6e7a66,
    pillar:0x606c5c, debris:[0x49543f, 0x5c644c],
    flame:0x62e0a8, flameCore:0xe6fff0, torchLight:[0x4ad98e, 1.3, 9],
    cloth:0x1f5038,
    pools:{mode:2, colA:0x0c3532, colB:0x2fa38a, glow:0.6, amount:0.05, pits:1},
    roots:true, shafts:true, particles:{kind:4, color:0x8fe6b8, n:200},
    nameA:['繁茂','蔓生','孢缚','纠缠','苔覆','苏醒','野性','盛放'],
    nameB:['花园','巢穴','根系','温室','空洞','林苑','蓄水池','树廊']
  },
  sterile: {
    label:'冷白', accent:'#5fd1c7',
    bg:0x05090a, fog:0x071011, fogD:0.0025,
    hemi:[0x6f8f8a, 0x050909, 0.34], dir:[0xb7d6cf, 0.34],
    floor:0x6f7975, corridor:0x626d69, wall:0x56615d, cap:0x78837f,
    pillar:0x5d6865, debris:[0x434b49, 0x747f7b],
    flame:0x5fd1c7, flameCore:0xcffaf3, torchLight:[0x58c8bf, 0.62, 7.5],
    cloth:0x1f6f66,
    pools:{mode:2, colA:0x071918, colB:0x2f8f86, glow:0.22, amount:0.025, pits:1},
    particles:{kind:0, color:0xa9d8d1, n:120},
    nameA:['无菌','苍白','隔离','静默','冷光','消毒','封闭','低温'],
    nameB:['楼层','回廊','病区','诊室','大厅','隔间','舱室','侧翼']
  },
  abandoned: {
    label:'灰绿', accent:'#79b65f',
    bg:0x050807, fog:0x08100b, fogD:0.0029,
    hemi:[0x47654d, 0x050806, 0.38], dir:[0xa9c39b, 0.38],
    floor:0x687067, corridor:0x5c655d, wall:0x515951, cap:0x737b72,
    pillar:0x596156, debris:[0x3f473d, 0x6d705d],
    flame:0x83d86b, flameCore:0xe8ffd8, torchLight:[0x72c95d, 0.75, 8],
    cloth:0x2b5730,
    pools:{mode:3, colA:0x071008, colB:0x36562e, glow:0.38, amount:0.045, pits:1},
    bones:true, particles:{kind:3, color:0xa2df88, n:140},
    nameA:['废弃','霉斑','停电','封锁','潮湿','破败','失序','阴冷'],
    nameB:['楼层','回廊','病区','诊室','大厅','隔间','舱室','侧翼']
  },
  emergency: {
    label:'警示红', accent:'#ff5b4f',
    bg:0x0a0607, fog:0x14090a, fogD:0.0026,
    hemi:[0x7a4544, 0x080505, 0.36], dir:[0xffc1b8, 0.4],
    floor:0x6f6868, corridor:0x625c5c, wall:0x5a5050, cap:0x7c7371,
    pillar:0x625654, debris:[0x493f3e, 0x7d6c66],
    flame:0xff6d5f, flameCore:0xffeee8, torchLight:[0xff4d42, 0.85, 8.5],
    cloth:0x8c2f2a,
    pools:{mode:3, colA:0x160706, colB:0x74322d, glow:0.45, amount:0.035, pits:1},
    particles:{kind:0, color:0xffb3aa, n:120},
    nameA:['急诊','警报','封控','红灯','抢救','深夜','失序','高危'],
    nameB:['楼层','回廊','病区','诊室','大厅','隔间','舱室','侧翼']
  }
};
const SETTING_KEYS = Object.keys(SETTINGS);
const PALETTE_KEYS = Object.keys(PALETTES);
const DUNGEON_PALETTE_KEYS = ['ancient','molten','frost','grim','verdant'];
const HOSPITAL_PALETTE_KEYS = ['sterile','abandoned','emergency'];
function themeSpec(settingKey, paletteKey){
  const setting = SETTINGS[settingKey] || SETTINGS.dungeon;
  const palette = PALETTES[paletteKey] || PALETTES.ancient;
  return {
    ...palette,
    settingKey, paletteKey, kit:setting.kit,
    settingLabel:setting.label, paletteLabel:palette.label,
    label:setting.label + ' · ' + palette.label,
    nameA:setting.nameA || palette.nameA,
    nameB:setting.nameB || palette.nameB
  };
}

/* ---------------- name generator ---------------- */
function dungeonName(rng, th){
  const clans=['\u739b\u5c14','\u6c83\u5c14','\u963f\u4ec0','\u51ef\u5c14','\u4e4c\u5c14','\u5fb7\u62c9','\u8bfa\u65af','\u624e\u5c14','\u8d1d\u5c14','\u83ab\u5c14','\u6208\u5c14','\u4f0a\u65af'];
  const suffix=['\u6208\u65af','\u963f\u65af','\u9c81\u514b','\u827e\u4ec0','\u7c73\u5c14','\u53e4\u5c14','\u4e39','\u5965\u65af','\u827e\u514b','\u963f\u4ec0','\u4e4c\u6cfd\u514b','\u963f\u91cc\u59c6'];
  return rng.pick(clans) + rng.pick(suffix) + '\u7684' + rng.pick(th.nameA) + rng.pick(th.nameB);
}

/* ---------------- Delaunay (Bowyer–Watson) ---------------- */
function delaunay(pts){
  const n = pts.length;
  if(n < 2) return [];
  if(n === 2) return [[0,1]];
  const P = pts.map((p,i)=>({x:p.x + ((i*0.618033)%1)*1e-3, y:p.y + ((i*0.414213)%1)*1e-3, i}));
  let minX=1e18,minY=1e18,maxX=-1e18,maxY=-1e18;
  for(const p of P){ if(p.x<minX)minX=p.x; if(p.y<minY)minY=p.y; if(p.x>maxX)maxX=p.x; if(p.y>maxY)maxY=p.y; }
  const dm = Math.max(maxX-minX, maxY-minY, 1), mx=(minX+maxX)/2, my=(minY+maxY)/2;
  const s1={x:mx-30*dm,y:my-dm,i:-1}, s2={x:mx,y:my+30*dm,i:-2}, s3={x:mx+30*dm,y:my-dm,i:-3};
  const mkTri=(a,b,c)=>{
    const t=[a,b,c];
    const d=2*(a.x*(b.y-c.y)+b.x*(c.y-a.y)+c.x*(a.y-b.y));
    if(Math.abs(d)<1e-12){ t.ccx=0; t.ccy=0; t.r2=Infinity; return t; }
    const a2=a.x*a.x+a.y*a.y, b2=b.x*b.x+b.y*b.y, c2=c.x*c.x+c.y*c.y;
    t.ccx=(a2*(b.y-c.y)+b2*(c.y-a.y)+c2*(a.y-b.y))/d;
    t.ccy=(a2*(c.x-b.x)+b2*(a.x-c.x)+c2*(b.x-a.x))/d;
    t.r2=(a.x-t.ccx)*(a.x-t.ccx)+(a.y-t.ccy)*(a.y-t.ccy);
    return t;
  };
  let tris=[mkTri(s1,s2,s3)];
  for(const p of P){
    const bad=[], edges=[];
    for(const t of tris){ if((p.x-t.ccx)*(p.x-t.ccx)+(p.y-t.ccy)*(p.y-t.ccy) < t.r2) bad.push(t); }
    for(const t of bad) for(let e=0;e<3;e++) edges.push([t[e],t[(e+1)%3]]);
    const poly=[];
    for(let i=0;i<edges.length;i++){
      let shared=false;
      for(let j=0;j<edges.length;j++){ if(i===j) continue;
        const a=edges[i],b=edges[j];
        if((a[0]===b[0]&&a[1]===b[1])||(a[0]===b[1]&&a[1]===b[0])){shared=true;break;}
      }
      if(!shared) poly.push(edges[i]);
    }
    tris = tris.filter(t=>!bad.includes(t));
    for(const e of poly) tris.push(mkTri(e[0],e[1],p));
  }
  tris = tris.filter(t=>t[0].i>=0 && t[1].i>=0 && t[2].i>=0);
  const seen=new Set(), out=[];
  for(const t of tris) for(let e=0;e<3;e++){
    const a=t[e].i, b=t[(e+1)%3].i, lo=Math.min(a,b), hi=Math.max(a,b), k=lo*4096+hi;
    if(!seen.has(k)){ seen.add(k); out.push([lo,hi]); }
  }
  return out;
}

/* ---------------- generator ---------------- */
function edgeRoutePoints(e){
  const ax=e.ax, ay=e.ay, bx=e.bx, by=e.by;
  if(e.route) return e.route;
  const horizontalOut = e.aside==='e' || e.aside==='w' || e.bside==='e' || e.bside==='w';
  const pts = horizontalOut ? [{x:ax,y:ay},{x:bx,y:ay},{x:bx,y:by}] : [{x:ax,y:ay},{x:ax,y:by},{x:bx,y:by}];
  return pts.filter((p,i)=>i===0 || p.x!==pts[i-1].x || p.y!==pts[i-1].y);
}
function assignEdgeRoute(e){
  const ax=e.ax, ay=e.ay, bx=e.bx, by=e.by;
  let first = Math.abs(ax-bx) >= Math.abs(ay-by) ? 'h' : 'v';
  if((e.aside==='n' || e.aside==='s') && (e.bside==='n' || e.bside==='s')) first='v';
  else if((e.aside==='e' || e.aside==='w') && (e.bside==='e' || e.bside==='w')) first='h';
  const pts = first==='h' ? [{x:ax,y:ay},{x:bx,y:ay},{x:bx,y:by}] : [{x:ax,y:ay},{x:ax,y:by},{x:bx,y:by}];
  e.route = pts.filter((p,i)=>i===0 || p.x!==pts[i-1].x || p.y!==pts[i-1].y);
}
function roomDoorPoint(A, B, margin=1){
  const dx = B.cx - A.cx, dy = B.cy - A.cy;
  const hw = Math.max(1, A.w/2 - margin), hh = Math.max(1, A.h/2 - margin);
  let x=A.cx, y=A.cy, side='e';
  if(Math.abs(dx) / Math.max(1, hw) >= Math.abs(dy) / Math.max(1, hh)){
    x = A.cx + (dx >= 0 ? hw : -hw);
    y = A.cy + Math.max(-hh, Math.min(hh, dy));
    side = dx >= 0 ? 'e' : 'w';
  } else {
    x = A.cx + Math.max(-hw, Math.min(hw, dx));
    y = A.cy + (dy >= 0 ? hh : -hh);
    side = dy >= 0 ? 's' : 'n';
  }
  return {x:Math.round(x), y:Math.round(y), side};
}
function edgeDoorPoints(e, rooms){
  const A=rooms[e.a], B=rooms[e.b];
  return {da:roomDoorPoint(A,B), db:roomDoorPoint(B,A)};
}
function classifyArch(w, h){
  const area = w * h, m = Math.max(w, h);
  if(m >= 13 || area >= 130) return 'l';
  if(m >= 8 || area >= 64) return 'm';
  return 's';
}
function makeRoomRecord(id, cx, cy, w, h, shape, locked, roleHint){
  w = Math.max(5, Math.round(w)); h = Math.max(5, Math.round(h));
  cx = Math.round(cx); cy = Math.round(cy);
  return { id, sourceId:id, cx, cy, w, h, arch:classifyArch(w,h), shape:shape || 'rect',
    sx0:cx, sy0:cy, type:TYPE.COMBAT, depth:0, difficulty:0.2, degree:0,
    locked:!!locked, roleHint:roleHint || null };
}
function randomScatterRooms(rng, N, idStart, centerX, centerY){
  const R = Math.sqrt(Math.max(1, N)) * 4.6;
  const rooms = [], large = [];
  for(let i=0;i<N;i++){
    const t = rng.raw();
    let w,h,arch;
    if(t<0.45){ arch='s'; w=rng.i(5,7);  h=rng.i(5,7); }
    else if(t<0.85){ arch='m'; w=rng.i(8,12); h=rng.i(8,12); }
    else { arch='l'; w=rng.i(13,18); h=rng.i(13,18); large.push(i); }
    const st = rng.raw();
    const shape = st<0.60 ? 'rect' : (st<0.82 ? 'ellipse' : 'oct');
    const ang = rng.f(0, Math.PI*2), rad = R*Math.sqrt(rng.raw());
    const cx = Math.cos(ang)*rad + (centerX || 0), cy = Math.sin(ang)*rad + (centerY || 0);
    rooms.push({ id:idStart+i, sourceId:null, cx, cy, w, h, arch, shape, sx0:cx, sy0:cy,
      type:TYPE.COMBAT, depth:0, difficulty:0.2, degree:0, locked:false, roleHint:null });
  }
  while(large.length < Math.min(2, N)){
    const j = rng.i(0, N-1);
    if(rooms[j].arch !== 'l'){
      rooms[j].arch='l'; rooms[j].w=rng.i(13,18); rooms[j].h=rng.i(13,18); rooms[j].shape='rect'; large.push(j);
    }
  }
  return rooms;
}
function initialRoomsFromParams(rng, params){
  const editorRooms = params.editorEnabled && Array.isArray(params.editorRooms) ? params.editorRooms : [];
  if(!editorRooms.length) return randomScatterRooms(rng, params.roomCount, 0, 0, 0);
  const rooms = editorRooms.map((r,i)=>makeRoomRecord(i, r.x, r.y, r.w, r.h, r.shape, r.locked, r.roleHint));
  const target = Math.max(params.roomCount, rooms.length);
  if(rooms.length < target){
    let cx=0, cy=0;
    for(const r of rooms){ cx += r.cx; cy += r.cy; }
    cx /= Math.max(1, rooms.length); cy /= Math.max(1, rooms.length);
    rooms.push(...randomScatterRooms(rng, target - rooms.length, rooms.length, cx, cy));
  }
  rooms.forEach((r,i)=>{ r.id=i; r.degree=0; r.type=TYPE.COMBAT; });
  return rooms;
}
function generateDungeon(params){
  const t0 = performance.now();
  let attempt = 0, seed = params.seed >>> 0, d = null;
  while(attempt < 5){
    d = tryGenerate(seed, params);
    if(d.valid) break;
    seed = (Math.imul(seed, 9301) + 49297) >>> 0; attempt++;
  }
  d.stats.genMs = performance.now() - t0;
  d.stats.attempts = attempt + 1;
  return d;
}

function tryGenerate(seed, params){
  const rng = makeRng(seed);
  const TH = themeSpec(params.settingKey, params.paletteKey);
  const isHospital = TH.kit === 'hospital';

  /* -- 1. scatter / editor layout -- */
  const rooms = initialRoomsFromParams(rng, params);
  const N = rooms.length;
  if(N < 2) return { valid:false, stats:{} };

  /* -- 2. separate -- */
  const ROOM_GAP = 6;
  { const CX=new Float64Array(N), CY=new Float64Array(N), HW=new Float64Array(N), HH=new Float64Array(N), LOCK=new Uint8Array(N);
    for(let i=0;i<N;i++){ CX[i]=rooms[i].cx; CY[i]=rooms[i].cy; HW[i]=rooms[i].w/2+ROOM_GAP/2; HH[i]=rooms[i].h/2+ROOM_GAP/2; LOCK[i]=rooms[i].locked?1:0; }
    for(let iter=0; iter<300; iter++){
      let moved = false;
      for(let i=0;i<N;i++) for(let j=i+1;j<N;j++){
        const ox = HW[i]+HW[j] - Math.abs(CX[i]-CX[j]);
        if(ox<=0) continue;
        const oy = HH[i]+HH[j] - Math.abs(CY[i]-CY[j]);
        if(oy<=0 || (LOCK[i] && LOCK[j])) continue;
        moved = true;
        if(ox < oy){
          const s = CX[i] <= CX[j] ? -1 : 1;
          if(LOCK[i]) CX[j] -= s*ox; else if(LOCK[j]) CX[i] += s*ox; else { CX[i] += s*ox/2; CX[j] -= s*ox/2; }
        } else {
          const s = CY[i] <= CY[j] ? -1 : 1;
          if(LOCK[i]) CY[j] -= s*oy; else if(LOCK[j]) CY[i] += s*oy; else { CY[i] += s*oy/2; CY[j] -= s*oy/2; }
        }
      }
      if(!moved) break;
    }
    for(let i=0;i<N;i++){ rooms[i].cx = Math.round(CX[i]); rooms[i].cy = Math.round(CY[i]); }
  }

  /* -- 3. graph: Delaunay -> MST -> loops -- */
  const centers = rooms.map(r=>({x:r.cx, y:r.cy}));
  let delEdges = delaunay(centers);
  if(delEdges.length === 0){ delEdges = []; for(let i=0;i<N-1;i++) delEdges.push([i,i+1]); }
  const blockedPairs = new Set();
  const secretRoomIdx = new Set();
  if(params.editorEnabled && Array.isArray(params.editorRooms)){
    const secretIds = new Set(Array.isArray(params.secretRooms) ? params.secretRooms : []);
    params.editorRooms.forEach((r,i)=>{
      if(r && (r.roleHint==='secret' || secretIds.has(r.id))) secretRoomIdx.add(i);
    });
  }
  if(params.editorEnabled && Array.isArray(params.blockedLinks) && Array.isArray(params.editorRooms)){
    for(const k of params.blockedLinks){
      const [ida,idb]=String(k).split(',').map(Number);
      const a=params.editorRooms.findIndex(r=>r.id===ida), b=params.editorRooms.findIndex(r=>r.id===idb);
      if(a>=0 && b>=0 && a!==b) blockedPairs.add(Math.min(a,b)+','+Math.max(a,b));
    }
  }
  const isBlockedPair=(a,b)=>blockedPairs.has(Math.min(a,b)+','+Math.max(a,b));
  const isSecretAutoPair=(a,b)=>secretRoomIdx.has(a) || secretRoomIdx.has(b);
  if(blockedPairs.size || secretRoomIdx.size) delEdges = delEdges.filter(e=>!isBlockedPair(e[0], e[1]) && !isSecretAutoPair(e[0], e[1]));
  const forcedPairs = [];
  if(params.editorEnabled && Array.isArray(params.editorLinks) && Array.isArray(params.editorRooms)){
    const seenForced = new Set();
    for(const l of params.editorLinks){
      const a = params.editorRooms.findIndex(r=>r.id===l.a), b = params.editorRooms.findIndex(r=>r.id===l.b);
      if(a<0 || b<0 || a===b || a>=N || b>=N || isBlockedPair(a,b)) continue;
      const lo=Math.min(a,b), hi=Math.max(a,b), k=lo+','+hi;
      if(!seenForced.has(k)){ seenForced.add(k); forcedPairs.push([lo,hi]); }
    }
  }
  for(const e of forcedPairs){
    const lo=Math.min(e[0],e[1]), hi=Math.max(e[0],e[1]), exists=delEdges.some(d=>Math.min(d[0],d[1])===lo && Math.max(d[0],d[1])===hi);
    if(!exists) delEdges.push([lo,hi]);
  }
  const forcedKeys = new Set(forcedPairs.map(e=>Math.min(e[0],e[1])+','+Math.max(e[0],e[1])));
  const editorParent = Array.from({length:N},(_,i)=>i);
  const editorFind = x=>{
    while(editorParent[x]!==x){ editorParent[x]=editorParent[editorParent[x]]; x=editorParent[x]; }
    return x;
  };
  const editorUnion = (a,b)=>{
    const ra=editorFind(a), rb=editorFind(b);
    if(ra===rb) return false;
    editorParent[rb]=ra;
    return true;
  };
  const elen = e => Math.hypot(centers[e[0]].x-centers[e[1]].x, centers[e[0]].y-centers[e[1]].y);

  const adj = Array.from({length:N},()=>[]);
  delEdges.forEach((e,idx)=>{ const w=elen(e); adj[e[0]].push({b:e[1],w,idx}); adj[e[1]].push({b:e[0],w,idx}); });
  const inT = new Uint8Array(N); inT[0]=1; let inCount=1;
  const mstIdx = new Set();
  while(inCount < N){
    let best=null;
    for(let a=0;a<N;a++) if(inT[a]) for(const e of adj[a]) if(!inT[e.b] && (!best || e.w<best.w)) best=e;
    if(!best) break;
    inT[best.b]=1; inCount++; mstIdx.add(best.idx);
  }
  const disconnectedRooms = [];
  if(inCount < N){
    for(let i=0;i<N;i++) if(!inT[i]) disconnectedRooms.push(i);
  }

  let mstLenSum=0; for(const i of mstIdx) mstLenSum += elen(delEdges[i]);
  const mstMean = mstLenSum / Math.max(1, mstIdx.size);

  const edges = [], usedEdges = new Set();
  const addEdge = (a,b,isLoop,isManual)=>{
    const e={a,b,isLoop, isCritical:false, isManual};
    const d=edgeDoorPoints(e, rooms);
    e.ax=d.da.x; e.ay=d.da.y; e.aside=d.da.side;
    e.bx=d.db.x; e.by=d.db.y; e.bside=d.db.side;
    assignEdgeRoute(e);
    edges.push(e);
  };
  for(const e of forcedPairs){
    if(editorUnion(e[0], e[1])){
      const k=Math.min(e[0],e[1])+','+Math.max(e[0],e[1]);
      usedEdges.add(k); addEdge(e[0], e[1], false, true);
    }
  }
  delEdges.forEach((e,idx)=>{
    const k=Math.min(e[0],e[1])+','+Math.max(e[0],e[1]);
    if(usedEdges.has(k)) return;
    if(mstIdx.has(idx) && editorUnion(e[0], e[1])){ usedEdges.add(k); addEdge(e[0], e[1], false, false); }
    else if(!params.editorEnabled && elen(e) < mstMean*2.2 && rng.chance(params.loopChance)){
      usedEdges.add(k); addEdge(e[0], e[1], true, false);
    }
  });
  for(const e of edges){ rooms[e.a].degree++; rooms[e.b].degree++; }

  /* leaf guard: dungeons need dead ends — prune loop edges until >=3 leaves */
  if(N >= 20){
    let leafCount = 0;
    for(let i=0;i<N;i++) if(rooms[i].degree===1) leafCount++;
    while(leafCount < 3){
      let bi=-1, bs=-1;
      for(let i=0;i<edges.length;i++){
        const e=edges[i]; if(!e.isLoop) continue;
        const s=(rooms[e.a].degree===2?1:0)+(rooms[e.b].degree===2?1:0);
        const L=Math.hypot(centers[e.a].x-centers[e.b].x, centers[e.a].y-centers[e.b].y);
        const score = s*10000 + L;
        if(score>bs){ bs=score; bi=i; }
      }
      if(bi<0) break;
      const e=edges[bi];
      if(--rooms[e.a].degree===1) leafCount++;
      if(--rooms[e.b].degree===1) leafCount++;
      edges.splice(bi,1);
    }
  }

  /* -- 4. semantics before carving -- */
  const gAdj = Array.from({length:N},()=>[]);
  edges.forEach((e,i)=>{ gAdj[e.a].push({b:e.b,i}); gAdj[e.b].push({b:e.a,i}); });

  let boss = rooms.findIndex(r=>r.roleHint==='boss');
  if(boss < 0){ boss = 0; for(let i=1;i<N;i++) if(rooms[i].w*rooms[i].h > rooms[boss].w*rooms[boss].h) boss = i; }
  let entrance = rooms.findIndex((r,i)=>i!==boss && r.roleHint==='entrance');
  if(entrance < 0) entrance = Math.min(N-1, boss===0 ? 1 : 0);

  const distFrom = src => {
    const D = new Int32Array(N).fill(-1); D[src]=0; const q=[src];
    for(let h=0; h<q.length; h++){ const a=q[h]; for(const e of gAdj[a]) if(D[e.b]<0){ D[e.b]=D[a]+1; q.push(e.b); } }
    return D;
  };
  const dB = distFrom(boss);
  let bestD = dB[entrance];
  if(!rooms.some(r=>r.roleHint==='entrance')){
    for(let i=0;i<N;i++) if(i!==boss && rooms[i].degree===1 && dB[i]>bestD){ bestD=dB[i]; entrance=i; }
    if(bestD < 0){ for(let i=0;i<N;i++) if(i!==boss && dB[i]>bestD){ bestD=dB[i]; entrance=i; } }
  }

  const dE = distFrom(entrance);
  let maxDepth = 1; for(let i=0;i<N;i++) if(dE[i]>maxDepth) maxDepth = dE[i];
  rooms.forEach((r,i)=>{ r.depth = Math.max(0,dE[i]); r.difficulty = Math.min(1, 0.15 + 0.85*(r.depth/maxDepth)); });
  rooms[entrance].type = TYPE.ENTRANCE; rooms[entrance].difficulty = 0;
  rooms[boss].type = TYPE.BOSS; rooms[boss].difficulty = 1;

  const par = new Int32Array(N).fill(-1), pe = new Int32Array(N).fill(-1);
  { const q=[entrance], vis=new Uint8Array(N); vis[entrance]=1;
    for(let h=0; h<q.length; h++){ const a=q[h];
      for(const e of gAdj[a]) if(!vis[e.b]){ vis[e.b]=1; par[e.b]=a; pe[e.b]=e.i; q.push(e.b); } } }
  const critRooms = new Set(); let critLen = 0;
  for(let c=boss; c!==-1; c=par[c]){ critRooms.add(c); if(pe[c]>=0){ edges[pe[c]].isCritical=true; critLen++; } if(c===entrance) break; }

  const leaves = [];
  for(let i=0;i<N;i++) if(i!==entrance && i!==boss && rooms[i].degree===1) leaves.push(i);
  leaves.sort((a,b)=>rooms[b].depth-rooms[a].depth);
  leaves.slice(0,4).forEach(i=>{ rooms[i].type = TYPE.TREASURE; });

  const shrineC = [];
  for(let i=0;i<N;i++){ const r=rooms[i];
    if(r.type===TYPE.COMBAT && !critRooms.has(i) && r.depth>maxDepth*0.3 && r.depth<maxDepth*0.85) shrineC.push(i); }
  for(let k=0; k<2 && shrineC.length>0; k++){
    const j = shrineC.splice(rng.i(0,shrineC.length-1),1)[0]; rooms[j].type = TYPE.SHRINE;
  }
  const eliteC = [];
  for(const i of critRooms){ const r=rooms[i];
    if(r.type===TYPE.COMBAT && r.depth>=maxDepth*0.55 && r.depth<=maxDepth*0.85) eliteC.push(i); }
  eliteC.sort((a,b)=>rooms[a].depth-rooms[b].depth);
  for(let k=0;k<Math.min(2,eliteC.length);k++) rooms[eliteC[eliteC.length-1-k]].type = TYPE.ELITE;

  /* -- 4.5 theme room mutations (generation-aware) -- */
  if(!isHospital && TH.lakes){
    const lc = [];
    for(let i=0;i<N;i++){ const r=rooms[i];
      if((r.type===TYPE.COMBAT || r.type===TYPE.ELITE) && Math.min(r.w,r.h)>=9) lc.push(i); }
    for(let k=0; k<2 && lc.length>0; k++) rooms[lc.splice(rng.i(0,lc.length-1),1)[0]].lake = true;
  }
  if(!isHospital && TH.graveyards){
    const gc = [];
    for(let i=0;i<N;i++){ const r=rooms[i];
      if(r.type===TYPE.COMBAT && r.shape!=='ellipse' && Math.min(r.w,r.h)>=8) gc.push(i); }
    for(let k=0; k<3 && gc.length>0; k++) rooms[gc.splice(rng.i(0,gc.length-1),1)[0]].grave = true;
  }

  /* -- 5. carve + rasterize -- */
  let minX=1e9,minY=1e9,maxX=-1e9,maxY=-1e9;
  for(const r of rooms){
    minX=Math.min(minX, r.cx - Math.ceil(r.w/2)); maxX=Math.max(maxX, r.cx + Math.ceil(r.w/2));
    minY=Math.min(minY, r.cy - Math.ceil(r.h/2)); maxY=Math.max(maxY, r.cy + Math.ceil(r.h/2));
  }
  const PADG = 5, offX = PADG - minX, offY = PADG - minY;
  const W = (maxX-minX) + PADG*2 + 1, H = (maxY-minY) + PADG*2 + 1;
  for(const r of rooms){ r.cx += offX; r.cy += offY; r.sx0 += offX; r.sy0 += offY; }
  for(const e of edges){
    const d=edgeDoorPoints(e, rooms);
    e.ax=d.da.x; e.ay=d.da.y; e.aside=d.da.side;
    e.bx=d.db.x; e.by=d.db.y; e.bside=d.db.side;
    const editorLink = params.editorEnabled && Array.isArray(params.editorLinks) && Array.isArray(params.editorRooms)
      ? params.editorLinks.find(l=>{
          const a = params.editorRooms.findIndex(r=>r.id===l.a), b = params.editorRooms.findIndex(r=>r.id===l.b);
          return Math.min(a,b)===Math.min(e.a,e.b) && Math.max(a,b)===Math.max(e.a,e.b);
        })
      : null;
    if(editorLink){
      const A0=params.editorRooms.find(r=>r.id===editorLink.a), B0=params.editorRooms.find(r=>r.id===editorLink.b);
      const applyDoor = (room, spec, fallback)=>{
        if(!room || !spec) return fallback;
        const p=doorSpecPoint({x:room.cx,y:room.cy,w:room.w,h:room.h}, spec);
        return p || fallback;
      };
      const da=applyDoor(rooms[e.a], editorLink.doorA, d.da);
      const db=applyDoor(rooms[e.b], editorLink.doorB, d.db);
      e.ax=da.x; e.ay=da.y; e.aside=da.side;
      e.bx=db.x; e.by=db.y; e.bside=db.side;
      const hasCustomRoute = (Array.isArray(editorLink.bends) && editorLink.bends.length > 0) || !!editorLink.doorA || !!editorLink.doorB || linkWidth(editorLink) !== 2;
      e.visualWidth = linkWidth(editorLink);
      e.useEditorRoute = hasCustomRoute;
      if(Array.isArray(editorLink.bends) && editorLink.bends.length){
        e.route = [da, ...editorLink.bends.map(p=>({x:Math.round(p.x+offX), y:Math.round(p.y+offY)})), db]
          .filter((p,i,a)=>i===0 || p.x!==a[i-1].x || p.y!==a[i-1].y);
      } else assignEdgeRoute(e);
    } else assignEdgeRoute(e);
  }

  const grid = new Uint8Array(W*H);
  const roomId = new Int16Array(W*H).fill(-1);
  const corridor = new Uint8Array(W*H);
  const doorway = new Uint8Array(W*H);
  const idx = (x,y)=> y*W + x;
  const inB = (x,y)=> x>=0 && y>=0 && x<W && y<H;

  for(const r of rooms){
    const rx=r.w/2, ry=r.h/2, sh=r.shape, ch=Math.min(rx,ry)*0.55;
    const irx2=1/(rx*rx), iry2=1/(ry*ry);
    const y0=Math.max(0,Math.floor(r.cy-ry)), y1=Math.min(H-1,Math.ceil(r.cy+ry));
    const x0=Math.max(0,Math.floor(r.cx-rx)), x1=Math.min(W-1,Math.ceil(r.cx+rx));
    for(let y=y0;y<=y1;y++){
      const dy=y-r.cy, ady=Math.abs(dy), row=y*W;
      if(ady>ry) continue;
      for(let x=x0;x<=x1;x++){
        const dx=x-r.cx, adx=Math.abs(dx);
        if(adx>rx) continue;
        let ok=true;
        if(sh==='ellipse') ok = dx*dx*irx2 + dy*dy*iry2 <= 1.0;
        else if(sh==='oct') ok = adx<=rx-ch || ady<=ry-ch || (adx-(rx-ch))+(ady-(ry-ch)) <= ch;
        if(ok){ const c=row+x; grid[c]=FLOOR; roomId[c]=r.id; }
      }
    }
  }

  const stamp = (x,y)=>{
    if(!inB(x,y)) return;
    const c=idx(x,y);
    if(grid[c]!==FLOOR) grid[c]=FLOOR;
    corridor[c]=1;
  };
  const markDoorway = (x,y)=>{
    if(!inB(x,y)) return;
    const c=idx(x,y);
    if(grid[c]!==FLOOR) grid[c]=FLOOR;
    corridor[c]=1;
    doorway[c]=1;
  };
  const stampDoorFloor = (x,y)=>{
    if(!inB(x,y)) return;
    const c=idx(x,y);
    if(grid[c]!==FLOOR) grid[c]=FLOOR;
    corridor[c]=1;
  };
  const offs = w => w===1?[0] : (w===2?[0,1] : [-1,0,1]);
  const hLine=(x0,x1,y,w)=>{ const o=offs(w); for(let x=Math.min(x0,x1); x<=Math.max(x0,x1); x++) for(const k of o) stamp(x,y+k); };
  const vLine=(y0,y1,x,w)=>{ const o=offs(w); for(let y=Math.min(y0,y1); y<=Math.max(y0,y1); y++) for(const k of o) stamp(x+k,y); };
  const stampWide=(x,y,w)=>{
    const o=offs(w);
    for(const ox of o) for(const oy of o) stamp(x+ox,y+oy);
  };
  const markDoorCore=(x,y,nx,ny,tx,ty,w)=>{
    const span=Math.max(1, Math.min(3, Math.round(w)));
    const o=offs(span);
    for(const k of o){
      const bx=x+tx*k, by=y+ty*k;
      markDoorway(bx,by);
      markDoorway(bx+nx,by+ny);
    }
  };
  const carveDoor = (p,w)=>{
    if(!p || !p.side) return;
    const x=Math.round(p.x), y=Math.round(p.y);
    const nx=p.side==='e'?1:(p.side==='w'?-1:0), ny=p.side==='s'?1:(p.side==='n'?-1:0);
    const tx=ny!==0?1:0, ty=nx!==0?1:0;
    const o=offs(Math.max(2, Math.min(4, Math.round(w)+1)));
    for(const k of o){
      const bx=x+tx*k, by=y+ty*k;
      for(let d=-1; d<=3; d++) stampDoorFloor(bx+nx*d, by+ny*d);
    }
    markDoorCore(x,y,nx,ny,tx,ty,w);
  };
  const forceDoorFallback=(room,p,w)=>{
    if(!room || !p || !p.side) return;
    const nx=p.side==='e'?1:(p.side==='w'?-1:0), ny=p.side==='s'?1:(p.side==='n'?-1:0);
    const tx=ny!==0?1:0, ty=nx!==0?1:0;
    const x0=Math.floor(room.cx-room.w/2), x1=Math.ceil(room.cx+room.w/2);
    const y0=Math.floor(room.cy-room.h/2), y1=Math.ceil(room.cy+room.h/2);
    let best=null;
    const scan=(x,y)=>{
      if(!inB(x,y) || roomId[idx(x,y)]!==room.id) return;
      let out=false;
      for(let d=1; d<=3; d++){
        const ox=x+nx*d, oy=y+ny*d;
        if(inB(ox,oy) && corridor[idx(ox,oy)]) out=true;
      }
      const dist=Math.abs(x-Math.round(p.x))+Math.abs(y-Math.round(p.y));
      if(out && (!best || dist<best.dist)) best={x,y,dist};
    };
    if(p.side==='n' || p.side==='s') for(let x=x0+1; x<=x1-1; x++) scan(x, p.side==='n'?y0:y1);
    else for(let y=y0+1; y<=y1-1; y++) scan(p.side==='w'?x0:x1, y);
    if(!best){
      const minSide=p.side==='n'||p.side==='s'?x0+1:y0+1;
      const maxSide=p.side==='n'||p.side==='s'?x1-1:y1-1;
      const along=Math.max(minSide, Math.min(maxSide, Math.round(p.side==='n'||p.side==='s'?p.x:p.y)));
      best=p.side==='n'||p.side==='s' ? {x:along,y:p.side==='n'?y0:y1} : {x:p.side==='w'?x0:x1,y:along};
    }
    const o=offs(Math.max(2, Math.min(4, Math.round(w)+1)));
    for(const k of o){
      const bx=best.x+tx*k, by=best.y+ty*k;
      for(let d=-2; d<=4; d++) stampDoorFloor(bx+nx*d, by+ny*d);
    }
    markDoorCore(best.x,best.y,nx,ny,tx,ty,w);
  };
  const carveRoute=(pts,w)=>{
    if(!pts || pts.length<2) return;
    w = Math.max(1, Math.min(6, Math.round(w)));
    for(let i=0;i<pts.length-1;i++){
      const a=pts[i], b=pts[i+1];
      const x0=Math.round(a.x), y0=Math.round(a.y), x1=Math.round(b.x), y1=Math.round(b.y);
      if(x0===x1){ vLine(y0,y1,x0,w); continue; }
      if(y0===y1){ hLine(x0,x1,y0,w); continue; }
      const steps=Math.max(Math.abs(x1-x0), Math.abs(y1-y0))*2;
      for(let s=0;s<=steps;s++){
        const t=steps ? s/steps : 0;
        stampWide(Math.round(x0+(x1-x0)*t), Math.round(y0+(y1-y0)*t), w);
      }
    }
  };

  for(const e of edges){
    const A=rooms[e.a], B=rooms[e.b];
    let w = e.isCritical ? 3 : 2;
    if(!e.isCritical && (rooms[e.a].type===TYPE.TREASURE || rooms[e.b].type===TYPE.TREASURE) && rng.chance(0.4)) w = 1;
    if(e.useEditorRoute){
      const route=edgeRoutePoints(e), rw=e.visualWidth || w;
      carveRoute(route, rw);
      carveDoor(route[0], rw);
      carveDoor(route[route.length-1], rw);
      forceDoorFallback(A, route[0], rw);
      forceDoorFallback(B, route[route.length-1], rw);
      continue;
    }
    const dx = Math.abs(A.cx-B.cx), dy = Math.abs(A.cy-B.cy);
    const ovX = Math.min(A.cx+A.w/2, B.cx+B.w/2) - Math.max(A.cx-A.w/2, B.cx-B.w/2);
    const ovY = Math.min(A.cy+A.h/2, B.cy+B.h/2) - Math.max(A.cy-A.h/2, B.cy-B.h/2);
    if(ovX >= w+2 && dy > 0){ const x = Math.round((Math.max(A.cx-A.w/2,B.cx-B.w/2)+Math.min(A.cx+A.w/2,B.cx+B.w/2))/2); vLine(A.cy,B.cy,x,w); }
    else if(ovY >= w+2 && dx > 0){ const y = Math.round((Math.max(A.cy-A.h/2,B.cy-B.h/2)+Math.min(A.cy+A.h/2,B.cy+B.h/2))/2); hLine(A.cx,B.cx,y,w); }
    else if(rng.chance(0.5)){ hLine(A.cx,B.cx,A.cy,w); vLine(A.cy,B.cy,B.cx,w); }
    else { vLine(A.cy,B.cy,A.cx,w); hLine(A.cx,B.cx,B.cy,w); }
  }

  for(let y=0;y<H;y++){
    const row=y*W;
    for(let x=0;x<W;x++){
      if(grid[row+x]!==FLOOR) continue;
      const ya=Math.max(0,y-1), yb=Math.min(H-1,y+1);
      const xa=Math.max(0,x-1), xb=Math.min(W-1,x+1);
      for(let ny=ya;ny<=yb;ny++){
        const nrow=ny*W;
        for(let nx=xa;nx<=xb;nx++){
          const ni=nrow+nx;
          if(grid[ni]===VOID) grid[ni]=WALL;
        }
      }
    }
  }

  for(let y=0;y<H;y++){
    const row=y*W;
    for(let x=0;x<W;x++){
      const c=row+x;
      if(!corridor[c]) continue;
      const touchesRoom = (x<W-1 && roomId[c+1]>=0) || (x>0 && roomId[c-1]>=0) ||
        (y<H-1 && roomId[c+W]>=0) || (y>0 && roomId[c-W]>=0);
      if(!touchesRoom) continue;
      const wallX = (x<W-1 && grid[c+1]===WALL) || (x>0 && grid[c-1]===WALL);
      const wallY = (y<H-1 && grid[c+W]===WALL) || (y>0 && grid[c-W]===WALL);
      if(wallX || wallY) doorway[c]=1;
    }
  }

  /* -- 5.5 theme carving: liquid pockets, frozen lakes, arches -- */
  /* Pockets replace single WALL cells with sunken liquid slots (POOL).
     Connectivity is untouched: floor cells never change, and any VOID
     exposed behind a pocket is backfilled with WALL. */
  const pools = [];
  if(!isHospital && TH.pools && TH.pools.amount > 0){
    const nearDoorC = (x,y,d)=>{ for(let oy=-d;oy<=d;oy++) for(let ox=-d;ox<=d;ox++){
      const nx=x+ox, ny=y+oy;
      if(nx>=0&&ny>=0&&nx<W&&ny<H && doorway[idx(nx,ny)]) return true; } return false; };
    const cand = [];
    for(let y=1;y<H-1;y++) for(let x=1;x<W-1;x++){
      const c=idx(x,y);
      if(grid[c]!==WALL || nearDoorC(x,y,2)) continue;
      let nf=0;
      if(grid[c+1]===FLOOR) nf++; if(grid[c-1]===FLOOR) nf++;
      if(grid[c+W]===FLOOR) nf++; if(grid[c-W]===FLOOR) nf++;
      if(nf===1) cand.push({x,y});
    }
    for(let i=cand.length-1;i>0;i--){ const j=rng.i(0,i); const t=cand[i]; cand[i]=cand[j]; cand[j]=t; }
    const target = Math.round(cand.length * TH.pools.amount);
    for(const s of cand){
      if(pools.length >= target) break;
      let close=false;
      for(const p of pools) if(Math.max(Math.abs(p.x-s.x),Math.abs(p.y-s.y)) < 3){ close=true; break; }
      if(close) continue;
      grid[idx(s.x,s.y)] = POOL; pools.push({x:s.x, y:s.y});
    }
    for(const p of pools)
      for(let oy=-1;oy<=1;oy++) for(let ox=-1;ox<=1;ox++){
        const nx=p.x+ox, ny=p.y+oy;
        if(nx>=0&&ny>=0&&nx<W&&ny<H && grid[idx(nx,ny)]===VOID) grid[idx(nx,ny)]=WALL;
      }
  }

  /* Interior liquid pits: single floor cells sunk into lava/water/miasma.
     Carved before BFS validation, so connectivity is still guaranteed;
     interior-only + spacing >= 4 means a room can never be split. */
  if(!isHospital && TH.pools && TH.pools.pits){
    for(const r of rooms){
      if((r.type!==TYPE.COMBAT && r.type!==TYPE.ELITE) || r.lake || r.grave) continue;
      let n = Math.min(TH.pools.pits, Math.floor(r.w*r.h/45)+1), guard=0;
      while(n>0 && guard++<40){
        const x=rng.i(Math.floor(r.cx-r.w/2)+2, Math.ceil(r.cx+r.w/2)-2);
        const y=rng.i(Math.floor(r.cy-r.h/2)+2, Math.ceil(r.cy+r.h/2)-2);
        if(!inB(x,y)) continue;
        const c=idx(x,y);
        if(roomId[c]!==r.id || grid[c]!==FLOOR || doorway[c]) continue;
        let ok=true;
        for(let oy=-1;oy<=1 && ok;oy++) for(let ox=-1;ox<=1;ox++)
          if(grid[idx(x+ox,y+oy)]!==FLOOR){ ok=false; break; }
        if(ok) for(const p of pools) if(Math.max(Math.abs(p.x-x),Math.abs(p.y-y))<4){ ok=false; break; }
        if(!ok) continue;
        grid[c]=POOL; pools.push({x,y}); n--;
      }
    }
  }

  /* Frozen lakes: interior floor cells of lake rooms stay walkable (FLOOR
     for BFS) but are flagged so rendering swaps stone tiles for ice. */
  const lakeMask = new Uint8Array(W*H);
  const lakeCells = [];
  for(const r of rooms){
    if(!r.lake) continue;
    for(let y=Math.floor(r.cy-r.h/2)+2; y<=Math.ceil(r.cy+r.h/2)-2; y++)
      for(let x=Math.floor(r.cx-r.w/2)+2; x<=Math.ceil(r.cx+r.w/2)-2; x++){
        if(!inB(x,y)) continue;
        const c=idx(x,y);
        if(roomId[c]!==r.id || grid[c]!==FLOOR || doorway[c]) continue;
        let solid=false;
        for(let oy=-1;oy<=1 && !solid;oy++) for(let ox=-1;ox<=1;ox++)
          if(grid[idx(x+ox,y+oy)]!==FLOOR){ solid=true; break; }
        if(!solid){ lakeMask[c]=1; lakeCells.push({x,y}); }
      }
  }

  /* Doorway arches: group doorway cells into runs perpendicular to the
     corridor axis; one arch frame per run of width <= 3. */
  const arches = [];
  { const aseen = new Uint8Array(W*H);
    const wallAt=(x,y)=>inB(x,y) && grid[idx(x,y)]===WALL;
    for(let y=0;y<H;y++) for(let x=0;x<W;x++){
      const c=idx(x,y);
      if(!doorway[c] || aseen[c]) continue;
      let rx=0, ry=0;
      if(x<W-1 && roomId[c+1]>=0) rx=1; else if(x>0 && roomId[c-1]>=0) rx=-1;
      else if(y<H-1 && roomId[c+W]>=0) ry=1; else ry=-1;
      const px = rx===0 ? 1 : 0, py = rx===0 ? 0 : 1;
      let x0=x, y0=y, x1=x, y1=y;
      while(inB(x0-px,y0-py) && doorway[idx(x0-px,y0-py)] && !aseen[idx(x0-px,y0-py)]){ x0-=px; y0-=py; }
      while(inB(x1+px,y1+py) && doorway[idx(x1+px,y1+py)] && !aseen[idx(x1+px,y1+py)]){ x1+=px; y1+=py; }
      let len=0;
      for(let ax=x0, ay=y0;; ax+=px, ay+=py){ aseen[idx(ax,ay)]=1; len++; if(ax===x1 && ay===y1) break; }
      const sx=x0-px, sy=y0-py, ex=x1+px, ey=y1+py;
      const wallAnchored = px ? ((wallAt(sx,sy) || wallAt(ex,ey)) && (wallAt(x0, y0-1) || wallAt(x0, y0+1) || wallAt(x1, y1-1) || wallAt(x1, y1+1)))
        : ((wallAt(sx,sy) || wallAt(ex,ey)) && (wallAt(x0-1, y0) || wallAt(x0+1, y0) || wallAt(x1-1, y1) || wallAt(x1+1, y1)));
      if(len<=3 && wallAnchored) arches.push({x:(x0+x1)/2, y:(y0+y1)/2, px, py, len});
    }
  }

  /* -- 6. BFS field + validation -- */
  const bfs = new Int16Array(W*H).fill(-1);
  const ei = idx(rooms[entrance].cx, rooms[entrance].cy);
  const total = W*H;
  let floorTotal=0; for(let i=0;i<total;i++) if(grid[i]===FLOOR) floorTotal++;
  let reach=0, maxBfs=0;
  if(grid[ei]===FLOOR){
    const q = new Int32Array(floorTotal); let qh=0, qt=0;
    q[qt++]=ei; bfs[ei]=0; reach=1;
    while(qh<qt){
      const c=q[qh++], x=c%W, b=bfs[c]+1;
      let n;
      if(x>0       && grid[n=c-1]===FLOOR && bfs[n]<0){ bfs[n]=b; q[qt++]=n; reach++; }
      if(x<W-1     && grid[n=c+1]===FLOOR && bfs[n]<0){ bfs[n]=b; q[qt++]=n; reach++; }
      if(c>=W      && grid[n=c-W]===FLOOR && bfs[n]<0){ bfs[n]=b; q[qt++]=n; reach++; }
      if(c<total-W && grid[n=c+W]===FLOOR && bfs[n]<0){ bfs[n]=b; q[qt++]=n; reach++; }
    }
    maxBfs = bfs[q[qt-1]];  /* FIFO: last enqueued cell is farthest */
  }
  const valid = reach === floorTotal && floorTotal > 0;

  /* -- 7. decoration (pure data) -- */
  const props=[], spawns=[];
  const occ = new Uint8Array(W*H);
  const nearDoor = (x,y,d)=>{ for(let oy=-d;oy<=d;oy++) for(let ox=-d;ox<=d;ox++)
    if(inB(x+ox,y+oy) && doorway[idx(x+ox,y+oy)]) return true; return false; };
  const interior = (x,y)=>{ for(let oy=-1;oy<=1;oy++) for(let ox=-1;ox<=1;ox++)
    if(!inB(x+ox,y+oy) || grid[idx(x+ox,y+oy)]!==FLOOR) return false; return true; };
  const put = (kind,x,y,rot,scale,rid)=>{ props.push({kind,x,y,rot:rot||0,scale:scale||1,roomId:rid}); occ[idx(x,y)]=1; };

  for(const r of rooms){
    const cix = idx(r.cx, r.cy);
    if(!isHospital && r.type===TYPE.ENTRANCE) put('ring', r.cx, r.cy, 0, 1, r.id);
    if(!isHospital && r.type===TYPE.BOSS){
      put('bossCrystal', r.cx, r.cy, rng.f(0,6.28), 1, r.id);
      const rr = Math.max(2.5, Math.min(r.w,r.h)/2 - 2), a0 = rng.f(0,1);
      for(let k=0;k<6;k++){
        const a = a0 + k*Math.PI/3;
        const bx = Math.round(r.cx + Math.cos(a)*rr), by = Math.round(r.cy + Math.sin(a)*rr);
        if(inB(bx,by) && grid[idx(bx,by)]===FLOOR && !occ[idx(bx,by)] && !nearDoor(bx,by,1)) put('brazier',bx,by,0,1,r.id);
      }
    }
    if(!isHospital && r.type===TYPE.TREASURE && grid[cix]===FLOOR) put('chest', r.cx, r.cy, rng.i(0,3)*Math.PI/2, 1, r.id);
    if(!isHospital && r.type===TYPE.SHRINE && grid[cix]===FLOOR) put('shrineCrystal', r.cx, r.cy, rng.f(0,6.28), 1, r.id);

    if(!isHospital && (r.type===TYPE.COMBAT || r.type===TYPE.ELITE) && Math.min(r.w,r.h)>=10 && r.shape!=='ellipse' && !r.grave && !r.lake){
      const step = Math.min(r.w,r.h) >= 14 ? 4 : 3;
      for(let y=Math.ceil(r.cy-r.h/2)+2; y<=r.cy+r.h/2-2; y++)
        for(let x=Math.ceil(r.cx-r.w/2)+2; x<=r.cx+r.w/2-2; x++){
          if(((x-r.cx)%step)!==0 || ((y-r.cy)%step)!==0) continue;
          if(x===r.cx && y===r.cy) continue;
          if(interior(x,y) && !occ[idx(x,y)] && !nearDoor(x,y,2)) put('pillar',x,y,0,rng.f(0.94,1.06),r.id);
        }
    }
    if(!isHospital && r.grave){
      for(let y=Math.ceil(r.cy-r.h/2)+2; y<=r.cy+r.h/2-2; y+=2)
        for(let x=Math.ceil(r.cx-r.w/2)+2; x<=r.cx+r.w/2-2; x+=2){
          if(Math.abs(x-r.cx)<=1 && Math.abs(y-r.cy)<=1) continue;
          if(interior(x,y) && !occ[idx(x,y)] && !nearDoor(x,y,2) && rng.chance(0.8))
            put('grave', x, y, rng.f(-0.3,0.3), rng.f(0.85,1.15), r.id);
        }
      if(Math.min(r.w,r.h)>=10 && grid[cix]===FLOOR && !occ[cix])
        put('sarco', r.cx, r.cy, rng.chance(0.5)?0:Math.PI/2, 1, r.id);
      let cd=4;
      while(cd-->0){
        const x=rng.i(Math.floor(r.cx-r.w/2)+1, Math.ceil(r.cx+r.w/2)-1);
        const y=rng.i(Math.floor(r.cy-r.h/2)+1, Math.ceil(r.cy+r.h/2)-1);
        if(inB(x,y) && roomId[idx(x,y)]===r.id && grid[idx(x,y)]===FLOOR && !occ[idx(x,y)])
          put('candle', x, y, 0, rng.f(0.85,1.2), r.id);
      }
    }
    if(!isHospital && (r.type===TYPE.COMBAT || r.type===TYPE.ELITE || r.type===TYPE.BOSS)){
      let area=0;
      for(let y=Math.floor(r.cy-r.h/2); y<=Math.ceil(r.cy+r.h/2); y++)
        for(let x=Math.floor(r.cx-r.w/2); x<=Math.ceil(r.cx+r.w/2); x++)
          if(inB(x,y) && roomId[idx(x,y)]===r.id) area++;
      let count = Math.round((area/18) * (0.5 + r.difficulty));
      if(r.type===TYPE.ELITE) count = Math.max(2, Math.round(count*0.6));
      if(r.type===TYPE.BOSS)  count = rng.i(2,3);
      const tier = r.type===TYPE.ELITE ? 3 : Math.max(1, Math.ceil(r.difficulty*3));
      let guard=0;
      while(count>0 && guard++<220){
        const x=rng.i(Math.floor(r.cx-r.w/2)+1, Math.ceil(r.cx+r.w/2)-1);
        const y=rng.i(Math.floor(r.cy-r.h/2)+1, Math.ceil(r.cy+r.h/2)-1);
        if(!inB(x,y)) continue;
        const c=idx(x,y);
        if(roomId[c]===r.id && grid[c]===FLOOR && !occ[c] && !doorway[c] && !lakeMask[c]){
          spawns.push({x,y,tier,roomId:r.id}); occ[c]=1; count--;
        }
      }
    }
  }
  const torchCand=[];
  for(let y=0;y<H;y++){
    const row=y*W;
    for(let x=0;x<W;x++){
      const c=row+x;
      if(grid[c]!==WALL) continue;
      if(x<W-1 && grid[c+1]===FLOOR)      torchCand.push({x,y,dx:1,dy:0});
      else if(x>0 && grid[c-1]===FLOOR)   torchCand.push({x,y,dx:-1,dy:0});
      else if(y<H-1 && grid[c+W]===FLOOR) torchCand.push({x,y,dx:0,dy:1});
      else if(y>0 && grid[c-W]===FLOOR)   torchCand.push({x,y,dx:0,dy:-1});
    }
  }
  for(let i=torchCand.length-1;i>0;i--){ const j=rng.i(0,i); const t=torchCand[i]; torchCand[i]=torchCand[j]; torchCand[j]=t; }
  const torches=[];
  if(!isHospital){
    for(const c of torchCand){
      let ok=true;
      for(const t of torches) if(Math.max(Math.abs(t.x-c.x),Math.abs(t.y-c.y))<4){ ok=false; break; }
      if(ok) torches.push(c);
    }
  }
  if(!isHospital){
    for(let y=0;y<H;y++){
      const row=y*W;
      for(let x=0;x<W;x++){
        const c=row+x;
        if(grid[c]!==FLOOR || occ[c] || doorway[c] || lakeMask[c]) continue;
        const rid = roomId[c];
        const diff = rid>=0 ? rooms[rid].difficulty : 0.5;
        let p = params.decorDensity * 0.045 * (1.25 - 0.6*diff);
        if(corridor[c]) p *= 0.45;
        if(rng.chance(p)) props.push({kind:'debris',x,y,rot:rng.f(0,6.28),scale:rng.f(0.6,1.35),roomId:rid,v:rng.i(0,2)});
      }
    }
  }

  /* -- 7.5 theme prop sweeps -- */
  const floorDir = (x,y)=>{
    const c=idx(x,y);
    if(x<W-1 && grid[c+1]===FLOOR) return [1,0];
    if(x>0 && grid[c-1]===FLOOR) return [-1,0];
    if(y<H-1 && grid[c+W]===FLOOR) return [0,1];
    if(y>0 && grid[c-W]===FLOOR) return [0,-1];
    return null;
  };
  if(!isHospital && TH.icicles){
    for(let y=0;y<H;y++) for(let x=0;x<W;x++){
      if(grid[idx(x,y)]!==WALL) continue;
      const d = floorDir(x,y);
      if(d && rng.chance(0.06 + 0.08*params.decorDensity))
        props.push({kind:'icicle',x,y,dx:d[0],dy:d[1],rot:rng.f(0,6.28),scale:rng.f(0.7,1.3)});
    }
    for(const lc of lakeCells)
      if(rng.chance(0.05)) props.push({kind:'shardIce',x:lc.x,y:lc.y,rot:rng.f(0,6.28),scale:rng.f(0.6,1.2)});
  }
  if(!isHospital && TH.roots){
    const sites=[];
    for(let y=1;y<H-1;y++) for(let x=1;x<W-1;x++){
      if(grid[idx(x,y)]!==WALL) continue;
      const d = floorDir(x,y);
      if(d && roomId[idx(x+d[0],y+d[1])]>=0) sites.push({x,y,dx:d[0],dy:d[1]});
    }
    for(let i=sites.length-1;i>0;i--){ const j=rng.i(0,i); const t=sites[i]; sites[i]=sites[j]; sites[j]=t; }
    const breaches=[];
    for(const s of sites){
      if(breaches.length>=5) break;
      let close=false;
      for(const b of breaches) if(Math.max(Math.abs(b.x-s.x),Math.abs(b.y-s.y))<7){ close=true; break; }
      if(!close) breaches.push(s);
    }
    const mossMask = new Uint8Array(W*H);
    for(const b of breaches){
      props.push({kind:'roots',x:b.x,y:b.y,dx:b.dx,dy:b.dy,rot:0,scale:rng.f(0.9,1.2)});
      for(let oy=-2;oy<=2;oy++) for(let ox=-2;ox<=2;ox++){
        const nx=b.x+ox, ny=b.y+oy;
        if(!inB(nx,ny)) continue;
        const c=idx(nx,ny);
        if(grid[c]===FLOOR && !mossMask[c] && rng.chance(0.75)){
          mossMask[c]=1; props.push({kind:'moss',x:nx,y:ny,rot:rng.f(0,6.28),scale:rng.f(0.7,1.4)});
        }
      }
    }
    for(let y=0;y<H;y++) for(let x=0;x<W;x++){
      const c=idx(x,y);
      if(grid[c]!==FLOOR || mossMask[c] || lakeMask[c]) continue;
      let nw=0;
      if(x<W-1 && grid[c+1]===WALL) nw++; if(x>0 && grid[c-1]===WALL) nw++;
      if(y<H-1 && grid[c+W]===WALL) nw++; if(y>0 && grid[c-W]===WALL) nw++;
      if(nw>0 && rng.chance(0.12*params.decorDensity)){
        mossMask[c]=1; props.push({kind:'moss',x,y,rot:rng.f(0,6.28),scale:rng.f(0.6,1.3)});
      }
    }
  }
  if(TH.kit === 'hospital'){
    const clearForHospital = (x,y,rid)=>{
      if(!inB(x,y)) return false;
      const c = idx(x,y);
      return roomId[c]===rid && grid[c]===FLOOR && !doorway[c] && !lakeMask[c];
    };
    const tryHospitalFloor = (r, kind, rot, scale, tries=90)=>{
      const cand = [
        {x:r.cx, y:r.cy},
        {x:r.cx-2, y:r.cy-1}, {x:r.cx+2, y:r.cy+1},
        {x:r.cx-2, y:r.cy+2}, {x:r.cx+2, y:r.cy-2},
        {x:r.cx-3, y:r.cy}, {x:r.cx+3, y:r.cy},
        {x:r.cx, y:r.cy-3}, {x:r.cx, y:r.cy+3}
      ];
      for(let i=0;i<tries;i++) cand.push({
        x:rng.i(Math.floor(r.cx-r.w/2)+1, Math.ceil(r.cx+r.w/2)-1),
        y:rng.i(Math.floor(r.cy-r.h/2)+1, Math.ceil(r.cy+r.h/2)-1)
      });
      for(const p of cand){
        if(!clearForHospital(p.x,p.y,r.id)) continue;
        const c=idx(p.x,p.y);
        if(occ[c]) continue;
        put(kind, p.x, p.y, rot, scale, r.id);
        return p;
      }
      return null;
    };
    for(const r of rooms){
      const area = Math.max(1, r.w * r.h);
      const roomy = area >= 95;
      const addSupportProps = (items)=>{
        for(const item of items){
          if(item.when !== undefined && !rng.chance(item.when)) continue;
          tryHospitalFloor(r, item.kind, item.rot ?? (rng.chance(0.5)?0:Math.PI/2), item.scale ?? rng.f(0.82,1.0), item.tries ?? 70);
        }
      };
      if(r.type===TYPE.ENTRANCE){
        tryHospitalFloor(r, 'nurseCounter', 0, 1.15, 80);
        tryHospitalFloor(r, 'waitingBench', Math.PI/2, 1.0, 60);
        if(roomy) tryHospitalFloor(r, 'waitingBench', 0, 0.9, 60);
        addSupportProps([
          {kind:'medCart', scale:0.85, when:0.85},
          {kind:'medCabinet', scale:0.88, when:0.65},
          {kind:'bioBin', scale:0.78, when:0.55}
        ]);
      } else if(r.type===TYPE.BOSS){
        tryHospitalFloor(r, 'surgeryTable', rng.chance(0.5)?0:Math.PI/2, 1.18, 110);
        tryHospitalFloor(r, 'surgicalLamp', 0, 1.05, 80);
        tryHospitalFloor(r, 'gurney', Math.PI/2, 0.98, 90);
        tryHospitalFloor(r, 'cleanZone', 0, 1.15, 90);
        addSupportProps([
          {kind:'monitor', scale:0.95, when:0.95},
          {kind:'medCart', scale:0.86, when:0.9},
          {kind:'oxygenTank', scale:0.86, when:0.85},
          {kind:'bioBin', scale:0.8, when:0.75},
          {kind:'medCabinet', scale:0.9, when:0.7}
        ]);
      } else if(r.type===TYPE.SHRINE){
        tryHospitalFloor(r, 'mriScanner', rng.chance(0.5)?0:Math.PI/2, 1.08, 110);
        tryHospitalFloor(r, 'monitor', 0, 0.95, 80);
        addSupportProps([
          {kind:'medCart', scale:0.82, when:0.85},
          {kind:'medCabinet', scale:0.88, when:0.75},
          {kind:'waitingBench', scale:0.82, when:0.6},
          {kind:'oxygenTank', scale:0.78, when:0.55}
        ]);
      } else if(r.type===TYPE.TREASURE){
        tryHospitalFloor(r, 'doctorDesk', 0, 1.05, 90);
        tryHospitalFloor(r, 'waitingBench', Math.PI/2, 0.9, 70);
        addSupportProps([
          {kind:'medCabinet', scale:0.92, when:0.9},
          {kind:'monitor', scale:0.78, when:0.65},
          {kind:'medCart', scale:0.78, when:0.55},
          {kind:'bioBin', scale:0.72, when:0.45}
        ]);
      } else if(r.type===TYPE.ELITE){
        tryHospitalFloor(r, 'examTable', rng.chance(0.5)?0:Math.PI/2, 1.02, 90);
        tryHospitalFloor(r, 'doctorDesk', 0, 0.92, 70);
        addSupportProps([
          {kind:'monitor', scale:0.9, when:0.9},
          {kind:'medCart', scale:0.85, when:0.85},
          {kind:'medCabinet', scale:0.86, when:0.75},
          {kind:'privacyCurtain', scale:0.92, when:0.65},
          {kind:'oxygenTank', scale:0.76, when:0.45}
        ]);
      } else {
        const ward = (r.id + r.depth) % 3 !== 0;
        if(ward){
          const beds = roomy ? rng.i(2,3) : rng.i(1,2);
          for(let i=0;i<beds;i++){
            const rot = (i%2===0) ? 0 : Math.PI/2;
            const p = tryHospitalFloor(r, 'hospitalBed', rot, rng.f(0.98,1.08), 100);
            if(p && rng.chance(0.85)){
              const ix = p.x + (rot===0 ? (i%2===0 ? -1 : 1) : 0), iy = p.y + (rot===0 ? 0 : (i%2===0 ? -1 : 1));
              if(clearForHospital(ix,iy,r.id) && !occ[idx(ix,iy)]) put('ivStand', ix, iy, 0, rng.f(0.88,1.0), r.id);
            }
          }
          addSupportProps([
            {kind:'medCabinet', scale:0.88, when:0.7},
            {kind:'privacyCurtain', scale:0.9, when:0.65},
            {kind:'oxygenTank', scale:0.76, when:0.55},
            {kind:'bioBin', scale:0.72, when:0.45},
            {kind:'medCart', scale:0.78, when:roomy?0.55:0.35}
          ]);
        } else {
          tryHospitalFloor(r, 'examTable', rng.chance(0.5)?0:Math.PI/2, 0.96, 80);
          addSupportProps([
            {kind:'doctorDesk', scale:0.85, when:0.75},
            {kind:'medCabinet', scale:0.85, when:0.7},
            {kind:'medCart', scale:0.78, when:0.55},
            {kind:'monitor', scale:0.78, when:0.45},
            {kind:'bioBin', scale:0.7, when:0.35}
          ]);
        }
      }
    }
    const signs=[];
    for(let y=0;y<H;y++) for(let x=0;x<W;x++){
      if(grid[idx(x,y)]!==WALL) continue;
      const d = floorDir(x,y);
      if(!d) continue;
      const fc = idx(x+d[0], y+d[1]);
      if(roomId[fc] < 0 || doorway[fc]) continue;
      let close=false;
      for(const s of signs) if(Math.max(Math.abs(s.x-x),Math.abs(s.y-y))<6){ close=true; break; }
      if(!close && rng.chance(0.18 + 0.14*params.decorDensity)){
        signs.push({x,y}); props.push({kind:'wallLight',x,y,dx:d[0],dy:d[1],rot:0,scale:rng.f(0.85,1.05)});
      } else if(!close && rng.chance(0.16 + 0.16*params.decorDensity)){
        signs.push({x,y}); props.push({kind:'wallChart',x,y,dx:d[0],dy:d[1],rot:0,scale:rng.f(0.85,1.05)});
      } else if(!close && rng.chance(0.12 + 0.12*params.decorDensity)){
        signs.push({x,y}); props.push({kind:'noticeBoard',x,y,dx:d[0],dy:d[1],rot:0,scale:rng.f(0.82,1.0)});
      } else if(!close && rng.chance(0.08 + 0.08*params.decorDensity)){
        signs.push({x,y}); props.push({kind:'clock',x,y,dx:d[0],dy:d[1],rot:0,scale:rng.f(0.75,0.9)});
      } else if(!close && rng.chance(0.1 + 0.1*params.decorDensity)){
        signs.push({x,y}); props.push({kind:'hospitalSign',x,y,dx:d[0],dy:d[1],rot:0,scale:0.9});
      }
    }
    for(let y=0;y<H;y++) for(let x=0;x<W;x++){
      const c=idx(x,y);
      if(grid[c]!==FLOOR || lakeMask[c] || doorway[c]) continue;
      if(corridor[c] && rng.chance(0.025 + 0.035*params.decorDensity))
        props.push({kind:'floorStripe',x,y,rot:rng.chance(0.5)?0:Math.PI/2,scale:rng.f(0.85,1.08),roomId:roomId[c]});
      else if(corridor[c] && rng.chance(0.008 + 0.018*params.decorDensity))
        props.push({kind:'floorArrow',x,y,rot:rng.i(0,3)*Math.PI/2,scale:rng.f(0.85,1.05),roomId:roomId[c]});
    }
  }
  if(!isHospital && TH.bones){
    for(let y=0;y<H;y++) for(let x=0;x<W;x++){
      const c=idx(x,y);
      if(grid[c]!==FLOOR || occ[c] || doorway[c] || corridor[c]) continue;
      const rid = roomId[c];
      if(rid>=0 && rooms[rid].depth>1 && rng.chance(0.018 + 0.02*params.decorDensity))
        props.push({kind:'bones',x,y,rot:rng.f(0,6.28),scale:rng.f(0.8,1.2),roomId:rid});
    }
  }
  /* liquid veins: crack decals anchored to pool edges so they read as heat/
     rot radiating FROM the liquid into the surrounding stone, never floating
     mid-room. Frost gets pale fracture lines around lake shores. */
  { const DIRS = [[1,0],[-1,0],[0,1],[0,-1]];
    if(!isHospital && TH.pools && (TH.pools.mode===0 || TH.pools.mode===3)){
      const pv = TH.pools.mode===0 ? 0.8 : 0.45;
      for(const p of pools)
        for(const [dx,dy] of DIRS){
          const nx=p.x+dx, ny=p.y+dy;
          if(!inB(nx,ny) || grid[idx(nx,ny)]!==FLOOR) continue;
          if(rng.chance(pv))
            props.push({kind:'crack',x:nx,y:ny,dx,dy,rot:rng.f(0,6.28),scale:rng.f(0.9,1.5)});
        }
    }
    if(!isHospital && TH.lakes){
      for(const lc of lakeCells)
        for(const [dx,dy] of DIRS){
          const nx=lc.x+dx, ny=lc.y+dy;
          if(!inB(nx,ny)) continue;
          const c2 = idx(nx,ny);
          if(grid[c2]!==FLOOR || lakeMask[c2]) continue;
          if(rng.chance(0.3))
            props.push({kind:'crack',x:nx,y:ny,dx,dy,rot:rng.f(0,6.28),scale:rng.f(0.7,1.2),ice:1});
        }
    }
  }
  if(!isHospital) for(const r of rooms){
    if(r.type!==TYPE.ELITE && r.type!==TYPE.BOSS) continue;
    const cand=[];
    for(let y=Math.floor(r.cy-r.h/2)-1; y<=Math.ceil(r.cy+r.h/2)+1; y++)
      for(let x=Math.floor(r.cx-r.w/2)-1; x<=Math.ceil(r.cx+r.w/2)+1; x++){
        if(!inB(x,y) || grid[idx(x,y)]!==WALL) continue;
        const d = floorDir(x,y);
        if(d && roomId[idx(x+d[0],y+d[1])]===r.id) cand.push({x,y,dx:d[0],dy:d[1]});
      }
    for(let i=cand.length-1;i>0;i--){ const j=rng.i(0,i); const t=cand[i]; cand[i]=cand[j]; cand[j]=t; }
    const placed=[];
    for(const s of cand){
      if(placed.length >= (r.type===TYPE.BOSS?4:2)) break;
      let close=false;
      for(const p of placed) if(Math.max(Math.abs(p.x-s.x),Math.abs(p.y-s.y))<4){ close=true; break; }
      if(!close){ placed.push(s); props.push({kind:'banner',x:s.x,y:s.y,dx:s.dx,dy:s.dy,rot:0,scale:1}); }
    }
  }

  const loops = edges.filter(e=>e.isLoop).length;
  return {
    valid, disconnectedRooms, params, seed, name:dungeonName(rng, TH),
    W,H, grid, roomId, corridor, doorway, bfs, maxBfs,
    rooms, edges, entrance, boss, maxDepth,
    props, spawns, torches, pools, lakeCells, lakeMask, arches,
    stats:{ rooms:N, edges:edges.length, loops, critLen, floorTiles:floorTotal, reach, genMs:0, attempts:1 }
  };
}

/* ================================================================
   RENDERER
   ================================================================ */
const canvasBg = 0x07080d;
const renderer = new THREE.WebGLRenderer({antialias:true});
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.6));
renderer.setSize(innerWidth, innerHeight);
renderer.setClearColor(canvasBg);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;   // PCFSoftShadowMap is deprecated in modern three (it silently falls back to this anyway)
renderer.info.autoReset = false;
document.body.appendChild(renderer.domElement);
const maxAniso = renderer.capabilities.getMaxAnisotropy();

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(canvasBg, 0.002);

const CAMERA_FOV = 45;
let aspect = innerWidth/innerHeight;
const cam = new THREE.PerspectiveCamera(CAMERA_FOV, aspect, 0.1, 1000);
let yaw = Math.PI/4, pitch = 0.64, camDist = 170;
const camTarget = new THREE.Vector3(0,0,0);
function updateCam(){
  const cp=Math.cos(pitch), sp=Math.sin(pitch);
  const f = new THREE.Vector3(cp*Math.sin(yaw), sp, cp*Math.cos(yaw));
  cam.position.copy(camTarget).addScaledVector(f, camDist);
  cam.lookAt(camTarget);
}
updateCam();

/* Analytic-light gain. r128 shipped the legacy (pre-physical) lighting model;
   modern three is physically based and dropped `useLegacyLights`, so the same
   intensity values render far dimmer. The legacy→physical gap here is dominated
   by the point lights (candela reinterpretation ≈ 4π) on top of the diffuse
   BRDF's 1/π, so 4π restores the brightness the theme intensities were authored
   against. Measured against the r128 original: floors land at the same ~0.17
   linear instead of ~0.04. */
const LIGHT_K = 4 * Math.PI;

/* painted-miniature light rig: warm key with soft shadows, cool ambient */
const hemi = new THREE.HemisphereLight(0x2e3a52, 0x0a0b10, 0.55);
scene.add(hemi);
const dirL = new THREE.DirectionalLight(0xffe8c8, 0.85);
dirL.position.set(72, 78, 46);
dirL.castShadow = true;
dirL.shadow.mapSize.set(2048, 2048);
dirL.shadow.bias = -0.0004;
dirL.shadow.normalBias = 0.55;
dirL.shadow.camera.near = 1;
dirL.shadow.camera.far = 320;
scene.add(dirL);

/* -------- shared temp objects -------- */
const _p=new THREE.Vector3(), _q=new THREE.Quaternion(), _s=new THREE.Vector3(),
      _m=new THREE.Matrix4(), _c=new THREE.Color(), _Y=new THREE.Vector3(0,1,0),
      _E=new THREE.Euler();
const V3 = (x,y,z)=> new THREE.Vector3(x,y,z);

/* ================================================================
   POST PIPELINE — scene renders linear into an RT (MSAA on WebGL2),
   then: bright-pass -> separable blur (bloom) -> final composite with
   tilt-shift focus band, cool-shadow/warm-highlight grade, vignette,
   grain, and gamma. Toggleable for A/B and perf comparison.
   ================================================================ */
const POST = (()=>{
  const tri = new THREE.BufferGeometry();
  tri.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1,-1,0, 3,-1,0, -1,3,0]),3));
  const qcam = new THREE.OrthographicCamera(-1,1,1,-1,0,1);
  const mkScene = mat => { const s=new THREE.Scene(); s.add(new THREE.Mesh(tri, mat)); return s; };
  const V = `varying vec2 vUv; void main(){ vUv = position.xy*0.5+0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
  const thresh = new THREE.ShaderMaterial({ uniforms:{ tS:{value:null} }, vertexShader:V, fragmentShader:`
    varying vec2 vUv; uniform sampler2D tS;
    void main(){
      vec3 c = texture2D(tS, vUv).rgb;
      float l = dot(c, vec3(0.299, 0.587, 0.114));
      gl_FragColor = vec4(c * smoothstep(0.58, 0.95, l), 1.0);
    }`, depthTest:false, depthWrite:false });
  const blur = new THREE.ShaderMaterial({ uniforms:{ tS:{value:null}, uDir:{value:new THREE.Vector2(1,0)}, uRes:{value:new THREE.Vector2(1,1)} }, vertexShader:V, fragmentShader:`
    varying vec2 vUv; uniform sampler2D tS; uniform vec2 uDir, uRes;
    void main(){
      vec2 px = uDir / uRes;
      vec3 c = texture2D(tS, vUv).rgb * 0.227;
      c += (texture2D(tS, vUv + px*1.384).rgb + texture2D(tS, vUv - px*1.384).rgb) * 0.316;
      c += (texture2D(tS, vUv + px*3.230).rgb + texture2D(tS, vUv - px*3.230).rgb) * 0.0703;
      gl_FragColor = vec4(c, 1.0);
    }`, depthTest:false, depthWrite:false });
  const fin = new THREE.ShaderMaterial({ uniforms:{
      tS:{value:null}, tB:{value:null}, uRes:{value:new THREE.Vector2(1,1)},
      uTime:{value:0}, uBloom:{value:0.9}, uTilt:{value:1.0} }, vertexShader:V, fragmentShader:`
    varying vec2 vUv; uniform sampler2D tS, tB; uniform vec2 uRes; uniform float uTime, uBloom, uTilt;
    void main(){
      vec2 px = 1.0 / uRes;
      vec3 col = texture2D(tS, vUv).rgb;
      /* Tilt-shift focus band. Sample the neighbour taps in uniform control flow
         (radius collapses to 0 where band==0) to avoid undefined implicit-
         derivative LOD inside a conditional. */
      float band = smoothstep(0.15, 0.52, abs(vUv.y - 0.5)) * uTilt;
      float r = band * 3.4;
      vec3 b = col * 0.4;
      b += texture2D(tS, vUv + vec2( px.x*r,  px.y*r*0.6)).rgb * 0.15;
      b += texture2D(tS, vUv + vec2(-px.x*r,  px.y*r*0.6)).rgb * 0.15;
      b += texture2D(tS, vUv + vec2( px.x*r, -px.y*r*0.6)).rgb * 0.15;
      b += texture2D(tS, vUv + vec2(-px.x*r, -px.y*r*0.6)).rgb * 0.15;
      col = mix(col, b, min(1.0, band));
      col += texture2D(tB, vUv).rgb * uBloom;
      float lum = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(col, col * vec3(0.90, 0.97, 1.12), (1.0 - smoothstep(0.0, 0.4, lum)) * 0.38);
      col = mix(col, col * vec3(1.07, 1.01, 0.93), smoothstep(0.45, 1.0, lum) * 0.28);
      col = mix(vec3(lum), col, 1.09);
      col = (col - 0.5) * 1.05 + 0.5;
      float vg = smoothstep(1.35, 0.5, length(vUv - 0.5) * 1.55);
      col *= mix(0.78, 1.02, vg);
      float gr = fract(sin(dot(gl_FragCoord.xy + mod(uTime,10.0)*37.0, vec2(12.9898,78.233))) * 43758.5453);
      col += (gr - 0.5) * 0.02;
      col = pow(max(col, 0.0), vec3(0.4545));
      gl_FragColor = vec4(col, 1.0);
    }`, depthTest:false, depthWrite:false });
  return { qcam, sThresh:mkScene(thresh), sBlur:mkScene(blur), sFinal:mkScene(fin),
           thresh, blur, fin, rtScene:null, rtA:null, rtB:null, w:0, h:0, enabled:true };
})();
function setupRTs(){
  const size = new THREE.Vector2();
  renderer.getDrawingBufferSize(size);
  if(POST.w===size.x && POST.h===size.y && POST.rtScene) return;
  POST.w=size.x; POST.h=size.y;
  if(POST.rtScene){ POST.rtScene.dispose(); POST.rtA.dispose(); POST.rtB.dispose(); }
  const ps = {minFilter:THREE.LinearFilter, magFilter:THREE.LinearFilter, format:THREE.RGBAFormat, depthBuffer:true, stencilBuffer:false};
  /* MSAA is requested via the `samples` option now (WebGLMultisampleRenderTarget
     was removed in r138). Modern three is WebGL2-only, so multisampling is
     always available. The scene renders here in raw linear (three applies neither
     tone-map nor colour conversion to a non-canvas target); the composite pass
     grades and gamma-encodes it — matching the r128 original exactly. */
  POST.rtScene = new THREE.WebGLRenderTarget(size.x, size.y, {...ps, samples:4});
  const pb = {minFilter:THREE.LinearFilter, magFilter:THREE.LinearFilter, format:THREE.RGBAFormat, depthBuffer:false, stencilBuffer:false};
  POST.rtA = new THREE.WebGLRenderTarget(size.x>>2, size.y>>2, pb);
  POST.rtB = new THREE.WebGLRenderTarget(size.x>>2, size.y>>2, pb);
}
let curBg = new THREE.Color(canvasBg);
const _cBg = new THREE.Color();
function renderFrame(){
  if(!POST.enabled){
    /* straight-to-canvas debug path: let three apply sRGB + its ACES tone map */
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(curBg);
    renderer.setRenderTarget(null);
    renderer.render(scene, cam);
    return;
  }
  setupRTs();
  /* clear color bypasses material shaders, so linearize it here — the final
     composite pass applies gamma and lands it back on the authored value */
  renderer.setClearColor(_cBg.copy(curBg).convertSRGBToLinear());
  /* rtScene stores raw linear HDR (three skips tone-map + colour conversion when
     the target isn't the canvas); the post shaders tone-map and gamma-encode it. */
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.setRenderTarget(POST.rtScene); renderer.render(scene, cam);
  POST.thresh.uniforms.tS.value = POST.rtScene.texture;
  renderer.setRenderTarget(POST.rtA); renderer.render(POST.sThresh, POST.qcam);
  POST.blur.uniforms.uRes.value.set(POST.w>>2, POST.h>>2);
  POST.blur.uniforms.tS.value = POST.rtA.texture; POST.blur.uniforms.uDir.value.set(1,0);
  renderer.setRenderTarget(POST.rtB); renderer.render(POST.sBlur, POST.qcam);
  POST.blur.uniforms.tS.value = POST.rtB.texture; POST.blur.uniforms.uDir.value.set(0,1);
  renderer.setRenderTarget(POST.rtA); renderer.render(POST.sBlur, POST.qcam);
  POST.fin.uniforms.tS.value = POST.rtScene.texture;
  POST.fin.uniforms.tB.value = POST.rtA.texture;
  POST.fin.uniforms.uRes.value.set(POST.w, POST.h);
  POST.fin.uniforms.uTime.value = elapsed;
  renderer.setRenderTarget(null); renderer.render(POST.sFinal, POST.qcam);
}

/* ================================================================
   PROCEDURAL TEXTURES — canvas-generated, shared, tiny
   ================================================================ */
function makeCanvas(sz){ const c=document.createElement('canvas'); c.width=c.height=sz; return [c, c.getContext('2d')]; }
const texRand = mulberry32(0xC0FFEE);
function makeStoneTex(){
  const [cv,g] = makeCanvas(256);
  g.fillStyle='#c9c9c9'; g.fillRect(0,0,256,256);
  for(let i=0;i<2600;i++){
    const v = 170 + texRand()*110 | 0;
    g.fillStyle = 'rgba('+v+','+v+','+v+',0.16)';
    g.fillRect(texRand()*256, texRand()*256, 1+texRand()*3.4, 1+texRand()*3.4);
  }
  for(let i=0;i<420;i++){
    g.fillStyle = 'rgba(40,40,48,'+(0.05+texRand()*0.10).toFixed(3)+')';
    g.fillRect(texRand()*256, texRand()*256, 1+texRand()*2, 1+texRand()*2);
  }
  g.strokeStyle='rgba(30,30,36,0.20)'; g.lineWidth=1;
  for(let i=0;i<7;i++){
    let x=texRand()*256, y=texRand()*256;
    g.beginPath(); g.moveTo(x,y);
    for(let s=0;s<6;s++){ x+=(texRand()-0.5)*46; y+=(texRand()-0.5)*46; g.lineTo(x,y); }
    g.stroke();
  }
  const t = new THREE.CanvasTexture(cv);
  t.wrapS=t.wrapT=THREE.RepeatWrapping; t.colorSpace=THREE.SRGBColorSpace;
  t.anisotropy = Math.min(4, maxAniso);
  return t;
}
function makeCrackTex(){
  const [cv,g] = makeCanvas(128);
  g.lineCap='round';
  const branch=(x,y,a,w,d)=>{
    if(d<=0 || w<0.4) return;
    const len=9+texRand()*15, nx=x+Math.cos(a)*len, ny=y+Math.sin(a)*len;
    g.strokeStyle='rgba(255,255,255,'+(0.45+0.5*Math.min(1,w/3)).toFixed(2)+')'; g.lineWidth=w;
    g.beginPath(); g.moveTo(x,y); g.lineTo(nx,ny); g.stroke();
    branch(nx,ny, a+(texRand()-0.5)*1.0, w*0.76, d-1);
    if(texRand()<0.55) branch(nx,ny, a+(texRand()-0.5)*2.2, w*0.55, d-2);
  };
  for(let i=0;i<3;i++) branch(64,64, texRand()*6.28, 3, 6);
  return new THREE.CanvasTexture(cv);
}
function makeRuneTex(){
  const [cv,g] = makeCanvas(256);
  g.translate(128,128); g.lineCap='round';
  g.strokeStyle='rgba(255,255,255,0.85)';
  g.lineWidth=3; g.beginPath(); g.arc(0,0,104,0,6.2832); g.stroke();
  g.lineWidth=1.6; g.beginPath(); g.arc(0,0,76,0,6.2832); g.stroke();
  for(let i=0;i<20;i++){
    g.save(); g.rotate(i/20*6.2832); g.translate(90,0); g.rotate(1.5708);
    g.lineWidth=2.6; g.beginPath();
    let x=-4+texRand()*8, y=-7;
    g.moveTo(x,y);
    for(let s=0;s<3;s++){ x+=(texRand()-0.5)*12; y+=4+texRand()*4; g.lineTo(x,y); }
    g.stroke(); g.restore();
  }
  return new THREE.CanvasTexture(cv);
}
function makeSwirlTex(){
  const [cv,g] = makeCanvas(256);
  g.translate(128,128); g.lineCap='round';
  for(let arm=0;arm<3;arm++)
    for(let i=0;i<44;i++){
      const t0=i/44, a=arm*2.094 + t0*4.4, r=6+t0*112;
      g.strokeStyle='rgba(255,255,255,'+(0.55*(1-t0)).toFixed(3)+')';
      g.lineWidth=7*(1-t0)+1.5;
      g.beginPath(); g.arc(0,0,r,a,a+0.32); g.stroke();
    }
  const grd=g.createRadialGradient(0,0,0,0,0,36);
  grd.addColorStop(0,'rgba(255,255,255,0.9)'); grd.addColorStop(1,'rgba(255,255,255,0)');
  g.fillStyle=grd; g.beginPath(); g.arc(0,0,36,0,6.2832); g.fill();
  return new THREE.CanvasTexture(cv);
}
function makeShaftTex(){
  const [cv,g] = makeCanvas(64);
  const grd=g.createLinearGradient(0,0,0,64);
  grd.addColorStop(0,'rgba(255,255,255,0.7)'); grd.addColorStop(1,'rgba(255,255,255,0)');
  g.fillStyle=grd; g.fillRect(0,0,64,64);
  return new THREE.CanvasTexture(cv);
}
function makeGlowTex(){
  const [cv,g] = makeCanvas(128);
  const grd=g.createRadialGradient(64,64,3,64,64,62);
  grd.addColorStop(0,'rgba(255,255,255,0.85)');
  grd.addColorStop(0.35,'rgba(255,255,255,0.28)');
  grd.addColorStop(1,'rgba(255,255,255,0)');
  g.fillStyle=grd; g.beginPath(); g.arc(64,64,62,0,6.2832); g.fill();
  return new THREE.CanvasTexture(cv);
}
function makeHospitalFloorTex(){
  const [cv,g] = makeCanvas(256);
  g.fillStyle='#d7e0dc';
  g.fillRect(0,0,256,256);

  /* Clean vinyl/ceramic tile sheet: subtle grout only. Strong symbols and
     high-contrast guide lines are modeled as separate floor props instead. */
  for(let y=0;y<256;y+=64){
    for(let x=0;x<256;x+=64){
      const n = 214 + Math.floor(texRand()*8);
      g.fillStyle = `rgb(${n},${n+8},${n+4})`;
      g.fillRect(x+2,y+2,60,60);
    }
  }
  g.strokeStyle='rgba(74,94,90,0.22)';
  g.lineWidth=2;
  for(let i=0;i<=256;i+=64){
    g.beginPath(); g.moveTo(i,0); g.lineTo(i,256); g.stroke();
    g.beginPath(); g.moveTo(0,i); g.lineTo(256,i); g.stroke();
  }
  g.strokeStyle='rgba(255,255,255,0.18)';
  g.lineWidth=1;
  for(let i=32;i<256;i+=64){
    g.beginPath(); g.moveTo(i,0); g.lineTo(i,256); g.stroke();
    g.beginPath(); g.moveTo(0,i); g.lineTo(256,i); g.stroke();
  }
  const t = new THREE.CanvasTexture(cv);
  t.wrapS=t.wrapT=THREE.RepeatWrapping; t.colorSpace=THREE.SRGBColorSpace;
  t.anisotropy = Math.min(4, maxAniso);
  return t;
}
function makeHospitalWallTex(){
  const [cv,g] = makeCanvas(256);
  g.fillStyle='#becbc6';
  g.fillRect(0,0,256,256);

  /* Hospital wall finish: quiet plaster panels with a soft washable lower
     band. No repeated fake equipment shapes; actual equipment is geometry. */
  g.fillStyle='rgba(238,246,242,0.42)';
  g.fillRect(0,0,256,104);
  g.fillStyle='rgba(145,178,170,0.38)';
  g.fillRect(0,112,256,52);
  g.fillStyle='rgba(72,158,150,0.32)';
  g.fillRect(0,116,256,10);
  g.strokeStyle='rgba(58,78,74,0.18)';
  g.lineWidth=2;
  for(let x=0;x<=256;x+=128){
    g.beginPath(); g.moveTo(x,0); g.lineTo(x,256); g.stroke();
  }
  for(let y=104;y<=256;y+=76){
    g.beginPath(); g.moveTo(0,y); g.lineTo(256,y); g.stroke();
  }
  g.strokeStyle='rgba(255,255,255,0.16)';
  g.lineWidth=1;
  g.beginPath(); g.moveTo(0,166); g.lineTo(256,166); g.stroke();
  const t = new THREE.CanvasTexture(cv);
  t.wrapS=t.wrapT=THREE.RepeatWrapping; t.colorSpace=THREE.SRGBColorSpace;
  t.anisotropy = Math.min(4, maxAniso);
  return t;
}
const TEX = { stone:makeStoneTex(), crack:makeCrackTex(), rune:makeRuneTex(), swirl:makeSwirlTex(), shaft:makeShaftTex(), glow:makeGlowTex(), hospitalFloor:makeHospitalFloorTex(), hospitalWall:makeHospitalWallTex() };

/* ================================================================
   MATERIAL KIT — named roles, shared across all instanced sets
   ================================================================ */
const matStone = new THREE.MeshStandardMaterial({map:TEX.stone, roughness:0.92, metalness:0.02});
const matHospitalFloor = new THREE.MeshStandardMaterial({map:TEX.hospitalFloor, roughness:0.58, metalness:0.02});
const matHospitalWall = new THREE.MeshStandardMaterial({roughness:0.78, metalness:0.01});
const matHospitalTrim = new THREE.MeshStandardMaterial({roughness:0.28, metalness:0.35});
const matTrim  = new THREE.MeshStandardMaterial({roughness:0.38, metalness:0.75});
const matGlow  = new THREE.MeshBasicMaterial({color:0xffffff});
matGlow.toneMapped = false;
const matCloth = new THREE.MeshLambertMaterial({side:THREE.DoubleSide});
const matIce   = new THREE.MeshStandardMaterial({roughness:0.16, metalness:0.02, transparent:true, opacity:0.88});
const matMoss  = new THREE.MeshLambertMaterial();
const matBark  = new THREE.MeshStandardMaterial({roughness:0.95, metalness:0});
const matCrackD = new THREE.MeshBasicMaterial({map:TEX.crack, transparent:true, blending:THREE.AdditiveBlending, depthWrite:false});
matCrackD.toneMapped = false;
const matRune  = new THREE.MeshBasicMaterial({map:TEX.rune, transparent:true, blending:THREE.AdditiveBlending, depthWrite:false, side:THREE.DoubleSide});
matRune.toneMapped = false;
const matPortal= new THREE.MeshBasicMaterial({map:TEX.swirl, transparent:true, blending:THREE.AdditiveBlending, depthWrite:false});
matPortal.toneMapped = false;
const matShaft = new THREE.MeshBasicMaterial({map:TEX.shaft, transparent:true, blending:THREE.AdditiveBlending, depthWrite:false, side:THREE.DoubleSide, opacity:0.13});
matShaft.toneMapped = false;
const matSkirt = new THREE.MeshBasicMaterial({map:TEX.glow, transparent:true, blending:THREE.AdditiveBlending, depthWrite:false, opacity:0.5});
matSkirt.toneMapped = false;

/* liquid surface shader: lava / ice / water / miasma via uMode */
const liquidMat = new THREE.ShaderMaterial({
  transparent:true, depthWrite:false,
  uniforms:{ uTime:{value:0}, uMode:{value:0}, uGlow:{value:1}, uOp:{value:1},
             uColA:{value:new THREE.Color(0x000000)}, uColB:{value:new THREE.Color(0xffffff)} },
  vertexShader:`
    attribute vec2 aE;
    attribute vec4 aM;
    varying vec2 vP, vE;
    varying vec4 vM;
    void main(){ vP = vec2(position.x, position.z); vE = aE; vM = aM;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader:`
    precision highp float;
    varying vec2 vP, vE;
    varying vec4 vM;
    uniform float uTime, uMode, uGlow, uOp;
    uniform vec3 uColA, uColB;
    float h21(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y); }
    float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
      float a=h21(i), b=h21(i+vec2(1,0)), c=h21(i+vec2(0,1)), d=h21(i+vec2(1,1));
      return mix(mix(a,b,f.x), mix(c,d,f.x), f.y); }
    float fbm(vec2 p){ float v=0.0, a=0.5;
      for(int i=0;i<4;i++){ v+=a*vnoise(p); p=p*2.03+11.7; a*=0.5; } return v; }
    void main(){
      vec3 col;
      if(uMode < 0.5){
        float n = fbm(vP*0.55 + vec2(uTime*0.045, uTime*0.021));
        float crust = smoothstep(0.40, 0.62, n);
        float veins = smoothstep(0.06, 0.0, abs(n-0.5));
        col = mix(uColB*1.6, uColA, crust);
        col += vec3(1.0,0.72,0.32) * veins * 0.9;
        col += uColB * 0.22 * (0.5 + 0.5*sin(uTime*1.7 + n*22.0));
      } else if(uMode < 1.5){
        float n = fbm(vP*0.8);
        float cr = smoothstep(0.47, 0.5, abs(fract(n*6.0)-0.5));
        col = mix(uColA, uColB, n);
        col += vec3(1.0) * cr * 0.16;
        float tw = step(0.994, h21(floor(vP*3.0) + floor(uTime*2.0)));
        col += vec3(0.8,0.95,1.0) * tw * 0.45;
      } else if(uMode < 2.5){
        float n = fbm(vP*0.7 + vec2(uTime*0.05, -uTime*0.035));
        float n2 = fbm(vP*1.3 - vec2(uTime*0.04, uTime*0.05));
        float caust = pow(1.0 - abs(n - n2), 6.0);
        col = mix(uColA, uColB, n*0.85) + vec3(0.5,0.9,0.8)*caust*0.35;
      } else {
        vec2 w = vP + 1.5*vec2(fbm(vP*0.35 + uTime*0.02), fbm(vP*0.35 - uTime*0.016));
        float n = fbm(w*0.5);
        col = mix(uColA, uColB, smoothstep(0.25, 0.75, n));
        col += uColB * 0.3 * smoothstep(0.6, 0.9, n);
      }
      /* soften true borders only: cooled crust for lava, depth falloff for
         water/ice, alpha fade for miasma */
      float e = 0.0;
      e = max(e, vM.x * smoothstep(0.26, 0.5, -vE.x));
      e = max(e, vM.y * smoothstep(0.26, 0.5,  vE.x));
      e = max(e, vM.z * smoothstep(0.26, 0.5, -vE.y));
      e = max(e, vM.w * smoothstep(0.26, 0.5,  vE.y));
      float aOut = uOp;
      if(uMode < 0.5)      col = mix(col, vec3(0.10,0.03,0.01), e*0.85);
      else if(uMode < 1.5) col *= (1.0 - 0.25*e);
      else if(uMode < 2.5) col *= (1.0 - 0.4*e);
      else                 aOut *= (1.0 - 0.55*e);
      gl_FragColor = vec4(col * (0.5 + uGlow), aOut);
    }`
});

/* ambient particle field: dust / embers / snow / wisps / spores (GPU) */
const partMat = new THREE.ShaderMaterial({
  transparent:true, depthWrite:false, blending:THREE.AdditiveBlending,
  uniforms:{ uTime:{value:0}, uRamp:{value:1}, uZoom:{value:2}, uKind:{value:0},
             uColor:{value:new THREE.Color(0xffffff)} },
  vertexShader:`
    attribute float aSeed;
    uniform float uTime, uRamp, uZoom, uKind;
    varying float vA;
    float h(float n){ return fract(sin(n*127.1)*43758.5453); }
    void main(){
      vec3 p = position;
      float s = aSeed, t, w;
      /* w = particle diameter in WORLD units; uZoom = device px per world
         unit, so sprites stay anchored to the scene across zoom levels */
      if(uKind < 0.5){            /* dust motes in light shafts */
        w = 0.05 + 0.05*h(s+3.1);
        p.x += sin(uTime*0.10 + s*17.0)*0.25;
        p.z += cos(uTime*0.08 + s*23.0)*0.25;
        p.y += 0.25*sin(uTime*0.13 + s*31.0);
        vA = 0.10 + 0.08*sin(uTime*0.5 + s*40.0);
      } else if(uKind < 1.5){     /* embers rising off lava + flames */
        w = 0.045 + 0.05*h(s+3.1);
        t = fract(uTime*(0.10 + 0.08*h(s)) + s);
        p.y += t*(1.1 + 0.9*h(s+5.0));
        p.x += sin(t*9.0 + s*50.0)*0.10;
        p.z += cos(t*8.0 + s*60.0)*0.10;
        vA = smoothstep(0.0,0.05,t)*(1.0-t)*(0.55 + 0.45*sin(uTime*10.0 + s*90.0));
      } else if(uKind < 2.5){     /* snowfall */
        w = 0.04 + 0.045*h(s+3.1);
        t = fract(uTime*(0.035 + 0.02*h(s)) + s);
        p.y += (1.0-t)*3.2;
        p.x += sin(uTime*0.5 + s*30.0)*0.3;
        p.z += cos(uTime*0.42 + s*36.0)*0.3;
        vA = 0.5*smoothstep(0.0,0.05,t)*smoothstep(1.0,0.95,t);
      } else if(uKind < 3.5){     /* wisps hovering over graves/candles */
        w = 0.09 + 0.07*h(s+3.1);
        p.x += sin(uTime*0.25 + s*44.0)*0.35;
        p.z += cos(uTime*0.21 + s*52.0)*0.35;
        p.y += 0.35 + 0.25*sin(uTime*0.4 + s*20.0);
        vA = 0.16 + 0.14*sin(uTime*1.3 + s*70.0);
      } else {                    /* spores drifting off moss/roots */
        w = 0.035 + 0.04*h(s+3.1);
        t = fract(uTime*0.03*(0.6 + h(s)) + s);
        p.y += t*1.3 + 0.08;
        p.x += sin(uTime*0.35 + s*25.0)*0.3;
        p.z += cos(uTime*0.3 + s*29.0)*0.3;
        vA = 0.35*smoothstep(0.0,0.08,t)*(1.0-t);
      }
      vA *= uRamp;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      gl_PointSize = max(w * uZoom, 1.2);
    }`,
  fragmentShader:`
    precision mediump float;
    uniform vec3 uColor;
    varying float vA;
    void main(){
      float d = length(gl_PointCoord - 0.5);
      float a = smoothstep(0.5, 0.12, d) * vA;
      gl_FragColor = vec4(uColor * (1.0 + 0.8*smoothstep(0.3, 0.0, d)), a);
    }`
});
partMat.toneMapped = false;

/* ================================================================
   PROCEDURAL GEOMETRY KIT — authored, merged, shared, instanced
   ================================================================ */
function bgFromTris(v){
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(v),3));
  const p = g.attributes.position, uv = new Float32Array(p.count*2);
  for(let i=0;i<p.count;i++){
    uv[i*2]   = (p.getX(i)+p.getZ(i))*0.53 + 0.5;
    uv[i*2+1] = p.getY(i)*0.61 + (p.getX(i)-p.getZ(i))*0.21;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv,2));
  g.computeVertexNormals();
  return g;
}
function chamferBox(w,h,d,ch){
  const hw=w/2, hd=d/2, iw=Math.max(0.01,hw-ch), id=Math.max(0.01,hd-ch), hb=Math.max(0.01,h-ch);
  const v=[];
  const q=(a,b,c,e)=>{ v.push(a[0],a[1],a[2], b[0],b[1],b[2], c[0],c[1],c[2],
                              a[0],a[1],a[2], c[0],c[1],c[2], e[0],e[1],e[2]); };
  const b0=[-hw,0,-hd],b1=[hw,0,-hd],b2=[hw,0,hd],b3=[-hw,0,hd];
  const m0=[-hw,hb,-hd],m1=[hw,hb,-hd],m2=[hw,hb,hd],m3=[-hw,hb,hd];
  const t0=[-iw,h,-id],t1=[iw,h,-id],t2=[iw,h,id],t3=[-iw,h,id];
  q(b1,b0,m0,m1); q(b3,b2,m2,m3); q(b2,b1,m1,m2); q(b0,b3,m3,m0);
  q(m1,m0,t0,t1); q(m3,m2,t2,t3); q(m2,m1,t1,t2); q(m0,m3,t3,t0);
  q(t3,t2,t1,t0); q(b0,b1,b2,b3);
  return bgFromTris(v);
}
function spireGeo(rBase,h,twist){
  const rings=[{r:rBase,y:0,a:0},{r:rBase*0.8,y:h*0.45,a:twist*0.5},{r:rBase*0.48,y:h*0.78,a:twist}];
  const pt=(r,y,a,k)=>{ const ang=a + k*Math.PI/2 + Math.PI/4;
    return [Math.cos(ang)*r, y, Math.sin(ang)*r]; };
  const v=[];
  for(let i=0;i<rings.length-1;i++){
    const A=rings[i], B=rings[i+1];
    for(let k=0;k<4;k++){
      const a0=pt(A.r,A.y,A.a,k), a1=pt(A.r,A.y,A.a,k+1), b0=pt(B.r,B.y,B.a,k), b1=pt(B.r,B.y,B.a,k+1);
      v.push(...a1,...a0,...b0, ...a1,...b0,...b1);
    }
  }
  const T=rings[rings.length-1];
  for(let k=0;k<4;k++){
    const a0=pt(T.r,T.y,T.a,k), a1=pt(T.r,T.y,T.a,k+1);
    v.push(...a1,...a0, 0,h,0);
  }
  for(let k=0;k<4;k++){
    const a0=pt(rings[0].r,0,0,k), a1=pt(rings[0].r,0,0,k+1);
    v.push(...a0,...a1, 0,0,0);
  }
  return bgFromTris(v);
}
function xg(g, x,y,z, rx,ry,rz, sx,sy,sz){
  const c = g.index ? g.toNonIndexed() : g.clone();
  _m.compose(_p.set(x,y,z), _q.setFromEuler(_E.set(rx,ry,rz)),
             _s.set(sx, sy===undefined?sx:sy, sz===undefined?sx:sz));
  c.applyMatrix4(_m);
  return c;
}
function mergeGeos(list){
  let vc=0;
  for(const g of list) vc += g.attributes.position.count;
  const pos=new Float32Array(vc*3), nor=new Float32Array(vc*3), uv=new Float32Array(vc*2);
  let o=0;
  for(const g of list){
    pos.set(g.attributes.position.array, o*3);
    nor.set(g.attributes.normal.array, o*3);
    if(g.attributes.uv) uv.set(g.attributes.uv.array, o*2);
    o += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos,3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor,3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv,2));
  return out;
}
const tube = (a,b,c)=> new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(a,b,c), 7, 0.055, 6, false);

const GEO = {};
GEO.floor   = chamferBox(0.96,0.22,0.96,0.05).translate(0,-0.22,0);
GEO.hospitalFloor = new THREE.BoxGeometry(0.98,0.1,0.98).translate(0,-0.05,0);
GEO.wall    = chamferBox(1,1,1,0.07);
GEO.hospitalWall = new THREE.BoxGeometry(1,1,1).translate(0,0.5,0);
GEO.wallCap = chamferBox(1.09,0.13,1.09,0.035);
GEO.hospitalWallCap = new THREE.BoxGeometry(1.04,0.1,1.04).translate(0,0.05,0);
GEO.basin   = new THREE.BoxGeometry(1,0.55,1).translate(0,-0.43,0);
GEO.pillar  = mergeGeos([
  xg(chamferBox(0.68,0.15,0.68,0.035), 0,0,0, 0,0,0, 1),
  xg(new THREE.CylinderGeometry(0.19,0.25,1.5,10), 0,0.89,0, 0,0,0, 1),
  xg(new THREE.CylinderGeometry(0.27,0.27,0.07,10), 0,1.68,0, 0,0,0, 1),
  xg(chamferBox(0.55,0.14,0.55,0.03), 0,1.72,0, 0,0,0, 1)
]);
GEO.archPost   = chamferBox(0.24,1.74,0.24,0.045);
GEO.archLintel = chamferBox(1,0.22,0.36,0.05);
GEO.torch = mergeGeos([
  xg(new THREE.BoxGeometry(0.07,0.36,0.07), 0,0.16,0.07, -0.42,0,0, 1),
  xg(new THREE.CylinderGeometry(0.11,0.05,0.16,7), 0,0.36,0.15, 0,0,0, 1)
]);
GEO.flame     = new THREE.ConeGeometry(0.13,0.42,7).translate(0,0.21,0);
GEO.flameCore = new THREE.ConeGeometry(0.065,0.26,7).translate(0,0.13,0);
GEO.debrisA = xg(new THREE.IcosahedronGeometry(0.15,0), 0,0.05,0, 0,0,0, 1);
GEO.debrisB = mergeGeos([
  xg(new THREE.IcosahedronGeometry(0.13,0), 0,0.05,0, 0.3,0.5,0, 1),
  xg(new THREE.IcosahedronGeometry(0.09,0), 0.17,0.04,0.05, 0,1.1,0.4, 1),
  xg(new THREE.IcosahedronGeometry(0.07,0), -0.12,0.03,0.13, 0.7,0,0, 1)
]);
GEO.debrisC = xg(chamferBox(0.34,0.07,0.28,0.02), 0,0,0, 0,0.4,0.06, 1);
GEO.chestBody = mergeGeos([
  xg(chamferBox(0.8,0.36,0.52,0.04), 0,0,0, 0,0,0, 1),
  xg(new THREE.CylinderGeometry(0.25,0.25,0.78,10,1,false,0,Math.PI).rotateZ(Math.PI/2), 0,0.36,0, 0,0,0, 1),
  xg(new THREE.CircleGeometry(0.25,8,0,Math.PI), 0.39,0.36,0, 0,Math.PI/2,0, 1),
  xg(new THREE.CircleGeometry(0.25,8,0,Math.PI), -0.39,0.36,0, 0,-Math.PI/2,0, 1)
]);
GEO.chestTrim = mergeGeos([
  xg(new THREE.BoxGeometry(0.07,0.4,0.55), -0.2,0.2,0, 0,0,0, 1),
  xg(new THREE.BoxGeometry(0.07,0.4,0.55), 0.2,0.2,0, 0,0,0, 1),
  xg(new THREE.TorusGeometry(0.26,0.036,6,10,Math.PI).rotateY(Math.PI/2), -0.2,0.36,0, 0,0,0, 1),
  xg(new THREE.TorusGeometry(0.26,0.036,6,10,Math.PI).rotateY(Math.PI/2), 0.2,0.36,0, 0,0,0, 1),
  xg(new THREE.BoxGeometry(0.11,0.16,0.06), 0,0.33,0.26, 0,0,0, 1)
]);
GEO.chestSeam = new THREE.BoxGeometry(0.6,0.045,0.03).translate(0,0.36,0.25);
GEO.grave = mergeGeos([
  xg(new THREE.BoxGeometry(0.36,0.5,0.09), 0,0.25,0, 0,0,0, 1),
  xg(new THREE.CylinderGeometry(0.18,0.18,0.09,10,1,false,0,Math.PI).rotateX(Math.PI/2).rotateZ(Math.PI/2), 0,0.5,0, 0,0,0, 1)
]);
GEO.sarco = mergeGeos([
  xg(chamferBox(1.5,0.44,0.8,0.06), 0,0,0, 0,0,0, 1),
  xg(chamferBox(1.38,0.16,0.68,0.05), 0,0.44,0, 0,0,0, 1)
]);
GEO.candle = new THREE.CylinderGeometry(0.05,0.065,0.18,6).translate(0,0.09,0);
GEO.icicle = mergeGeos([
  xg(new THREE.ConeGeometry(0.075,0.5,6).rotateX(Math.PI), 0,-0.25,0, 0,0,0, 1),
  xg(new THREE.ConeGeometry(0.05,0.34,6).rotateX(Math.PI), 0.11,-0.17,0.04, 0,0,0, 1),
  xg(new THREE.ConeGeometry(0.04,0.26,5).rotateX(Math.PI), -0.09,-0.13,-0.05, 0,0,0, 1)
]);
GEO.shard = spireGeo(0.17,0.6,0.6);
GEO.roots = mergeGeos([
  xg(tube(V3(0,1.75,-0.1),  V3(0.05,1.1,0.42),  V3(0.5,0.02,0.75)), 0,0,0, 0,0,0, 1),
  xg(tube(V3(-0.1,1.6,-0.1),V3(-0.3,0.9,0.4),   V3(-0.55,0.02,0.9)), 0,0,0, 0,0,0, 1),
  xg(tube(V3(0.12,1.45,-0.08),V3(0.15,0.8,0.3), V3(0.05,0.02,1.1)), 0,0,0, 0,0,0, 1),
  xg(tube(V3(-0.02,1.2,-0.05),V3(-0.5,0.7,0.3), V3(-0.2,0.02,0.55)), 0,0,0, 0,0,0, 1)
]);
GEO.moss  = new THREE.CircleGeometry(0.42,9).rotateX(-Math.PI/2).translate(0,0.013,0);
GEO.crack = new THREE.PlaneGeometry(1.2,1.2).rotateX(-Math.PI/2).translate(0,0.016,0);
GEO.skirt = new THREE.PlaneGeometry(2.7,2.7).rotateX(-Math.PI/2).translate(0,0.02,0);
GEO.bannerRod = new THREE.CylinderGeometry(0.028,0.028,0.74,6).rotateZ(Math.PI/2);
GEO.bannerCloth = (()=>{
  const s = new THREE.Shape();
  s.moveTo(-0.27,0); s.lineTo(0.27,0); s.lineTo(0.27,-0.62); s.lineTo(0,-0.8); s.lineTo(-0.27,-0.62); s.closePath();
  return new THREE.ShapeGeometry(s);
})();
GEO.emblem = new THREE.PlaneGeometry(0.17,0.17).rotateZ(Math.PI/4);
GEO.spawn1 = mergeGeos([
  xg(new THREE.ConeGeometry(0.1,0.5,5), 0,0.24,0, 0,0,0.24, 1),
  xg(new THREE.ConeGeometry(0.085,0.42,5), 0.16,0.2,-0.06, 0.3,0,-0.3, 1),
  xg(new THREE.ConeGeometry(0.07,0.34,5), -0.13,0.17,0.11, -0.28,0,0.22, 1)
]);
GEO.spawn2 = spireGeo(0.17,1.15,0.5);
GEO.band2  = chamferBox(0.26,0.07,0.26,0.015);
GEO.spawn3 = spireGeo(0.22,1.65,0.85);
GEO.band3  = chamferBox(0.33,0.09,0.33,0.02);
GEO.bossShard = spireGeo(0.34,2.3,0.7);
GEO.plinth   = chamferBox(0.92,0.5,0.92,0.06);
GEO.platform = chamferBox(2.35,0.14,2.35,0.06);
GEO.crystal = mergeGeos([
  xg(new THREE.OctahedronGeometry(0.3,0), 0,0,0, 0,0,0, 1,1.45,1),
  xg(new THREE.OctahedronGeometry(0.16,0), 0,0.34,0, 0,0.6,0, 1,1.4,1)
]);
GEO.ring     = new THREE.TorusGeometry(0.95,0.07,8,30).rotateX(-Math.PI/2);
GEO.portal   = new THREE.CircleGeometry(0.86,24).rotateX(-Math.PI/2);
GEO.runeRing = new THREE.RingGeometry(1.5,2.3,48).rotateX(-Math.PI/2);
GEO.shaft    = new THREE.CylinderGeometry(0.45,1.7,6,12,1,true).translate(0,3,0);
GEO.brazier = mergeGeos([
  xg(new THREE.BoxGeometry(0.07,0.5,0.07), 0.16,0.25,0, 0,0,-0.25, 1),
  xg(new THREE.BoxGeometry(0.07,0.5,0.07), -0.08,0.25,0.14, 0.22,0,0.13, 1),
  xg(new THREE.BoxGeometry(0.07,0.5,0.07), -0.08,0.25,-0.14, -0.22,0,0.13, 1),
  xg(new THREE.CylinderGeometry(0.32,0.16,0.26,9), 0,0.52,0, 0,0,0, 1)
]);
GEO.coals = mergeGeos([
  xg(new THREE.IcosahedronGeometry(0.09,0), 0,0.63,0.03, 0,0,0, 1),
  xg(new THREE.IcosahedronGeometry(0.07,0), 0.1,0.62,-0.06, 0,0.5,0, 1),
  xg(new THREE.IcosahedronGeometry(0.06,0), -0.1,0.61,-0.02, 0.4,0,0, 1)
]);
GEO.bone = mergeGeos([
  xg(new THREE.CylinderGeometry(0.024,0.024,0.34,5).rotateZ(Math.PI/2), 0,0.03,0, 0,0.4,0, 1),
  xg(new THREE.CylinderGeometry(0.02,0.02,0.3,5).rotateZ(Math.PI/2), 0.04,0.05,0.06, 0,-0.7,0, 1),
  xg(new THREE.SphereGeometry(0.08,7,6), -0.12,0.08,-0.09, 0,0,0, 1),
  xg(new THREE.BoxGeometry(0.07,0.05,0.06), -0.12,0.03,-0.03, 0,0,0, 1)
]);
GEO.hospitalBed = mergeGeos([
  xg(chamferBox(1.35,0.18,0.62,0.035), 0,0.42,0, 0,0,0, 1),
  xg(chamferBox(0.18,0.46,0.66,0.025), -0.66,0.62,0, 0,0,0, 1),
  xg(new THREE.CylinderGeometry(0.025,0.025,0.42,5), -0.52,0.2,-0.24, 0,0,0, 1),
  xg(new THREE.CylinderGeometry(0.025,0.025,0.42,5), 0.52,0.2,-0.24, 0,0,0, 1),
  xg(new THREE.CylinderGeometry(0.025,0.025,0.42,5), -0.52,0.2,0.24, 0,0,0, 1),
  xg(new THREE.CylinderGeometry(0.025,0.025,0.42,5), 0.52,0.2,0.24, 0,0,0, 1)
]);
GEO.ivStand = mergeGeos([
  xg(new THREE.CylinderGeometry(0.025,0.025,1.05,6), 0,0.52,0, 0,0,0, 1),
  xg(new THREE.CylinderGeometry(0.03,0.03,0.45,6).rotateZ(Math.PI/2), 0,1.05,0, 0,0,0, 1),
  xg(new THREE.TorusGeometry(0.09,0.012,5,10), 0.16,0.86,0, 0,0,0, 1),
  xg(chamferBox(0.34,0.035,0.34,0.01), 0,0.02,0, 0,0,0, 1)
]);
GEO.medCabinet = mergeGeos([
  xg(chamferBox(0.72,0.9,0.42,0.035), 0,0.45,0, 0,0,0, 1),
  xg(new THREE.BoxGeometry(0.035,0.48,0.045), 0,0.55,0.235, 0,0,0, 1),
  xg(new THREE.BoxGeometry(0.5,0.055,0.045), 0,0.55,0.24, 0,0,0, 1)
]);
GEO.surgeryTable = mergeGeos([
  xg(chamferBox(1.55,0.22,0.68,0.04), 0,0.62,0, 0,0,0, 1),
  xg(chamferBox(0.62,0.12,0.54,0.03), -0.58,0.82,0, 0,0,0, 1),
  xg(new THREE.CylinderGeometry(0.08,0.12,0.58,8), 0,0.31,0, 0,0,0, 1),
  xg(chamferBox(0.68,0.07,0.5,0.02), 0,0.04,0, 0,0,0, 1)
]);
GEO.receptionDesk = mergeGeos([
  xg(chamferBox(1.55,0.62,0.46,0.035), 0,0.31,0, 0,0,0, 1),
  xg(chamferBox(1.35,0.08,0.54,0.02), 0,0.66,0, 0,0,0, 1),
  xg(chamferBox(0.72,0.05,0.035,0.01), 0,0.7,0.29, 0,0,0, 1)
]);
GEO.waitingBench = mergeGeos([
  xg(chamferBox(1.35,0.12,0.36,0.025), 0,0.38,0, 0,0,0, 1),
  xg(chamferBox(1.35,0.36,0.08,0.02), 0,0.58,-0.18, -0.14,0,0, 1),
  xg(new THREE.CylinderGeometry(0.025,0.025,0.38,5), -0.46,0.18,0.1, 0,0,0, 1),
  xg(new THREE.CylinderGeometry(0.025,0.025,0.38,5), 0.46,0.18,0.1, 0,0,0, 1)
]);
GEO.medCart = mergeGeos([
  xg(chamferBox(0.72,0.12,0.48,0.025), 0,0.36,0, 0,0,0, 1),
  xg(chamferBox(0.66,0.08,0.42,0.02), 0,0.66,0, 0,0,0, 1),
  xg(new THREE.CylinderGeometry(0.035,0.035,0.54,6), -0.28,0.36,-0.18, 0,0,0, 1),
  xg(new THREE.CylinderGeometry(0.035,0.035,0.54,6), 0.28,0.36,-0.18, 0,0,0, 1),
  xg(new THREE.TorusGeometry(0.06,0.014,5,8).rotateX(Math.PI/2), -0.28,0.05,0.2, 0,0,0, 1),
  xg(new THREE.TorusGeometry(0.06,0.014,5,8).rotateX(Math.PI/2), 0.28,0.05,0.2, 0,0,0, 1)
]);
GEO.monitor = mergeGeos([
  xg(chamferBox(0.62,0.42,0.05,0.018), 0,0.82,0, 0,0,0, 1),
  xg(new THREE.CylinderGeometry(0.025,0.025,0.7,6), 0,0.35,0, 0,0,0, 1),
  xg(chamferBox(0.42,0.06,0.32,0.015), 0,0.04,0, 0,0,0, 1)
]);
GEO.hospitalSign = mergeGeos([
  xg(new THREE.BoxGeometry(0.62,0.38,0.035), 0,0,0, 0,0,0, 1),
  xg(new THREE.BoxGeometry(0.11,0.29,0.045), 0,0,0.01, 0,0,0, 1),
  xg(new THREE.BoxGeometry(0.33,0.105,0.05), 0,0,0.02, 0,0,0, 1)
]);
GEO.nurseCounter = mergeGeos([
  xg(chamferBox(1.6,0.58,0.5,0.035), 0,0.29,0, 0,0,0, 1),
  xg(chamferBox(0.58,0.76,0.46,0.03), -0.48,0.38,0, 0,0,0, 1),
  xg(chamferBox(0.78,0.06,0.08,0.015), 0.24,0.66,0.27, 0,0,0, 1)
]);
GEO.doctorDesk = mergeGeos([
  xg(chamferBox(1.05,0.12,0.58,0.025), 0,0.48,0, 0,0,0, 1),
  xg(chamferBox(0.12,0.46,0.46,0.018), -0.42,0.23,0, 0,0,0, 1),
  xg(chamferBox(0.12,0.46,0.46,0.018), 0.42,0.23,0, 0,0,0, 1),
  xg(chamferBox(0.28,0.18,0.05,0.01), 0.18,0.62,0.18, -0.16,0,0, 1)
]);
GEO.examTable = mergeGeos([
  xg(chamferBox(1.2,0.18,0.5,0.03), 0,0.55,0, 0,0,0, 1),
  xg(chamferBox(0.38,0.12,0.46,0.02), -0.44,0.7,0, 0,0,0.18, 1),
  xg(new THREE.CylinderGeometry(0.04,0.04,0.5,6), -0.38,0.26,-0.16, 0,0,0, 1),
  xg(new THREE.CylinderGeometry(0.04,0.04,0.5,6), 0.38,0.26,0.16, 0,0,0, 1)
]);
GEO.wallChart = mergeGeos([
  xg(new THREE.BoxGeometry(0.54,0.62,0.035), 0,0,0, 0,0,0, 1),
  xg(new THREE.BoxGeometry(0.4,0.035,0.045), 0,0.18,0.01, 0,0,0, 1),
  xg(new THREE.BoxGeometry(0.34,0.028,0.045), 0,0.05,0.01, 0,0,0, 1),
  xg(new THREE.BoxGeometry(0.28,0.028,0.045), 0,-0.08,0.01, 0,0,0, 1)
]);
GEO.noticeBoard = mergeGeos([
  xg(new THREE.BoxGeometry(0.78,0.52,0.035), 0,0,0, 0,0,0, 1),
  xg(new THREE.BoxGeometry(0.22,0.28,0.045), -0.18,0.04,0.01, 0,0,0, 1),
  xg(new THREE.BoxGeometry(0.22,0.2,0.045), 0.18,-0.02,0.01, 0,0,0, 1)
]);
GEO.clock = mergeGeos([
  xg(new THREE.CylinderGeometry(0.22,0.22,0.035,24).rotateX(Math.PI/2), 0,0,0, 0,0,0, 1),
  xg(new THREE.BoxGeometry(0.15,0.018,0.045), 0.04,0.03,0.015, 0,0,0.65, 1),
  xg(new THREE.BoxGeometry(0.018,0.12,0.045), 0,-0.03,0.018, 0,0,0, 1)
]);
GEO.privacyCurtain = mergeGeos([
  xg(new THREE.CylinderGeometry(0.018,0.018,1.55,6), -0.62,0.78,-0.42, 0,0,0, 1),
  xg(new THREE.CylinderGeometry(0.018,0.018,1.55,6), 0.62,0.78,-0.42, 0,0,0, 1),
  xg(new THREE.CylinderGeometry(0.018,0.018,1.28,6).rotateZ(Math.PI/2), 0,1.54,-0.42, 0,0,0, 1),
  xg(new THREE.PlaneGeometry(1.32,1.05), 0,1.0,-0.43, 0,0,0, 1),
  xg(new THREE.PlaneGeometry(0.92,1.05), -0.64,1.0,0.02, 0,Math.PI/2,0, 1)
]);
GEO.surgicalLamp = mergeGeos([
  xg(new THREE.CylinderGeometry(0.035,0.035,1.0,6), 0,1.55,0, 0.62,0,0.2, 1),
  xg(new THREE.CylinderGeometry(0.03,0.03,0.72,6), 0.35,1.25,0, 0,0,1.25, 1),
  xg(new THREE.CylinderGeometry(0.32,0.26,0.12,18), 0.68,1.08,0, Math.PI/2,0,0, 1),
  xg(new THREE.SphereGeometry(0.075,8,6), 0.56,1.08,0.15, 0,0,0, 1),
  xg(new THREE.SphereGeometry(0.075,8,6), 0.75,1.08,0.0, 0,0,0, 1),
  xg(new THREE.SphereGeometry(0.075,8,6), 0.56,1.08,-0.15, 0,0,0, 1)
]);
GEO.mriScanner = mergeGeos([
  xg(new THREE.CylinderGeometry(0.62,0.62,0.78,24,1,false,0,Math.PI*2).rotateZ(Math.PI/2), 0,0.72,0, 0,0,0, 1),
  xg(new THREE.CylinderGeometry(0.38,0.38,0.82,24).rotateZ(Math.PI/2), 0,0.72,0, 0,0,0, 1),
  xg(chamferBox(1.55,0.18,0.42,0.035), 0.28,0.42,0, 0,0,0, 1),
  xg(chamferBox(0.68,0.08,0.32,0.02), 0.78,0.56,0, 0,0,0, 1)
]);
GEO.wallLight = mergeGeos([
  xg(chamferBox(0.82,0.08,0.05,0.012), 0,0,0, 0,0,0, 1),
  xg(chamferBox(0.14,0.1,0.06,0.01), -0.46,0,0, 0,0,0, 1),
  xg(chamferBox(0.14,0.1,0.06,0.01), 0.46,0,0, 0,0,0, 1)
]);
GEO.oxygenTank = mergeGeos([
  xg(new THREE.CylinderGeometry(0.12,0.12,0.68,12), -0.08,0.34,0, 0,0,0, 1),
  xg(new THREE.CylinderGeometry(0.12,0.12,0.68,12), 0.12,0.34,0, 0,0,0, 1),
  xg(new THREE.SphereGeometry(0.08,8,6), -0.08,0.72,0, 0,0,0, 1),
  xg(new THREE.SphereGeometry(0.08,8,6), 0.12,0.72,0, 0,0,0, 1),
  xg(new THREE.CylinderGeometry(0.018,0.018,0.46,6).rotateZ(Math.PI/2), 0.02,0.58,0, 0,0,0, 1)
]);
GEO.bioBin = mergeGeos([
  xg(chamferBox(0.44,0.52,0.42,0.04), 0,0.26,0, 0,0,0, 1),
  xg(chamferBox(0.52,0.08,0.48,0.025), 0,0.56,0, 0,0,0, 1),
  xg(new THREE.BoxGeometry(0.22,0.035,0.035), 0,0.62,0.26, 0,0,0, 1)
]);
GEO.gurney = mergeGeos([
  xg(chamferBox(1.45,0.16,0.55,0.035), 0,0.58,0, 0,0,0, 1),
  xg(chamferBox(0.55,0.1,0.48,0.025), -0.52,0.72,0, 0,0,0, 1),
  xg(new THREE.CylinderGeometry(0.022,0.022,1.5,6).rotateZ(Math.PI/2), 0,0.77,-0.34, 0,0,0, 1),
  xg(new THREE.CylinderGeometry(0.022,0.022,1.5,6).rotateZ(Math.PI/2), 0,0.77,0.34, 0,0,0, 1),
  xg(new THREE.CylinderGeometry(0.025,0.025,0.5,6), -0.55,0.3,-0.22, 0,0,0, 1),
  xg(new THREE.CylinderGeometry(0.025,0.025,0.5,6), 0.55,0.3,-0.22, 0,0,0, 1),
  xg(new THREE.TorusGeometry(0.06,0.014,5,8).rotateX(Math.PI/2), -0.55,0.05,-0.22, 0,0,0, 1),
  xg(new THREE.TorusGeometry(0.06,0.014,5,8).rotateX(Math.PI/2), 0.55,0.05,0.22, 0,0,0, 1)
]);
GEO.floorCross = mergeGeos([
  xg(new THREE.PlaneGeometry(1.1,0.22).rotateX(-Math.PI/2), 0,0.018,0, 0,0,0, 1),
  xg(new THREE.PlaneGeometry(0.22,1.1).rotateX(-Math.PI/2), 0,0.019,0, 0,0,0, 1)
]);
GEO.floorStripe = new THREE.PlaneGeometry(1.45,0.12).rotateX(-Math.PI/2).translate(0,0.018,0);
GEO.wallPanel = mergeGeos([
  xg(new THREE.BoxGeometry(0.92,0.52,0.035), 0,0,0, 0,0,0, 1),
  xg(new THREE.BoxGeometry(0.92,0.055,0.045), 0,0.29,0.01, 0,0,0, 1),
  xg(new THREE.BoxGeometry(0.92,0.055,0.045), 0,-0.29,0.01, 0,0,0, 1)
]);
GEO.hospitalDoorPost = chamferBox(0.16,1.55,0.16,0.025);
GEO.hospitalDoorLintel = chamferBox(1,0.16,0.22,0.025);
GEO.deptSign = mergeGeos([
  xg(new THREE.BoxGeometry(0.74,0.26,0.035), 0,0,0, 0,0,0, 1),
  xg(new THREE.BoxGeometry(0.16,0.16,0.045), -0.22,0,0.01, 0,0,0, 1),
  xg(new THREE.BoxGeometry(0.34,0.045,0.045), 0.18,0.04,0.015, 0,0,0, 1),
  xg(new THREE.BoxGeometry(0.28,0.035,0.045), 0.15,-0.06,0.015, 0,0,0, 1)
]);
GEO.cleanZone = mergeGeos([
  xg(new THREE.PlaneGeometry(2.2,0.08).rotateX(-Math.PI/2), 0,0.019,-1.1, 0,0,0, 1),
  xg(new THREE.PlaneGeometry(2.2,0.08).rotateX(-Math.PI/2), 0,0.019,1.1, 0,0,0, 1),
  xg(new THREE.PlaneGeometry(0.08,2.2).rotateX(-Math.PI/2), -1.1,0.02,0, 0,0,0, 1),
  xg(new THREE.PlaneGeometry(0.08,2.2).rotateX(-Math.PI/2), 1.1,0.02,0, 0,0,0, 1)
]);
GEO.floorArrow = mergeGeos([
  xg(new THREE.PlaneGeometry(0.72,0.14).rotateX(-Math.PI/2), -0.16,0.018,0, 0,0,0, 1),
  xg(new THREE.ConeGeometry(0.2,0.36,3).rotateX(-Math.PI/2).rotateZ(Math.PI/2), 0.34,0.019,0, 0,0,0, 1)
]);

/* -------- instance set builder with reveal + tilt support -------- */
function instSet(){
  return { px:[],py:[],pz:[], sx:[],sy:[],sz:[], rx:[],ry:[],rz:[], col:[], delay:[], n:0,
    add(x,y,z, sx,sy,sz, ry, color, delay){
      this.px.push(x); this.py.push(y); this.pz.push(z);
      this.sx.push(sx); this.sy.push(sy); this.sz.push(sz);
      this.rx.push(0); this.ry.push(ry); this.rz.push(0);
      this.col.push(color); this.delay.push(delay); this.n++;
    },
    addT(x,y,z, sx,sy,sz, rx,ry,rz, color, delay){
      this.px.push(x); this.py.push(y); this.pz.push(z);
      this.sx.push(sx); this.sy.push(sy); this.sz.push(sz);
      this.rx.push(rx); this.ry.push(ry); this.rz.push(rz);
      this.col.push(color); this.delay.push(delay); this.n++;
    }};
}
/* shadow: 0 = none, 1 = cast+receive, 2 = receive only */
function buildMesh(set, geo, mat, mode, dur, shadow){
  const alloc = Math.max(set.n,1);
  const mesh = new THREE.InstancedMesh(geo, mat, alloc);
  mesh.count = set.n;
  /* Always allocate an instance-colour buffer, even for the "spare" instances
     past set.n. A shared material rendered by some meshes with instanceColor and
     some without compiles to two program variants and can trip the renderer's
     attribute fast-path; giving every InstancedMesh a colour buffer keeps them
     all on one variant. (Originally a hard r128 crash; cheap insurance since.) */
  for(let i=0;i<alloc;i++) mesh.setColorAt(i, _c.set(i<set.n ? set.col[i] : 0xffffff));
  if(mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  if(shadow===1){ mesh.castShadow = true; mesh.receiveShadow = true; }
  else if(shadow===2) mesh.receiveShadow = true;
  mesh.userData = { set, mode, dur, settled:false };
  writeInstances(mesh, Infinity);
  return mesh;
}
const easeOutCubic = t => 1-Math.pow(1-t,3);
const easeOutBack  = t => { const c=1.70158; return 1 + (c+1)*Math.pow(t-1,3) + c*Math.pow(t-1,2); };
function writeInstances(mesh, t){
  const u = mesh.userData, s = u.set;
  let allDone = true;
  for(let i=0;i<s.n;i++){
    let k = (t - s.delay[i]) / u.dur;
    if(k < 1) allDone = false;
    k = Math.max(0.0001, Math.min(1, k));
    const g = u.mode==='rise' ? easeOutCubic(k) : easeOutBack(k)*Math.min(1,k*8);
    _q.setFromEuler(_E.set(s.rx[i], s.ry[i], s.rz[i]));
    if(u.mode==='rise'){ _p.set(s.px[i], s.py[i], s.pz[i]); _s.set(s.sx[i], s.sy[i]*Math.max(g,0.0001), s.sz[i]); }
    else { const m=Math.max(g,0.0001); _p.set(s.px[i], s.py[i], s.pz[i]); _s.set(s.sx[i]*m, s.sy[i]*m, s.sz[i]*m); }
    _m.compose(_p,_q,_s); mesh.setMatrixAt(i,_m);
  }
  mesh.instanceMatrix.needsUpdate = true;
  u.settled = allDone;
}

/* -------- scene state -------- */
let D = null;
let group = null;
let meshes = {};
let overlay = null;
let roomSelection = null;
let routeOverlay = null;
let lights = [];
let floorColorsBase = null, floorColorsHeat = null;
let animT = Infinity, animEnd = 0, animating = false;
let fx = { liquids:[], shafts:[], spinners:[], parts:null };
let levelGeos = [];
const lerpC = (a,b,t)=> _c.set(a).lerp(new THREE.Color(b), t).getHex();

function disposeLevel(){
  if(group){ scene.remove(group);
    group.traverse(o=>{
      if(o.isInstancedMesh) o.dispose();
      if(o.isLine || o.isPoints){ o.geometry.dispose(); if(o.material && o.material.dispose && o.material!==partMat) o.material.dispose(); }
    });
  }
  for(const g of levelGeos) g.dispose();
  levelGeos = [];
  group = null; meshes = {}; overlay = null; roomSelection = null; routeOverlay = null;
  lights = [];
  fx = { liquids:[], shafts:[], spinners:[], parts:null };
}

function applyThemeEnv(TH){
  scene.fog.color.set(TH.fog);
  curBg.set(TH.bg);
  hemi.color.set(TH.hemi[0]); hemi.groundColor.set(TH.hemi[1]); hemi.intensity = TH.hemi[2] * LIGHT_K;
  dirL.color.set(TH.dir[0]); dirL.intensity = TH.dir[1] * LIGHT_K;
  document.documentElement.style.setProperty('--ember', TH.accent);
}

function buildLiquidMesh(cells, wx, wz, y){
  /* aE = corner-local coords, aM = which of the 4 sides border non-liquid.
     The shader uses both to soften only true edges: single-cell pools get a
     full cooled rim, lake interiors stay seamless. */
  const key = new Set(cells.map(c=>c.x+','+c.y));
  const n = cells.length;
  const pos = new Float32Array(n*18), ae = new Float32Array(n*12), am = new Float32Array(n*24);
  const CE = [-0.5,-0.5, -0.5,0.5, 0.5,0.5, -0.5,-0.5, 0.5,0.5, 0.5,-0.5];
  let o=0, oe=0, om=0;
  for(const c of cells){
    const x0=wx(c.x)-0.51, x1=wx(c.x)+0.51, z0=wz(c.y)-0.51, z1=wz(c.y)+0.51;
    pos.set([x0,y,z0, x0,y,z1, x1,y,z1,  x0,y,z0, x1,y,z1, x1,y,z0], o); o+=18;
    ae.set(CE, oe); oe+=12;
    const mx0 = key.has((c.x-1)+','+c.y) ? 0 : 1, mx1 = key.has((c.x+1)+','+c.y) ? 0 : 1;
    const mz0 = key.has(c.x+','+(c.y-1)) ? 0 : 1, mz1 = key.has(c.x+','+(c.y+1)) ? 0 : 1;
    for(let k=0;k<6;k++){ am[om++]=mx0; am[om++]=mx1; am[om++]=mz0; am[om++]=mz1; }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos,3));
  g.setAttribute('aE', new THREE.BufferAttribute(ae,2));
  g.setAttribute('aM', new THREE.BufferAttribute(am,4));
  levelGeos.push(g);
  return new THREE.Mesh(g, liquidMat);
}

function buildScene(d){
  disposeLevel();
  D = d;
  const TH = themeSpec(d.params.settingKey, d.params.paletteKey);
  const accC = parseInt(TH.accent.slice(1),16);
  applyThemeEnv(TH);
  group = new THREE.Group(); scene.add(group);
  const W=d.W, H=d.H, grid=d.grid, roomId=d.roomId, corridor=d.corridor,
        doorway=d.doorway, bfs=d.bfs, maxBfs=d.maxBfs, rooms=d.rooms,
        lakeMask=d.lakeMask;
  const idx=(x,y)=>y*W+x, wx=x=>x-W/2+0.5, wz=y=>y-H/2+0.5;
  const cellRng = makeRng(d.seed ^ 0x9e3779b9);
  const dStep = 0.016;

  /* moss + pool adjacency masks for floor tinting */
  const mossMask = new Uint8Array(W*H);
  for(const p of d.props) if(p.kind==='moss') mossMask[idx(p.x,p.y)] = 1;
  const poolAdj = (x,y)=>{
    const c=idx(x,y);
    return (x<W-1 && grid[c+1]===POOL) || (x>0 && grid[c-1]===POOL) ||
           (y<H-1 && grid[c+W]===POOL) || (y>0 && grid[c-W]===POOL);
  };

  /* floors */
  const fs = instSet(); floorColorsBase=[]; floorColorsHeat=[];
  const base = new THREE.Color(), tint = new THREE.Color(),
        heatA = new THREE.Color(0x2f4bb0), heatB = new THREE.Color(0xe8502f);
  for(let y=0;y<H;y++) for(let x=0;x<W;x++){
    const c=idx(x,y); if(grid[c]!==FLOOR || lakeMask[c]) continue;
    let walls8=0;
    for(let oy=-1;oy<=1;oy++) for(let ox=-1;ox<=1;ox++){
      if(!ox&&!oy) continue;
      const nx=x+ox, ny=y+oy;
      if(nx<0||ny<0||nx>=W||ny>=H || grid[idx(nx,ny)]===WALL) walls8++;
    }
    const rid = roomId[c];
    if(TH.kit === 'hospital'){
      base.set(corridor[c] ? 0x93aaa5 : 0xcbd6d2);
      if(rid>=0 && rooms[rid].type===TYPE.BOSS) base.lerp(tint.set(0xe2ebe7), 0.12);
      if(rid>=0 && rooms[rid].type===TYPE.ENTRANCE) base.lerp(tint.set(0xb7ccc7), 0.10);
      if(doorway[c]) base.lerp(tint.set(0xe6eeea), 0.12);
      if(cellRng.chance(0.02)) base.lerp(tint.set(0x7b8783), 0.12);
    } else {
      base.set(corridor[c] ? TH.corridor : TH.floor);
      if(rid>=0 && rooms[rid].type!==TYPE.COMBAT) base.lerp(tint.set(TINT[rooms[rid].type]), 0.17);
      if(doorway[c]) base.multiplyScalar(1.14);
      if(mossMask[c]) base.lerp(tint.set(0x4c7a42), 0.32);
      if(TH.pools && TH.pools.mode===0 && poolAdj(x,y)) base.lerp(tint.set(0xff7a33), 0.3);
      base.multiplyScalar(1 - 0.11*Math.min(walls8,4));
    }
    base.multiplyScalar(((x+y)&1) ? 0.965 : 1.0);
    base.multiplyScalar(cellRng.f(0.94,1.06));
    floorColorsBase.push(base.getHex());
    const diff = rid>=0 ? rooms[rid].difficulty : (maxBfs ? bfs[c]/maxBfs : 0.5);
    floorColorsHeat.push(heatA.clone().lerp(heatB, Math.min(1,diff)).multiplyScalar(0.55 + 0.45*(1-0.09*Math.min(walls8,4))).getHex());
    fs.add(wx(x), cellRng.f(-0.02,0.008), wz(y), 1,1,1, 0, floorColorsBase[floorColorsBase.length-1], Math.max(0,bfs[c])*dStep);
  }
  meshes.floor = TH.kit === 'hospital'
    ? buildMesh(fs, GEO.hospitalFloor, matHospitalFloor, 'pop', 0.34, 2)
    : buildMesh(fs, GEO.floor, matStone, 'pop', 0.34, 2);

  /* walls + trim caps */
  const nearFloorBfs = (x,y)=>{ let b=1e4;
    for(let oy=-1;oy<=1;oy++) for(let ox=-1;ox<=1;ox++){
      const nx=x+ox, ny=y+oy;
      if(nx>=0&&ny>=0&&nx<W&&ny<H && bfs[idx(nx,ny)]>=0) b=Math.min(b,bfs[idx(nx,ny)]);
    } return b===1e4?0:b; };
  const ws = instSet(), cs = instSet();
  const wcol = new THREE.Color();
  const isDoorWallCut = (x,y)=>{
    const c=idx(x,y);
    if(grid[c]!==WALL) return false;
    return (x>0 && doorway[c-1] && x<W-1 && grid[c+1]===FLOOR) ||
      (x<W-1 && doorway[c+1] && x>0 && grid[c-1]===FLOOR) ||
      (y>0 && doorway[c-W] && y<H-1 && grid[c+W]===FLOOR) ||
      (y<H-1 && doorway[c+W] && y>0 && grid[c-W]===FLOOR);
  };
  for(let y=0;y<H;y++) for(let x=0;x<W;x++){
    if(grid[idx(x,y)]!==WALL || isDoorWallCut(x,y)) continue;
    const h = TH.kit === 'hospital' ? 2.25 + cellRng.f(-0.08,0.08) : 2.0 + cellRng.f(-0.25,0.25);
    const dl = nearFloorBfs(x,y)*dStep + 0.30;
    if(TH.kit === 'hospital'){
      wcol.set(0xaebdb8).multiplyScalar(cellRng.f(0.99,1.02));
    } else {
      wcol.set(TH.wall).multiplyScalar(cellRng.f(0.9,1.08));
    }
    ws.add(wx(x),0,wz(y), 1,h,1, 0, wcol.getHex(), dl);
    if(TH.kit === 'hospital') wcol.set(0xd0d9d5).multiplyScalar(cellRng.f(0.995,1.02));
    else wcol.set(TH.cap).multiplyScalar(cellRng.f(0.92,1.1));
    cs.add(wx(x),h,wz(y), 1,1,1, 0, wcol.getHex(), dl+0.12);
  }
  meshes.wall = TH.kit === 'hospital'
    ? buildMesh(ws, GEO.hospitalWall, matHospitalWall, 'rise', 0.42, 1)
    : buildMesh(ws, GEO.wall, matStone, 'rise', 0.42, 1);
  meshes.wallCap = TH.kit === 'hospital'
    ? buildMesh(cs, GEO.hospitalWallCap, matHospitalTrim, 'pop', 0.3, 1)
    : buildMesh(cs, GEO.wallCap, matStone, 'pop', 0.3, 1);

  /* prop instance sets */
  const S = { pillar:instSet(), arch:instSet(), archL:instSet(), torchArm:instSet(),
              flame:instSet(), flameCore:instSet(),
              debrisA:instSet(), debrisB:instSet(), debrisC:instSet(),
              hospitalBed:instSet(), ivStand:instSet(), medCabinet:instSet(), surgeryTable:instSet(), hospitalSign:instSet(),
              nurseCounter:instSet(), doctorDesk:instSet(), examTable:instSet(), wallChart:instSet(), noticeBoard:instSet(), clock:instSet(),
              receptionDesk:instSet(), waitingBench:instSet(), medCart:instSet(), monitor:instSet(),
              privacyCurtain:instSet(), surgicalLamp:instSet(), mriScanner:instSet(), wallLight:instSet(),
              oxygenTank:instSet(), bioBin:instSet(), gurney:instSet(), floorCross:instSet(), floorStripe:instSet(), wallPanel:instSet(),
              hospitalDoorPost:instSet(), hospitalDoorLintel:instSet(), deptSign:instSet(), cleanZone:instSet(), floorArrow:instSet(),
              chest:instSet(), chestTrim:instSet(), chestGlow:instSet(),
              grave:instSet(), sarco:instSet(), candle:instSet(), bone:instSet(),
              icicle:instSet(), shardIce:instSet(), roots:instSet(), moss:instSet(),
              crackD:instSet(), skirt:instSet(), bannerRod:instSet(), bannerCloth:instSet(), emblem:instSet(),
              spawn1:instSet(), spawn2:instSet(), spawn3:instSet(), band2:instSet(), band3:instSet(),
              crystal:instSet(), ring:instSet(), plinth:instSet(), platform:instSet(),
              brazier:instSet(), coals:instSet(), basin:instSet(),
              bossGlow:instSet(), bossRock:instSet() };
  const pd = (x,y)=> Math.max(0,bfs[idx(x,y)])*dStep + 0.62;
  const shaftAt = [];
  let portalXZ = null, runeXZ = null;

  for(const p of d.props){
    const X=wx(p.x), Z=wz(p.y), dl=pd(p.x,p.y);
    switch(p.kind){
      case 'pillar': { const s=p.scale*1.15;
        S.pillar.add(X,0,Z, s,s,s, cellRng.i(0,3)*Math.PI/2, TH.pillar, dl); break; }
      case 'debris': { const set=[S.debrisA,S.debrisB,S.debrisC][p.v||0];
        set.add(X,0,Z, p.scale,p.scale*0.85,p.scale, p.rot, lerpC(TH.debris[0],TH.debris[1],cellRng.raw()), dl); break; }
      case 'hospitalBed':
        S.hospitalBed.add(X,0,Z, p.scale,p.scale,p.scale, p.rot, 0xd8e0dc, dl);
        S.bannerCloth.add(X,0.6,Z, p.scale*1.08,p.scale*0.66,p.scale, p.rot, 0xf2f5f2, dl+0.06);
        break;
      case 'ivStand':
        S.ivStand.add(X,0,Z, p.scale,p.scale,p.scale, 0, 0x9aa8a4, dl);
        break;
      case 'medCabinet':
        S.medCabinet.add(X,0,Z, p.scale,p.scale,p.scale, p.rot, 0xd1d9d5, dl);
        S.emblem.add(X, 1.02*p.scale, Z+0.25*Math.cos(p.rot), p.scale*0.9,p.scale*0.9,p.scale, p.rot, 0xd96a62, dl+0.08);
        break;
      case 'receptionDesk':
        S.receptionDesk.add(X,0,Z, p.scale,p.scale,p.scale, p.rot, 0xb9c4bf, dl);
        S.emblem.add(X, 0.96*p.scale, Z+0.31*Math.cos(p.rot), p.scale*0.95,p.scale*0.95,p.scale, p.rot, 0x7db8b0, dl+0.08);
        break;
      case 'nurseCounter':
        S.nurseCounter.add(X,0,Z, p.scale,p.scale,p.scale, p.rot, 0xb6c5c0, dl);
        S.emblem.add(X, 0.78*p.scale, Z+0.3*Math.cos(p.rot), p.scale*0.9,p.scale*0.9,p.scale, p.rot, 0x7db8b0, dl+0.08);
        break;
      case 'doctorDesk':
        S.doctorDesk.add(X,0,Z, p.scale,p.scale,p.scale, p.rot, 0xb9b8aa, dl);
        S.emblem.add(X+0.2*Math.sin(p.rot), 0.66*p.scale, Z+0.18*Math.cos(p.rot), p.scale*0.65,p.scale*0.65,p.scale, p.rot, 0x30414a, dl+0.08);
        break;
      case 'examTable':
        S.examTable.add(X,0,Z, p.scale,p.scale,p.scale, p.rot, 0xd3ded9, dl);
        S.bannerCloth.add(X,0.7,Z, p.scale*0.8,p.scale*0.42,p.scale, p.rot, 0xf4f7f4, dl+0.06);
        break;
      case 'waitingBench':
        S.waitingBench.add(X,0,Z, p.scale,p.scale,p.scale, p.rot, 0x7d8a86, dl);
        break;
      case 'medCart':
        S.medCart.add(X,0,Z, p.scale,p.scale,p.scale, p.rot, 0xa8b7b2, dl);
        break;
      case 'monitor':
        S.monitor.add(X,0,Z, p.scale,p.scale,p.scale, p.rot, 0x1f2f31, dl);
        S.emblem.add(X, 0.84*p.scale, Z+0.04, p.scale*1.1,p.scale*1.1,p.scale, p.rot, 0x58c8bf, dl+0.08);
        break;
      case 'privacyCurtain':
        S.privacyCurtain.add(X,0,Z, p.scale,p.scale,p.scale, p.rot, 0xd9f0ec, dl);
        break;
      case 'surgicalLamp':
        S.surgicalLamp.add(X,0,Z, p.scale,p.scale,p.scale, p.rot, 0xe7f8f4, dl);
        S.emblem.add(X+0.68*p.scale, 1.08*p.scale, Z, p.scale*1.6,p.scale*1.6,p.scale, p.rot, 0xf6fff8, dl+0.08);
        break;
      case 'mriScanner':
        S.mriScanner.add(X,0,Z, p.scale,p.scale,p.scale, p.rot, 0xc7d4d0, dl);
        S.emblem.add(X, 0.78*p.scale, Z+0.48*Math.cos(p.rot), p.scale*1.3,p.scale*1.3,p.scale, p.rot, 0x58c8bf, dl+0.08);
        break;
      case 'wallLight': {
        const ry = Math.atan2(p.dx, p.dy);
        S.wallLight.add(wx(p.x)+p.dx*0.55, 1.65, wz(p.y)+p.dy*0.55, p.scale,p.scale,p.scale, ry, 0xd9fff7, nearFloorBfs(p.x,p.y)*dStep + 0.7);
        break; }
      case 'wallChart': {
        const ry = Math.atan2(p.dx, p.dy);
        S.wallChart.add(wx(p.x)+p.dx*0.54, 1.42, wz(p.y)+p.dy*0.54, p.scale,p.scale,p.scale, ry, 0xe7efe9, nearFloorBfs(p.x,p.y)*dStep + 0.7);
        break; }
      case 'noticeBoard': {
        const ry = Math.atan2(p.dx, p.dy);
        S.noticeBoard.add(wx(p.x)+p.dx*0.54, 1.38, wz(p.y)+p.dy*0.54, p.scale,p.scale,p.scale, ry, 0xb9a97b, nearFloorBfs(p.x,p.y)*dStep + 0.7);
        break; }
      case 'clock': {
        const ry = Math.atan2(p.dx, p.dy);
        S.clock.add(wx(p.x)+p.dx*0.54, 1.64, wz(p.y)+p.dy*0.54, p.scale,p.scale,p.scale, ry, 0xf0f3ef, nearFloorBfs(p.x,p.y)*dStep + 0.7);
        break; }
      case 'oxygenTank':
        S.oxygenTank.add(X,0,Z, p.scale,p.scale,p.scale, p.rot, 0x8fd3cf, dl);
        break;
      case 'bioBin':
        S.bioBin.add(X,0,Z, p.scale,p.scale,p.scale, p.rot, 0xd8a12d, dl);
        S.emblem.add(X, 0.6*p.scale, Z+0.25, p.scale*1.1,p.scale*1.1,p.scale, p.rot, 0x1f1a12, dl+0.08);
        break;
      case 'gurney':
        S.gurney.add(X,0,Z, p.scale,p.scale,p.scale, p.rot, 0xc5d1cc, dl);
        S.bannerCloth.add(X,0.75,Z, p.scale*1.2,p.scale*0.45,p.scale, p.rot, 0xf2f6f2, dl+0.06);
        break;
      case 'floorCross':
        S.floorCross.add(X,0,Z, p.scale,p.scale,p.scale, p.rot, 0xff3b35, dl);
        break;
      case 'floorStripe':
        S.floorStripe.add(X,0,Z, p.scale,p.scale,p.scale, p.rot, 0x5fd1c7, dl);
        break;
      case 'wallPanel': {
        const ry = Math.atan2(p.dx, p.dy);
        S.wallPanel.add(wx(p.x)+p.dx*0.53, 1.2, wz(p.y)+p.dy*0.53, p.scale,p.scale,p.scale, ry, 0xd6e4df, nearFloorBfs(p.x,p.y)*dStep + 0.7);
        break; }
      case 'cleanZone':
        S.cleanZone.add(X,0,Z, p.scale,p.scale,p.scale, p.rot, 0x5fd1c7, dl);
        break;
      case 'floorArrow':
        S.floorArrow.add(X,0,Z, p.scale,p.scale,p.scale, p.rot, 0x5fd1c7, dl);
        break;
      case 'surgeryTable':
        S.surgeryTable.add(X,0,Z, p.scale,p.scale,p.scale, p.rot, 0xcfd8d4, dl);
        S.bannerCloth.add(X,0.9,Z, p.scale*1.2,p.scale*0.55,p.scale, p.rot, 0xe9fff9, dl+0.06);
        break;
      case 'hospitalSign': {
        const ry = Math.atan2(p.dx, p.dy);
        S.hospitalSign.add(wx(p.x)+p.dx*0.54, 1.5, wz(p.y)+p.dy*0.54, p.scale,p.scale,p.scale, ry, 0xff3b35, nearFloorBfs(p.x,p.y)*dStep + 0.7);
        break; }
      case 'chest':
        S.chest.add(X,0,Z, 1,1,1, p.rot, 0x8a5a2c, dl);
        S.chestTrim.add(X,0,Z, 1,1,1, p.rot, 0xc8a24a, dl);
        S.chestGlow.add(X,0,Z, 1,1,1, p.rot, 0xffd27a, dl+0.15);
        break;
      case 'shrineCrystal': {
        S.plinth.add(X,0,Z, 1,1,1, p.rot, lerpC(TH.pillar,0xffffff,0.12), dl);
        S.crystal.add(X, 1.4, Z, 1.05,1.05,1.05, p.rot, 0x8fbcff, dl+0.2);
        for(let k=0;k<4;k++){
          const a = k*Math.PI/2 + Math.PI/4, cx = X+Math.cos(a)*0.36, cz = Z+Math.sin(a)*0.36;
          S.candle.add(cx, 0.5, cz, 0.8,0.8,0.8, 0, 0xd8cba8, dl+0.15);
          S.flameCore.add(cx, 0.65, cz, 0.5,0.5,0.5, 0, TH.flameCore, dl+0.25);
        }
        shaftAt.push([X,Z,1]);
        break; }
      case 'ring':
        S.platform.add(X,-0.02,Z, 1,1,1, 0, lerpC(TH.floor,0xffffff,0.1), dl);
        S.ring.add(X, 0.16, Z, 1,1,1, 0, 0x3fd0bb, dl+0.1);
        S.pillar.add(X-1.45, 0.1, Z, 0.72,0.72,0.72, 0, TH.pillar, dl+0.15);
        S.pillar.add(X+1.45, 0.1, Z, 0.72,0.72,0.72, 0, TH.pillar, dl+0.15);
        portalXZ = [X,Z];
        shaftAt.push([X,Z,0.9]);
        break;
      case 'bossCrystal': {
        S.bossGlow.add(X,0,Z, 1.15,1.15,1.15, p.rot, 0xff4636, dl);
        S.bossGlow.add(X+0.55,0,Z-0.42, 0.6,0.75,0.6, p.rot+1.2, 0xff6a45, dl+0.12);
        S.bossRock.addT(X-0.62,0,Z+0.42, 0.75,0.8,0.75, 0.05,p.rot+2.1,-0.06, 0x4a3336, dl+0.15);
        S.bossRock.addT(X+0.75,0,Z+0.55, 0.55,0.6,0.55, -0.06,p.rot+3.6,0.05, 0x51383a, dl+0.2);
        S.bossRock.addT(X-0.5,0,Z-0.62, 0.5,0.55,0.5, 0.04,p.rot+4.9,0.04, 0x452f31, dl+0.24);
        const r = rooms[p.roomId];
        runeXZ = {x:X, z:Z, s:Math.min(1.6, Math.max(0.8, (Math.min(r.w,r.h)/2-1.5)/2.3))};
        break; }
      case 'brazier':
        S.brazier.add(X,0,Z, 1,1,1, cellRng.f(0,6.28), 0x3a3f4a, dl);
        S.coals.add(X,0,Z, 1,1,1, 0, 0xff7a30, dl+0.1);
        S.flame.add(X, 0.62, Z, 1.35,1.35,1.35, 0, TH.flame, dl+0.12);
        S.flameCore.add(X, 0.66, Z, 1.3,1.3,1.3, 0, TH.flameCore, dl+0.12);
        break;
      case 'grave':
        S.grave.addT(X,0,Z, p.scale,p.scale,p.scale, cellRng.f(-0.08,0.08), p.rot, cellRng.f(-0.13,0.13),
                     lerpC(TH.wall,0xffffff,0.15), dl);
        break;
      case 'sarco':
        S.sarco.add(X,0,Z, 1,1,1, p.rot, lerpC(TH.pillar,0xffffff,0.08), dl);
        break;
      case 'candle':
        S.candle.add(X,0,Z, p.scale,p.scale,p.scale, 0, 0xd8cba8, dl);
        S.flameCore.add(X, 0.19*p.scale, Z, 0.55,0.55,0.55, 0, TH.flameCore, dl+0.1);
        break;
      case 'icicle':
        S.icicle.add(wx(p.x)+p.dx*0.42, 1.75, wz(p.y)+p.dy*0.42, p.scale,p.scale,p.scale, p.rot,
                     0xbfe2ff, nearFloorBfs(p.x,p.y)*dStep + 0.7);
        break;
      case 'shardIce':
        S.shardIce.addT(X,-0.1,Z, p.scale,p.scale,p.scale, cellRng.f(-0.15,0.15), p.rot, cellRng.f(-0.15,0.15),
                        0xcfeaff, dl);
        break;
      case 'roots':
        S.roots.add(wx(p.x), 0, wz(p.y), p.scale,p.scale,p.scale, Math.atan2(p.dx,p.dy),
                    0x5a4632, nearFloorBfs(p.x,p.y)*dStep + 0.6);
        break;
      case 'moss':
        S.moss.add(X,0,Z, p.scale,p.scale,p.scale, p.rot, lerpC(0x3f6b3a,0x5a8a4a,cellRng.raw()), dl);
        break;
      case 'crack': {
        /* centered on the pool/lake edge so branches radiate outward */
        const cx = X - (p.dx||0)*0.5, cz = Z - (p.dy||0)*0.5;
        const vc = p.ice ? 0x9fd8ff : (TH.pools && TH.pools.mode===3 ? 0x86c05a : 0xff6a28);
        S.crackD.add(cx, 0, cz, p.scale,p.scale,p.scale, p.rot, vc, dl);
        break; }
      case 'bones':
        S.bone.add(X,0,Z, p.scale,p.scale,p.scale, p.rot, 0xcfc4a4, dl);
        break;
      case 'banner': {
        const ry = Math.atan2(p.dx, p.dy);
        const bx = wx(p.x)+p.dx*0.54, bz = wz(p.y)+p.dy*0.54;
        const bdl = nearFloorBfs(p.x,p.y)*dStep + 0.7;
        S.bannerRod.add(bx, 1.98, bz, 1,1,1, ry, 0x6a5a3a, bdl);
        S.bannerCloth.add(bx+p.dx*0.03, 1.96, bz+p.dy*0.03, 1,1,1, ry, TH.cloth, bdl+0.05);
        S.emblem.add(bx+p.dx*0.06, 1.6, bz+p.dy*0.06, 1,1,1, ry, accC, bdl+0.1);
        break; }
    }
  }

  /* torches */
  for(const t of d.torches){
    const ry = Math.atan2(t.dx, t.dy);
    const X = wx(t.x)+t.dx*0.5, Z = wz(t.y)+t.dy*0.5, dl = nearFloorBfs(t.x,t.y)*dStep + 0.66;
    S.torchArm.add(X, 1.02, Z, 1,1,1, ry, 0x4a4038, dl);
    S.flame.add(X+t.dx*0.16, 1.5, Z+t.dy*0.16, 1.2,1.2,1.2, 0, TH.flame, dl+0.08);
    S.flameCore.add(X+t.dx*0.16, 1.53, Z+t.dy*0.16, 1.2,1.2,1.2, 0, TH.flameCore, dl+0.08);
  }

  /* spawn markers: three authored tiers */
  for(const sp of d.spawns){
    const X=wx(sp.x), Z=wz(sp.y), dl=pd(sp.x,sp.y)+0.1, rot=cellRng.f(0,6.28);
    if(sp.tier===1){
      S.spawn1.add(X,0,Z, 1,1,1, rot, 0x5f4b45, dl);
      S.band2.add(X, 0.14, Z, 0.7,0.7,0.7, rot, 0xb03a2a, dl+0.08);
    } else if(sp.tier===2){
      S.spawn2.add(X,0,Z, 1,1,1, rot, 0x5a4348, dl);
      S.band2.add(X, 0.55, Z, 1,1,1, rot, 0xd8433a, dl+0.1);
    } else {
      S.spawn3.add(X,0,Z, 1,1,1, rot, 0x4c4258, dl);
      S.band3.add(X, 0.62, Z, 1,1,1, rot, 0x9b6cf0, dl+0.1);
      S.crystal.add(X, 1.98, Z, 0.42,0.42,0.42, rot, 0xb794ff, dl+0.2);
    }
  }

  /* doorway frames */
  for(const a of d.arches){
    const X=wx(a.x), Z=wz(a.y);
    const half = a.len/2 + 0.15;
    const dlA = nearFloorBfs(Math.round(a.x), Math.round(a.y))*dStep + 0.7;
    if(TH.kit === 'hospital'){
      const col = lerpC(TH.wall, 0xe8f3ef, 0.35);
      const signC = accC;
      if(a.px===1){
        S.hospitalDoorPost.add(X-half,0,Z, 1,1,1, 0, col, dlA);
        S.hospitalDoorPost.add(X+half,0,Z, 1,1,1, 0, col, dlA);
        S.hospitalDoorLintel.add(X,1.52,Z, a.len+0.46,1,1, 0, col, dlA+0.1);
        S.deptSign.add(X,1.84,Z+0.18, 1,1,1, 0, signC, dlA+0.12);
      } else {
        S.hospitalDoorPost.add(X,0,Z-half, 1,1,1, 0, col, dlA);
        S.hospitalDoorPost.add(X,0,Z+half, 1,1,1, 0, col, dlA);
        S.hospitalDoorLintel.add(X,1.52,Z, a.len+0.46,1,1, Math.PI/2, col, dlA+0.1);
        S.deptSign.add(X+0.18,1.84,Z, 1,1,1, Math.PI/2, signC, dlA+0.12);
      }
    } else {
      const col = lerpC(TH.wall, 0xffffff, 0.12);
      if(a.px===1){
        S.arch.add(X-half,0,Z, 1,1,1, 0, col, dlA);
        S.arch.add(X+half,0,Z, 1,1,1, 0, col, dlA);
        S.archL.add(X,1.62,Z, a.len+0.42,1,1, 0, col, dlA+0.1);
      } else {
        S.arch.add(X,0,Z-half, 1,1,1, 0, col, dlA);
        S.arch.add(X,0,Z+half, 1,1,1, 0, col, dlA);
        S.archL.add(X,1.62,Z, a.len+0.42,1,1, Math.PI/2, col, dlA+0.1);
      }
    }
  }

  /* liquid pockets + frozen lakes */
  if(TH.pools){
    liquidMat.uniforms.uMode.value = TH.pools.mode;
    liquidMat.uniforms.uColA.value.set(TH.pools.colA);
    liquidMat.uniforms.uColB.value.set(TH.pools.colB);
    liquidMat.uniforms.uGlow.value = TH.pools.glow;
  }
  if(d.pools.length){
    const skirtC = TH.pools.mode===0 ? 0xff5a1f : (TH.pools.mode===3 ? 0x33531e : 0x11463c);
    for(const p of d.pools){
      const dl = nearFloorBfs(p.x,p.y)*dStep + 0.5;
      S.basin.add(wx(p.x), 0, wz(p.y), 1,1,1, 0, lerpC(TH.wall,0x000000,0.35), dl);
      S.skirt.add(wx(p.x), 0, wz(p.y), cellRng.f(0.85,1.25),1,cellRng.f(0.85,1.25), cellRng.f(0,6.28), skirtC, dl+0.15);
    }
    const m = buildLiquidMesh(d.pools, wx, wz, -0.08);
    group.add(m); fx.liquids.push(m);
  }
  if(d.lakeCells.length){
    const m = buildLiquidMesh(d.lakeCells, wx, wz, -0.12);
    group.add(m); fx.liquids.push(m);
  }

  const setDefs = [
    ['pillar',   GEO.pillar,    matStone,  'rise', 0.4,  1],
    ['arch',     GEO.archPost,  matStone,  'rise', 0.45, 1],
    ['archL',    GEO.archLintel,matStone,  'pop',  0.35, 1],
    ['torchArm', GEO.torch,     matTrim,   'pop',  0.3,  0],
    ['flame',    GEO.flame,     matGlow,   'pop',  0.3,  0],
    ['flameCore',GEO.flameCore, matGlow,   'pop',  0.3,  0],
    ['debrisA',  GEO.debrisA,   matStone,  'pop',  0.3,  2],
    ['debrisB',  GEO.debrisB,   matStone,  'pop',  0.3,  2],
    ['debrisC',  GEO.debrisC,   matStone,  'pop',  0.3,  2],
        ['hospitalBed', GEO.hospitalBed, matHospitalWall, 'pop', 0.35, 1],
    ['ivStand',  GEO.ivStand,   matHospitalTrim,   'pop',  0.3,  0],
    ['medCabinet',GEO.medCabinet,matHospitalWall, 'pop',  0.35, 1],
    ['surgeryTable',GEO.surgeryTable,matHospitalWall,'pop',0.4,  1],
    ['hospitalSign',GEO.hospitalSign,matGlow,'pop',0.3,  0],
    ['nurseCounter',GEO.nurseCounter,matHospitalWall,'pop',0.35,1],
    ['doctorDesk',GEO.doctorDesk,matHospitalWall,'pop',0.35,1],
    ['examTable',GEO.examTable,matHospitalWall,'pop',0.35,1],
    ['wallChart',GEO.wallChart,matHospitalWall,'pop',0.3,0],
    ['noticeBoard',GEO.noticeBoard,matHospitalWall,'pop',0.3,0],
    ['clock',GEO.clock,matHospitalTrim,'pop',0.3,0],
    ['receptionDesk',GEO.receptionDesk,matHospitalWall,'pop',0.35,1],
    ['waitingBench',GEO.waitingBench,matHospitalWall,'pop',0.35,1],
    ['medCart',  GEO.medCart,   matHospitalTrim,   'pop',  0.35, 0],
    ['monitor',  GEO.monitor,   matHospitalTrim,   'pop',  0.35, 0],
    ['privacyCurtain',GEO.privacyCurtain,matCloth,'rise',0.4,0],
    ['surgicalLamp',GEO.surgicalLamp,matHospitalTrim,'pop',0.35,0],
    ['mriScanner',GEO.mriScanner,matHospitalWall,'pop',0.45,1],
    ['wallLight',GEO.wallLight,matGlow,'pop',0.3,0],
    ['oxygenTank',GEO.oxygenTank,matHospitalTrim,'pop',0.35,0],
    ['bioBin',GEO.bioBin,matHospitalWall,'pop',0.35,1],
    ['gurney',GEO.gurney,matHospitalTrim,'pop',0.4,1],
    ['floorCross',GEO.floorCross,matGlow,'pop',0.3,0],
    ['floorStripe',GEO.floorStripe,matGlow,'pop',0.3,0],
    ['wallPanel',GEO.wallPanel,matStone,'pop',0.35,0],
    ['hospitalDoorPost',GEO.hospitalDoorPost,matStone,'rise',0.35,1],
    ['hospitalDoorLintel',GEO.hospitalDoorLintel,matStone,'pop',0.35,1],
    ['deptSign',GEO.deptSign,matGlow,'pop',0.3,0],
    ['cleanZone',GEO.cleanZone,matGlow,'pop',0.3,0],
    ['floorArrow',GEO.floorArrow,matGlow,'pop',0.3,0],
    ['chest',    GEO.chestBody, matStone,  'pop',  0.35, 1],
    ['chestTrim',GEO.chestTrim, matTrim,   'pop',  0.35, 0],
    ['chestGlow',GEO.chestSeam, matGlow,   'pop',  0.4,  0],
    ['grave',    GEO.grave,     matStone,  'rise', 0.4,  1],
    ['sarco',    GEO.sarco,     matStone,  'pop',  0.4,  1],
    ['candle',   GEO.candle,    matStone,  'pop',  0.3,  0],
    ['bone',     GEO.bone,      matStone,  'pop',  0.3,  0],
    ['icicle',   GEO.icicle,    matIce,    'pop',  0.35, 0],
    ['shardIce', GEO.shard,     matIce,    'pop',  0.35, 0],
    ['roots',    GEO.roots,     matBark,   'rise', 0.5,  1],
    ['moss',     GEO.moss,      matMoss,   'pop',  0.4,  0],
    ['crackD',   GEO.crack,     matCrackD, 'pop',  0.4,  0],
    ['skirt',    GEO.skirt,     matSkirt,  'pop',  0.5,  0],
    ['bannerRod',GEO.bannerRod, matTrim,   'pop',  0.3,  0],
    ['bannerCloth',GEO.bannerCloth,matCloth,'rise',0.4,  0],
    ['emblem',   GEO.emblem,    matGlow,   'pop',  0.3,  0],
    ['spawn1',   GEO.spawn1,    matStone,  'rise', 0.4,  1],
    ['spawn2',   GEO.spawn2,    matStone,  'rise', 0.4,  1],
    ['spawn3',   GEO.spawn3,    matStone,  'rise', 0.4,  1],
    ['band2',    GEO.band2,     matGlow,   'pop',  0.3,  0],
    ['band3',    GEO.band3,     matGlow,   'pop',  0.3,  0],
    ['crystal',  GEO.crystal,   matGlow,   'pop',  0.4,  0],
    ['ring',     GEO.ring,      matGlow,   'pop',  0.4,  0],
    ['plinth',   GEO.plinth,    matStone,  'pop',  0.4,  1],
    ['platform', GEO.platform,  matStone,  'pop',  0.45, 2],
    ['brazier',  GEO.brazier,   matTrim,   'pop',  0.35, 1],
    ['coals',    GEO.coals,     matGlow,   'pop',  0.35, 0],
    ['basin',    GEO.basin,     matStone,  'pop',  0.3,  0],
    ['bossGlow', GEO.bossShard, matGlow,   'rise', 0.5,  0],
    ['bossRock', GEO.bossShard, matStone,  'rise', 0.5,  1]
  ];
  for(const [k, geo, mat, mode, dur, sh] of setDefs) meshes[k] = buildMesh(S[k], geo, mat, mode, dur, sh);
  for(const k in meshes) group.add(meshes[k]);

  /* hero single meshes: portal swirl, boss rune ring, god-ray shafts */
  if(portalXZ){
    matPortal.color.set(0x3fd0bb);
    const m = new THREE.Mesh(GEO.portal, matPortal);
    m.position.set(portalXZ[0], 0.12, portalXZ[1]);
    group.add(m); fx.spinners.push({m, spd:0.55});
  }
  if(runeXZ){
    matRune.color.set(0xff5040);
    const m = new THREE.Mesh(GEO.runeRing, matRune);
    m.position.set(runeXZ.x, 0.06, runeXZ.z);
    m.scale.setScalar(runeXZ.s);
    group.add(m); fx.spinners.push({m, spd:-0.16});
  }
  if(TH.shafts){
    const big = rooms.filter(r=>r.type===TYPE.COMBAT && !r.lake).sort((a,b)=>b.w*b.h-a.w*a.h).slice(0,2);
    for(const r of big) shaftAt.push([wx(r.cx), wz(r.cy), 1.3]);
  }
  for(const s of shaftAt){
    const m = new THREE.Mesh(GEO.shaft, matShaft);
    m.position.set(s[0], 0, s[1]);
    m.scale.setScalar(s[2]);
    group.add(m); fx.shafts.push(m);
  }

  /* ambient particles — emitted from sources that make physical sense:
     embers off lava + flames, wisps over graves/candles/miasma, spores off
     moss/roots/water, dust inside light shafts, snow as weather everywhere */
  { const spec = TH.particles;
    const pts = [];
    const pp = (x,z,y)=>pts.push({x,z,y});
    if(spec.kind===1){
      for(const p of d.pools) pp(wx(p.x)+cellRng.f(-0.3,0.3), wz(p.y)+cellRng.f(-0.3,0.3), -0.02);
      for(const t of d.torches) pp(wx(t.x)+t.dx*0.66, wz(t.y)+t.dy*0.66, 1.5);
      for(const p of d.props) if(p.kind==='brazier') pp(wx(p.x), wz(p.y), 0.62);
    } else if(spec.kind===3){
      for(const p of d.props){
        if(p.kind==='grave' || p.kind==='sarco') pp(wx(p.x)+cellRng.f(-0.2,0.2), wz(p.y)+cellRng.f(-0.2,0.2), 0.3);
        else if(p.kind==='candle') pp(wx(p.x), wz(p.y), 0.25);
        else if(p.kind==='bones') pp(wx(p.x), wz(p.y), 0.1);
      }
      for(const p of d.pools) pp(wx(p.x), wz(p.y), 0);
    } else if(spec.kind===4){
      for(const p of d.props){
        if(p.kind==='moss') pp(wx(p.x)+cellRng.f(-0.25,0.25), wz(p.y)+cellRng.f(-0.25,0.25), 0.05);
        else if(p.kind==='roots') pp(wx(p.x)+p.dx*0.8, wz(p.y)+p.dy*0.8, cellRng.f(0.2,1.4));
      }
      for(const p of d.pools) pp(wx(p.x), wz(p.y), 0);
    } else if(spec.kind===0){
      for(const s of shaftAt) for(let k=0;k<10;k++)
        pp(s[0]+cellRng.f(-0.8,0.8)*s[2], s[1]+cellRng.f(-0.8,0.8)*s[2], cellRng.f(0.3,2.4));
      for(const t of d.torches) pp(wx(t.x)+t.dx*0.7, wz(t.y)+t.dy*0.7, cellRng.f(1.2,1.9));
    } else {
      for(let y=0;y<H;y++) for(let x=0;x<W;x++)
        if(grid[idx(x,y)]===FLOOR && cellRng.chance(0.25)) pp(wx(x), wz(y), 0);
    }
    if(!pts.length)
      for(let y=0;y<H;y++) for(let x=0;x<W;x++)
        if(grid[idx(x,y)]===FLOOR && cellRng.chance(0.1)) pp(wx(x), wz(y), 0);
    if(pts.length){
      const n = Math.min(spec.n, Math.max(40, pts.length*6));
      const pos = new Float32Array(n*3), seed = new Float32Array(n);
      for(let i=0;i<n;i++){
        const p = pts[cellRng.i(0, pts.length-1)];
        pos[i*3]=p.x; pos[i*3+1]=p.y; pos[i*3+2]=p.z;
        seed[i]=cellRng.raw();
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos,3));
      g.setAttribute('aSeed', new THREE.BufferAttribute(seed,1));
      levelGeos.push(g);
      partMat.uniforms.uKind.value = spec.kind;
      partMat.uniforms.uColor.value.set(spec.color);
      const pm = new THREE.Points(g, partMat);
      pm.frustumCulled = false;
      group.add(pm); fx.parts = pm;
    }
  }

  /* shadow camera fit */
  const shHalf = Math.max(W,H)*0.62 + 6;
  dirL.shadow.camera.left = -shHalf; dirL.shadow.camera.right = shHalf;
  dirL.shadow.camera.top = shHalf;   dirL.shadow.camera.bottom = -shHalf;
  dirL.shadow.camera.updateProjectionMatrix();

  /* lights: farthest-point sample of torches + key lights */
  const budget = 12;
  const keys = [];
  keys.push({x:rooms[d.entrance].cx, y:rooms[d.entrance].cy, col:0x3fd0bb, i:1.0, dist:13});
  keys.push({x:rooms[d.boss].cx, y:rooms[d.boss].cy, col:0xff4030, i:1.7, dist:17, ry:2.2});
  const shr = rooms.filter(r=>r.type===TYPE.SHRINE);
  if(shr.length) keys.push({x:shr[0].cx, y:shr[0].cy, col:0x6f9dff, i:1.0, dist:12});
  const tb = Math.max(4, budget - keys.length);
  const chosen = [];
  if(d.torches.length){
    chosen.push(d.torches[0]);
    while(chosen.length < Math.min(tb, d.torches.length)){
      let best=null, bd=-1;
      for(const t of d.torches){
        let dm=1e9; for(const c of chosen){ const q=(t.x-c.x)*(t.x-c.x)+(t.y-c.y)*(t.y-c.y); if(q<dm) dm=q; }
        if(dm>bd){ bd=dm; best=t; }
      }
      chosen.push(best);
    }
  }
  let li=0;
  for(const k of keys){
    const L = new THREE.PointLight(k.col, k.i, k.dist, 2);
    L.position.set(wx(k.x), k.ry||1.6, wz(k.y));
    L.userData={base:k.i, ph:li*2.1, ramp:1}; group.add(L); lights.push(L); li++;
  }
  for(const t of chosen){
    const L = new THREE.PointLight(TH.torchLight[0], TH.torchLight[1], TH.torchLight[2], 2);
    L.position.set(wx(t.x)+t.dx*0.6, 1.7, wz(t.y)+t.dy*0.6);
    L.userData={base:TH.torchLight[1], ph:li*1.7, ramp:1}; group.add(L); lights.push(L); li++;
  }

  /* graph overlay */
  overlay = new THREE.Group(); group.add(overlay);
  const mkLines = (pairs, color, y, op)=>{
    const pos = new Float32Array(Math.max(pairs.length,1)*6);
    pairs.forEach((e,i)=>{
      pos.set([wx(rooms[e.a].cx), y, wz(rooms[e.a].cy), wx(rooms[e.b].cx), y, wz(rooms[e.b].cy)], i*6);
    });
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos,3));
    const m = new THREE.LineBasicMaterial({color, transparent:true, opacity:op, depthTest:false});
    const l = new THREE.LineSegments(g,m); l.renderOrder=5; overlay.add(l); return l;
  };
  const delPairs = delaunay(rooms.map(r=>({x:r.cx,y:r.cy}))).map(e=>({a:e[0],b:e[1]}));
  overlay.userData = {
    del:  mkLines(delPairs, 0x6a7385, 2.5, 0.13),
    mst:  mkLines(d.edges.filter(e=>!e.isLoop), 0xdfe4f0, 2.6, 0.7),
    loop: mkLines(d.edges.filter(e=>e.isLoop), 0x39d5e0, 2.65, 0.9),
    crit: mkLines(d.edges.filter(e=>e.isCritical), 0xff4d4d, 2.75, 0.95)
  };
  { const pos=new Float32Array(rooms.length*3), col=new Float32Array(rooms.length*3);
    rooms.forEach((r,i)=>{ pos.set([wx(r.cx),2.85,wz(r.cy)],i*3); _c.set(TINT[r.type]); col.set([_c.r,_c.g,_c.b],i*3); });
    const g=new THREE.BufferGeometry();
    g.setAttribute('position',new THREE.BufferAttribute(pos,3));
    g.setAttribute('color',new THREE.BufferAttribute(col,3));
    const pts=new THREE.Points(g,new THREE.PointsMaterial({size:6,sizeAttenuation:false,vertexColors:true,transparent:true,opacity:0.95,depthTest:false}));
    pts.renderOrder=6; overlay.add(pts); overlay.userData.pts=pts;
  }
  { const pos=new Float32Array(rooms.length*8*3), col=new Float32Array(rooms.length*8*3);
    rooms.forEach((r,i)=>{ _c.set(TINT[r.type]); for(let k=0;k<8;k++) col.set([_c.r,_c.g,_c.b],(i*8+k)*3); });
    const g=new THREE.BufferGeometry();
    g.setAttribute('position',new THREE.BufferAttribute(pos,3));
    g.setAttribute('color',new THREE.BufferAttribute(col,3));
    const m=new THREE.LineBasicMaterial({vertexColors:true,transparent:true,opacity:0.9,depthTest:false});
    const rects=new THREE.LineSegments(g,m); rects.renderOrder=7; overlay.add(rects); overlay.userData.rects=rects;
  }
  overlay.userData.wx=wx; overlay.userData.wz=wz;

  /* fog + camera framing */
  scene.fog.density = TH.fogD;
  camTarget.set(0,0,0);
  const fitSpan = Math.max(W,H) * 1.18;
  camDist = Math.min(320, Math.max(70, fitSpan / (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov) * 0.5))));
  updateCam();

  const maxDelay = maxBfs*dStep + 1.2;
  animEnd = 2.3 + maxDelay + 0.8;
}

function updateRects(t){
  const u = overlay.userData, rects = u.rects, pos = rects.geometry.attributes.position.array;
  const k = easeOutCubic(Math.min(1, Math.max(0, t/0.95)));
  D.rooms.forEach((r,i)=>{
    const cx = r.sx0 + (r.cx - r.sx0)*k, cy = r.sy0 + (r.cy - r.sy0)*k;
    const x0=u.wx(cx-r.w/2), x1=u.wx(cx+r.w/2), z0=u.wz(cy-r.h/2), z1=u.wz(cy+r.h/2), y=0.35;
    pos.set([x0,y,z0, x1,y,z0,  x1,y,z0, x1,y,z1,  x1,y,z1, x0,y,z1,  x0,y,z1, x0,y,z0], i*24);
  });
  rects.geometry.attributes.position.needsUpdate = true;
}

/* -------- reveal / overlay opacity per frame -------- */
const clamp01 = v => Math.max(0, Math.min(1, v));
function phase(t,a,b){ return clamp01((t-a)/(b-a)); }
function applyReveal(t){
  const u = overlay.userData, graphOn = el.tGraph.checked;
  updateRects(Math.min(t, 1.0));
  u.rects.material.opacity = 0.9 * (1 - phase(t, 2.5, 3.2));
  u.del.material.opacity  = 0.13 * phase(t,0.95,1.45) * (graphOn ? 1 : (1 - phase(t,3.0,3.6)));
  const resolved = phase(t,1.55,2.15);
  u.mst.material.opacity  = 0.7*resolved * (graphOn?1:(1-phase(t,3.2,3.9)));
  u.loop.material.opacity = 0.9*resolved * (graphOn?1:(1-phase(t,3.2,3.9)));
  u.crit.material.opacity = 0.95*phase(t,1.9,2.35) * (graphOn?1:(1-phase(t,3.4,4.1)));
  u.pts.material.opacity  = 0.95*phase(t,0.15,0.5) * (graphOn?1:(1-phase(t,3.0,3.6)));
  const tt = t - 2.3;
  for(const k in meshes){ const m=meshes[k]; if(!m.userData.settled) writeInstances(m, tt); }
  const lightRamp = phase(t, 2.6, animEnd*0.85);
  for(const L of lights) L.userData.ramp = lightRamp;
  setFxRamp(phase(t, 2.7, Math.max(3.6, animEnd*0.8)));
  setStage(t);
}
function setFxRamp(v){
  liquidMat.uniforms.uOp.value = v;
  partMat.uniforms.uRamp.value = v;
  matShaft.opacity = 0.13*v;
  matSkirt.opacity = 0.5*v;
  matRune.opacity = 0.85*v;
  matPortal.opacity = 0.9*v;
}
function setOverlayStatic(){
  setFxRamp(1);
  const u = overlay.userData, on = el.tGraph.checked;
  updateRects(1e3);
  u.rects.material.opacity = on ? 0.35 : 0;
  u.del.material.opacity   = on ? 0.13 : 0;
  u.mst.material.opacity   = on ? 0.7  : 0;
  u.loop.material.opacity  = on ? 0.9  : 0;
  u.crit.material.opacity  = on ? 0.95 : 0;
  u.pts.material.opacity   = on ? 0.95 : 0;
  for(const L of lights) L.userData.ramp = 1;
}

/* -------- pipeline stepper -------- */
const pipeEls = [...document.querySelectorAll('#pipe li')];
function setStage(t){
  const bounds = [0, 0.3,
 0.95, 1.55, 2.3, 2.3 + Math.max(0.6,(animEnd-2.3)*0.55)];
  pipeEls.forEach((li,i)=>{
    const s = bounds[i], e = i<5 ? bounds[i+1] : animEnd;
    li.classList.toggle('active', t>=s && t<e);
    li.classList.toggle('done', t>=e);
  });
}
function setStageDone(){ pipeEls.forEach(li=>{ li.classList.remove('active'); li.classList.add('done'); }); }

/* -------- UI refs -------- */
const $ = id => document.getElementById(id);
const el = { seed:$('seed'), dice:$('dice'), forge:$('forge'),
  rooms:$('rooms'), loops:$('loops'), decor:$('decor'),
  vRooms:$('vRooms'), vLoops:$('vLoops'), vDecor:$('vDecor'),
  tGraph:$('tGraph'), tHeat:$('tHeat'), tAnim:$('tAnim'), tPost:$('tPost'),
  tEditor:$('tEditor'), editorCanvas:$('editorCanvas'), editorStatus:$('editorStatus'), editorFullscreen:$('editorFullscreen'), editorCollapse:$('editorCollapse'),
  editorMenu:$('editorMenu'),
  dname:$('dname'), dsub:$('dsub'), vSetting:$('vSetting'), vTheme:$('vTheme'),
  sRooms:$('sRooms'), sEdges:$('sEdges'), sCrit:$('sCrit'),
  sTiles:$('sTiles'), sLights:$('sLights'), sMs:$('sMs'),
  sCalls:$('sCalls'), sTris:$('sTris'), sFps:$('sFps') };

/* -------- setting + palette selection -------- */
let settingSel = 'auto', paletteSel = 'auto';
function setSettingSel(t){
  settingSel = t;
  document.querySelectorAll('#settingChips .chip').forEach(ch=>ch.classList.toggle('on', ch.dataset.s===t));
}
function setPaletteSel(t){
  paletteSel = t;
  document.querySelectorAll('#paletteChips .chip').forEach(ch=>ch.classList.toggle('on', ch.dataset.p===t));
}
function resolveSetting(seed){
  return settingSel==='auto'
    ? SETTING_KEYS[(Math.imul(seed ^ 0x51ed, 2246822519)>>>0) % SETTING_KEYS.length]
    : settingSel;
}
function palettePoolForSetting(settingKey){
  return settingKey==='hospital' ? HOSPITAL_PALETTE_KEYS : DUNGEON_PALETTE_KEYS;
}
function resolvePalette(seed, settingKey){
  if(paletteSel !== 'auto') return paletteSel;
  const pool = palettePoolForSetting(settingKey);
  return pool[(Math.imul(seed ^ 0x9e37, 2654435761)>>>0) % pool.length];
}

/* -------- object-layer toggles (all on by default) -------- */
const objVis = { props:true, torches:true, particles:true, liquids:true, lights:true };
/* which instanced-mesh categories belong to each toggle; everything not listed
   (floor, wall, wallCap) is structural and always shown */
const OBJ_MESHES = {
  props: ['pillar','arch','archL','debrisA','debrisB','debrisC','chest','chestTrim','chestGlow',
          'grave','sarco','candle','bone','icicle','shardIce','roots','moss','crackD','skirt',
          'hospitalBed','ivStand','medCabinet','surgeryTable','hospitalSign',
          'nurseCounter','doctorDesk','examTable','wallChart','noticeBoard','clock',
          'receptionDesk','waitingBench','medCart','monitor','privacyCurtain','surgicalLamp','mriScanner','wallLight',
          'oxygenTank','bioBin','gurney','floorCross','floorStripe','wallPanel',
          'hospitalDoorPost','hospitalDoorLintel','deptSign','cleanZone','floorArrow',
          'bannerRod','bannerCloth','emblem','spawn1','spawn2','spawn3','band2','band3',
          'crystal','ring','plinth','platform','basin','bossGlow','bossRock'],
  torches: ['torchArm','flame','flameCore','brazier','coals'],
};
/* Apply current toggle state to the live scene. Called after every forge (which
   rebuilds meshes/fx/lights) and whenever a chip is clicked. */
function applyObjectVis(){
  for(const cat in OBJ_MESHES)
    for(const k of OBJ_MESHES[cat])
      if(meshes[k]) meshes[k].visible = objVis[cat];
  if(fx.parts) fx.parts.visible = objVis.particles;
  for(const m of fx.shafts) m.visible = objVis.particles;
  for(const m of fx.liquids) m.visible = objVis.liquids;
  for(const sp of fx.spinners) sp.m.visible = objVis.props;
  for(const L of lights) L.visible = objVis.lights;
}

const prefersReduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
if(prefersReduced) el.tAnim.checked = false;
if(innerWidth < 640){
  document.getElementById('panel').classList.add('min');
  document.getElementById('collapse').textContent = '+';
}

function applyHeat(on){
  if(!meshes.floor) return;
  const src = on ? floorColorsHeat : floorColorsBase;
  for(let i=0;i<src.length;i++) meshes.floor.setColorAt(i, _c.set(src[i]));
  if(meshes.floor.instanceColor) meshes.floor.instanceColor.needsUpdate = true;
}

/* -------- 2D layout editor -------- */
const editor = { tool:'select', rooms:[], links:[], blockedLinks:[], secretRooms:[], selectedId:null, selectedLinkKey:null, connectFrom:null, drag:null, scale:6, panX:0, panY:0, nextId:1, deb:null, full:false, collapsed:false, panelWidth:null, panelHeight:null, dirty:false };
function resetEditorLayoutState(){
  editor.rooms=[];
  editor.links=[];
  editor.blockedLinks=[];
  editor.secretRooms=[];
  editor.selectedId=null;
  editor.selectedLinkKey=null;
  editor.connectFrom=null;
  editor.drag=null;
  editor.nextId=1;
  editor.dirty=false;
}
function forgeFromEditor(animate=false){
  editor.dirty = true;
  forge(animate, true);
}
const editorCtx = el.editorCanvas ? el.editorCanvas.getContext('2d') : null;
const editorRoom = id => editor.rooms.find(r=>r.id===id);
const selectedEditorIndex = () => editor.rooms.findIndex(r=>r.id===editor.selectedId);
function editorDoorPoint(A, B, margin=1){
  return roomDoorPoint({cx:A.x, cy:A.y, w:A.w, h:A.h}, {cx:B.x, cy:B.y, w:B.w, h:B.h}, margin);
}
function sceneEdgePoint(e, key){
  const p = key==='a' ? {x:e.ax, y:e.ay} : {x:e.bx, y:e.by};
  if(Number.isFinite(p.x) && Number.isFinite(p.y)) return p;
  const d = edgeDoorPoints(e, D.rooms);
  return key==='a' ? d.da : d.db;
}
function editorLinkKey(a,b){ return Math.min(a,b)+','+Math.max(a,b); }
function unblockEditorLink(a,b){
  const k=editorLinkKey(a,b);
  editor.blockedLinks=editor.blockedLinks.filter(q=>q!==k);
}
function blockEditorLink(a,b){
  const k=editorLinkKey(a,b);
  if(!editor.blockedLinks.includes(k)) editor.blockedLinks.push(k);
}
function blockEditorRoomLinks(id){
  for(const l of editor.links) if(l.a===id || l.b===id) blockEditorLink(l.a,l.b);
  editor.links = editor.links.filter(l=>l.a!==id && l.b!==id);
  if(editor.selectedLinkKey && !editor.links.some(l=>editorLinkKey(l.a,l.b)===editor.selectedLinkKey)) editor.selectedLinkKey=null;
}
function markEditorRoomSecret(id){
  const r=editorRoom(id); if(!r) return;
  r.roleHint='secret';
  if(!editor.secretRooms.includes(id)) editor.secretRooms.push(id);
}
function markDisconnectedRoomsAsSecret(){
  if(editor.rooms.length<=1) return [];
  const ids=editor.rooms.map(r=>r.id);
  const idSet=new Set(ids);
  const adj=new Map(ids.map(id=>[id, []]));
  for(const l of editor.links){
    if(!idSet.has(l.a) || !idSet.has(l.b)) continue;
    adj.get(l.a).push(l.b); adj.get(l.b).push(l.a);
  }
  const seen=new Set(), comps=[];
  for(const id of ids){
    if(seen.has(id)) continue;
    const comp=[], q=[id]; seen.add(id);
    for(let h=0; h<q.length; h++){
      const a=q[h]; comp.push(a);
      for(const b of adj.get(a)) if(!seen.has(b)){ seen.add(b); q.push(b); }
    }
    comps.push(comp);
  }
  if(comps.length<=1) return [];
  const main = comps.find(c=>c.some(id=>editorRoom(id)?.roleHint==='entrance')) ||
    comps.find(c=>c.some(id=>editorRoom(id)?.roleHint==='boss')) ||
    comps.reduce((a,b)=>a.length>=b.length?a:b);
  const mainSet=new Set(main), secretIds=[];
  for(const comp of comps){
    if(comp===main || comp.every(id=>mainSet.has(id))) continue;
    for(const id of comp) secretIds.push(id);
  }
  for(const id of secretIds) markEditorRoomSecret(id);
  if(editor.selectedLinkKey && !editor.links.some(l=>editorLinkKey(l.a,l.b)===editor.selectedLinkKey)) editor.selectedLinkKey=null;
  return secretIds;
}
function unblockEditorRoomLinks(id){
  editor.blockedLinks = editor.blockedLinks.filter(k=>{
    const [a,b]=String(k).split(',').map(Number);
    return a!==id && b!==id;
  });
}
function clearEditorRoomSecret(id){
  const r=editorRoom(id); if(!r) return false;
  const wasSecret = r.roleHint==='secret' || editor.secretRooms.includes(id);
  if(!wasSecret) return false;
  if(r.roleHint==='secret') r.roleHint=null;
  editor.secretRooms = editor.secretRooms.filter(q=>q!==id);
  unblockEditorRoomLinks(id);
  return true;
}
function normalizeConnectedSecretRooms(){
  if(!editor.secretRooms.length || !editor.rooms.length) return false;
  const ids=editor.rooms.map(r=>r.id);
  const idSet=new Set(ids);
  const secretSet=new Set(editor.secretRooms);
  const adj=new Map(ids.map(id=>[id, []]));
  for(const l of editor.links){
    if(!idSet.has(l.a) || !idSet.has(l.b)) continue;
    adj.get(l.a).push(l.b); adj.get(l.b).push(l.a);
  }
  const seen=new Set();
  let changed=false;
  for(const id of ids){
    if(seen.has(id)) continue;
    const comp=[], q=[id]; seen.add(id);
    let hasNormal=false;
    for(let h=0; h<q.length; h++){
      const a=q[h]; comp.push(a);
      const r=editorRoom(a);
      if(r && r.roleHint!=='secret' && !secretSet.has(a)) hasNormal=true;
      for(const b of adj.get(a)) if(!seen.has(b)){ seen.add(b); q.push(b); }
    }
    if(hasNormal){
      for(const cid of comp) if(clearEditorRoomSecret(cid)) changed=true;
    }
  }
  if(changed && editor.selectedId!==null && !editorRoom(editor.selectedId)) editor.selectedId=null;
  return changed;
}
function defaultLinkRoute(A,B){
  const da=editorDoorPoint(A,B), db=editorDoorPoint(B,A);
  const e={ax:da.x, ay:da.y, aside:da.side, bx:db.x, by:db.y, bside:db.side};
  assignEdgeRoute(e);
  return edgeRoutePoints(e);
}
function linkWidth(l){ return Math.max(1, Math.min(6, Number.isFinite(l && l.width) ? l.width : 2)); }
function clampDoorOffset(v){ return Math.max(-0.82, Math.min(0.82, Number.isFinite(v) ? v : 0)); }
function pointToDoorSpec(room, p){
  const x0=room.x-room.w/2, x1=room.x+room.w/2, y0=room.y-room.h/2, y1=room.y+room.h/2;
  const dists=[{side:'n',d:Math.abs(p.y-y0)},{side:'s',d:Math.abs(p.y-y1)},{side:'w',d:Math.abs(p.x-x0)},{side:'e',d:Math.abs(p.x-x1)}].sort((a,b)=>a.d-b.d);
  const side=dists[0].side;
  if(side==='n' || side==='s') return {side, offset:clampDoorOffset((p.x-room.x)/(room.w/2 || 1))};
  return {side, offset:clampDoorOffset((p.y-room.y)/(room.h/2 || 1))};
}
function doorSpecPoint(room, spec){
  if(!room || !spec) return null;
  const o=clampDoorOffset(spec.offset || 0);
  const hw=room.w/2, hh=room.h/2;
  if(spec.side==='n') return {x:room.x+o*hw, y:room.y-hh, side:'n'};
  if(spec.side==='s') return {x:room.x+o*hw, y:room.y+hh, side:'s'};
  if(spec.side==='w') return {x:room.x-hw, y:room.y+o*hh, side:'w'};
  return {x:room.x+hw, y:room.y+o*hh, side:'e'};
}
function editorRoomAtPoint(p){
  for(let i=editor.rooms.length-1;i>=0;i--){
    const r=editor.rooms[i], x0=r.x-r.w/2, x1=r.x+r.w/2, y0=r.y-r.h/2, y1=r.y+r.h/2;
    if(p.x>=x0 && p.x<=x1 && p.y>=y0 && p.y<=y1) return r;
  }
  return null;
}
function reassignLinkEndpoint(l, which, room, point){
  if(!l || !room) return false;
  if(which==='a'){
    if(room.id===l.a || room.id===l.b) return false;
    blockEditorLink(l.a, l.b);
    l.a=room.id;
    l.doorA=pointToDoorSpec(room, point);
  } else {
    if(room.id===l.a || room.id===l.b) return false;
    blockEditorLink(l.a, l.b);
    l.b=room.id;
    l.doorB=pointToDoorSpec(room, point);
  }
  l.manual=true;
  unblockEditorLink(l.a, l.b);
  return true;
}
function linkDoorPoint(l, which){
  const A=editorRoom(l.a), B=editorRoom(l.b); if(!A || !B) return null;
  const drag = editor.drag && editor.drag.mode==='routeDoor' && editor.drag.link===l && editor.drag.which===which ? editor.drag.previewPoint : null;
  if(drag) return drag;
  const room = which==='a' ? A : B;
  const spec = which==='a' ? l.doorA : l.doorB;
  const auto = which==='a' ? editorDoorPoint(A,B) : editorDoorPoint(B,A);
  return doorSpecPoint(room, spec) || auto;
}
function linkHandles(l){
  const pts=[];
  const da=linkDoorPoint(l,'a'), db=linkDoorPoint(l,'b');
  if(da) pts.push({kind:'door', which:'a', link:l, point:da});
  if(db) pts.push({kind:'door', which:'b', link:l, point:db});
  if(Array.isArray(l.bends)) l.bends.forEach((b,i)=>pts.push({kind:'bend', bendIndex:i, link:l, point:b}));
  return pts;
}
function editorLinkHandleAt(p){
  const tol=Math.max(1.4, 9/editor.scale);
  let best=null;
  for(const l of editor.links){
    for(const h of linkHandles(l)){
      const d=Math.hypot(p.x-h.point.x, p.y-h.point.y);
      if(d<=tol && (!best || d<best.d)) best={...h,d};
    }
  }
  return best;
}

function linkVisualRoute(l){
  const A=editorRoom(l.a), B=editorRoom(l.b); if(!A || !B) return [];
  const da=linkDoorPoint(l,'a'), db=linkDoorPoint(l,'b');
  if(!da || !db) return [];
  if(Array.isArray(l.bends) && l.bends.length) return [da, ...l.bends.map(p=>({x:p.x,y:p.y})), db];
  const e={ax:da.x, ay:da.y, aside:da.side, bx:db.x, by:db.y, bside:db.side};
  assignEdgeRoute(e);
  return edgeRoutePoints(e);
}
function hitRouteSegment(p, pts, tol){
  let best=null;
  for(let i=0;i<pts.length-1;i++){
    const a=pts[i], b=pts[i+1], vx=b.x-a.x, vy=b.y-a.y, len2=vx*vx+vy*vy;
    if(len2<=0) continue;
    const t=Math.max(0, Math.min(1, ((p.x-a.x)*vx+(p.y-a.y)*vy)/len2));
    const x=a.x+vx*t, y=a.y+vy*t, d=Math.hypot(p.x-x,p.y-y);
    if(d<=tol && (!best || d<best.d)) best={seg:i, t, x, y, d};
  }
  return best;
}
function editorLinkAt(p){
  let best=null;
  for(const l of editor.links){
    const tol = Math.max(linkWidth(l)/2, 8/editor.scale);
    const hit=hitRouteSegment(p, linkVisualRoute(l), tol);
    if(hit && (!best || hit.d<best.hit.d)) best={link:l, hit};
  }
  return best;
}
function ensureEditableRoute(l){
  if(!l) return [];
  if(!Array.isArray(l.bends)) l.bends=[];
  if(!l.bends.length){
    const pts=linkVisualRoute(l);
    if(pts.length>2) l.bends = pts.slice(1,-1).map(p=>({x:p.x,y:p.y}));
  }
  return linkVisualRoute(l);
}
function editorSnapTargetPoints(skip){
  const pts=[];
  for(const r of editor.rooms){
    const x0=r.x-r.w/2, x1=r.x+r.w/2, y0=r.y-r.h/2, y1=r.y+r.h/2;
    pts.push({x:r.x,y:r.y}, {x:x0,y:y0}, {x:x1,y:y0}, {x:x1,y:y1}, {x:x0,y:y1},
      {x:r.x,y:y0}, {x:r.x,y:y1}, {x:x0,y:r.y}, {x:x1,y:r.y});
  }
  for(const l of editor.links){
    for(const h of linkHandles(l)){
      if(skip && skip.link===l && skip.kind===h.kind && skip.which===h.which && skip.bendIndex===h.bendIndex) continue;
      pts.push({x:h.point.x, y:h.point.y});
    }
  }
  return pts;
}
function editorSnapTolerance(){ return Math.max(3.5, 28/editor.scale); }
function snapEditorPoint(p, skip){
  const tol=editorSnapTolerance();
  let best=null;
  for(const t of editorSnapTargetPoints(skip)){
    const d=Math.hypot(p.x-t.x, p.y-t.y);
    if(d<=tol && (!best || d<best.d)) best={...t,d};
  }
  if(best) return {x:editorSnap(best.x), y:editorSnap(best.y), snapped:true};
  let x=p.x, y=p.y, dx=tol, dy=tol;
  for(const t of editorSnapTargetPoints(skip)){
    const ax=Math.abs(p.x-t.x), ay=Math.abs(p.y-t.y);
    if(ax<dx){ dx=ax; x=t.x; }
    if(ay<dy){ dy=ay; y=t.y; }
  }
  return {x:editorSnap(x), y:editorSnap(y), snapped:dx<tol || dy<tol};
}
function snapRouteSegmentDelta(l, seg, startPts, delta, lock){
  let out={x:delta.x, y:delta.y};
  const tol=editorSnapTolerance();
  const a=startPts[seg], b=startPts[seg+1];
  const moved=[{p:a, index:seg}, {p:b, index:seg+1}];
  let best=null;
  for(const m of moved){
    const cur={x:m.p.x+out.x, y:m.p.y+out.y};
    for(const t of editorSnapTargetPoints({link:l})){
      let sx=t.x-cur.x, sy=t.y-cur.y;
      if(lock==='x') sy=0;
      if(lock==='y') sx=0;
      const d=Math.hypot(sx,sy);
      if(d<=tol && (!best || d<best.d)) best={x:out.x+sx, y:out.y+sy, d};
    }
  }
  if(best) out={x:best.x, y:best.y};
  return {x:editorSnap(out.x), y:editorSnap(out.y)};
}
function setLinkRoutePoint(l, index, point){
  const pts=linkVisualRoute(l);
  if(!pts.length) return;
  const p={x:editorSnap(point.x), y:editorSnap(point.y)};
  if(index<=0){
    if(!Array.isArray(l.bends)) l.bends=[];
    if(!l.bends.length) l.bends.unshift(p);
    else { l.bends[0].x=p.x; l.bends[0].y=p.y; }
  } else if(index>=pts.length-1){
    if(!Array.isArray(l.bends)) l.bends=[];
    if(!l.bends.length) l.bends.push(p);
    else { const i=l.bends.length-1; l.bends[i].x=p.x; l.bends[i].y=p.y; }
  } else {
    if(!Array.isArray(l.bends)) l.bends=[];
    if(l.bends[index-1]){ l.bends[index-1].x=p.x; l.bends[index-1].y=p.y; }
  }
}
function moveLinkRouteSegment(l, seg, startPts, delta){
  if(!l || !startPts || seg<0 || seg>=startPts.length-1) return;
  const a=startPts[seg], b=startPts[seg+1];
  const dx=b.x-a.x, dy=b.y-a.y;
  let mx=delta.x, my=delta.y, lock=null;
  if(Math.abs(dx) >= Math.abs(dy)*1.4){ mx=0; lock='y'; }
  else if(Math.abs(dy) >= Math.abs(dx)*1.4){ my=0; lock='x'; }
  const snapped=snapRouteSegmentDelta(l, seg, startPts, {x:mx,y:my}, lock);
  setLinkRoutePoint(l, seg, {x:a.x+snapped.x, y:a.y+snapped.y});
  setLinkRoutePoint(l, seg+1, {x:b.x+snapped.x, y:b.y+snapped.y});
}
function toggleEditorLink(a,b){
  if(!a || !b || a===b) return;
  const k=editorLinkKey(a,b), i=editor.links.findIndex(l=>editorLinkKey(l.a,l.b)===k);
  unblockEditorLink(a,b);
  if(i>=0){
    const [removed]=editor.links.splice(i,1);
    if(removed) blockEditorLink(a,b);
    markDisconnectedRoomsAsSecret();
  } else {
    editor.links.push({a,b,bends:[],width:2,manual:true});
    normalizeConnectedSecretRooms();
  }
}
function editorRequestForge(){
  drawEditor();
  if(!editor.rooms.length) return;
  clearTimeout(editor.deb); editor.deb = setTimeout(()=>forgeFromEditor(false), 180);
}
function syncEditorCanvasSize(){
  const c=el.editorCanvas; if(!c) return;
  const r=c.getBoundingClientRect(), w=Math.max(260, Math.round(r.width)), h=Math.max(260, Math.round(r.height));
  if(c.width!==w || c.height!==h){ c.width=w; c.height=h; }
}
function editorWorldToCanvas(x,y){ const c=el.editorCanvas; return {x:c.width/2+editor.panX+x*editor.scale, y:c.height/2+editor.panY+y*editor.scale}; }
function editorCanvasToWorld(px,py){ const c=el.editorCanvas; return {x:(px-c.width/2-editor.panX)/editor.scale, y:(py-c.height/2-editor.panY)/editor.scale}; }
function editorPointer(e){
  const r = el.editorCanvas.getBoundingClientRect();
  return editorCanvasToWorld((e.clientX-r.left)*(el.editorCanvas.width/r.width), (e.clientY-r.top)*(el.editorCanvas.height/r.height));
}
function editorSnap(v){ return Math.round(v); }
function editorHit(p){
  const hp = 7 / editor.scale;
  for(let i=editor.rooms.length-1;i>=0;i--){
    const r=editor.rooms[i], x0=r.x-r.w/2, x1=r.x+r.w/2, y0=r.y-r.h/2, y1=r.y+r.h/2;
    if(p.x<x0-hp || p.x>x1+hp || p.y<y0-hp || p.y>y1+hp) continue;
    const nearL=Math.abs(p.x-x0)<=hp, nearR=Math.abs(p.x-x1)<=hp, nearT=Math.abs(p.y-y0)<=hp, nearB=Math.abs(p.y-y1)<=hp;
    if((nearL||nearR||nearT||nearB) && p.x>=x0-hp && p.x<=x1+hp && p.y>=y0-hp && p.y<=y1+hp){
      return {room:r, mode:(nearT?'n':'')+(nearB?'s':'')+(nearL?'w':'')+(nearR?'e':'')};
    }
    if(p.x>=x0 && p.x<=x1 && p.y>=y0 && p.y<=y1) return {room:r, mode:'move'};
  }
  return null;
}
function editorNormalizeRect(a,b){
  const x0=Math.min(a.x,b.x), x1=Math.max(a.x,b.x), y0=Math.min(a.y,b.y), y1=Math.max(a.y,b.y);
  return {x:editorSnap((x0+x1)/2), y:editorSnap((y0+y1)/2), w:Math.max(5, editorSnap(x1-x0)), h:Math.max(5, editorSnap(y1-y0))};
}
function editorResizeRoom(r, start, cur, mode){
  let x0=start.x-start.w/2, x1=start.x+start.w/2, y0=start.y-start.h/2, y1=start.y+start.h/2;
  if(mode.includes('w')) x0=cur.x; if(mode.includes('e')) x1=cur.x;
  if(mode.includes('n')) y0=cur.y; if(mode.includes('s')) y1=cur.y;
  const nr = editorNormalizeRect({x:x0,y:y0},{x:x1,y:y1});
  r.x=nr.x; r.y=nr.y; r.w=nr.w; r.h=nr.h;
}
function roomByEditorId(id){
  if(!D) return null;
  const idx = editor.rooms.findIndex(r=>r.id===id);
  if(idx < 0) return null;
  return D.rooms.find(r=>r.sourceId===idx) || D.rooms[idx] || null;
}
function hitRoomAtWorld(x, z){
  if(!D) return null;
  let best = null, bestArea = Infinity;
  for(const r of D.rooms){
    const cx = r.cx-D.W/2+0.5, cz = r.cy-D.H/2+0.5;
    const dx = x-cx, dz = z-cz, ax=Math.abs(dx), az=Math.abs(dz), rx=r.w/2, rz=r.h/2;
    if(ax>rx || az>rz) continue;
    let ok = true;
    if(r.shape==='ellipse') ok = (dx*dx)/(rx*rx) + (dz*dz)/(rz*rz) <= 1;
    else if(r.shape==='oct'){
      const ch=Math.min(rx,rz)*0.55;
      ok = ax<=rx-ch || az<=rz-ch || (ax-(rx-ch))+(az-(rz-ch)) <= ch;
    }
    if(!ok) continue;
    const area = r.w*r.h;
    if(area < bestArea){ best=r; bestArea=area; }
  }
  return best;
}
function selectRoomFromScene(clientX, clientY){
  if(!D) return false;
  const rect = renderer.domElement.getBoundingClientRect();
  const ndc = new THREE.Vector2(
    ((clientX-rect.left)/rect.width)*2-1,
    -((clientY-rect.top)/rect.height)*2+1
  );
  const ray = new THREE.Raycaster();
  ray.setFromCamera(ndc, cam);
  const hit = new THREE.Vector3();
  if(!ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0,1,0), 0), hit)) return false;
  const room = hitRoomAtWorld(hit.x, hit.z);
  if(!room) return false;
  let idx = Number.isInteger(room.sourceId) ? room.sourceId : D.rooms.indexOf(room);
  if(!editor.rooms[idx]) return false;
  editor.selectedId = editor.rooms[idx].id;
  editor.tool = 'select';
  drawEditor();
  return true;
}
function criticalRoomIds(){
  if(!D) return new Set();
  const adj = Array.from({length:D.rooms.length},()=>[]);
  D.edges.forEach(e=>{ adj[e.a].push(e.b); adj[e.b].push(e.a); });
  const par = new Int32Array(D.rooms.length).fill(-1), q=[D.entrance], vis=new Uint8Array(D.rooms.length); vis[D.entrance]=1;
  for(let h=0; h<q.length; h++) for(const b of adj[q[h]]) if(!vis[b]){ vis[b]=1; par[b]=q[h]; q.push(b); }
  const ids = new Set();
  for(let c=D.boss; c>=0; c=par[c]){ ids.add(c); if(c===D.entrance) break; }
  return ids;
}
function clearRouteOverlay(){
  if(routeOverlay){
    if(routeOverlay.parent) routeOverlay.parent.remove(routeOverlay);
    routeOverlay.traverse(o=>{ if(o.geometry) o.geometry.dispose(); if(o.material) o.material.dispose(); });
    routeOverlay = null;
  }
}
function makeRouteBandGeometry(edges, width, y){
  const verts=[];
  for(const e of edges){
    if(!e.useEditorRoute) continue;
    const pts=edgeRoutePoints(e).map(p=>({x:p.x-D.W/2+0.5, y:p.y-D.H/2+0.5}));
    const bandWidth = Math.max(0.5, Number.isFinite(e.visualWidth) ? e.visualWidth : width);
    for(let i=0;i<pts.length-1;i++){
      const a=pts[i], b=pts[i+1], dx=b.x-a.x, dy=b.y-a.y, len=Math.hypot(dx,dy);
      if(len<=0) continue;
      const nx=-dy/len*bandWidth/2, ny=dx/len*bandWidth/2;
      verts.push(a.x+nx,y,a.y+ny, b.x+nx,y,b.y+ny, b.x-nx,y,b.y-ny, a.x+nx,y,a.y+ny, b.x-nx,y,b.y-ny, a.x-nx,y,a.y-ny);
    }
  }
  const g=new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts),3));
  return g;
}
function syncDungeonRoutesFromEditor(){
  if(!D || !Array.isArray(D.edges) || !Array.isArray(editor.links) || !Array.isArray(editor.rooms)) return;
  const links = new Map(editor.links.map(l=>[editorLinkKey(l.a,l.b), l]));
  const roomForEdgeIndex = i=>{
    const r = D.rooms[i];
    if(!r) return null;
    const source = Number.isInteger(r.sourceId) ? r.sourceId : i;
    return editor.rooms[source] || null;
  };
  for(const e of D.edges){
    const A=roomForEdgeIndex(e.a), B=roomForEdgeIndex(e.b);
    if(!A || !B) continue;
    const l=links.get(editorLinkKey(A.id, B.id));
    if(!l) continue;
    const pts=linkVisualRoute(l);
    if(pts.length >= 2){
      e.route = pts.map(p=>({x:Math.round(p.x + D.W/2), y:Math.round(p.y + D.H/2), side:p.side}))
        .filter((p,i,a)=>i===0 || p.x!==a[i-1].x || p.y!==a[i-1].y);
      if(e.route.length >= 2){
        const a=e.route[0], b=e.route[e.route.length-1];
        e.ax=a.x; e.ay=a.y; if(a.side) e.aside=a.side;
        e.bx=b.x; e.by=b.y; if(b.side) e.bside=b.side;
      }
    }
    e.visualWidth = linkWidth(l);
  }
}
function updateRouteOverlay(){
  syncDungeonRoutesFromEditor();
  clearRouteOverlay();
  if(!D || !group) return;
  routeOverlay = new THREE.Group(); routeOverlay.renderOrder = 11; group.add(routeOverlay);
  const mk = (edges, color, y, opacity, width)=>{
    if(!edges.length) return;
    const g = makeRouteBandGeometry(edges, width, y);
    if(!g.attributes.position.count) return;
    const solid = new THREE.Mesh(g, new THREE.MeshBasicMaterial({color, transparent:true, opacity, depthTest:true, depthWrite:false, side:THREE.DoubleSide}));
    solid.renderOrder = 4; routeOverlay.add(solid);
    const ghost = new THREE.Mesh(g.clone(), new THREE.MeshBasicMaterial({color, transparent:true, opacity:Math.min(0.16, opacity*0.28), depthTest:false, depthWrite:false, side:THREE.DoubleSide}));
    ghost.renderOrder = 11; routeOverlay.add(ghost);
  };
  mk(D.edges.filter(e=>!e.isCritical && !e.isManual), 0x78d7ff, 0.85, 0.32, 2.0);
  mk(D.edges.filter(e=>e.isManual), 0x59d68f, 0.92, 0.62, 2.2);
  mk(D.edges.filter(e=>e.isCritical), 0xffd36a, 1.00, 0.72, 2.4);
}
function updateSceneSelection(){
  if(roomSelection){
    if(roomSelection.parent) roomSelection.parent.remove(roomSelection);
    roomSelection.geometry.dispose(); roomSelection.material.dispose(); roomSelection = null;
  }
  if(!D || !group) return;
  const selected = editorRoom(editor.selectedId);
  const r = selected ? roomByEditorId(selected.id) : null;
  if(!r) return;
  const x0=r.cx-D.W/2-r.w/2+0.5, x1=r.cx-D.W/2+r.w/2+0.5;
  const z0=r.cy-D.H/2-r.h/2+0.5, z1=r.cy-D.H/2+r.h/2+0.5, y=3.25;
  const pos = new Float32Array([x0,y,z0, x1,y,z0,  x1,y,z0, x1,y,z1,  x1,y,z1, x0,y,z1,  x0,y,z1, x0,y,z0]);
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos,3));
  const m = new THREE.LineBasicMaterial({color:0xffd36a, transparent:true, opacity:0.95, depthTest:false});
  roomSelection = new THREE.LineSegments(g,m); roomSelection.renderOrder = 12; group.add(roomSelection);
}
function drawEditorRoute(g, pts, color, width, dots=false){
  if(!pts || pts.length < 2) return;
  g.strokeStyle=color; g.lineWidth=width;
  g.beginPath();
  pts.forEach((p,i)=>{ const q=editorWorldToCanvas(p.x,p.y); if(i===0) g.moveTo(q.x,q.y); else g.lineTo(q.x,q.y); });
  g.stroke();
  if(dots){
    g.fillStyle=color;
    const a=editorWorldToCanvas(pts[0].x,pts[0].y), b=editorWorldToCanvas(pts[pts.length-1].x,pts[pts.length-1].y);
    g.beginPath(); g.arc(a.x,a.y,4,0,Math.PI*2); g.arc(b.x,b.y,4,0,Math.PI*2); g.fill();
  }
}
function drawEditorCorridor(g, pts, color, width, selected=false){
  if(!pts || pts.length < 2) return;
  const px = Math.max(3, width * editor.scale);
  g.save();
  g.lineJoin='round'; g.lineCap='round';
  g.strokeStyle=color; g.globalAlpha=selected ? 0.34 : 0.22; g.lineWidth=px;
  g.beginPath();
  pts.forEach((p,i)=>{ const q=editorWorldToCanvas(p.x,p.y); if(i===0) g.moveTo(q.x,q.y); else g.lineTo(q.x,q.y); });
  g.stroke();
  g.globalAlpha=1; g.strokeStyle=selected ? '#e8973f' : color; g.lineWidth=selected ? 2.2 : 1.4;
  g.beginPath();
  pts.forEach((p,i)=>{ const q=editorWorldToCanvas(p.x,p.y); if(i===0) g.moveTo(q.x,q.y); else g.lineTo(q.x,q.y); });
  g.stroke();
  g.restore();
}
function editorLinkRoute(l,A,B){
  if(l && (l.a || l.b)) return linkVisualRoute(l);
  return defaultLinkRoute(A,B);
}
function drawEditor(){
  if(!editorCtx) return;
  syncEditorCanvasSize();
  const c=el.editorCanvas, g=editorCtx;
  g.clearRect(0,0,c.width,c.height);
  g.fillStyle='#080a10'; g.fillRect(0,0,c.width,c.height);
  g.strokeStyle='#171b29'; g.lineWidth=1;
  const step=5*editor.scale, ox=(c.width/2+editor.panX)%step, oy=(c.height/2+editor.panY)%step;
  for(let x=ox; x<c.width; x+=step){ g.beginPath(); g.moveTo(x,0); g.lineTo(x,c.height); g.stroke(); }
  for(let y=oy; y<c.height; y+=step){ g.beginPath(); g.moveTo(0,y); g.lineTo(c.width,y); g.stroke(); }
  g.strokeStyle='#2b3144'; g.beginPath(); g.moveTo(c.width/2,0); g.lineTo(c.width/2,c.height); g.moveTo(0,c.height/2); g.lineTo(c.width,c.height/2); g.stroke();
  if(editor.links.length){
    for(const l of editor.links){
      const A=editorRoom(l.a), B=editorRoom(l.b); if(!A || !B) continue;
      const key=editorLinkKey(l.a,l.b), sel=key===editor.selectedLinkKey;
      drawEditorCorridor(g, editorLinkRoute(l,A,B), sel ? '#e8973f' : '#59d68f', linkWidth(l), sel);
    }
  }
  if(editor.connectFrom){
    const A=editorRoom(editor.connectFrom);
    if(A){ const a=editorWorldToCanvas(A.x,A.y); g.fillStyle='#59d68f'; g.beginPath(); g.arc(a.x,a.y,7,0,Math.PI*2); g.fill(); }
  }
  if(D){
    const crit = criticalRoomIds();
    for(const r of D.rooms){
      if(!crit.has(r.id)) continue;
      const p=editorWorldToCanvas(r.cx-D.W/2, r.cy-D.H/2);
      g.fillStyle='rgba(255,211,106,0.8)'; g.beginPath(); g.arc(p.x,p.y,3.5,0,Math.PI*2); g.fill();
    }
  }
  if(editor.selectedLinkKey){
    const link = editor.links.find(l=>editorLinkKey(l.a,l.b)===editor.selectedLinkKey);
    const handles = link ? linkHandles(link) : [];
    for(const h of handles){
      const p=editorWorldToCanvas(h.point.x,h.point.y);
      g.fillStyle=h.kind==='door' ? '#ffd36a' : '#e8973f';
      g.strokeStyle='#11141d'; g.lineWidth=2;
      g.beginPath(); g.arc(p.x,p.y,h.kind==='door'?6:5,0,Math.PI*2); g.fill(); g.stroke();
    }
  }
  for(const r of editor.rooms){
    const p=editorWorldToCanvas(r.x-r.w/2,r.y-r.h/2), w=r.w*editor.scale, h=r.h*editor.scale;
    const sel=r.id===editor.selectedId;
    const source = editor.rooms.indexOf(r);
    const floating = D && Array.isArray(D.disconnectedRooms) && D.disconnectedRooms.includes(source);
    const roleCol = r.roleHint==='secret' ? '#b86cff' : (r.roleHint==='entrance' ? '#3fd0bb' : (r.roleHint==='boss' ? '#d8433a' : null));
    g.fillStyle = floating ? 'rgba(184,108,255,0.20)' : (r.locked ? 'rgba(217,164,65,0.22)' : 'rgba(63,208,187,0.16)');
    g.strokeStyle = floating ? '#b86cff' : (sel ? '#e8973f' : (roleCol || (r.locked ? '#d9a441' : '#3fd0bb')));
    g.lineWidth = floating ? 2.5 : (sel ? 2 : 1);
    g.fillRect(p.x,p.y,w,h); g.strokeRect(p.x,p.y,w,h);
    g.fillStyle = roleCol || (floating ? '#d6b2ff' : (r.locked ? '#d9a441' : '#9aa0b4'));
    g.font='16px sans-serif';
    const label = (r.roleHint==='secret'?'密 ':r.roleHint==='entrance'?'入 ':r.roleHint==='boss'?'首 ':'') + (floating?'悬':(r.locked?'锁':'动'));
    g.fillText(label, p.x+7, p.y+19);
    if(sel){
      g.fillStyle='#e8973f';
      for(const [hx,hy] of [[p.x,p.y],[p.x+w,p.y],[p.x,p.y+h],[p.x+w,p.y+h]]) g.fillRect(hx-3,hy-3,6,6);
    }
  }
  if(editor.drag && editor.drag.mode==='draw' && editor.drag.draft){
    const r=editor.drag.draft, p=editorWorldToCanvas(r.x-r.w/2,r.y-r.h/2);
    g.strokeStyle='#e8973f'; g.setLineDash([5,4]); g.strokeRect(p.x,p.y,r.w*editor.scale,r.h*editor.scale); g.setLineDash([]);
  }
  const link = editor.selectedLinkKey ? editor.links.find(l=>editorLinkKey(l.a,l.b)===editor.selectedLinkKey) : null;
  const selected = editorRoom(editor.selectedId), si = selectedEditorIndex();
  const floatingCount = D && Array.isArray(D.disconnectedRooms) ? D.disconnectedRooms.length : 0;
  let status = editor.rooms.length + ' 区域 · ' + editor.links.length + ' 条路径';
  if(link) status = '已选路径 · ' + (link.manual?'手动':'生成') + ' · ' + (Array.isArray(link.bends)?link.bends.length:0) + ' 个转折点';
  if(selected) status = (selected.locked?'已选锁定':'已选可动') + ' · 区域#' + (si+1);
  if(floatingCount) status = '有 ' + floatingCount + ' 个悬浮区域 · 可作为密室';
  el.editorStatus.textContent = status;
  updateSceneSelection();
}
function toggleEditorCollapse(){
  const sec = document.querySelector('.editor-sec'); if(!sec) return;
  editor.collapsed = !editor.collapsed;
  sec.classList.toggle('collapsed', editor.collapsed);
  if(editor.collapsed){
    sec.style.width='44px';
    sec.style.height='44px';
    sec.style.maxHeight='44px';
  } else {
    sec.style.width=editor.panelWidth ? editor.panelWidth+'px' : '';
    sec.style.height=editor.panelHeight ? editor.panelHeight+'px' : '';
    sec.style.maxHeight=editor.panelHeight ? 'none' : '';
  }
  if(el.editorCollapse) el.editorCollapse.textContent = editor.collapsed ? '展开' : '折叠';
  if(!editor.collapsed) requestAnimationFrame(drawEditor);
}
function toggleEditorFullscreen(){
  const sec = document.querySelector('.editor-sec'); if(!sec) return;
  editor.full = !editor.full;
  sec.classList.toggle('full', editor.full);
  if(el.editorFullscreen) el.editorFullscreen.textContent = editor.full ? '退出全屏' : '全屏';
  requestAnimationFrame(drawEditor);
}
function startEditorResize(e){
  const sec=document.querySelector('.editor-sec');
  if(!sec || editor.collapsed || editor.full) return;
  e.preventDefault(); e.stopPropagation();
  const dir=e.currentTarget.dataset.editorResize || 'corner';
  const start={x:e.clientX, y:e.clientY, w:sec.getBoundingClientRect().width, h:sec.getBoundingClientRect().height};
  const onMove=ev=>{
    const maxW=Math.max(460, innerWidth-360), maxH=Math.max(420, innerHeight-32);
    let w=start.w, h=start.h;
    if(dir==='left' || dir==='corner') w=Math.max(460, Math.min(maxW, start.w - (ev.clientX-start.x)));
    if(dir==='bottom' || dir==='corner') h=Math.max(420, Math.min(maxH, start.h + (ev.clientY-start.y)));
    editor.panelWidth=w; editor.panelHeight=h;
    sec.style.width=w+'px'; sec.style.height=h+'px'; sec.style.maxHeight='none';
    drawEditor();
  };
  const onUp=()=>{ removeEventListener('pointermove', onMove); removeEventListener('pointerup', onUp); };
  addEventListener('pointermove', onMove);
  addEventListener('pointerup', onUp, {once:true});
}
addEventListener('resize', ()=>requestAnimationFrame(drawEditor));
function syncEditorFromDungeon(d, keepManual=false){
  if(!d || editor.rooms.length) return;
  editor.rooms = d.rooms.map((r,i)=>({ id:i+1, x:Math.round(r.cx-d.W/2), y:Math.round(r.cy-d.H/2),
    w:r.w, h:r.h, shape:r.shape, locked:false, roleHint:r.type===TYPE.ENTRANCE?'entrance':(r.type===TYPE.BOSS?'boss':null) }));
  if(!keepManual) editor.links = d.edges.map(e=>({a:e.a+1,b:e.b+1,bends:[],width:2,generated:true}));
  editor.nextId = editor.rooms.length + 1;
}
function syncEditorGeneratedRooms(d){
  if(!d) return;
  for(const r of d.rooms){
    const source = Number.isInteger(r.sourceId) ? r.sourceId : r.id;
    if(source < 0) continue;
    let er = editor.rooms[source];
    if(!er){
      er = { id:editor.nextId++, x:0, y:0, w:r.w, h:r.h, shape:r.shape, locked:false, roleHint:null };
      editor.rooms[source] = er;
    }
    er.x = Math.round(r.cx-d.W/2);
    er.y = Math.round(r.cy-d.H/2);
    er.w = r.w; er.h = r.h; er.shape = r.shape;
    if(r.type===TYPE.ENTRANCE && !editor.rooms.some(q=>q!==er && q && q.roleHint==='entrance')) er.roleHint = 'entrance';
    if(r.type===TYPE.BOSS && !editor.rooms.some(q=>q!==er && q && q.roleHint==='boss')) er.roleHint = 'boss';
  }
  editor.rooms = editor.rooms.filter(Boolean);
}
function syncEditorLinksFromDungeon(d){
  if(!d) return;
  const old = new Map(editor.links.map(l=>[editorLinkKey(l.a,l.b), l]));
  const blocked = new Set(editor.blockedLinks || []);
  const next = [];
  for(const e of d.edges){
    const A=d.rooms[e.a], B=d.rooms[e.b];
    const ai = Number.isInteger(A.sourceId) ? A.sourceId : e.a;
    const bi = Number.isInteger(B.sourceId) ? B.sourceId : e.b;
    const ea=editor.rooms[ai], eb=editor.rooms[bi];
    if(!ea || !eb) continue;
    const key=editorLinkKey(ea.id, eb.id);
    if(blocked.has(key)) continue;
    const prev=old.get(key);
    next.push(prev ? {...prev, a:ea.id, b:eb.id, generated:!prev.manual, width:linkWidth(prev)} : {a:ea.id, b:eb.id, bends:[], width:2, generated:true});
    old.delete(key);
  }
  for(const l of old.values()) if(l.manual && !blocked.has(editorLinkKey(l.a,l.b))) next.push(l);
  editor.links = next;
  if(editor.selectedLinkKey && !editor.links.some(l=>editorLinkKey(l.a,l.b)===editor.selectedLinkKey)) editor.selectedLinkKey=null;
}
function deleteSelectedEditorRoom(){
  if(editor.selectedId===null) return false;
  editor.links=editor.links.filter(l=>l.a!==editor.selectedId && l.b!==editor.selectedId);
  editor.rooms=editor.rooms.filter(r=>r.id!==editor.selectedId);
  editor.selectedId=null; editor.connectFrom=null; editor.selectedLinkKey=null;
  hideEditorMenu(); editorRequestForge();
  return true;
}
function hideEditorMenu(){ if(el.editorMenu){ el.editorMenu.classList.remove('on'); el.editorMenu._ctx=null; } }
function showEditorMenu(e, h){
  if(!el.editorMenu || !h) return;
  editor.selectedId = h.room.id;
  editor.selectedLinkKey = null;
  editor.tool = 'select';
  drawEditor();
  el.editorMenu._ctx={kind:'room', room:h.room};
  el.editorMenu.querySelectorAll('button').forEach(btn=>{ btn.style.display = btn.dataset.menu==='room' ? 'block' : 'none'; });
  el.editorMenu.style.left = Math.min(e.clientX, innerWidth - 170) + 'px';
  el.editorMenu.style.top = Math.min(e.clientY, innerHeight - 190) + 'px';
  el.editorMenu.classList.add('on');
}
function showEditorLinkMenu(e, kind, ctx){
  if(!el.editorMenu || !ctx || !ctx.link) return;
  editor.selectedId=null;
  editor.selectedLinkKey=editorLinkKey(ctx.link.a, ctx.link.b);
  editor.tool='select';
  drawEditor();
  el.editorMenu._ctx={kind, ...ctx};
  el.editorMenu.querySelectorAll('button').forEach(btn=>{
    const menu=btn.dataset.menu;
    btn.style.display = (menu===kind || (kind==='link' && menu==='link')) ? 'block' : 'none';
  });
  el.editorMenu.style.left = Math.min(e.clientX, innerWidth - 170) + 'px';
  el.editorMenu.style.top = Math.min(e.clientY, innerHeight - 190) + 'px';
  el.editorMenu.classList.add('on');
}
function showEditorBlankMenu(e, p){
  if(!el.editorMenu) return;
  editor.selectedId=null;
  editor.selectedLinkKey=null;
  editor.tool='select';
  drawEditor();
  el.editorMenu._ctx={kind:'blank', point:p};
  el.editorMenu.querySelectorAll('button').forEach(btn=>{ btn.style.display = btn.dataset.menu==='blank' ? 'block' : 'none'; });
  el.editorMenu.style.left = Math.min(e.clientX, innerWidth - 170) + 'px';
  el.editorMenu.style.top = Math.min(e.clientY, innerHeight - 90) + 'px';
  el.editorMenu.classList.add('on');
}
function setSelectedRole(role){
  const r = editorRoom(editor.selectedId); if(!r) return;
  if(role==='secret'){
    const makeSecret = r.roleHint!=='secret';
    r.roleHint = makeSecret ? 'secret' : null;
    if(makeSecret){
      if(!editor.secretRooms.includes(r.id)) editor.secretRooms.push(r.id);
      blockEditorRoomLinks(r.id);
    } else {
      editor.secretRooms = editor.secretRooms.filter(id=>id!==r.id);
      unblockEditorRoomLinks(r.id);
    }
    editor.selectedLinkKey=null;
    forgeFromEditor(false);
    return;
  }
  for(const q of editor.rooms) if(q.roleHint===role) q.roleHint=null;
  r.roleHint = r.roleHint===role ? null : role;
  editorRequestForge();
}
function initEditor(){
  if(!el.editorCanvas) return;
  if(el.editorCollapse) el.editorCollapse.addEventListener('click', toggleEditorCollapse);
  if(el.editorFullscreen) el.editorFullscreen.addEventListener('click', toggleEditorFullscreen);
  document.querySelectorAll('[data-editor-resize]').forEach(h=>h.addEventListener('pointerdown', startEditorResize));
  if(el.editorMenu){
    el.editorMenu.addEventListener('click', e=>{
      const action = e.target.dataset.action;
      if(!action) return;
      const ctx=el.editorMenu._ctx;
      if(action==='add-room'){
        const p=ctx && ctx.point;
        if(p){
          const r={id:editor.nextId++, x:editorSnap(p.x), y:editorSnap(p.y), w:12, h:9, shape:'rect', locked:false, roleHint:null};
          editor.rooms.push(r);
          editor.selectedId=r.id;
          editor.selectedLinkKey=null;
          hideEditorMenu();
          editorRequestForge();
        }
      }
      else if(action==='delete') deleteSelectedEditorRoom();
      else if(action==='lock'){ const r=editorRoom(editor.selectedId); if(r){ r.locked=!r.locked; hideEditorMenu(); editorRequestForge(); } }
      else if(action==='connect'){
        const r=ctx && ctx.room;
        if(r){
          if(editor.connectFrom && editor.connectFrom!==r.id){ toggleEditorLink(editor.connectFrom, r.id); editor.connectFrom=null; hideEditorMenu(); editorRequestForge(); }
          else { editor.connectFrom=r.id; editor.selectedId=r.id; hideEditorMenu(); drawEditor(); }
        }
      }
      else if(action==='entrance'){ hideEditorMenu(); setSelectedRole('entrance'); }
      else if(action==='boss'){ hideEditorMenu(); setSelectedRole('boss'); }
      else if(action==='secret'){ hideEditorMenu(); setSelectedRole('secret'); }
      else if(ctx && ctx.link && action==='add-bend'){
        if(!Array.isArray(ctx.link.bends)) ctx.link.bends=[];
        const i=Math.min(ctx.link.bends.length, Math.max(0, ctx.hit ? ctx.hit.seg : ctx.link.bends.length));
        ctx.link.bends.splice(i, 0, {x:editorSnap(ctx.hit.x), y:editorSnap(ctx.hit.y)});
        hideEditorMenu(); drawEditor(); forgeFromEditor(false);
      } else if(ctx && ctx.link && action==='reset-link'){
        ctx.link.bends=[]; ctx.link.doorA=null; ctx.link.doorB=null; hideEditorMenu(); drawEditor(); forgeFromEditor(false);
      } else if(ctx && ctx.link && action==='narrower'){
        ctx.link.width=Math.max(1, linkWidth(ctx.link)-1); hideEditorMenu(); drawEditor(); forgeFromEditor(false);
      } else if(ctx && ctx.link && action==='wider'){
        ctx.link.width=Math.min(6, linkWidth(ctx.link)+1); hideEditorMenu(); drawEditor(); forgeFromEditor(false);
      } else if(ctx && ctx.link && action==='delete-link'){
        blockEditorLink(ctx.link.a, ctx.link.b);
        editor.links=editor.links.filter(l=>l!==ctx.link);
        editor.selectedLinkKey=null;
        markDisconnectedRoomsAsSecret();
        hideEditorMenu(); forgeFromEditor(false);
      } else if(ctx && ctx.link && action==='delete-bend'){
        if(Array.isArray(ctx.link.bends)) ctx.link.bends.splice(ctx.bendIndex,1);
        hideEditorMenu(); drawEditor(); forgeFromEditor(false);
      } else if(ctx && ctx.link && action==='reset-door'){
        if(ctx.which==='a') ctx.link.doorA=null; else if(ctx.which==='b') ctx.link.doorB=null;
        hideEditorMenu(); drawEditor(); forgeFromEditor(false);
      }
    });
  }
  addEventListener('pointerdown', e=>{ if(el.editorMenu && !el.editorMenu.contains(e.target)) hideEditorMenu(); });
  addEventListener('keydown', e=>{
    const tag=e.target.tagName;
    if(tag==='INPUT' || tag==='TEXTAREA') return;
    if((e.code==='Delete' || e.code==='Backspace') && editor.selectedId!==null){ e.preventDefault(); deleteSelectedEditorRoom(); }
    else if((e.code==='Delete' || e.code==='Backspace') && editor.selectedLinkKey){
      const l=editor.links.find(q=>editorLinkKey(q.a,q.b)===editor.selectedLinkKey);
      if(l && Array.isArray(l.bends) && l.bends.length){ e.preventDefault(); l.bends=[]; drawEditor(); forgeFromEditor(false); }
    }
    if(e.code==='Escape') hideEditorMenu();
  });

  el.editorCanvas.addEventListener('wheel', e=>{
    e.preventDefault();
    const r = el.editorCanvas.getBoundingClientRect();
    const mx = (e.clientX-r.left)*(el.editorCanvas.width/r.width), my = (e.clientY-r.top)*(el.editorCanvas.height/r.height);
    const before = editorCanvasToWorld(mx, my);
    editor.scale = Math.max(2.5, Math.min(16, editor.scale*Math.exp(-e.deltaY*0.001)));
    editor.panX = mx - el.editorCanvas.width/2 - before.x*editor.scale;
    editor.panY = my - el.editorCanvas.height/2 - before.y*editor.scale;
    drawEditor();
  }, {passive:false});
  el.editorMenu._ctx = null;
  el.editorCanvas.addEventListener('contextmenu', e=>{
    e.preventDefault();
    const p=editorPointer(e);
    const handle=editorLinkHandleAt(p);
    const routeHit=editorLinkAt(p);
    const h=editorHit(p);
    if(handle){ showEditorLinkMenu(e, handle.kind, handle); return; }
    if(routeHit){ showEditorLinkMenu(e, 'link', {link:routeHit.link, hit:routeHit.hit}); return; }
    if(h) showEditorMenu(e,h); else showEditorBlankMenu(e,p);
  });
  el.editorCanvas.addEventListener('pointerdown', e=>{
    e.preventDefault(); el.editorCanvas.setPointerCapture(e.pointerId);
    if(e.button===2) return;
    if(e.button===1 || (e.button===0 && e.altKey)){
      editor.drag={mode:'pan', px:e.clientX, py:e.clientY, panX:editor.panX, panY:editor.panY};
      return;
    }
    const p=editorPointer(e);
    const handle = editorLinkHandleAt(p);
    if(handle){
      const l=handle.link, key=editorLinkKey(l.a,l.b);
      editor.selectedId=null; editor.selectedLinkKey=key;
      const skip={link:l, kind:handle.kind, which:handle.which, bendIndex:handle.bendIndex};
      if(handle.kind==='bend') editor.drag={mode:'routeBend', link:l, bendIndex:handle.bendIndex, skip};
      else editor.drag={mode:'routeDoor', link:l, which:handle.which, skip, startRoom:handle.which==='a'?l.a:l.b};
      drawEditor();
      return;
    }
    const routeHit = editorLinkAt(p);
    if(routeHit){
      const l=routeHit.link, key=editorLinkKey(l.a,l.b);
      editor.selectedId=null; editor.selectedLinkKey=key;
      const pts=ensureEditableRoute(l).map(q=>({x:q.x,y:q.y,side:q.side}));
      editor.drag={mode:'routeSegment', link:l, seg:routeHit.hit.seg, start:p, routeStart:pts};
      drawEditor();
      return;
    }
    const h=editorHit(p);
    if(!h){
      editor.selectedId = null;
      editor.selectedLinkKey = null;
      editor.drag=null;
      drawEditor();
    } else {
      editor.selectedId = h.room.id;
      editor.selectedLinkKey = null;
      editor.drag = {mode:h.mode || 'move', room:h.room, start:p, roomStart:{...h.room}};
      drawEditor();
    }
  });
  el.editorCanvas.addEventListener('pointermove', e=>{
    if(!editor.drag) return;
    e.preventDefault(); const p=editorPointer(e);
    if(editor.drag.mode==='pan'){ editor.panX = editor.drag.panX + e.clientX-editor.drag.px; editor.panY = editor.drag.panY + e.clientY-editor.drag.py; drawEditor(); return; }
    if(editor.drag.mode==='draw') editor.drag.draft=editorNormalizeRect(editor.drag.start,p);
    else if(editor.drag.mode==='routeBend'){
      const l=editor.drag.link, b=l && l.bends && l.bends[editor.drag.bendIndex];
      if(b){ const sp=snapEditorPoint(p, editor.drag.skip); b.x=sp.x; b.y=sp.y; updateRouteOverlay(); }
    }
    else if(editor.drag.mode==='routeDoor'){
      const l=editor.drag.link;
      const target=editorRoomAtPoint(p);
      const room=target || editorRoom(editor.drag.which==='a' ? l.a : l.b);
      if(room){
        const sp=target ? p : snapEditorPoint(p, editor.drag.skip);
        editor.drag.previewPoint = target ? {...doorSpecPoint(room, pointToDoorSpec(room, sp)), preview:true} : sp;
        if(!target){
          const spec=pointToDoorSpec(room, sp);
          if(editor.drag.which==='a') l.doorA=spec; else l.doorB=spec;
        }
        updateRouteOverlay();
      }
    }
    else if(editor.drag.mode==='routeSegment'){
      const l=editor.drag.link;
      moveLinkRouteSegment(l, editor.drag.seg, editor.drag.routeStart, {x:p.x-editor.drag.start.x, y:p.y-editor.drag.start.y});
      updateRouteOverlay();
    }
    else if(editor.drag.mode==='move'){
      const r=editor.drag.room, s=editor.drag.roomStart;
      r.x=editorSnap(s.x + p.x-editor.drag.start.x); r.y=editorSnap(s.y + p.y-editor.drag.start.y);
    } else editorResizeRoom(editor.drag.room, editor.drag.roomStart, p, editor.drag.mode);
    drawEditor();
  });
  const end = e=>{
    if(!editor.drag) return;
    if(editor.drag.mode==='pan'){ editor.drag=null; drawEditor(); return; }
    if(editor.drag.mode==='routeBend' || editor.drag.mode==='routeDoor' || editor.drag.mode==='routeSegment'){
      const l=editor.drag.link;
      if(editor.drag.mode==='routeDoor'){
        const p=editorPointer(e);
        const target=editorRoomAtPoint(p);
        const current=editor.drag.which==='a' ? l.a : l.b;
        if(target && target.id!==current) reassignLinkEndpoint(l, editor.drag.which, target, p);
      }
      if(editor.drag) editor.drag.previewPoint=null;
      if(l && Array.isArray(l.bends)){
        l.bends = l.bends.filter((b,i,a)=>i===0 || Math.hypot(b.x-a[i-1].x,b.y-a[i-1].y)>0.5);
      }
      editor.drag=null; drawEditor(); updateRouteOverlay(); forgeFromEditor(false); return;
    }
    if(editor.drag.mode==='draw' && editor.drag.draft){
      const r=editor.drag.draft;
      if(r.w>=5 && r.h>=5){ editor.rooms.push({id:editor.nextId++, ...r, shape:'rect', locked:false, roleHint:null}); editor.selectedId=editor.nextId-1; }
    }
    editor.drag=null; editorRequestForge();
  };
  el.editorCanvas.addEventListener('pointerup', end);
  el.editorCanvas.addEventListener('pointercancel', end);
  drawEditor();
}
initEditor();
function settleAll(){ for(const k in meshes) writeInstances(meshes[k], Infinity); }
function finishAnim(){
  animating = false; animT = Infinity;
  settleAll(); setOverlayStatic(); setStageDone();
}

/* -------- forge -------- */
function maybeAskSecretRooms(d){
  if(!d || !Array.isArray(d.disconnectedRooms) || !d.disconnectedRooms.length) return;
  const ids=d.disconnectedRooms.map(i=>editor.rooms[i] && editor.rooms[i].id).filter(Boolean);
  const fresh=ids.filter(id=>!editor.secretRooms.includes(id));
  if(!fresh.length) return;
  const ok=confirm('有 ' + fresh.length + ' 个区域已与主路径断开。是否作为密室/隐藏区域保留？\n\n确定：标记为密室候选。\n取消：清除路径删除限制并恢复自动连接。');
  if(ok){
    for(const id of fresh) markEditorRoomSecret(id);
    drawEditor();
  } else {
    editor.blockedLinks=[];
    editor.secretRooms=[];
    for(const r of editor.rooms) if(r.roleHint==='secret') r.roleHint=null;
    forgeFromEditor(false);
  }
}
function forge(animate, useEditorLayout=false){
  if(!useEditorLayout) resetEditorLayoutState();
  const seed = (parseInt(el.seed.value,10)||0)>>>0;
  const settingKey = resolveSetting(seed);
  const paletteKey = resolvePalette(seed, settingKey);
  if(useEditorLayout && editor.dirty) normalizeConnectedSecretRooms();
  const params = {
    seed,
    roomCount:+el.rooms.value,
    loopChance:+el.loops.value/100,
    decorDensity:+el.decor.value/100,
    settingKey,
    paletteKey,
    editorEnabled:useEditorLayout && editor.dirty,
    editorRooms:(useEditorLayout && editor.dirty) ? editor.rooms.map(r=>({...r})) : [],
    editorLinks:(useEditorLayout && editor.dirty) ? editor.links.map(l=>({...l})) : [],
    blockedLinks:(useEditorLayout && editor.dirty) ? [...editor.blockedLinks] : [],
    secretRooms:(useEditorLayout && editor.dirty) ? [...editor.secretRooms] : []
  };
  const d = generateDungeon(params);
  syncEditorGeneratedRooms(d);
  syncEditorLinksFromDungeon(d);
  buildScene(d);
  applyObjectVis();
  updateRouteOverlay();
  const TH = themeSpec(settingKey, paletteKey);
  el.vSetting.textContent = settingSel==='auto' ? '\u81ea\u52a8 \u00b7 '+TH.settingLabel : TH.settingLabel;
  el.vTheme.textContent = paletteSel==='auto' ? '\u81ea\u52a8 \u00b7 '+TH.paletteLabel : TH.paletteLabel;
  el.dname.textContent = d.name;
  const st = d.stats;
  el.dsub.innerHTML = '\u79cd\u5b50 ' + d.seed +
    ' \u00b7 <span style="color:var(--ember)">' + TH.label + '</span>' +
    ' \u00b7 \u7b2c ' + ((d.seed % 9) + 2) + ' \u5c42' +
    ' \u00b7 ' + (d.valid ? '<span class="ok">\u5df2\u8fde\u901a \u2713</span>' : '<span class="bad">\u6709\u60ac\u6d6e\u533a\u57df</span>') +
    (Array.isArray(d.disconnectedRooms) && d.disconnectedRooms.length ? ' \u00b7 \u5bc6\u5ba4\u5019\u9009 \u00d7' + d.disconnectedRooms.length : '') +
    (st.attempts > 1 ? ' \u00b7 \u91cd\u8bd5 \u00d7' + (st.attempts-1) : '');
  el.sRooms.textContent  = st.rooms;
  el.sEdges.textContent  = st.edges + ' \u00b7 ' + st.loops;
  el.sCrit.textContent   = st.critLen + ' \u6bb5';
  el.sTiles.textContent  = st.floorTiles;
  el.sLights.textContent = lights.length;
  el.sMs.textContent     = st.genMs.toFixed(1) + 'ms';
  applyHeat(el.tHeat.checked);
  drawEditor();
  maybeAskSecretRooms(d);
  if(animate && el.tAnim.checked){
    animating = true; animT = 0;
    for(const k in meshes) meshes[k].userData.settled = false;
    setFxRamp(0);
  } else finishAnim();
}

/* -------- live per-frame animation: flames, crystals, liquids, particles -------- */
function liveUpdate(time, tt){
  for(const key of ['flame','flameCore']){
    const fm = meshes[key];
    if(!fm || !fm.userData.set.n) continue;
    const fu = fm.userData, s = fu.set;
    for(let i=0;i<s.n;i++){
      const k = clamp01((tt - s.delay[i]) / fu.dur);
      const g = Math.max(0.0001, k>=1 ? 1 : easeOutBack(k)*Math.min(1,k*8));
      const fl = 0.86 + 0.22*Math.sin(time*11 + i*2.7)*Math.sin(time*5.3 + i*1.31);
      _q.set(0,0,0,1);
      _p.set(s.px[i], s.py[i] + 0.03*Math.sin(time*7 + i), s.pz[i]);
      _s.set(s.sx[i]*g*(0.92 + 0.12*Math.sin(time*13 + i*3.1)), s.sy[i]*g*fl, s.sz[i]*g);
      _m.compose(_p,_q,_s); fm.setMatrixAt(i,_m);
    }
    fm.instanceMatrix.needsUpdate = true;
  }
  const cm = meshes.crystal;
  if(cm && cm.userData.set.n){ const cu = cm.userData, s = cu.set;
    for(let i=0;i<s.n;i++){
      const k = clamp01((tt - s.delay[i]) / cu.dur);
      const g = Math.max(0.0001, k>=1 ? 1 : easeOutBack(k)*Math.min(1,k*8));
      _q.setFromAxisAngle(_Y, s.ry[i] + time*0.9);
      _p.set(s.px[i], s.py[i] + 0.08*Math.sin(time*2.1 + i*1.7), s.pz[i]);
      _s.set(s.sx[i]*g, s.sy[i]*g, s.sz[i]*g);
      _m.compose(_p,_q,_s); cm.setMatrixAt(i,_m);
    }
    cm.instanceMatrix.needsUpdate = true;
  }
  liquidMat.uniforms.uTime.value = time;
  partMat.uniforms.uTime.value = time;
  /* approximate device pixels per world unit at the target plane */
  const targetDist = Math.max(1, cam.position.distanceTo(camTarget));
  const viewH = 2 * targetDist * Math.tan(THREE.MathUtils.degToRad(cam.fov) * 0.5);
  partMat.uniforms.uZoom.value = renderer.domElement.height / viewH;
  for(const sp of fx.spinners) sp.m.rotation.y = time * sp.spd;
  for(const L of lights){
    const ramp = L.userData.ramp === undefined ? 1 : L.userData.ramp;
    L.intensity = L.userData.base * LIGHT_K * ramp * (0.84 + 0.22*Math.sin(time*9 + L.userData.ph)*Math.sin(time*4.7 + L.userData.ph*1.7));
  }
}

/* -------- main loop -------- */
const timer = new THREE.Timer();   // Clock is deprecated in modern three; Timer replaces it
let elapsed = 0;
let fpsFrames = 0, fpsTime = 0;
function tick(){
  /* RAF pauses entirely in occluded windows; keep a slow heartbeat so the
     build reveal and stats stay live when the tab is hidden */
  if(document.hidden) setTimeout(tick, 100);
  else requestAnimationFrame(tick);
  timer.update();
  const dt = Math.min(timer.getDelta(), 0.05);
  elapsed += dt;
  if(animating){
    animT += dt;
    applyReveal(animT);
    if(animT > animEnd + 0.35) finishAnim();
  }
  liveUpdate(elapsed, animating ? animT - 2.3 : Infinity);
  renderer.info.reset();
  renderFrame();
  fpsFrames++; fpsTime += dt;
  if(fpsTime >= 0.5){
    el.sFps.textContent = Math.round(fpsFrames/fpsTime);
    el.sCalls.textContent = renderer.info.render.calls;
    const tr = renderer.info.render.triangles;
    el.sTris.textContent = tr > 1e6 ? (tr/1e6).toFixed(2)+'M' : Math.round(tr/1e3)+'k';
    fpsFrames = 0; fpsTime = 0;
  }
}

/* -------- camera controls: drag pan, wheel zoom, shift-drag orbit -------- */
const cnv = renderer.domElement;
let dragging=false, orbiting=false, lastX=0, lastY=0, downX=0, downY=0;
cnv.addEventListener('pointerdown', e=>{
  orbiting = e.button===2 || (e.button===0 && e.shiftKey);
  dragging = e.button===0 && !e.shiftKey;
  lastX = e.clientX; lastY = e.clientY; downX = e.clientX; downY = e.clientY;
  cnv.setPointerCapture(e.pointerId);
});
cnv.addEventListener('pointermove', e=>{
  if(!dragging && !orbiting) return;
  const dx = e.clientX - lastX, dy = e.clientY - lastY;
  lastX = e.clientX; lastY = e.clientY;
  if(orbiting){
    yaw -= dx*0.005;
    pitch = Math.min(1.15, Math.max(0.32, pitch + dy*0.005));
  } else {
    const viewH = 2 * camDist * Math.tan(THREE.MathUtils.degToRad(cam.fov) * 0.5);
    const wpp = viewH / cnv.clientHeight;
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    camTarget.x += (-dx*fz - dy*fx)*wpp;
    camTarget.z += ( dx*fx - dy*fz)*wpp;
  }
  updateCam();
});
const endDrag = e=>{
  const wasDragging = dragging, wasOrbiting = orbiting;
  dragging=false; orbiting=false;
  if(!wasDragging || wasOrbiting) return;
  if(Math.hypot(e.clientX-downX, e.clientY-downY) <= 4) selectRoomFromScene(e.clientX, e.clientY);
};
cnv.addEventListener('pointerup', endDrag);
cnv.addEventListener('pointercancel', endDrag);
cnv.addEventListener('contextmenu', e=>e.preventDefault());
cnv.addEventListener('wheel', e=>{
  e.preventDefault();
  camDist = Math.min(360, Math.max(45, camDist*Math.exp(e.deltaY*0.0012)));
  updateCam();
}, {passive:false});

/* -------- UI wiring -------- */
let deb = null;
const sliderRegen = ()=>{ clearTimeout(deb); deb = setTimeout(()=>forge(false), 220); };
el.rooms.addEventListener('input', ()=>{ el.vRooms.textContent = el.rooms.value; sliderRegen(); });
el.loops.addEventListener('input', ()=>{ el.vLoops.textContent = el.loops.value + '%'; sliderRegen(); });
el.decor.addEventListener('input', ()=>{ el.vDecor.textContent = el.decor.value + '%'; sliderRegen(); });
el.seed.addEventListener('change', ()=>forge(true));
el.dice.addEventListener('click', ()=>{ el.seed.value = 1 + Math.floor(Math.random()*999999); forge(true); });
el.forge.addEventListener('click', ()=>forge(true));
el.tGraph.addEventListener('change', ()=>{ if(!animating) setOverlayStatic(); });
el.tHeat.addEventListener('change', ()=>applyHeat(el.tHeat.checked));
el.tPost.addEventListener('change', ()=>{ POST.enabled = el.tPost.checked; });
document.querySelectorAll('#settingChips .chip').forEach(ch=>{
  ch.addEventListener('click', ()=>{ setSettingSel(ch.dataset.s); forge(true); });
});
document.querySelectorAll('#paletteChips .chip').forEach(ch=>{
  ch.addEventListener('click', ()=>{ setPaletteSel(ch.dataset.p); forge(true); });
});
document.querySelectorAll('#objchips .chip').forEach(ch=>{
  ch.addEventListener('click', ()=>{
    const cat = ch.dataset.o;
    objVis[cat] = !objVis[cat];
    ch.classList.toggle('on', objVis[cat]);
    ch.setAttribute('aria-pressed', objVis[cat]);
    applyObjectVis();   // no reforge needed — just flip visibility on the live scene
  });
});
document.getElementById('collapse').addEventListener('click', e=>{
  const p = document.getElementById('panel');
  p.classList.toggle('min');
  e.target.textContent = p.classList.contains('min') ? '+' : '\u2013';
});

addEventListener('keydown', e=>{
  const tag = e.target.tagName;
  if(tag==='BUTTON') return;
  if(tag==='INPUT' && e.target.type!=='range' && e.target.type!=='checkbox') return;
  if(e.code==='KeyR'){ el.seed.value = 1 + Math.floor(Math.random()*999999); forge(true); }
  else if(e.code==='KeyG'){ el.tGraph.checked = !el.tGraph.checked; if(!animating) setOverlayStatic(); }
  else if(e.code==='KeyH'){ el.tHeat.checked = !el.tHeat.checked; applyHeat(el.tHeat.checked); }
  else if(e.code==='KeyT'){
    if(e.shiftKey){
      const order = ['auto'].concat(SETTING_KEYS);
      setSettingSel(order[(order.indexOf(settingSel)+1) % order.length]);
    } else {
      const order = ['auto'].concat(PALETTE_KEYS);
      setPaletteSel(order[(order.indexOf(paletteSel)+1) % order.length]);
    }
    forge(true);
  }
  else if(e.code==='KeyP'){ el.tPost.checked = !el.tPost.checked; POST.enabled = el.tPost.checked; }
  else if(e.code==='Space'){ e.preventDefault(); if(animating) finishAnim(); }
});

addEventListener('resize', ()=>{
  aspect = innerWidth/innerHeight;
  cam.aspect = aspect;
  cam.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  drawEditor();
});

/* -------- go -------- */
forge(true);
syncEditorFromDungeon(D);
tick();
