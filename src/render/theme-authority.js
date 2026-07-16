const PROFILES=Object.freeze({
  dungeon:Object.freeze({
    id:'subterranean-palace',sceneKit:'dungeon',silhouette:'monumental-masonry',
    paletteKeys:Object.freeze(['ancient','molten','frost','grim','verdant']),defaultPalette:'ancient',
    weight:1,shapeWeight:1,materialWeight:.94,decorWeight:1.25,lightWeight:.82,
    wallHeight:2.25,wallVariation:.18,capScale:1.08,fallback:false
  }),
  hospital:Object.freeze({
    id:'clinical-facility',sceneKit:'hospital',silhouette:'modular-clinical',
    paletteKeys:Object.freeze(['sterile','abandoned','emergency']),defaultPalette:'sterile',
    weight:1,shapeWeight:1,materialWeight:.96,decorWeight:1.3,lightWeight:.9,
    wallHeight:2.45,wallVariation:.035,capScale:1,fallback:false
  }),
  industrial:Object.freeze({
    id:'industrial-facility',sceneKit:'dungeon',silhouette:'reinforced-industrial',
    paletteKeys:Object.freeze(['frost','grim','sterile','emergency']),defaultPalette:'frost',
    weight:.92,shapeWeight:.88,materialWeight:.94,decorWeight:1.12,lightWeight:.86,
    wallHeight:2.3,wallVariation:.08,capScale:1.03,fallback:false
  }),
  timber:Object.freeze({
    id:'timber-structure',sceneKit:'dungeon',silhouette:'framed-timber',
    paletteKeys:Object.freeze(['ancient','grim','verdant']),defaultPalette:'ancient',
    weight:.92,shapeWeight:.88,materialWeight:.9,decorWeight:1.16,lightWeight:.8,
    wallHeight:2.2,wallVariation:.12,capScale:1.06,fallback:false
  }),
  neutral:Object.freeze({
    id:'neutral-fallback',sceneKit:'dungeon',silhouette:'neutral-structural',
    paletteKeys:Object.freeze(['ancient','molten','frost','grim','verdant','sterile','abandoned','emergency']),defaultPalette:'ancient',
    weight:.55,shapeWeight:.5,materialWeight:.72,decorWeight:1,lightWeight:.72,
    wallHeight:2.2,wallVariation:.12,capScale:1.04,fallback:true
  })
});

const CUSTOM_ARCHETYPES=Object.freeze([
  ['hospital',/(医院|医疗|诊所|实验室|无菌|洁净|hospital|medical|clinic|laboratory|sterile|clean)/i],
  ['industrial',/(工业|工厂|机械|机甲|金属|钢铁|管道|蒸汽|赛博|科幻|太空|深海|潜艇|industrial|factory|mechanical|metal|steel|pipe|steam|cyber|sci[- ]?fi|spaceship|submarine)/i],
  ['timber',/(木屋|木质|森林|树屋|矿井|栈道|wood|wooden|timber|forest|treehouse|mine)/i],
  ['dungeon',/(遗迹|废墟|石|古代|神庙|城堡|地宫|地下宫殿|中世纪|ruin|stone|ancient|temple|castle|dungeon|medieval|underground palace)/i]
]);

function cloneProfile(profile,key,source){
  return {...profile,key,source,paletteKeys:[...profile.paletteKeys]};
}

export function inferThemeArchetype(setting={}){
  if(setting.kit==='dungeon' || setting.kit==='hospital') return setting.kit;
  const source=[setting.label,setting.prompt,setting.themePrompt,setting.settingLabel].filter(Boolean).join(' ');
  return CUSTOM_ARCHETYPES.find(([,pattern])=>pattern.test(source))?.[0] || 'neutral';
}

export function compileThemeAuthority(settingKey,setting={}){
  const key=settingKey==='dungeon' || settingKey==='hospital'
    ? settingKey
    : inferThemeArchetype(setting);
  return cloneProfile(PROFILES[key] || PROFILES.neutral,key,setting.kit==='custom'?'custom':'builtin');
}

export function resolveThemePaletteKey(authority,requested){
  const profile=authority || PROFILES.neutral;
  return profile.paletteKeys.includes(requested) ? requested : profile.defaultPalette;
}

export function themePaletteKeys(authority){
  return [...(authority?.paletteKeys || PROFILES.neutral.paletteKeys)];
}
