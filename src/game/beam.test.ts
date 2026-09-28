import { expect, it } from "vitest";
import { Arena, BEAM_CHARGE_MS, BEAM_HOLD_MS } from "./arena";
import { emptyControl, type Control } from "./control";
const input = (extra: Partial<Control> = {}): Control => ({
  ...emptyControl(),
  valid: true,
  ...extra,
});
function advance(world: Arena, ms: number, control = input()) {
  for (let t = 0; t < ms; t += 25) world.tick(Math.min(25, ms - t), control);
}
function charging(final = false) {
  const world = new Arena();
  world.status = "fighting";
  world.elapsed = final ? 65001 : 6999;
  world.tick(1, input());
  expect(world.beam?.stage).toBe("charging");
  return world;
}
const defend = (world: Arena) =>
  input({ open: true, shield: true, position: { ...world.beam!.target } });
it("telegraphs before damage and reflects with a measured palm held at the seal", () => {
  const world = charging();
  const health = world.health;
  advance(world, 1500);
  expect(world.health).toBe(health);
  const remaining = world.beam!.remaining;
  advance(world, remaining + 1, defend(world));
  expect(world.beam?.stage).toBe("reflected");
  expect(world.stats.beamsReflected).toBe(1);
  expect(world.health).toBe(health);
  expect(world.energy).toBeGreaterThanOrEqual(25);
  expect(world.score).toBeGreaterThanOrEqual(250);
  advance(world, 1100);
  expect(world.stats.beamsReflected).toBe(1);
  expect(world.beam).toBeNull();
});
it("distinguishes wrong pose, position, an exhausted shield and a late defence", () => {
  const world = charging();
  world.tick(25, input({ fist: true }));
  expect(world.beamHint).toContain("Раскрой все пальцы");
  world.tick(
    25,
    input({ open: true, shield: true, position: { x: 0.1, y: 0.2 } }),
  );
  expect(world.beamHint).toContain("Перемести курсор");
  world.shieldEnergy = 0;
  world.tick(25, defend(world));
  expect(world.beamHint).toContain("истощён");
  const late = charging();
  advance(late, late.beam!.remaining - 200);
  advance(late, 201, defend(late));
  expect(late.stats.beamsMissed).toBe(1);
  expect(late.health).toBe(92);
  expect(late.beamHint).toContain("Слишком поздно");
});
it("requires holding the seal until the actual shot and damages only once", () => {
  const world = charging();
  advance(world, BEAM_HOLD_MS + 100, defend(world));
  expect(world.beam!.hold).toBe(BEAM_HOLD_MS);
  advance(world, BEAM_CHARGE_MS);
  expect(world.stats.beamsMissed).toBe(1);
  expect(world.health).toBe(92);
});
it("freezes warning and seal time during lost tracking, without auto-reflection", () => {
  const world = charging();
  advance(world, 100, defend(world));
  const remaining = world.beam!.remaining,
    hold = world.beam!.hold;
  world.tick(250, { ...emptyControl(), trackingGrace: true });
  expect(world.beam!.remaining).toBe(remaining);
  expect(world.beam!.hold).toBe(hold);
  world.tick(1500, emptyControl());
  expect(world.beam!.remaining).toBe(remaining);
  expect(world.stats.beamsReflected).toBe(0);
});
it("lets a defensive palm replace an armed blade and opens the final boss on return", () => {
  const world = charging(true);
  world.magic.bladeMs = 5000;
  advance(world, world.beam!.remaining + 1, defend(world));
  expect(world.magic.bladeMs).toBe(0);
  expect(world.stats.beamsReflected).toBe(1);
  expect(world.bossHp).toBe(208);
  expect(world.exposed).toBe(true);
});
it("territory dispels the ray and practice never introduces a boss attack", () => {
  const world = charging();
  world.domainMs = 7000;
  world.tick(25, input());
  expect(world.beam!.stage).toBe("dispelled");
  expect(world.health).toBe(100);
  expect(world.stats.beamsMissed).toBe(0);
  const practice = new Arena("shield");
  advance(practice, 12000);
  expect(practice.beam).toBeNull();
});
