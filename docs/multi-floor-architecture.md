# 多层地下城生成与编辑架构方案

> 文档状态：设计提案  
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

## 2. 当前实现审计

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

垂直连接器独立保存：

```js
const connector = {
  id,
  edgeId,
  kind: 'stairs',

  fromFloor,
  toFloor,
  lower: { x, y },
  upper: { x, y },

  direction: 'east',
  width: 2,
  length: 12,
  lowerRoute: [],
  upperRoute: []
};
```

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

## 8. 跨层连接器

### 8.1 不允许任意垂直移动

错误做法是让 A* 在任意格子拥有以下邻居：

```js
{ floor: floor + 1, x, y }
```

这会让算法在任何方便的位置凭空上下楼。

正确做法是先计算有限数量的合法楼梯候选，A* 和 BFS 只能通过这些候选跨层。

### 8.2 楼梯候选约束

候选位置必须满足：

- 上下层都有定向落脚平台，走廊接入平台而不是直接接入踏步。
- 不穿过其他房间。
- 整个梯段在上层拥有连续楼板洞口和净空体积。
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

推荐交互：

1. 用户在当前层选择起始房间或落点。
2. 切换到相邻层。
3. 选择目标房间或落点。
4. 系统计算并显示楼梯占地预览。
5. 合法时创建连接器。
6. 非法时高亮冲突格子并给出原因。

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
所有楼梯上下端必须可达
不得出现跨越两层以上的普通楼梯
```

### 16.3 编辑器测试

```text
添加楼层
删除空楼层
删除非空楼层
房间移动到相邻层
房间移动后边类型转换
创建与删除楼梯
撤销和重做
保存后重载
```

### 16.4 渲染测试

```text
单层模式与当前视觉兼容
当前层显示正确
幽灵层不阻挡操作
全部楼层高度正确
楼梯与上下楼板对齐
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
