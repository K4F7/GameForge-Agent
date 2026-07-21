export const orderCollectSimulationSource = String.raw`
type SimulationResult = "running" | "won" | "lost";
type SimulationEndReason = "orders-complete" | "time-expired" | "lives-depleted" | null;
type SimulationPoint = { x: number; y: number };
type SimulationEntity = { id: string; position: SimulationPoint };
type OrderCollectTelemetry = {
  schemaVersion: "1.0";
  mechanicProfile: "order-collect";
  randomSeed: number;
  elapsedMs: number;
  remainingMs: number;
  score: number;
  lives: number;
  order: { collected: number; total: number; remainingIds: string[] };
  result: SimulationResult;
  endReason: SimulationEndReason;
  player: SimulationPoint;
  collectibles: SimulationEntity[];
  hazards: SimulationEntity[];
};
type OrderCollectSimulationConfig = {
  randomSeed: number;
  durationSeconds: 75;
  startingLives: 3;
  collectibleCount: 6;
  hazardCount: 3;
  width: number;
  height: number;
};

class OrderCollectSimulation {
  private elapsedMs = 0;
  private score = 0;
  private lives: number;
  private result: SimulationResult = "running";
  private endReason: SimulationEndReason = null;
  private player: SimulationPoint;
  private collectibles: SimulationEntity[];
  private hazards: SimulationEntity[];

  constructor(private readonly config: OrderCollectSimulationConfig) {
    if (!Number.isInteger(config.randomSeed) || config.randomSeed < 0 || config.randomSeed > 0xffffffff) throw new Error("Invalid random seed.");
    if (config.durationSeconds !== 75 || config.startingLives !== 3 || config.collectibleCount !== 6 || config.hazardCount !== 3) {
      throw new Error("Order-collect MVP configuration is invalid.");
    }
    this.lives = config.startingLives;
    this.player = { x: config.width / 2, y: config.height * 0.72 };
    const random = simulationMulberry32(config.randomSeed);
    this.collectibles = simulationCreateEntities("order", config.collectibleCount, random, config.width, config.height);
    this.hazards = simulationCreateEntities("hazard", config.hazardCount, random, config.width, config.height);
  }

  movePlayer(position: SimulationPoint): void {
    if (this.result !== "running") return;
    this.player = {
      x: simulationClamp(position.x, 0, this.config.width),
      y: simulationClamp(position.y, 0, this.config.height),
    };
  }

  collect(entityId: string): void {
    if (this.result !== "running") return;
    const index = this.collectibles.findIndex((entity) => entity.id === entityId);
    if (index < 0) return;
    this.collectibles.splice(index, 1);
    this.score += 1;
    if (this.collectibles.length === 0) this.finish("won", "orders-complete");
  }

  hitHazard(entityId: string): void {
    if (this.result !== "running" || !this.hazards.some((entity) => entity.id === entityId)) return;
    this.lives -= 1;
    if (this.lives === 0) this.finish("lost", "lives-depleted");
  }

  advance(deltaMs: number): void {
    if (!Number.isFinite(deltaMs) || deltaMs < 0) throw new Error("Simulation delta must be finite and non-negative.");
    if (this.result !== "running") return;
    this.elapsedMs = Math.min(this.config.durationSeconds * 1000, this.elapsedMs + deltaMs);
    if (this.elapsedMs === this.config.durationSeconds * 1000) this.finish("lost", "time-expired");
  }

  snapshot(): OrderCollectTelemetry {
    return {
      schemaVersion: "1.0",
      mechanicProfile: "order-collect",
      randomSeed: this.config.randomSeed,
      elapsedMs: this.elapsedMs,
      remainingMs: this.config.durationSeconds * 1000 - this.elapsedMs,
      score: this.score,
      lives: this.lives,
      order: {
        collected: this.config.collectibleCount - this.collectibles.length,
        total: this.config.collectibleCount,
        remainingIds: this.collectibles.map((entity) => entity.id),
      },
      result: this.result,
      endReason: this.endReason,
      player: { ...this.player },
      collectibles: this.collectibles.map(simulationCopyEntity),
      hazards: this.hazards.map(simulationCopyEntity),
    };
  }

  reset(): void {
    const replacement = new OrderCollectSimulation(this.config);
    this.elapsedMs = replacement.elapsedMs;
    this.score = replacement.score;
    this.lives = replacement.lives;
    this.result = replacement.result;
    this.endReason = replacement.endReason;
    this.player = replacement.player;
    this.collectibles = replacement.collectibles;
    this.hazards = replacement.hazards;
  }

  private finish(result: Exclude<SimulationResult, "running">, reason: Exclude<SimulationEndReason, null>): void {
    this.result = result;
    this.endReason = reason;
  }
}

function simulationCreateEntities(prefix: string, count: number, random: () => number, width: number, height: number): SimulationEntity[] {
  return Array.from({ length: count }, (_value, index) => ({
    id: prefix + "-" + (index + 1),
    position: {
      x: Math.round((width * (0.12 + random() * 0.76)) * 100) / 100,
      y: Math.round((height * (0.22 + random() * 0.66)) * 100) / 100,
    },
  }));
}

function simulationMulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function simulationClamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function simulationCopyEntity(entity: SimulationEntity): SimulationEntity {
  return { id: entity.id, position: { ...entity.position } };
}
`;
