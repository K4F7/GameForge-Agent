import type { GameSpec, RuntimeAssetEntry, RuntimeAssetRole } from "@gameforge/contracts";

export type SceneNode = {
  id: string;
  label: string;
  detail: string;
  depth: 0 | 1 | 2;
  state: "runtime" | "bound" | "fallback";
};

export type MapCellKind = "floor" | "player" | "collectible" | "hazard" | "goal" | "platform";

export type MapCell = {
  column: number;
  row: number;
  kind: MapCellKind;
};

export type MapView = {
  columns: number;
  rows: number;
  cells: ReadonlyArray<MapCell>;
  label: string;
};

const roleLabels: Record<RuntimeAssetRole, string> = {
  player: "玩家",
  collectible: "收集物",
  hazard: "危险物",
  background: "背景",
  "collect-sound": "收集音效",
  "hit-sound": "受击音效",
  voice: "引导配音",
  bgm: "背景音乐",
};

const gameplayRoles: ReadonlyArray<RuntimeAssetRole> = ["player", "collectible", "hazard", "background"];
const audioRoles: ReadonlyArray<RuntimeAssetRole> = ["collect-sound", "hit-sound", "voice", "bgm"];

function assetNode(role: RuntimeAssetRole, assets: ReadonlyArray<RuntimeAssetEntry>, depth: 1 | 2): SceneNode {
  const asset = assets.find((candidate) => candidate.role === role);
  return {
    id: `asset:${role}`,
    label: roleLabels[role],
    detail: asset === undefined ? "程序化/静音回退" : asset.assetId,
    depth,
    state: asset === undefined ? "fallback" : "bound",
  };
}

export function createSceneNodes(spec: GameSpec, assets: ReadonlyArray<RuntimeAssetEntry>): ReadonlyArray<SceneNode> {
  const gameplay = resolveGameplay(spec);
  return [
    { id: "scene", label: `${spec.title}Scene`, detail: spec.genre, depth: 0, state: "runtime" },
    { id: "world", label: "World", detail: "Phaser Scene", depth: 1, state: "runtime" },
    ...gameplayRoles.map((role) => assetNode(role, assets, 2)),
    { id: "systems", label: "Gameplay Systems", detail: `${spec.targetDurationSeconds}s · ${gameplay.collectibleCount} 目标 · ${gameplay.hazardCount} 危险 · ${gameplay.startingLives} 生命`, depth: 1, state: "runtime" },
    { id: "movement", label: "Movement", detail: `${gameplay.movementSpeed} px/s`, depth: 2, state: "runtime" },
    { id: "controls", label: "Controls", detail: spec.controls.join(" · "), depth: 2, state: "runtime" },
    { id: "win", label: "Win Condition", detail: spec.winCondition, depth: 2, state: "runtime" },
    { id: "lose", label: "Lose Condition", detail: spec.loseCondition, depth: 2, state: "runtime" },
    { id: "audio", label: "Audio", detail: "Runtime manifest", depth: 1, state: "runtime" },
    ...audioRoles.map((role) => assetNode(role, assets, 2)),
  ];
}

const anchors: Record<GameSpec["genre"], ReadonlyArray<readonly [number, number, MapCellKind]>> = {
  arcade: [[1, 4, "player"], [9, 2, "goal"]],
  platformer: [[1, 4, "player"], [2, 4, "platform"], [3, 4, "platform"], [4, 4, "platform"], [5, 4, "platform"], [6, 3, "platform"], [7, 3, "platform"], [9, 2, "goal"]],
  puzzle: [[1, 4, "player"], [9, 1, "goal"]],
  shooter: [[1, 2, "player"], [9, 2, "goal"]],
  strategy: [[1, 3, "player"], [9, 2, "goal"]],
};

const collectiblePositions: ReadonlyArray<readonly [number, number]> = [[3, 1], [5, 1], [7, 1], [3, 2], [5, 2], [7, 2], [2, 3], [4, 3], [6, 4], [8, 4]];
const hazardPositions: ReadonlyArray<readonly [number, number]> = [[4, 4], [6, 3], [8, 3], [4, 2], [6, 2], [8, 1]];

function resolveGameplay(spec: GameSpec): NonNullable<GameSpec["gameplay"]> {
  return spec.gameplay ?? {
    collectibleCount: spec.genre === "strategy" ? 6 : 5,
    hazardCount: spec.genre === "platformer" ? 2 : 3,
    startingLives: 3,
    movementSpeed: spec.genre === "strategy" ? 150 : spec.genre === "platformer" ? 210 : 220,
  };
}

export function createMapView(spec: GameSpec): MapView {
  const columns = 11;
  const rows = 6;
  const floor = Array.from({ length: columns * rows }, (_, index): MapCell => ({
    column: index % columns,
    row: Math.floor(index / columns),
    kind: "floor",
  }));
  const gameplay = resolveGameplay(spec);
  const layout = [
    ...anchors[spec.genre],
    ...collectiblePositions.slice(0, gameplay.collectibleCount).map(([column, row]) => [column, row, "collectible"] as const),
    ...hazardPositions.slice(0, gameplay.hazardCount).map(([column, row]) => [column, row, "hazard"] as const),
  ];
  const features = layout.map(([column, row, kind]): MapCell => ({ column, row, kind }));
  return { columns, rows, cells: [...floor, ...features], label: `${spec.genre} 模板布局` };
}
