const BASE_RECIPES = Object.freeze({
  dungeon: Object.freeze({
    id:'ruin-underground-palace', archetype:'subterranean-palace', structure:'stone',
    treadSource:'cap', landingSource:'floor', trimSource:'wall', railSource:'wall',
    tread:Object.freeze({profile:'palace-stone-block',capHeight:.085,nosingDepth:.08,sideInset:.02,irregularity:.16}),
    landing:Object.freeze({
      profile:'palace-open-landing',borderWidth:0,borderHeight:0,accentBorder:false,
      edgeFrame:false,centerPanel:false
    }),
    rail:Object.freeze({
      profile:'square',style:'stone-balustrade',infillStyle:'open-balusters',
      height:.8,thickness:.16,
      postStyle:'stone-baluster',postThickness:.14,postSpacing:.72,
      wallHandrail:false,wallHandrailInset:.2,wallBracketSpacing:1.4,
      capitalSize:.22,capitalHeight:.08,plinthSize:.2,plinthHeight:.08
    }),
    marking:Object.freeze({enabled:false,width:.085,inset:.05,height:.035}),
    lighting:Object.freeze({required:true,mount:'wall',fixture:'torch-sconce',themeAsset:'dungeon-torch',
      assetSource:'theme-prop-library',minimumFixtures:2,
      mountAboveTread:1.05,intensityScale:.82,distanceScale:1,flicker:.12,maxAnalyticLights:2}),
    material:Object.freeze({
      body:Object.freeze({roughness:.92,metalness:.01}),
      trim:Object.freeze({roughness:.88,metalness:.02}),
      landing:Object.freeze({roughness:.94,metalness:.01}),
      rail:Object.freeze({roughness:.86,metalness:.03}),
      marking:Object.freeze({roughness:.58,metalness:.08})
    }),
    fallback:false
  }),
  hospital: Object.freeze({
    id:'hospital-metal', archetype:'clinical', structure:'concrete',
    treadSource:'floor', landingSource:'corridor', trimSource:'cap', railSource:'cap',
    tread:Object.freeze({profile:'clean-nosing',capHeight:.035,nosingDepth:.035,sideInset:.035,irregularity:0}),
    landing:Object.freeze({profile:'warning-frame',borderWidth:.075,borderHeight:.025,accentBorder:true}),
    rail:Object.freeze({profile:'round',height:.92,thickness:.065,postThickness:.052,postSpacing:1.25,
      wallHandrail:true,wallHandrailInset:.18,wallBracketSpacing:1.25}),
    marking:Object.freeze({enabled:true,width:.085,inset:.055,height:.035}),
    lighting:Object.freeze({required:true,mount:'wall',fixture:'clinical-wall-light',themeAsset:'hospital-wall-light',
      assetSource:'theme-prop-library',minimumFixtures:2,
      mountAboveTread:1.18,intensityScale:.72,distanceScale:.9,flicker:0,maxAnalyticLights:2}),
    material:Object.freeze({
      body:Object.freeze({roughness:.76,metalness:.04}),
      trim:Object.freeze({roughness:.5,metalness:.26}),
      landing:Object.freeze({roughness:.72,metalness:.05}),
      rail:Object.freeze({roughness:.28,metalness:.78}),
      marking:Object.freeze({roughness:.42,metalness:.16})
    }),
    fallback:false
  }),
  industrial: Object.freeze({
    id:'custom-industrial', archetype:'industrial', structure:'metal',
    treadSource:'corridor', landingSource:'floor', trimSource:'cap', railSource:'cap',
    tread:Object.freeze({profile:'metal-plate',capHeight:.045,nosingDepth:.055,sideInset:.045,irregularity:.05}),
    landing:Object.freeze({profile:'reinforced-frame',borderWidth:.1,borderHeight:.04,accentBorder:true}),
    rail:Object.freeze({profile:'round',height:.88,thickness:.075,postThickness:.065,postSpacing:1.15,
      wallHandrail:true,wallHandrailInset:.18,wallBracketSpacing:1.15}),
    marking:Object.freeze({enabled:true,width:.07,inset:.045,height:.03}),
    lighting:Object.freeze({required:true,mount:'pendant',fixture:'cage-pendant',themeAsset:'industrial-cage-pendant',
      assetSource:'procedural-theme-kit',minimumFixtures:2,
      pendantHeight:1.32,intensityScale:.78,distanceScale:1,flicker:.025,maxAnalyticLights:2}),
    material:Object.freeze({
      body:Object.freeze({roughness:.58,metalness:.42}),
      trim:Object.freeze({roughness:.4,metalness:.72}),
      landing:Object.freeze({roughness:.6,metalness:.36}),
      rail:Object.freeze({roughness:.3,metalness:.82}),
      marking:Object.freeze({roughness:.44,metalness:.2})
    }),
    fallback:false
  }),
  timber: Object.freeze({
    id:'custom-timber', archetype:'timber', structure:'wood',
    treadSource:'cap', landingSource:'floor', trimSource:'wall', railSource:'wall',
    tread:Object.freeze({profile:'timber-board',capHeight:.065,nosingDepth:.065,sideInset:.055,irregularity:.14}),
    landing:Object.freeze({profile:'timber-frame',borderWidth:.09,borderHeight:.035,accentBorder:false}),
    rail:Object.freeze({profile:'square',height:.86,thickness:.095,postThickness:.085,postSpacing:1.35,
      wallHandrail:true,wallHandrailInset:.2,wallBracketSpacing:1.35}),
    marking:Object.freeze({enabled:false,width:.07,inset:.045,height:.03}),
    lighting:Object.freeze({required:true,mount:'wall',fixture:'lantern-sconce',themeAsset:'timber-lantern-sconce',
      assetSource:'procedural-theme-kit',minimumFixtures:2,
      mountAboveTread:1.08,intensityScale:.76,distanceScale:.9,flicker:.07,maxAnalyticLights:2}),
    material:Object.freeze({
      body:Object.freeze({roughness:.78,metalness:.02}),
      trim:Object.freeze({roughness:.72,metalness:.02}),
      landing:Object.freeze({roughness:.8,metalness:.01}),
      rail:Object.freeze({roughness:.7,metalness:.03}),
      marking:Object.freeze({roughness:.55,metalness:.08})
    }),
    fallback:false
  }),
  custom: Object.freeze({
    id:'custom-neutral', archetype:'neutral', structure:'neutral',
    treadSource:'corridor', landingSource:'floor', trimSource:'cap', railSource:'cap',
    tread:Object.freeze({profile:'neutral-panel',capHeight:.04,nosingDepth:.04,sideInset:.04,irregularity:.04}),
    landing:Object.freeze({profile:'simple-frame',borderWidth:.075,borderHeight:.03,accentBorder:false}),
    rail:Object.freeze({profile:'square',height:.86,thickness:.1,postThickness:.085,postSpacing:1.45,
      wallHandrail:true,wallHandrailInset:.19,wallBracketSpacing:1.45}),
    marking:Object.freeze({enabled:true,width:.075,inset:.05,height:.03}),
    lighting:Object.freeze({required:true,mount:'wall',fixture:'neutral-sconce',themeAsset:'neutral-sconce',
      assetSource:'procedural-theme-kit',minimumFixtures:2,
      mountAboveTread:1.05,intensityScale:.74,distanceScale:.9,flicker:0,maxAnalyticLights:2}),
    material:Object.freeze({
      body:Object.freeze({roughness:.7,metalness:.12}),
      trim:Object.freeze({roughness:.58,metalness:.24}),
      landing:Object.freeze({roughness:.72,metalness:.1}),
      rail:Object.freeze({roughness:.46,metalness:.42}),
      marking:Object.freeze({roughness:.46,metalness:.14})
    }),
    fallback:true
  })
});

const CUSTOM_ARCHETYPES = Object.freeze([
  ['industrial', /(工业|工厂|机械|机甲|金属|钢铁|管道|蒸汽|赛博|科幻|太空|深海|潜艇|industrial|factory|mechanical|metal|steel|pipe|steam|cyber|sci[- ]?fi|spaceship|submarine)/i],
  ['timber', /(木|木屋|木质|森林|树屋|矿井|栈道|wood|wooden|timber|forest|treehouse|mine)/i],
  ['hospital', /(医院|医疗|诊所|实验室|无菌|洁净|hospital|medical|clinic|laboratory|sterile|clean)/i],
  ['dungeon', /(遗迹|废墟|石|古代|神庙|城堡|地牢|中世纪|ruin|stone|ancient|temple|castle|dungeon|medieval)/i]
]);

function themedColor(theme, source, fallback) {
  const value=theme?.[source];
  if(Array.isArray(value)) return value[0] ?? fallback;
  return value ?? fallback;
}

function normalizeColor(value,fallback=0x7a7d84){
  if(Number.isFinite(Number(value))) return Number(value)&0xffffff;
  if(typeof value==='string'){
    const text=value.trim().replace(/^#/,'');
    if(/^[0-9a-f]{3}$/i.test(text)) return parseInt(text.split('').map(char=>char+char).join(''),16);
    if(/^[0-9a-f]{6}$/i.test(text)) return parseInt(text,16);
  }
  return fallback&0xffffff;
}

function colorChannels(color){
  const value=normalizeColor(color);
  return [(value>>16)&255,(value>>8)&255,value&255];
}

function channelsColor([r,g,b]){
  return (Math.round(Math.max(0,Math.min(255,r)))<<16)
    |(Math.round(Math.max(0,Math.min(255,g)))<<8)
    |Math.round(Math.max(0,Math.min(255,b)));
}

function mixColor(a,b,amount){
  const left=colorChannels(a),right=colorChannels(b),t=Math.max(0,Math.min(1,amount));
  return channelsColor(left.map((channel,index)=>channel+(right[index]-channel)*t));
}

function shadeColor(color,amount){
  return mixColor(color,amount>=0?0xffffff:0x000000,Math.abs(amount));
}

function relativeLuminance(color){
  const linear=colorChannels(color).map(channel=>{
    const value=channel/255;
    return value<=.04045 ? value/12.92 : ((value+.055)/1.055)**2.4;
  });
  return linear[0]*.2126+linear[1]*.7152+linear[2]*.0722;
}

export function stairColorContrast(a,b){
  const first=relativeLuminance(a),second=relativeLuminance(b);
  return (Math.max(first,second)+.05)/(Math.min(first,second)+.05);
}

function ensureContrast(color,against,minimum){
  const source=normalizeColor(color);
  if(stairColorContrast(source,against)>=minimum) return source;
  const sourceIsLighter=relativeLuminance(source)>=relativeLuminance(against);
  const amounts=sourceIsLighter
    ? [.12,.22,.38,.56,-.14,-.26,-.46,-.62]
    : [-.14,-.26,-.46,-.62,.12,.22,.38,.56];
  const candidates=amounts.map(amount=>shadeColor(source,amount)).concat([0xffffff,0x000000]);
  return candidates.find(candidate=>stairColorContrast(candidate,against)>=minimum)
    ?? candidates.reduce((best,candidate)=>
      stairColorContrast(candidate,against)>stairColorContrast(best,against)?candidate:best,source);
}

export function deriveStairPalette(theme={},recipeKey='custom'){
  const floor=normalizeColor(themedColor(theme,'floor',0x7a7d84));
  const corridor=normalizeColor(themedColor(theme,'corridor',floor));
  const wall=normalizeColor(themedColor(theme,'wall',0x626773));
  const cap=normalizeColor(themedColor(theme,'cap',wall));
  const accent=normalizeColor(theme.accent,0xe8973f);
  let body,trim,landing,rail;
  if(recipeKey==='dungeon'){
    body=mixColor(cap,floor,.42);
    trim=shadeColor(mixColor(cap,wall,.28),.08);
    landing=mixColor(floor,corridor,.28);
    rail=shadeColor(mixColor(wall,cap,.22),-.12);
  }else if(recipeKey==='hospital'){
    body=mixColor(floor,corridor,.34);
    trim=shadeColor(mixColor(cap,floor,.22),.12);
    landing=mixColor(corridor,floor,.46);
    rail=shadeColor(mixColor(cap,accent,.08),.2);
  }else if(recipeKey==='industrial'){
    body=shadeColor(mixColor(corridor,cap,.48),-.06);
    trim=shadeColor(mixColor(cap,accent,.08),.13);
    landing=mixColor(floor,corridor,.5);
    rail=shadeColor(mixColor(cap,accent,.14),.12);
  }else if(recipeKey==='timber'){
    body=mixColor(cap,floor,.3);
    trim=shadeColor(mixColor(wall,cap,.36),.1);
    landing=mixColor(floor,corridor,.3);
    rail=shadeColor(mixColor(wall,cap,.25),-.08);
  }else{
    body=mixColor(corridor,floor,.4);
    trim=shadeColor(mixColor(cap,body,.25),.1);
    landing=mixColor(floor,corridor,.48);
    rail=shadeColor(mixColor(cap,wall,.35),.08);
  }
  trim=ensureContrast(trim,body,1.16);
  rail=ensureContrast(rail,landing,1.35);
  const marking=ensureContrast(accent,body,2.4);
  return {body,trim,landing,rail,marking,themeAccent:accent};
}

function inferRecipeKey(theme){
  if(theme?.kit==='hospital') return 'hospital';
  if(theme?.kit!=='custom') return 'dungeon';
  const source=[theme.settingLabel,theme.label,theme.prompt,theme.themePrompt].filter(Boolean).join(' ');
  return CUSTOM_ARCHETYPES.find(([,pattern])=>pattern.test(source))?.[0] || 'custom';
}

function hashText(value){
  let hash=2166136261;
  for(const char of String(value ?? '')){
    hash^=char.codePointAt(0);
    hash=Math.imul(hash,16777619);
  }
  return hash>>>0;
}

export function stairAssetVariantSeed(seed=0, connectorId='', recipeId=''){
  return ((Number(seed)>>>0)^hashText(connectorId)^Math.imul(hashText(recipeId),0x9e3779b1))>>>0;
}

export function compileStairAssetRecipe(theme={}, {seed=0,connectorId=''}={}){
  const key=inferRecipeKey(theme);
  const base=BASE_RECIPES[key];
  const colors=deriveStairPalette(theme,key);
  const recipe={
    ...base,
    themeKit:theme.kit==='custom' ? 'custom' : key,
    recipeKey:key,
    procedural:true,
    affectsStructure:false,
    tread:{...base.tread},
    landing:{...base.landing},
    rail:{...base.rail},
    marking:{...base.marking},
    lighting:{...base.lighting},
    material:Object.fromEntries(Object.entries(base.material).map(([role,value])=>[role,{...value}])),
    colors,
    treadColor:colors.body,
    treadCapColor:colors.trim,
    landingColor:colors.landing,
    railColor:colors.rail,
    markingColor:colors.marking,
    accentColor:colors.marking,
    themeAccentColor:colors.themeAccent
  };
  const themeLight=Array.isArray(theme.torchLight)?theme.torchLight:[];
  recipe.lighting.color=normalizeColor(themeLight[0],colors.themeAccent);
  recipe.lighting.intensity=Math.max(.35,Number(themeLight[1])||1.2)*recipe.lighting.intensityScale;
  recipe.lighting.distance=Math.max(5,Number(themeLight[2])||8)*recipe.lighting.distanceScale;
  recipe.lighting.fixtureColor=colors.rail;
  recipe.variantSeed=stairAssetVariantSeed(seed,connectorId,recipe.id);
  // Flat compatibility fields keep the renderer-facing surface small while
  // the nested recipe remains the source of truth for procedural modelling.
  recipe.railProfile=recipe.rail.profile;
  recipe.railHeight=recipe.rail.height;
  recipe.railThickness=recipe.rail.thickness;
  recipe.postThickness=recipe.rail.postThickness;
  recipe.postSpacing=recipe.rail.postSpacing;
  recipe.roughness=recipe.material.body.roughness;
  recipe.metalness=recipe.material.body.metalness;
  recipe.edgeMarking=recipe.marking.enabled;
  return recipe;
}

export function resolveStairKit(theme={}, context={}){
  return compileStairAssetRecipe(theme,context);
}

function signedUnit(seed){
  let value=(seed+0x6D2B79F5)|0;
  value=Math.imul(value^(value>>>15),1|value);
  value^=value+Math.imul(value^(value>>>7),61|value);
  return (((value^(value>>>14))>>>0)/2147483647.5)-1;
}

export function stairTreadAssetPlan(recipe, index, width, depth){
  const tread=recipe?.tread || BASE_RECIPES.custom.tread;
  const safeWidth=Math.max(.1,Number(width)||1);
  const safeDepth=Math.max(.05,Number(depth)||.25);
  const irregularity=Math.max(0,Math.min(.5,Number(tread.irregularity)||0));
  const widthNoise=Math.abs(signedUnit((recipe?.variantSeed||0)^Math.imul(index+1,0x45d9f3b)));
  const offsetNoise=signedUnit((recipe?.variantSeed||0)^Math.imul(index+1,0x27d4eb2d));
  const sideInset=Math.min(safeWidth*.12,Math.max(0,Number(tread.sideInset)||0));
  const widthLoss=Math.min(safeWidth*.08,widthNoise*irregularity*safeWidth*.08);
  const capWidth=Math.max(.08,safeWidth-sideInset*2-widthLoss);
  const availableOffset=Math.max(0,(safeWidth-capWidth)/2);
  const nosingDepth=Math.min(safeDepth*.2,Math.max(0,Number(tread.nosingDepth)||0));
  return {
    profile:tread.profile,
    capWidth,
    capDepth:safeDepth+nosingDepth,
    capHeight:Math.min(.09,Math.max(.015,Number(tread.capHeight)||.035)),
    lateralOffset:offsetNoise*availableOffset*.72,
    alongOffset:nosingDepth/2,
    markingDepth:Math.min(safeDepth*.35,Math.max(.025,Number(recipe?.marking?.width)||.075)),
    markingSpan:capWidth*.9,
    markingInset:Math.min(safeDepth*.25,Math.max(.015,Number(recipe?.marking?.inset)||.05)),
    markingHeight:Math.min(.05,Math.max(.012,Number(recipe?.marking?.height)||.03))
  };
}
