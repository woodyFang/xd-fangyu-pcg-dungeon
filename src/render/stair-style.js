import {
  stairGridSpan,
  stairLateralCenterOffset,
  stairRunCenter,
  stairTurnPlatformMetrics
} from '../domain/stair-contract.js';

export {
  compileStairAssetRecipe,
  deriveStairPalette,
  resolveStairKit,
  stairAssetVariantSeed,
  stairColorContrast,
  stairTreadAssetPlan
} from './stair-assets.js';

export {
  stairGridSpan,
  stairLateralCenterOffset,
  stairRunCenter,
  stairTurnPlatformMetrics
} from '../domain/stair-contract.js';

function point3(point, y) {
  return { x: point.x, y, z: point.y };
}

function validRun(start, end) {
  return Math.hypot(end.x - start.x, end.z - start.z) > 0.01;
}

export function stairLandingCenterY(surfaceY, thickness = .16, lift = .01) {
  return surfaceY-thickness/2+lift;
}

export function stairRailRuns(connector, totalRise, lowerY = 0) {
  if (!connector?.lower || !connector?.upper) return [];
  const rise = Math.max(0, Number(totalRise) || 0);
  const runs = [];
  const centerRun=(start,end)=>{
    const dx=end.x-start.x,dz=end.z-start.z;
    const length=Math.max(.001,Math.hypot(dx,dz));
    const offset=stairLateralCenterOffset(connector.width,connector.lateralCenterOffset);
    const ox=-dz/length*offset,oz=dx/length*offset;
    return {
      start:{...start,x:start.x+ox,z:start.z+oz},
      end:{...end,x:end.x+ox,z:end.z+oz}
    };
  };
  const push = (kind, start, end, alreadyCentered = false) => {
    if(!validRun(start,end)) return;
    const centered=alreadyCentered ? {start,end} : centerRun(start,end);
    runs.push({kind,start:centered.start,end:centered.end});
  };
  if (connector.turn) {
    const steps = Math.max(1, connector.stepCount || 1);
    const firstSteps = Math.max(1, connector.firstFlightSteps || Math.floor(steps / 2));
    const turnY = lowerY + rise * firstSteps / steps;
    const platform=stairTurnPlatformMetrics(connector);
    push('first-flight', point3(platform.first.start, lowerY), point3(platform.entry, turnY), true);
    push('second-flight', point3(platform.exit, turnY), point3(platform.second.end, lowerY + rise), true);
  } else {
    push('flight', point3(connector.lower, lowerY), point3(connector.upper, lowerY + rise));
  }
  return runs;
}

function sideRailSegment(run, side, railOffset, trimStart = 0, trimEnd = 0, kind = run.kind) {
  const dx=run.end.x-run.start.x,dz=run.end.z-run.start.z;
  const horizontalLength=Math.max(.001,Math.hypot(dx,dz));
  const direction={x:dx/horizontalLength,z:dz/horizontalLength};
  const perpendicular={x:-direction.z,z:direction.x};
  const startT=Math.min(1,Math.max(0,trimStart/horizontalLength));
  const endT=Math.max(startT,Math.min(1,1-trimEnd/horizontalLength));
  const point=t=>({
    x:run.start.x+dx*t+perpendicular.x*railOffset*side,
    y:run.start.y+(run.end.y-run.start.y)*t,
    z:run.start.z+dz*t+perpendicular.z*railOffset*side
  });
  return {kind,side,start:point(startT),end:point(endT)};
}

export function stairRailSegments(connector, totalRise, lowerY = 0, railOffset = (connector?.width || 1)/2) {
  const runs=stairRailRuns(connector,totalRise,lowerY);
  if(!connector?.turn){
    return runs.flatMap(run=>[-1,1].map(side=>sideRailSegment(run,side,railOffset)));
  }
  const first=runs.find(run=>run.kind==='first-flight');
  const second=runs.find(run=>run.kind==='second-flight');
  if(!first || !second) return runs.flatMap(run=>[-1,1].map(side=>sideRailSegment(run,side,railOffset)));
  const d1=connector.directionVector || {x:1,y:0};
  const d2=connector.secondDirectionVector || {x:-d1.y,y:d1.x};
  const turnSign=Math.sign(d1.x*d2.y-d1.y*d2.x) || 1;
  const innerSide=turnSign;
  const outerSide=-innerSide;
  const platform=stairTurnPlatformMetrics(connector);
  const segments=[];
  for(const run of runs){
    if(run===first || run===second) continue;
    for(const side of [-1,1]) segments.push(sideRailSegment(run,side,railOffset));
  }
  const firstOuter=sideRailSegment(first,outerSide,railOffset,0,0,'first-flight-outer');
  const firstInner=sideRailSegment(first,innerSide,railOffset,0,0,'first-flight-inner');
  const secondOuter=sideRailSegment(second,outerSide,railOffset,0,0,'second-flight-outer');
  const secondInner=sideRailSegment(second,innerSide,railOffset,0,0,'second-flight-inner');
  // The inner rails terminate at the intersection of their two local edge
  // lines. This keeps both flight rails full length while leaving the landing
  // interior open. It also compensates for the rail beam being centered just
  // outside the tread edge, so the two beams meet without a visible gap.
  const firstInnerDirection={
    x:(first.end.x-first.start.x)/Math.max(.001,Math.hypot(first.end.x-first.start.x,first.end.z-first.start.z)),
    z:(first.end.z-first.start.z)/Math.max(.001,Math.hypot(first.end.x-first.start.x,first.end.z-first.start.z))
  };
  const secondInnerDirection={
    x:(second.end.x-second.start.x)/Math.max(.001,Math.hypot(second.end.x-second.start.x,second.end.z-second.start.z)),
    z:(second.end.z-second.start.z)/Math.max(.001,Math.hypot(second.end.x-second.start.x,second.end.z-second.start.z))
  };
  const cross=(a,b)=>a.x*b.z-a.z*b.x;
  const denominator=cross(firstInnerDirection,secondInnerDirection);
  if(Math.abs(denominator)>.001){
    const between={x:secondInner.start.x-firstInner.end.x,z:secondInner.start.z-firstInner.end.z};
    const distance=cross(between,secondInnerDirection)/denominator;
    const innerCorner={
      x:firstInner.end.x+firstInnerDirection.x*distance,
      y:first.end.y,
      z:firstInner.end.z+firstInnerDirection.z*distance
    };
    firstInner.end={...innerCorner};
    secondInner.start={...innerCorner};
  }
  segments.push(firstOuter,firstInner,secondOuter,secondInner);
  const firstDx=first.end.x-first.start.x,firstDz=first.end.z-first.start.z;
  const firstLength=Math.max(.001,Math.hypot(firstDx,firstDz));
  const firstDirection={x:firstDx/firstLength,z:firstDz/firstLength};
  const toSecond={x:secondOuter.start.x-firstOuter.end.x,z:secondOuter.start.z-firstOuter.end.z};
  const cornerDistance=toSecond.x*firstDirection.x+toSecond.z*firstDirection.z;
  const corner={
    x:firstOuter.end.x+firstDirection.x*cornerDistance,
    y:firstOuter.end.y,
    z:firstOuter.end.z+firstDirection.z*cornerDistance
  };
  segments.push(
    {kind:'turn-platform-outer-first',side:outerSide,start:{...firstOuter.end},end:corner},
    {kind:'turn-platform-outer-second',side:outerSide,start:corner,end:{...secondOuter.start}}
  );
  return segments;
}

export function railPostFractions(run, spacing = 1.4) {
  if (!run?.start || !run?.end) return [];
  const horizontalLength = Math.hypot(run.end.x - run.start.x, run.end.z - run.start.z);
  if (horizontalLength < 0.01) return [];
  const intervals = Math.max(1, Math.ceil(horizontalLength / Math.max(0.5, spacing)));
  return Array.from({ length: intervals + 1 }, (_, index) => index / intervals);
}
