export type SimulationResult = "running" | "won" | "lost";
export type SimulationEndReason = "orders-complete" | "time-expired" | "lives-depleted" | null;
export type SimulationPoint = Readonly<{ x: number; y: number }>;
export type SimulationEntity = Readonly<{ id: string; position: SimulationPoint }>;

export type OrderCollectSimulationConfig = Readonly<{
  randomSeed: number;
  durationSeconds: 75;
  startingLives: 3;
  collectibleCount: 6;
  hazardCount: 3;
  width?: number;
  height?: number;
}>;

export type OrderCollectTelemetry = Readonly<{
  schemaVersion: "1.0";
  mechanicProfile: "order-collect";
  randomSeed: number;
  elapsedMs: number;
  remainingMs: number;
  score: number;
  lives: number;
  order: Readonly<{ collected: number; total: number; remainingIds: readonly string[] }>;
  result: SimulationResult;
  endReason: SimulationEndReason;
  player: SimulationPoint;
  collectibles: readonly SimulationEntity[];
  hazards: readonly SimulationEntity[];
}>;

export type OrderCollectTelemetryComparison = Readonly<{
  matched: boolean;
  remainingMsDifference: number;
  differences: readonly string[];
}>;

const DEFAULT_WIDTH = 960;
const DEFAULT_HEIGHT = 540;

export class OrderCollectSimulation {
  readonly #config: Required<OrderCollectSimulationConfig>;
  #elapsedMs = 0;
  #score = 0;
  #lives: number;
  #result: SimulationResult = "running";
  #endReason: SimulationEndReason = null;
  #player: SimulationPoint;
  #collectibles: SimulationEntity[];
  #hazards: SimulationEntity[];

  constructor(config: OrderCollectSimulationConfig) {
    validateConfig(config);
    this.#config = {
      ...config,
      width: config.width ?? DEFAULT_WIDTH,
      height: config.height ?? DEFAULT_HEIGHT,
    };
    this.#lives = config.startingLives;
    this.#player = { x: this.#config.width / 2, y: this.#config.height * 0.72 };
    const random = mulberry32(config.randomSeed);
    this.#collectibles = createEntities("order", config.collectibleCount, random, this.#config.width, this.#config.height);
    this.#hazards = createEntities("hazard", config.hazardCount, random, this.#config.width, this.#config.height);
  }

  movePlayer(position: SimulationPoint): void {
    if (this.#result !== "running") return;
    this.#player = {
      x: clamp(position.x, 0, this.#config.width),
      y: clamp(position.y, 0, this.#config.height),
    };
  }

  collect(entityId: string): void {
    if (this.#result !== "running") return;
    const index = this.#collectibles.findIndex((entity) => entity.id === entityId);
    if (index < 0) return;
    this.#collectibles.splice(index, 1);
    this.#score += 1;
    if (this.#collectibles.length === 0) this.#finish("won", "orders-complete");
  }

  hitHazard(entityId: string): void {
    if (this.#result !== "running" || !this.#hazards.some((entity) => entity.id === entityId)) return;
    this.#lives -= 1;
    if (this.#lives === 0) this.#finish("lost", "lives-depleted");
  }

  advance(deltaMs: number): void {
    if (!Number.isFinite(deltaMs) || deltaMs < 0) throw new Error("Simulation delta must be a finite non-negative number.");
    if (this.#result !== "running") return;
    this.#elapsedMs = Math.min(this.#config.durationSeconds * 1000, this.#elapsedMs + deltaMs);
    if (this.#elapsedMs === this.#config.durationSeconds * 1000) this.#finish("lost", "time-expired");
  }

  snapshot(): OrderCollectTelemetry {
    return {
      schemaVersion: "1.0",
      mechanicProfile: "order-collect",
      randomSeed: this.#config.randomSeed,
      elapsedMs: this.#elapsedMs,
      remainingMs: this.#config.durationSeconds * 1000 - this.#elapsedMs,
      score: this.#score,
      lives: this.#lives,
      order: {
        collected: this.#config.collectibleCount - this.#collectibles.length,
        total: this.#config.collectibleCount,
        remainingIds: this.#collectibles.map((entity) => entity.id),
      },
      result: this.#result,
      endReason: this.#endReason,
      player: { ...this.#player },
      collectibles: this.#collectibles.map(copyEntity),
      hazards: this.#hazards.map(copyEntity),
    };
  }

  reset(): void {
    const replacement = new OrderCollectSimulation(this.#config);
    this.#elapsedMs = replacement.#elapsedMs;
    this.#score = replacement.#score;
    this.#lives = replacement.#lives;
    this.#result = replacement.#result;
    this.#endReason = replacement.#endReason;
    this.#player = replacement.#player;
    this.#collectibles = replacement.#collectibles;
    this.#hazards = replacement.#hazards;
  }

  #finish(result: Exclude<SimulationResult, "running">, reason: Exclude<SimulationEndReason, null>): void {
    this.#result = result;
    this.#endReason = reason;
  }
}

export { orderCollectSimulationSource } from "./runtime-source.js";

function validateConfig(config: OrderCollectSimulationConfig): void {
  if (!Number.isInteger(config.randomSeed) || config.randomSeed < 0 || config.randomSeed > 0xffffffff) throw new Error("Invalid random seed.");
  if (config.durationSeconds !== 75 || config.startingLives !== 3 || config.collectibleCount !== 6 || config.hazardCount !== 3) {
    throw new Error("Order-collect MVP requires duration=75, lives=3, collectibles=6, and hazards=3.");
  }
}

function createEntities(prefix: string, count: number, random: () => number, width: number, height: number): SimulationEntity[] {
  return Array.from({ length: count }, (_value, index) => ({
    id: `${prefix}-${index + 1}`,
    position: {
      x: Math.round((width * (0.12 + random() * 0.76)) * 100) / 100,
      y: Math.round((height * (0.22 + random() * 0.66)) * 100) / 100,
    },
  }));
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function copyEntity(entity: SimulationEntity): SimulationEntity {
  return { id: entity.id, position: { ...entity.position } };
}

export function compareOrderCollectTelemetry(
  left: OrderCollectTelemetry,
  right: OrderCollectTelemetry,
  options: Readonly<{ remainingMsTolerance?: number }> = {},
): OrderCollectTelemetryComparison {
  const tolerance = options.remainingMsTolerance ?? 0;
  if (!Number.isFinite(tolerance) || tolerance < 0) throw new Error("Remaining-time tolerance must be finite and non-negative.");
  const differences: string[] = [];
  const compare = (field: string, leftValue: unknown, rightValue: unknown): void => {
    if (leftValue !== rightValue) differences.push(`${field}: ${String(leftValue)} != ${String(rightValue)}`);
  };
  compare("mechanicProfile", left.mechanicProfile, right.mechanicProfile);
  compare("randomSeed", left.randomSeed, right.randomSeed);
  compare("score", left.score, right.score);
  compare("lives", left.lives, right.lives);
  compare("order.collected", left.order.collected, right.order.collected);
  compare("order.total", left.order.total, right.order.total);
  compare("result", left.result, right.result);
  compare("endReason", left.endReason, right.endReason);
  const remainingMsDifference = Math.abs(left.remainingMs - right.remainingMs);
  if (remainingMsDifference > tolerance) {
    differences.push(`remainingMs: difference ${remainingMsDifference} exceeds tolerance ${tolerance}`);
  }
  return { matched: differences.length === 0, remainingMsDifference, differences };
}
