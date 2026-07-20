# 多层地下城生成与编辑架构方案

> 文档状态：已实施架构、强制规则与后续演进基线
> 适用项目：`threejs-procedural-dungeon`  
> 目标：在保留现有 Delaunay、MST、循环边、房间语义和 A* 走廊能力的基础上，实现可生成、可验证、可渲染、可交互编辑的真正多层地下城。

## 实施状态（2026-07-13）

第一版多层能力已经按本文档的核心架构落地：

- 已建立 `layers[]`，每层拥有独立的网格、房间索引、走廊、门洞、楼梯掩码、BFS 和装饰数据。
- 已将 A* 提取为可测试的逐层路由器，并修正低成本走廊导致启发函数高估的问题。
- 已实现关键路径驱动的楼层深度分带，自动生成边不会跳过楼层。
- 已在楼层分配后执行逐层压缩；同层保持安全间距，不同层允许俯视投影重叠。
- 已实现显式楼梯连接器、定向候选选址、两端 A* 接入，以及梯段、平台、净空和楼板洞口预留。
- 已实现三维 BFS，跨层移动只能发生在连接器端点。
- 已实现当前层、相邻层、全部层和分层视图；当前层使用完整主题渲染，相邻层使用幽灵结构渲染。
- 2D 编辑器已支持相邻层轮廓、楼梯 footprint、跨层连接选择、房间移层校验和安全删除楼层。
- 已加入 Node 自动化测试与 `npm run check`，覆盖单层兼容、确定性、A*、逐层压缩、楼梯空间契约和 100 组多层连通批测。

仍作为后续增强保留：锁钥访问区域隔离、完整撤销/重做历史、电梯与螺旋楼梯、按层独立主题和灯光预算。

## 1. 结论

本项目应采用以下多层架构：

```text
全局房间拓扑
    ↓
楼层分配
    ↓
每层独立二维栅格
    ↓
同层边：二维 A* 走廊
跨层边：显式楼梯连接器
    ↓
三维 BFS 连通验证
    ↓
按楼层分组渲染与编辑
```

第一版不采用“允许任意格子上下移动”的完整三维 A*。正确做法是让二维 A* 负责每层平面路径，只允许通过经过合法选址和空间检查的楼梯连接器跨层。这样能保证关卡结构可控，避免算法在任意位置凭空生成垂直通道。

## 2. 历史基线审计（实施前）

本节保留多层改造前的问题基线，用于解释后续架构决策；它不代表当前代码状态。当前实施情况以文首“实施状态”和对应自动化测试为准。

当前代码已经包含：

- `room.floor`
- `room.elevation`
- `floorCount`
- `editor.currentFloor`
- 楼层添加、删除、切换等基础 UI
- 编辑器按当前楼层过滤房间

但生成与渲染核心仍然是单层：

```js
grid     = new Uint8Array(W * H);
roomId   = new Int16Array(W * H);
corridor = new Uint8Array(W * H);
doorway  = new Uint8Array(W * H);
bfs      = new Int16Array(W * H);
```

当前主要缺口如下：

| 模块 | 当前行为 | 多层问题 |
| --- | --- | --- |
| 房间栅格化 | 所有房间写入同一张网格 | 不同楼层相同坐标会互相覆盖 |
| A* | 只搜索 `(x, y)` | 不知道当前楼层，也不识别楼梯 |
| 连通验证 | 单层四方向 BFS | 无法验证跨层可达性 |
| 装饰数据 | 多数记录只有 `x, y` | 不能确定装饰属于哪一层 |
| Three.js 渲染 | 地板和墙体都位于 `y = 0` | `room.elevation` 没有形成真实楼板 |
| 编辑器 | 隐藏非当前层房间和跨层边 | 用户无法看到或编辑楼梯关系 |
| 楼层状态 | 普通重新生成会重置编辑器状态 | `floorCount` 可能被恢复为 1 |

因此，继续只增加楼层字段不能形成真实多层。必须升级栅格、路径、验证、装饰、渲染和编辑器的数据契约。

## 3. 设计目标与系统不变量

完成后的系统必须始终满足：

1. 同一个种子与同一组参数产生完全相同的结果。
2. 每个房间属于且只属于一个楼层。
3. 每条拓扑边都存在真实可行走的空间实现。
4. 同层移动只能经过该层地板和走廊。
5. 跨层移动只能经过显式连接器。
6. 所有普通跨层边的楼层差必须等于 1。
7. 从入口出发可以到达所有非密室房间和 Boss。
8. 每个楼梯的上、下端都可以从对应楼层到达。
9. 编辑器中的楼层、房间、路径和楼梯必须与生成数据一致。
10. `floorCount = 1` 时，行为应与当前单层版本兼容。

## 4. 推荐数据模型

### 4.1 地牢根数据

```js
const dungeon = {
  seed,
  W,
  H,
  floorCount,
  floorHeight: 4,

  rooms,
  edges,
  connectors,
  layers,

  entrance,
  boss,
  valid,
  stats
};
```

### 4.2 每层独立数据

```js
const layer = {
  floor: 0,

  grid: new Uint8Array(W * H),
  roomId: new Int16Array(W * H).fill(-1),
  corridor: new Uint8Array(W * H),
  corridorOwner: new Int16Array(W * H).fill(-1),
  doorway: new Uint8Array(W * H),
  stairMask: new Uint8Array(W * H),
  bfs: new Int32Array(W * H).fill(-1),
  lakeMask: new Uint8Array(W * H),

  props: [],
  spawns: [],
  torches: [],
  pools: [],
  arches: []
};
```

每层继续使用当前二维索引：

```js
const idx2 = (x, y) => y * W + x;
```

只有全地牢验证需要三维索引：

```js
const idx3 = (floor, x, y) =>
  floor * W * H + y * W + x;
```

采用 `layers[]` 而不是在所有业务代码中直接操作一个巨型三维数组，有以下优势：

- 可以最大程度复用当前二维雕刻和装饰逻辑。
- 单层显示和隐藏更简单。
- 每层可以独立生成墙体、装饰和实例化网格。
- 后续允许不同楼层使用不同主题或局部参数。

### 4.3 房间数据

```js
const room = {
  id,
  sourceId,
  cx,
  cy,
  w,
  h,
  floor,
  type,
  depth,
  difficulty,
  degree,
  roleHint
};
```

不建议同时保存可变的 `elevation`。渲染时统一计算：

```js
const elevation = room.floor * dungeon.floorHeight;
```

这样可以避免 `floor` 与 `elevation` 不同步。

### 4.4 边与连接器

同层边：

```js
const edge = {
  id,
  a,
  b,
  kind: 'corridor',
  floor,
  route,
  carvedWidth,
  isLoop,
  isCritical,
  isManual
};
```

跨层边：

```js
const edge = {
  id,
  a,
  b,
  kind: 'stairs',
  connectorId,
  isLoop,
  isCritical,
  isManual
};
```

垂直连接器独立于拓扑边保存；拓扑边只通过 `connectorId` 引用它。完整字段、派生集合和职责边界统一见[第 8 章：楼梯系统](#8-楼梯系统跨层连接器)，此处不再维护第二份楼梯结构定义。

连接器必须是拓扑边的空间实现，而不是仅供渲染使用的装饰物。

### 4.5 装饰、出生点和灯光

所有空间数据必须包含楼层：

```js
const prop = {
  kind: 'chest',
  floor: 1,
  x: 20,
  y: 16,
  rot: 0,
  scale: 1,
  roomId: 7
};
```

走廊装饰的 `roomId` 可能为 `-1`，因此不能只依赖房间反推楼层。

## 5. 完整生成管线

推荐将当前 `tryGenerate()` 拆分为以下阶段：

```js
buildRoomGraph();
assignRoomSemantics();
assignFloors();
createLayerData();
rasterizeRoomsByFloor();
classifyEdges();
routeSameFloorEdges();
placeVerticalConnectors();
buildWallsByFloor();
validateDungeon3D();
decorateLayers();
```

完整顺序为：

```text
1. 散布房间
2. 房间分离
3. Delaunay 候选边
4. MST + 循环边
5. 入口、Boss、关键路径和房间语义
6. 房间楼层分配
7. 创建每层独立栅格
8. 按楼层栅格化房间
9. 边分类：同层走廊 / 跨层楼梯
10. 同层二维 A*
11. 跨层楼梯选址
12. 墙体、门洞和楼梯预留区
13. 三维 BFS 连通验证
14. 按层装饰
15. Three.js 场景构建
```

## 6. 楼层分配算法

### 6.1 不直接采用简单深度映射

当前逻辑近似为：

```js
room.floor = Math.floor(
  room.depth / maxDepth * floorCount
);
```

它可以作为初始值，但不能作为最终算法，因为可能产生：

- 相邻房间跨越两层以上。
- 大量普通边都变成楼梯。
- 某层只有一个房间或没有房间。
- 循环边导致频繁上下楼。
- 关键路径缺少足够的同层探索区间。

### 6.2 推荐：关键路径分段 + 分支继承

先将入口到 Boss 的关键路径分成连续区间：

```text
入口──A──B──C──D──E──Boss
 F0  F0 F0 F1 F1 F2  F2
```

关键路径每层目标数量：

```js
const criticalRoomsPerFloor =
  Math.ceil(criticalPath.length / floorCount);
```

然后处理非关键路径房间：

1. 默认继承其 BFS 父节点的楼层。
2. 当前层超过容量时，才考虑移动到相邻层。
3. 与父节点的楼层差不得超过 1。
4. 优先减少跨层边数量。
5. 保证每两个相邻楼层至少存在一个连接器。
6. 保证每层至少存在一个非楼梯房间。

### 6.3 优化评分

完成初始分层后，可以通过局部移动房间最小化：

```text
score =
  跨层边数量 × 20
  + 楼层容量偏差 × 4
  + 跨越多层的边数量 × 100
  + 空楼层数量 × 1000
```

最终必须满足：

```js
Math.abs(roomA.floor - roomB.floor) <= 1;
```

如果循环边仍跨越两层以上，应按以下顺序处理：

1. 尝试移动非关键房间到相邻层。
2. 删除该循环边。
3. 对手工强制边插入中间楼梯节点。

不能直接生成跨越多个楼层的普通楼梯。

### 6.4 第一版布局策略

当前实现先使用全局二维分离建立稳定拓扑，在楼层分配完成后再按层重新压缩布局。同层房间继续执行碰撞分离，不同层房间可以占用相同的俯视区域。Delaunay 在这一阶段只作为拓扑来源，不再假定压缩后的几何仍满足原三角剖分关系。

## 7. 同层 A* 走廊

现有 A* 应重构为显式接收楼层数据：

```js
routeAStar(layer, start, goal, options);
```

推荐成本：

| 格子类型 | 成本 |
| --- | ---: |
| 普通空格 | 1.00 |
| 已有兼容走廊 | 0.30 |
| 靠近目标门口 | 0.60 |
| 靠近墙边 | 0.90 |
| 端点房间内部 | 2.50 |
| 其他房间内部 | 25.00 |
| 楼梯预留区 | 禁止进入 |
| 越界 | 禁止进入 |

边的处理顺序必须稳定：

1. 关键路径上的 MST 边。
2. 其他 MST 边。
3. 循环边。
4. 编辑器手工边。

这样关键路径先占据可靠通道，后续边更容易复用已有走廊。

### 7.1 走廊复用的语义风险

走廊复用可能使两个拓扑上没有直接连接的区域，在栅格上意外连通。当前项目尚未实现钥匙与锁，但未来若加入访问控制，应使用：

```js
corridorOwner[cell] = accessRegionId;
```

只有访问区域兼容的走廊才能低成本复用，避免绕过锁门或秘密区域。

## 8. 楼梯系统（跨层连接器）

本章是楼梯的唯一规范入口。数据字段、选址、几何、洞口、防护、墙体、题材、照明、编辑和验收都以本章为准；数据模型、编辑器和测试章节只描述各自职责，不再复制楼梯规则。

### 8.1 数据契约与职责边界

拓扑边通过 `connectorId` 引用楼梯连接器。连接器保存所有跨层结构语义，生成器负责写入，编辑器通过领域规则修改，渲染器只消费，不得根据可见网格重新猜测尺寸或墙体。

```js
const connector = {
  id,
  edgeId,
  kind: 'stairs',

  fromFloor,
  toFloor,
  lower: { x, y },
  turn: { x, y } | null,
  upper: { x, y },
  lowerApproach: { x, y },
  upperApproach: { x, y },
  lowerApproachGate: { x, y },
  upperApproachGate: { x, y },
  lowerApproachRouteCell: { x, y },
  upperApproachRouteCell: { x, y },
  lowerApproachCells: [],
  upperApproachCells: [],

  direction: 'east',
  directionVector: { x: 1, y: 0 },
  secondDirection: 'south',
  secondDirectionVector: { x: 0, y: 1 },
  style: 'straight' | 'l-turn',
  width: 2,
  lateralCenterOffset: 0.5,
  length: 12,
  firstRun: 6,
  secondRun: 6,
  rise: 4,
  landingDepth: 2,
  stepCount: 16,
  firstFlightSteps: 8,
  secondFlightSteps: 8,
  stepRise: 0.25,
  treadDepth: 0.5,
  sideClearance: 0,

  mode: 'stable-auto',
  candidateIndex: 0,
  candidateCount: 1,
  structureAdapted: false,
  structureAdaptationRoutes: [],
  openingPolicy: 'headroom-tight-upper-slab-only',
  requiredHeadroom: 2.5,

  stairFootprintCells: [],
  headroomCells: [],
  sweptClearanceCells: [
    { cell, treadElevation, clearanceTop, intersectsUpperSlab }
  ],
  openingCells: [],
  openingBoundaryEdges: [],
  openingAccessEdges: [],
  openingGuardSegments: [],
  openingWallSegments: [],

  stairwellBoundaryEdges: [],
  stairwellLowerAccessEdges: [],
  stairwellUpperAccessEdges: [],
  stairwellLowerWallSegments: [],
  stairwellUpperWallSegments: [],
  stairwellLowerGuardSegments: [],
  stairwellUpperGuardSegments: [],
  stairwellInteriorCells: [],
  sharedFootprintCells: [],
  sharedFootprintKind: 'rectangular-stairwell-pad',
  clearVolume: {
    floorFrom,
    floorTo,
    start: { x, y },
    end: { x, y },
    width: 2,
    height: 4
  },

  wallMode: 'open' | 'wall-backed' | 'enclosed',
  wallGeneration: 'existing-floor-wall-system',
  wallHeightPolicy: 'double-floor-lower-wall',

  lightingPolicy: 'required-themed',
  minimumLightCount: 2,
  lightingAnchors: [],

  lowerRoute: [],
  upperRoute: [],
  lowerRouteCells: [],
  upperRouteCells: []
};
```

| 层级 | 负责内容 | 不得负责 |
| --- | --- | --- |
| `StairContract` / 生成器 | 位置、方向、宽度、梯段、平台、净空、洞口、墙体语义、接入路线 | 题材造型和灯具外观 |
| 编辑器 | 创建、选择、移动、旋转、改宽、切换样式，并触发契约重算 | 直接改写渲染几何 |
| `StairAssetRecipe` / 渲染器 | 按契约装配题材踏步、扶手、材质和灯具 | 反向改变拓扑、净空或连通关系 |

### 8.2 选址与跨层路由

不允许让 A* 在任意格子直接获得垂直邻居：

错误做法是让 A* 在任意格子拥有以下邻居：

```js
{ floor: floor + 1, x, y }
```

这会让算法在任何方便的位置凭空上下楼。

正确做法是先计算有限数量的合法楼梯候选，A* 和 BFS 只能通过这些候选跨层。

候选位置必须满足：

- 上下层都有定向落脚平台，走廊接入平台而不是直接接入踏步。
- 不穿过其他房间。
- 整个梯段拥有连续净空体积；只有净空与上层楼板相交的高位部分形成楼板洞口。
- 楼梯方向有足够长度。
- 不与已有楼梯或预留区域冲突。
- 不堵塞房间唯一出口。
- 上下层都可以通过二维 A* 连接到目标房门。
- `toFloor - fromFloor === 1`。

候选评分：

```text
score =
  下层房门到楼梯的 A* 成本
  + 上层楼梯到房门的 A* 成本
  + 楼梯几何长度
  + 走廊与平台方向不一致惩罚
  - 已有走廊复用奖励
```

选择评分最低的合法候选。

### 8.3 第一版连接器形式

第一版推荐使用楼梯间：

```text
下层房间 → 下层走廊 → 下层楼梯平台
                         ⇅
上层房间 ← 上层走廊 ← 上层楼梯平台
```

连接器保存上下平台、方向、宽度、梯段长度、踏步数量、净空体积和洞口格集合。渲染器只消费该契约，不再重新猜测楼梯尺寸。

### 8.4 楼层与楼梯尺寸

当前墙体高度约为 2 个世界单位，建议第一版设置：

```js
floorHeight = 4;
stepRise = 0.25;
stepCount = floorHeight / stepRise; // 16
```

直楼梯大约需要：

```text
宽度：2～3 格
水平长度：8 格
踏步：16 级，每级水平进深 0.5、上升 0.25
```

如果空间不足，可以使用：

- 双跑楼梯
- 螺旋楼梯
- 电梯
- 传送井

第一版优先使用楼梯间或双跑楼梯，减少对长直线空间的依赖。

### 8.5 楼梯外轮廓规则（强制）

- 直梯和 L 型楼梯只允许改变楼梯井内部的踏步组织，楼梯井在平面上必须始终使用轴对齐矩形包络。
- 不允许墙体沿两段梯段的并集生成 L 型、T 型、锯齿或局部凸角，也不允许只为某一级踏步向外补一格房间。
- 自动选址先寻找不影响无关房间的完整矩形楼梯井；密集布局确实无解时，只允许为受影响房间增加绕开洞口的最短适配通道，不能清空整个包络。
- 矩形包络只用于候选校验、冲突预留和编辑器 footprint，不拥有地面或墙体写入权。只有踏步、平台、楼板洞口和必要接入路线可以修改格子；包络中的原墙体和空角必须保留。
- 楼梯接入走廊必须在候选阶段避开该楼梯即将生成的洞口，不能先穿过未来梯段再被楼梯覆盖。
- 上下端接入是硬方向插槽，不是路径评分偏好。`lowerApproachGate` 外侧的最后一步必须严格等于第一跑方向，`upperApproachGate` 向外的第一步必须严格等于末跑方向；路径不得从平台侧面进入。
- 两个 Gate 按楼梯完整宽度预留为 `lowerApproachCells / upperApproachCells`，并写入平台占用掩码。候选无法从指定方向接入时必须淘汰，禁止通过增加软惩罚保留错误朝向。
- L 型楼梯的中间平台只在外侧边缘保持连续栏杆；第一跑和第二跑的内侧栏杆必须延伸到平台内角并在同一点精确相接，禁止提前截短、跨过平台内部或堵塞转弯通道。
- 楼梯上下端不生成独立落脚板或延伸栏杆，首末级踏步直接衔接楼层地面；L 型楼梯只在转角生成一个必要平台，并与普通踏步使用同一材质。

#### 8.5.1 上层洞口与防护规则（强制）

楼梯占地、人物净空和楼板洞口必须是三个独立集合：

```text
stairFootprintCells：下层实际踏步占地
headroomCells：完整楼梯移动包络的平面投影
sweptClearanceCells：逐格记录踏步标高、净空顶部和是否穿过上层楼板
openingCells：真正切除的上层楼板格
```

紧凑洞口模式使用以下判定：

```text
zTread(s) < upperSlabUnderside
and
zTread(s) + requiredHeadroom > upperSlabUnderside
```

每个踏步格都必须先进入 `sweptClearanceCells`，再由 `intersectsUpperSlab` 推导 `openingCells`。这样低位踏步上方也保留可供天花、灯具和碰撞检查使用的三维净空数据。默认不得把完整梯段投影或矩形楼梯井包络直接作为洞口；完整挑空井必须是独立结构模式，不能由题材决定。

楼梯摆放使用固定的 `1m` 地砖卡尺。下端锚点、转角点和上端锚点必须吸附到整数格；自动生成、直接放置、移动、旋转和旧数据回写都必须经过同一吸附函数。偶数格宽楼梯允许中心线相对锚点偏移 `0.5m`，该偏移用于让楼梯两侧边缘贴合地砖边界，不代表楼梯脱离 `1m` 摆放网格。

洞口生成后提取四邻域边界，并按相邻上层格分类：

```text
沿末段楼梯前进方向连接上层平台 → openingAccessEdges，不生成扶手

沿末段楼梯反方向连接仍在净空包络内、但因严格 2.5m 判定而保留楼板的梯段格 → openingStairPassageEdges，不生成墙体或横向护栏
相邻格为墙体                         → openingWallSegments，由墙体负责防护
其余边（地面、虚空或越界）           → openingGuardSegments，必须生成扶手
```

因此除上层落脚入口和梯段净空入口外，每条洞口边必须严格由墙或扶手二选一覆盖，不能遗漏，也不能重叠归属；两个入口宽度内都不得出现横向栏杆。旋转、移动、改宽和切换直跑/L 型后必须重新计算全部边界归属。

楼梯间本身必须按一份跨层契约生成，不能由上下两层各自推断。`sharedFootprintCells` 只是防止其他连接器侵入的矩形预留区，不得整块转成可见楼梯间；真正清墙和生成外壳的是贴合直跑/L 型几何的 `stairwellInteriorCells`。外壳边界生成 `stairwellBoundaryEdges`，下层来向和上层去向分别保留入口。真实墙段只保留外侧结构脊墙；其余非入口边进入对应楼层的 `stairwellLowerGuardSegments / stairwellUpperGuardSegments`。最终验证要求每层每条非入口边严格属于真实墙或护栏之一，从而同时避免侧向闯入、漏防护和把楼梯包成完整盒子。

#### 8.5.2 转角平台宽度协同规则（强制）

楼梯宽度必须同时维护“连续视觉宽度”和“离散网格跨度”，两者不得混用：

```text
visualWidth = clamp(round(inputWidth / 0.25) * 0.25, 1, 5)
gridSpan    = ceil(visualWidth)
```

- 两段梯跑、L 型转角平台和栏杆边界统一使用 `visualWidth`；转角平台的视觉尺寸必须是 `visualWidth × visualWidth`。
- 楼梯占地、楼板洞口、净空、碰撞和路径避让统一使用 `gridSpan`，允许它比视觉几何保守，但不得反向扩大平台模型。
- 改宽时不得缩放梯跑纵深，不得改变踏步深度、梯段长度、踏步数量或坡度。
- `firstRun` 和 `secondRun` 只表示两段踏步的净长度，不能包含或穿过转角平台；第一跑终点是平台入口边中点，第二跑起点是平台出口边中点。
- 设第一跑入口边中点为 `entry`、两段单位方向为 `d1/d2`，则 `platformCenter = entry + d1 × visualWidth / 2`，`exit = platformCenter + d2 × visualWidth / 2`。第二跑必须从 `exit` 生成，平台内部不得生成踏步线、踏步网格或斜向连接段。
- 单侧拖拽宽度时，第一跑对侧边界保持不动；平台沿 `d1` 和 `d2` 同步扩展，第二跑及其上端连接点随 `exit` 的位移整体补偿。禁止只放大平台模型而保留第二跑原位。
- 二维编辑器、三维踏步、平台、栏杆、命中区域和房间适配必须共同消费上述 `entry / platformCenter / exit`，不得分别推算转角。
- 样式归一化、方向、宽度吸附、横向偏移、梯跑拆分和平台几何的唯一规则源是 `src/domain/stair-contract.js`；生成、编辑和渲染模块不得保存同名公式副本。
- 扶手中心线必须从同一组梯跑边界派生：两条外侧扶手沿平台外轮廓连续包角；两条内侧扶手取各自边线的交点作为共同端点。不得再按平台宽度添加额外缩短量，扶手梁自身厚度造成的中心线偏移必须由边线交点补偿。
- 该规则仅定义直跑和 L 型楼梯。U 型楼梯必须使用独立拓扑；标准返折平台的横向跨度为 `2 × visualWidth + stairWellGap`，不得套用 L 型方形平台公式。

### 8.6 楼梯间墙体规则（强制）

楼梯墙体属于跨层建筑契约，不得由渲染器临时使用简易方盒补齐。连接器使用以下语义：

```text
wallMode: open | wall-backed | enclosed
wallGeneration: existing-floor-wall-system
wallHeightPolicy: double-floor-lower-wall
```

- `open` 不生成楼梯墙，暴露的楼板洞口边交给护栏系统。
- `wall-backed` 只选择结构脊边外侧已经由房间墙体系统生成的真实墙单元，不新增边界薄墙。
- `enclosed` 的完整围护墙也必须先进入房间墙体拓扑，再由统一墙体系统生成；渲染阶段不得补简易墙片。
- 楼梯踏步边界、洞口护栏和楼梯墙是三套互斥语义，不能通过同一个“邻格不是地面”条件决定。
- L 型楼梯内凹转角、上下层入口和平台衔接边属于 `transition-open`。即使普通 `buildWalls` 发现其邻格是虚空，也必须禁止在这些位置补墙；只有外侧结构脊边可以保留真实墙单元。结构脊边不能只按朝向判定，还必须位于楼梯间预留外轮廓对应法线方向的最外沿；与外墙平行但处在 L 型凹口内部、两侧都连接梯段或平台的横向墙格必须清空，禁止切断转角平台的空间与视线。
- 梯段每一侧必须按真实墙段切分防护路径：两层高实体墙覆盖的区间禁止生成落地立柱、栏柱和护栏压顶；临空区间必须生成完整护栏；同一侧由墙转为临空时必须在归属变化点拆段，横杆不得伸进墙体。
- 墙侧允许由题材配方选择贴墙扶手。贴墙扶手必须向楼梯净空侧偏移并只使用墙面支架，不得复用落地立柱；地宫石墙默认由实体墙承担侧向防护，不额外叠加石栏杆，医院、工业、木构和中性配方可生成贴墙扶手。

楼梯连接器只能标记既有墙单元的高度策略。需要显示的楼梯墙必须继续使用普通墙单元原有的平面厚度、程序化几何、主题材质、单元色差和墙帽比例，不得沿楼梯边界创建独立薄墙、固定材质墙片或额外 `BoxGeometry`。

下层被楼梯契约选中的真实墙单元直接生成两层高：

```text
lowerStairWallHeight = floorHeight + generatedThemeWallHeight
generatedThemeWallHeight = themeWallHeight ± themeWallVariation
```

这里的“两层高”表示墙体从一层地面跨过层间标高，并与二层正常生成墙的顶部对齐，不是简单使用 `floorHeight × 2`。该墙只在最终顶部生成一次墙帽；层间标高不得出现水平墙帽、接缝或第二堵重叠墙。上层同坐标墙单元保留结构和碰撞语义，但视觉实例由下层跨层墙统一拥有。没有既有墙单元的位置保持开放，交由洞口护栏处理。

### 8.7 楼梯题材、材质与照明（强制）

题材是场景表现层的最高级规则，不是附加标签。题材先编译为 `ThemeAuthority`，并以高权重统一约束建筑轮廓、墙地结构、门框、楼梯、道具族、材质族和照明语言；色调只能在该题材允许的色板族内变化，不能覆盖或稀释题材。

```text
通用层：房间布局、连通、楼层、碰撞、安全尺寸
题材层：建筑家族、轮廓、部件语法、道具族、材质与照明
色调层：在题材允许的色板范围内调整颜色和环境变化
```

- 内置遗迹固定使用地宫/地下宫殿建筑家族，允许暖灰、熔岩、冰封、腐化和植被侵蚀等遗迹内部变体。
- 内置医院固定使用模块化临床建筑家族，允许冷白、废弃和警示状态等医院内部变体。
- 切换题材时，若当前色调不属于新题材的允许集合，必须自动切换到该题材默认色调，并在界面隐藏不兼容色调。
- 自定义题材优先从名称与提示词解析完整建筑家族；临床或地宫语义必须继承对应的整套场景模型，而不是只修改楼梯或颜色。无法解析的参考图仍可进入中性回退，但必须保留 `fallback` 状态，不能伪装成已经完成的专用题材。

楼梯采用“通用结构生成 + 题材程序化造型生成”的两阶段模型。题材不能拥有另一套楼梯布局算法，也不能只切换一个固定预制体；每座楼梯必须先完成通用空间契约，再由题材配方实时生成踏步表层、平台包边、扶手、立柱和标识等造型素材。

固定流水线为：

```text
通用 StairContract
→ 题材编译 StairAssetRecipe
→ 程序化部件建模
→ 按 StairContract 插槽装配
```

`StairContract` 是唯一的生成逻辑，负责楼梯是否成立；`StairAssetRecipe` 只描述楼梯长什么样。结构生成模块中禁止出现按 `dungeon / hospital / custom` 分支计算楼梯位置、平台尺寸、台阶数量或扶手路径的代码。

题材只影响表现，不得反向改变以下结构数据：

```text
上下楼层、锚点、方向、宽度、梯段长度、平台、洞口、净空和连通关系
```

楼梯样式解析顺序为：

```text
房间组局部样式
→ 楼层题材样式
→ 地牢全局题材样式
→ 中性安全回退样式
```

不允许因为题材缺少专用资源而静默套用另一个题材的楼梯。例如，自定义题材没有楼梯资源时，应使用继承当前色板的中性结构，并在编辑器或生成日志中标记为回退，而不能直接显示遗迹石楼梯。

每个题材先编译为结构化程序化造型配方。配方只能控制契约包络内的部件模型参数：

```js
const stairAssetRecipe = {
  procedural: true,
  affectsStructure: false,
  structure: 'stone' | 'concrete' | 'metal' | 'wood',
  tread: {
    profile,
    capHeight,
    nosingDepth,
    sideInset,
    irregularity
  },
  landing: {
    profile,
    borderWidth,
    borderHeight,
    accentBorder,
    centerPanel,
    centerInset,
    centerHeight
  },
  rail: {
    profile,
    style,
    infillStyle,
    infillHeight,
    infillThickness,
    height,
    thickness,
    postStyle,
    postThickness,
    postSpacing,
    capitalSize,
    capitalHeight,
    plinthSize,
    plinthHeight
  },
  marking: {
    enabled,
    width,
    inset,
    height
  },
  material: {
    body: { roughness, metalness },
    trim: { roughness, metalness },
    landing: { roughness, metalness },
    rail: { roughness, metalness },
    marking: { roughness, metalness }
  },
  colors: {
    body,
    trim,
    landing,
    rail,
    marking,
    themeAccent
  }
};
```

程序化建模器必须消费通用契约提供的部件插槽：踏步宽度与进深、平台中心与边界、左右扶手路径、立柱路径采样点。配方可以改变截面、倒角感、踏鼻、包边和表面不规则度，但所有结果必须裁剪在对应插槽的安全包络内。

#### 8.7.1 楼梯配色适配规则（强制）

楼梯不得保存独立于场景题材的固定颜色。所有楼梯颜色必须从当前色板的 `floor / corridor / wall / cap / accent` 派生为五个用途明确的角色色：

```text
body：踏步主体
trim：踏步表层、踏鼻和非警示平台包边
landing：转角平台
rail：扶手与立柱
marking：防滑条、警示平台包边
```

适配规则：

1. 切换题材或色调时，五个角色色必须同时重新计算，禁止保留上一个色板的扶手或警示条颜色。
2. 遗迹配色以石材层次为主；医院配色必须区分低金属度混凝土踏步与高金属度扶手；工业、木质和中性自定义配方使用各自的分部件材质参数。
3. `trim` 与 `body`、`rail` 与 `landing` 必须保留可辨识明暗层次；`marking` 与踏步主体必须满足最低视觉对比度。对比不足时只能在当前强调色基础上增亮或压暗，不得借用其他题材颜色。
4. 配色适配属于模型材质规则，不得通过修改全局灯光、雾或曝光来掩盖模型颜色问题。
5. 自定义题材即使进入中性造型回退，也必须继续继承当前选中的色板，不得回退成遗迹或医院固定色。

#### 8.7.2 楼梯照明规则（强制）

每个楼梯连接器必须使用 `lightingPolicy: required-themed`，并至少生成两个跨层 `lightingAnchors`；L 型楼梯默认在首段、转角平台和末段各布一个语义锚点。照明是通行结构的必需项，题材决定灯具资产、安装方式、色温和亮度。

| 题材 | `themeAsset` | 资产来源与安装方式 |
| --- | --- | --- |
| 地宫 / 遗迹 | `dungeon-torch` | 直接复用地宫走廊的火把、火焰和焰芯，安装在有效楼梯间墙段 |
| 医院 | `hospital-wall-light` | 直接复用医院走廊的临床壁灯，安装在有效楼梯间墙段 |
| 工业 | `industrial-cage-pendant` | 使用工业题材配方的笼式吊灯，悬挂在楼梯上方空间 |
| 木构 | `timber-lantern-sconce` | 使用木构题材配方的灯笼壁灯，安装在有效楼梯间墙段 |
| 中性回退 | `neutral-sconce` | 使用继承当前色板的中性壁灯，并保留 `fallback` 记录 |

内置题材必须复用自己的场景灯具资产，不能只给通用灯具换色。任何灯具不得侵入踏步、平台、洞口入口及规定净空；题材切换时必须重新解析 `themeAsset`，但不得删除最低照明数量。

第一版题材映射规则：

| 题材 | 梯段与平台 | 扶手与侧边 | 灯光与细节 |
| --- | --- | --- | --- |
| 遗迹 | 地宫型厚重块石台阶、纪念性大踏步；平台保持整块石面，不生成中心方框 | 透空石栏杆、密排短石栏柱与连续石质压顶；禁止使用实体挡墙式扶手 | 积尘、碎石、低饱和石色与暖色局部强调 |
| 医院 | 规整混凝土或金属楼梯、清晰平台边界 | 连续金属扶手、规则立柱、靠墙侧可使用壁挂扶手 | 冷白灯、警示条、防滑边、轻度污损 |
| 自定义题材 | 根据题材提示词或参考图生成同级样式 | 必须从同一题材描述中解析扶手和侧边形式 | 使用当前题材色板与装饰语言；缺失时采用中性回退 |

几何与美术必须同时满足以下不变量：

1. 踏步、踢面和平台必须严格贴合连接器锚点与楼层高度。
2. 扶手必须沿对应梯段坡度生成，不能整段固定在顶层高度或半层高度。
3. 转角楼梯的两段扶手必须在平台标高连续衔接，不能穿过踏步或悬空。
4. 扶手、立柱、侧板和装饰不得侵入楼梯有效通行宽度、平台净空和楼板洞口。
5. 修改楼梯宽度、样式或旋转后，题材模型必须重新适配，不能保留旧方向的扶手或装饰。
6. 2D 编辑器显示稳定的结构 footprint；3D 渲染器负责根据题材套件生成最终造型，两者不得各自猜测尺寸。
7. 题材随机细节必须使用由 `seed + connectorId + themeId` 派生的确定性随机流；更换美术资源不能改变拓扑与连通性。
8. 爆炸视图允许用半透明连接符代替实体题材楼梯；当前层、相邻层和全部层模式必须显示正确的题材楼梯。

渲染接口必须保持结构与表现分离：

```js
const contract = generateStairContract(input);
const recipe = compileStairAssetRecipe(theme, {
  seed,
  connectorId: contract.id
});
buildStairConnector(contract, generateStairAssets(contract, recipe));
```

内置遗迹采用“地宫石阶”配方：踏步是厚重块石，转角平台保持无中心框线的完整石面，两侧沿真实梯段生成透空短石栏柱、柱座、柱头和连续压顶。栏柱间必须保留清晰空隙，禁止用连续实体墙填满扶手中部。所有地宫造型仅消费通用楼梯契约的路径与宽度，不修改通行净宽、平台边界、楼层高度或交互缩放结果。

内置医院题材生成临床金属/混凝土造型。自定义题材的第一版通过中英文题材关键词解析工业、木质、临床和遗迹造型；仅有参考图且没有可解析文字时使用当前色板的中性程序化配方，不猜测图像语义。

连接器生成失败属于结构错误；题材资源缺失属于表现回退。两者必须分别报告，不能把美术资源缺失误判为楼梯冲突。

### 8.8 编辑与重算规则

编辑器直接操作楼梯连接器，不修改渲染模型。当前支持：创建与删除、整体移动、90° 按钮旋转、拖拽旋转手柄、直跑/L 型切换，以及拖拽 `↔` 手柄改宽。宽度范围为 1～5 米，按 1 米地砖卡尺吸附；单侧改宽时保持对侧边界不动。历史数据中的小数宽度和中心偏移在重算时归一到最近合法整米尺寸及对应地砖边界。

以下任何操作完成后，都必须从领域规则重新解析完整契约，不得只更新画面：

```text
创建 / 移动 / 旋转 / 改宽 / 切换样式
→ resolveStairStructure()
→ 重算 footprint、平台、净空和 openingCells
→ 重算洞口防护、楼梯间边界和墙体高度策略
→ 重算题材资产、扶手路径和 lightingAnchors
→ 重新验证上下层接入路线与三维连通性
```

编辑预览可以保留 `previewAnchor / previewDirection / previewWidth / previewStyle`，确认后必须写回稳定连接器字段；取消则恢复原契约。2D 编辑器只显示结构 footprint、方向、样式和宽度，3D 场景始终由确认后的连接器重新生成。

### 8.9 实现位置与验收入口

| 职责 | 当前实现 |
| --- | --- |
| 结构公式与归一化 | `src/domain/stair-contract.js` |
| 候选、占地、洞口、墙体语义与连通验证 | `src/generation/multifloor.js` |
| 编辑操作与几何变换 | `src/ui/stair-editing.js` |
| 题材造型配方与灯具映射 | `src/render/stair-assets.js` |
| 扶手路径和平台几何消费 | `src/render/stair-style.js` |
| 2D/3D 装配和场景集成 | `src/main.js` |

验收以一条完整链路为单位，不能只检查某个模型是否出现：

1. **结构**：上下端可达，楼层差为 1，踏步、平台、净空、洞口和接入路线互不冲突。
2. **建筑**：洞口入口无遮挡，暴露边有墙或护栏，跨层墙无重复墙帽、薄墙片或层间接缝。
3. **编辑**：移动、旋转、改宽和样式切换后，2D footprint 与 3D 几何一致，旧方向数据全部清除。
4. **题材**：踏步、扶手、材质和灯具属于同一题材；资源缺失时显式进入中性回退。
5. **确定性**：相同 `seed + connectorId + themeId` 产生相同楼梯，表现变化不改变拓扑。

对应自动化测试集中在 `tests/stair-contract.test.js`、`tests/stair-editing.test.js`、`tests/stair-style.test.js`、`tests/multifloor.test.js` 和 `tests/ui-contract.test.js`。全局房间可达性仍由第 9 章的三维 BFS 验证负责。

每次生成和每次楼梯编辑提交后必须对每个连接器运行逐楼梯验收，并输出 `stairAudits`。验收同时覆盖四类结果：上下落脚区及接入路线可通行；楼梯踏步体积和净空未被墙体侵入；所有非入口边严格由墙体或护栏二选一保护；下层楼板保持完整、上层只允许 `openingCells` 指定的净空洞口。未通过验收的楼梯不得向三维 BFS 注册跨层跳转；自动生成应换种子重试，编辑操作应拒绝并恢复上一个有效状态。界面在每次成功生成后显示“楼梯验收 n/n ✓”。

## 9. 三维连通验证

### 9.1 搜索状态

验证状态为：

```js
{ floor, x, y }
```

同层邻居：

```js
(floor, x - 1, y)
(floor, x + 1, y)
(floor, x, y - 1)
(floor, x, y + 1)
```

只有位于连接器端点时才增加：

```js
(floor + 1, upperX, upperY)
(floor - 1, lowerX, lowerY)
```

### 9.2 验证指标

至少验证：

```js
allRequiredRoomsReachable;
bossReachable;
allConnectorsReachable;
allFloorsReachable;
```

房间中心验证：

```js
for (const room of rooms) {
  const reachable = bfs3[
    idx3(room.floor, room.cx, room.cy)
  ] >= 0;
}
```

密室可以使用独立规则，不应被普通可达性检查误判为生成失败。

还必须检查：

- 每个跨层拓扑边都存在连接器。
- 每个同层拓扑边都有合法路线。
- 每个楼梯两端都可以到达。
- 不存在只有入口没有出口的楼梯。
- 每层至少有一个必要房间可达。

## 10. 随机性与确定性

当前代码主要依赖单个顺序随机流。多层改造会增加大量随机调用，如果继续共享一个流，修改装饰就可能改变房间楼层。

建议拆分确定性随机流：

```js
const topologyRng = makeRng(seed ^ HASH_TOPOLOGY);
const floorRng = makeRng(seed ^ HASH_FLOORS);
const routeRng = makeRng(seed ^ HASH_ROUTES);
const stairRng = makeRng(seed ^ HASH_STAIRS);
const decorRng = floor =>
  makeRng(seed ^ HASH_DECOR ^ floor);
```

这样可以保证：

- 调整装饰密度不会改变房间拓扑。
- 修改楼梯模型不会改变楼层分配。
- 增加某层装饰不会改变其他楼层。
- 同一 seed 的结构更稳定、更容易测试。

## 11. 装饰与语义

现有装饰逻辑应改为逐层执行：

```js
for (const layer of dungeon.layers) {
  const roomsOnFloor = rooms.filter(
    room => room.floor === layer.floor
  );

  decorateLayer(
    layer,
    roomsOnFloor,
    decorRng(layer.floor)
  );
}
```

水池、冰湖和墓地区域只能在所属楼层扩张，不能因为 `(x, y)` 相同而影响其他楼层。

灯光预算建议按楼层分配：

```js
floorLightBudget =
  totalLightBudget / visibleFloorCount;
```

只显示当前层时，可以临时启用当前层完整灯光预算。

## 12. Three.js 渲染架构

### 12.1 每层独立 Group

推荐结构：

```js
const floorGroups = layers.map(layer => ({
  root: new THREE.Group(),
  floorMesh: null,
  wallMesh: null,
  propMeshes: {},
  lights: [],
  effects: []
}));
```

每层设置统一高度：

```js
floorGroup.root.position.y =
  layer.floor * floorHeight;
```

不建议把所有楼层放入同一个 InstancedMesh，因为之后无法方便地隐藏单层。应当按“楼层 × 类型”建立 InstancedMesh。

### 12.2 显示模式

至少提供：

```text
当前层：仅显示正在编辑的楼层
相邻幽灵：当前层完整，相邻层半透明
全部楼层：显示完整立体结构
爆炸视图：临时扩大楼层间距
```

默认编辑模式建议使用“当前层 + 相邻幽灵”，防止上层楼板遮挡下层。

### 12.3 相机与叠加图

相机取景必须基于当前可见楼层的三维包围盒，而不是继续假定所有内容都在 `y = 0`。

结构叠加线的位置应为：

```js
new THREE.Vector3(
  worldX,
  room.floor * floorHeight + overlayOffset,
  worldZ
);
```

跨层边应显示为垂直或斜向线，并使用不同颜色区分楼梯连接。

## 13. 多层编辑器交互

### 13.1 推荐 UI

```text
[F1] [F2] [F3] [+]
显示：当前层 / 相邻幽灵 / 全部
工具：选择 / 房间 / 走廊 / 楼梯
```

当前层编辑视图：

- 当前层房间：正常显示。
- 相邻层房间：低透明度虚线。
- 同层走廊：绿色。
- 上楼连接：蓝色箭头与 `↑ F2`。
- 下楼连接：紫色箭头与 `↓ F1`。
- 非相邻层：默认隐藏。

### 13.2 楼梯工具

本节只定义多层编辑器入口；楼梯字段、几何和重算要求统一见[第 8.8 节](#88-编辑与重算规则)。用户从当前层房间或落点发起，在相邻层选择目标并确认占地预览；非法候选必须高亮冲突格并给出原因。选中已有楼梯后，界面提供移动、旋转、直跑/L 型、宽度和删除操作。

### 13.3 房间跨层移动

移动房间后必须重新分类与它相连的所有边：

```text
原同层边 → 可能变成楼梯边
原楼梯边 → 可能变成同层边
跨越两层 → 拒绝移动或插入中间节点
```

不能只修改 `room.floor` 而保留旧路线。

### 13.4 删除楼层

删除楼层属于破坏性操作，应提供：

```text
迁移所有房间到上一层
迁移所有房间到下一层
删除本层所有房间
取消
```

迁移后必须重新生成相关走廊、楼梯和连通性验证。

### 13.5 稳定 ID

房间、边和连接器必须使用稳定 ID，不能依赖数组下标作为长期身份。删除楼层或房间后不应导致其他实体 ID 改变。

## 14. 推荐代码拆分

共享领域规则：

```text
src/domain/stair-contract.js
```

该模块只包含无场景状态、无网格写入、无渲染依赖的纯规则。数据流固定为：

```text
StairSpec
→ resolveStairStructure()
→ 生成候选 / 网格契约 / 验证 / 编辑预览 / 三维渲染
```

`generation`、`ui` 和 `render` 可以依赖领域规则；领域规则不得反向依赖这三个模块。

生成器：

```text
src/generation/topology.js
src/generation/floors.js
src/generation/layers.js
src/generation/router.js
src/generation/connectors.js
src/generation/validation.js
src/generation/decoration.js
```

渲染器：

```text
src/render/build-floor.js
src/render/build-connectors.js
src/render/floor-visibility.js
src/render/camera-framing.js
```

编辑器：

```text
src/editor/floor-state.js
src/editor/draw-floor.js
src/editor/connectors.js
src/editor/floor-mutations.js
```

短期可以先在 `src/main.js` 中提取函数，确认行为稳定后再移动文件，避免一次性重构引入过多变量。

## 15. 分阶段实施计划

### 阶段 0：技术债清理

- 删除 A* 后不可到达的旧 L 型走廊代码。
- 将 A*、栅格索引和雕刻函数提取为独立纯函数。
- 为现有单层生成建立固定 seed 快照。

验收标准：现有单层结果和功能不变。

### 阶段 1：多层数据结构

- 建立 `layers[]`。
- 将 `grid`、`roomId`、`corridor`、`doorway`、`bfs` 改成逐层数据。
- props、spawns、lights 增加 `floor`。
- 渲染器暂时只显示第 0 层。

验收标准：`floorCount = 1` 时固定 seed 结果与改造前一致。

### 阶段 2：真实多层生成

- 实现关键路径分段与分支继承。
- 分类同层边和跨层边。
- 每层运行二维 A*。
- 实现楼梯间连接器。
- 实现三维 BFS 验证。

验收标准：1～6 层的所有必要房间和 Boss 均可从入口到达。

### 阶段 3：三维显示

- 每层建立独立 Group 和 InstancedMesh。
- 应用楼层高度。
- 构建楼梯模型。
- 增加当前层、相邻幽灵、全部楼层和爆炸视图。
- 相机按可见楼层重新取景。

验收标准：楼层坐标重叠时仍可独立查看，楼梯上下端与楼板严格对齐。

### 阶段 4：完整多层编辑器

- 增加楼层标签和显示模式。
- 增加楼梯工具。
- 显示跨层连接箭头。
- 实现安全的房间跨层移动。
- 实现安全删除楼层。
- 为楼层操作增加撤销与重做。

验收标准：编辑器修改、生成数据和 3D 显示可以完整往返同步。

### 阶段 5：高级能力

- 按层重新压缩房间布局。
- 完整三维 A*，但只允许在合法连接器候选处跨层。
- 锁门与访问区域隔离。
- 电梯、螺旋楼梯、传送井等连接器类型。
- 不同楼层主题和灯光预算。

## 16. 测试与验收矩阵

### 16.1 确定性测试

```text
相同 seed + 相同参数 → 完全相同拓扑、楼层、路线和连接器
改变装饰密度 → 拓扑和楼层不变
改变显示模式 → 生成数据不变
```

### 16.2 连通性测试

```text
1、2、3、4、6 层分别生成 100 个种子
入口到 Boss 必须可达
所有必要房间必须可达
所有楼梯通过第 8.9 节的结构验收
```

### 16.3 编辑器测试

```text
添加楼层
删除空楼层
删除非空楼层
房间移动到相邻层
房间移动后边类型转换
楼梯编辑通过第 8.8、8.9 节的操作与重算验收
撤销和重做
保存后重载
```

### 16.4 渲染测试

```text
单层模式与当前视觉兼容
当前层显示正确
幽灵层不阻挡操作
全部楼层高度正确
楼梯建筑、题材、材质与照明通过第 8.9 节验收
切换楼层后灯光和粒子正确隐藏
```

### 16.5 性能目标

建议目标：

```text
最多 6 层
总房间数 80
总可行走格子约 30,000
生成耗时桌面端低于 100 ms
三维验证低于 10 ms
场景保持单层版本相近的帧率
```

三维 BFS 的复杂度约为：

```text
O(floorCount × W × H + connectorCount)
```

对当前规模是可接受的。

## 17. 实施风险

### 高风险

- 单层数组迁移为 `layers[]` 会影响大量装饰和渲染代码。
- 走廊复用可能产生拓扑外的隐式连通。
- 楼梯选址失败可能导致整个种子重试。
- 房间跨层移动会改变相邻边类型。

### 中风险

- 多层实例化渲染增加 Draw Call。
- 上层楼板遮挡下层，需要显示模式配合。
- 当前编辑器部分逻辑依赖数组索引而非稳定 ID。

### 缓解措施

- 保证单层兼容测试先通过，再开启多层。
- 每个阶段都保留结构验证和失败重试。
- 楼梯选址准备电梯或传送井作为最后兜底。
- 按楼层建立实例化网格，控制 Draw Call 增长。
- 在多层编辑前完成稳定 ID 迁移。

## 18. 最终决策

项目的第一版真实多层应采用：

```text
全局 Delaunay + MST + 循环拓扑
+ 关键路径驱动的楼层分配
+ 每层独立二维栅格
+ 每层二维 A* 走廊
+ 显式楼梯间连接器
+ 三维 BFS 验证
+ 每层独立 Three.js Group
+ 当前层与幽灵层编辑模式
```

这套方案对现有代码侵入可控，可以保留当前生成器的确定性、房间语义、A* 复用和 2D 编辑能力，同时为后续完整三维 A*、锁门、电梯和分层主题留出清晰扩展点。
