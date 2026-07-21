import { describe, expect, it } from "vitest";
import { compareOrderCollectTelemetry, OrderCollectSimulation, orderCollectSimulationSource, type OrderCollectSimulationConfig } from "./index.js";

const config: OrderCollectSimulationConfig = {
  randomSeed: 19016,
  durationSeconds: 75,
  startingLives: 3,
  collectibleCount: 6,
  hazardCount: 3,
};

describe("OrderCollectSimulation", () => {
  it("creates identical state from the same seed", () => {
    expect(new OrderCollectSimulation(config).snapshot()).toEqual(new OrderCollectSimulation(config).snapshot());
    expect(new OrderCollectSimulation({ ...config, randomSeed: 19017 }).snapshot().collectibles)
      .not.toEqual(new OrderCollectSimulation(config).snapshot().collectibles);
  });

  it("completes the order with stable score and terminal telemetry", () => {
    const simulation = new OrderCollectSimulation(config);
    for (const item of simulation.snapshot().collectibles) simulation.collect(item.id);

    expect(simulation.snapshot()).toMatchObject({
      score: 6,
      lives: 3,
      result: "won",
      endReason: "orders-complete",
      order: { collected: 6, total: 6, remainingIds: [] },
    });
  });

  it("supports both timeout and lives-depleted failure semantics", () => {
    const timeout = new OrderCollectSimulation(config);
    timeout.advance(75_000);
    expect(timeout.snapshot()).toMatchObject({ result: "lost", endReason: "time-expired", remainingMs: 0 });

    const collision = new OrderCollectSimulation(config);
    const hazardId = collision.snapshot().hazards[0]?.id;
    expect(hazardId).toBeDefined();
    collision.hitHazard(hazardId ?? "");
    collision.hitHazard(hazardId ?? "");
    collision.hitHazard(hazardId ?? "");
    expect(collision.snapshot()).toMatchObject({ result: "lost", endReason: "lives-depleted", lives: 0 });
  });

  it("returns defensive snapshots and clamps player input", () => {
    const simulation = new OrderCollectSimulation(config);
    simulation.movePlayer({ x: -10, y: 900 });
    const snapshot = simulation.snapshot();
    expect(snapshot.player).toEqual({ x: 0, y: 540 });
    expect(() => simulation.advance(-1)).toThrow(/non-negative/);
  });

  it("exports the standalone core source used by generated adapters", () => {
    expect(orderCollectSimulationSource).toContain("class OrderCollectSimulation");
    expect(orderCollectSimulationSource).toContain("mechanicProfile: \"order-collect\"");
    expect(orderCollectSimulationSource).toContain("reset(): void");
  });

  it("compares the required cross-runtime gameplay semantics", () => {
    const left = new OrderCollectSimulation(config);
    const right = new OrderCollectSimulation(config);
    left.collect("order-1");
    right.collect("order-1");
    left.advance(100);
    right.advance(140);

    expect(compareOrderCollectTelemetry(left.snapshot(), right.snapshot(), { remainingMsTolerance: 50 }))
      .toEqual({ matched: true, remainingMsDifference: 40, differences: [] });
    right.hitHazard("hazard-1");
    expect(compareOrderCollectTelemetry(left.snapshot(), right.snapshot(), { remainingMsTolerance: 50 }))
      .toMatchObject({ matched: false, differences: [expect.stringContaining("lives")] });
  });
});
