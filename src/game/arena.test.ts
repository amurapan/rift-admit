import { describe, expect, it } from "vitest";
import { Arena, BOSS, advice, freshStats, segmentDistance } from "./arena";
import { emptyControl, type Control } from "./control";

const input = (overrides: Partial<Control> = {}): Control => ({
  ...emptyControl(),
  valid: true,
  ...overrides,
});
function battle() {
  const arena = new Arena();
  arena.tick(3000, input());
  return arena;
}

describe("spatial combat", () => {
  it("only grabs a nearby orb and never a crystal", () => {
    const arena = new Arena("pinch");
    const orb = arena.spawn("orb", { x: 0.3, y: 0.55 }, { x: 0, y: 0 }, 0);
    arena.spawn("crystal", { x: 0.7, y: 0.55 }, { x: 0, y: 0 }, 0);
    arena.tick(20, input({ pinching: true, position: { x: 0.7, y: 0.55 } }));
    expect(arena.held).toBeUndefined();
    arena.tick(20, input({ pinching: true, position: { x: 0.3, y: 0.55 } }));
    expect(arena.held?.id).toBe(orb.id);
    expect(arena.stats.catches).toBe(1);
  });
  it("requires momentum, and a aimed throw physically hits the boss", () => {
    const arena = new Arena("pinch");
    arena.spawn("orb", { x: 0.3, y: 0.55 }, { x: 0, y: 0 }, 0);
    arena.tick(20, input({ pinching: true, position: { x: 0.3, y: 0.55 } }));
    arena.tick(20, input({ released: true, velocity: { x: 0, y: 0 } }));
    expect(arena.practiceDone).toBe(false);
    expect(arena.stats.weakThrows).toBe(1);
    expect(arena.hint).toContain("слабый");
    const orb = arena.entities[0];
    arena.tick(
      700,
      input({ pinching: true, position: { x: orb.x, y: orb.y } }),
    );
    arena.tick(600, input({ released: true, velocity: { x: 0.6, y: -1 } }));
    expect(arena.stats.returns).toBe(1);
    expect(arena.practiceDone).toBe(true);
  });
  it("cuts along a segment, not anywhere on the screen, and can hit multiple targets", () => {
    const arena = new Arena("swipe");
    arena.spawn("crystal", { x: 0.5, y: 0.5 }, { x: 0, y: 0 }, 0);
    arena.tick(
      20,
      input({ slash: { from: { x: 0.1, y: 0.2 }, to: { x: 0.8, y: 0.2 } } }),
    );
    arena.tick(400, input());
    expect(arena.practiceDone).toBe(false);
    expect(arena.stats.offTargetCuts).toBe(1);
    arena.spawn("crystal", { x: 0.7, y: 0.5 }, { x: 0, y: 0 }, 0);
    arena.tick(
      20,
      input({ slash: { from: { x: 0.3, y: 0.5 }, to: { x: 0.85, y: 0.5 } } }),
    );
    expect(arena.practiceDone).toBe(true);
    expect(arena.stats.multikills).toBe(1);
  });
  it("armored crystals require two cuts", () => {
    const arena = battle();
    const target = arena.spawn(
      "armored",
      { x: 0.5, y: 0.5 },
      { x: 0, y: 0 },
      0,
    );
    const slash = { from: { x: 0.2, y: 0.5 }, to: { x: 0.8, y: 0.5 } };
    arena.tick(20, input({ slash }));
    expect(arena.entities).toContain(target);
    expect(target.hp).toBe(1);
    arena.tick(400, input());
    arena.tick(20, input({ slash }));
    expect(arena.entities).not.toContain(target);
  });
  it("an off-position shield lets an attack pass, but an on-path shield blocks it", () => {
    const miss = new Arena("shield");
    miss.spawn("orb", { x: 0.5, y: 0.4 }, { x: 0, y: 0.3 }, 0);
    miss.tick(1000, input({ shield: true, position: { x: 0.15, y: 0.5 } }));
    expect(miss.practiceDone).toBe(false);
    const hit = new Arena("shield");
    hit.spawn("orb", { x: 0.5, y: 0.4 }, { x: 0, y: 0.3 }, 0);
    hit.tick(1000, input({ shield: true, position: { x: 0.5, y: 0.7 } }));
    expect(hit.practiceDone).toBe(true);
    expect(hit.stats.blocks + hit.stats.parries).toBe(1);
  });
  it("a freshly raised shield sends the projectile back", () => {
    const arena = battle();
    const orb = arena.spawn("orb", { x: 0.5, y: 0.5 }, { x: 0, y: 0.1 }, 0);
    arena.tick(20, input({ shield: true, position: { x: 0.5, y: 0.55 } }));
    expect(orb.team).toBe("friendly");
    expect(orb.vy).toBeLessThan(0);
    expect(arena.stats.parries).toBe(1);
  });
  it("a missing hand pauses physics and cannot release a held projectile", () => {
    const arena = new Arena("pinch");
    arena.spawn("orb", { x: 0.3, y: 0.55 }, { x: 0, y: 0 }, 0);
    arena.tick(50, input({ pinching: true, position: { x: 0.3, y: 0.55 } }));
    const time = arena.elapsed;
    arena.tick(5000, emptyControl());
    expect(arena.elapsed).toBe(time);
    expect(arena.held).toBeDefined();
    arena.tick(50, input({ released: true, velocity: { x: 1, y: -1 } }));
    expect(arena.stats.throws).toBe(0);
    arena.tick(50, input({ pinching: true, position: { x: 0.4, y: 0.5 } }));
    arena.tick(50, input({ released: true, velocity: { x: 1, y: -1 } }));
    expect(arena.stats.throws).toBe(1);
  });
  it("shield energy runs out, then recovers with the hand lowered", () => {
    const arena = battle();
    arena.tick(6400, input({ shield: true, position: { x: 0.1, y: 0.5 } }));
    expect(arena.shieldActive).toBe(false);
    arena.tick(2000, input());
    expect(arena.shieldEnergy).toBeGreaterThan(30);
    arena.tick(20, input({ shield: true }));
    expect(arena.shieldActive).toBe(true);
  });
  it("unlocks all three phases, and only the exposed boss can be cut", () => {
    const arena = battle();
    arena.elapsed = 30000;
    arena.tick(20, input());
    expect(arena.phase).toBe(1);
    arena.elapsed = 65000;
    arena.tick(20, input());
    expect(arena.phase).toBe(2);
    const slash = { from: { x: 0.2, y: 0.22 }, to: { x: 0.8, y: 0.22 } };
    arena.tick(20, input({ slash }));
    expect(arena.bossHp).toBe(240);
    arena.elapsed = 70000;
    arena.tick(20, input({ slash }));
    expect(arena.bossHp).toBe(228);
  });
  it("domain requires charge and a sustained two-hand pose and slows enemies", () => {
    const arena = battle();
    arena.tick(1100, input({ domainPose: true }));
    expect(arena.stats.domains).toBe(0);
    arena.energy = 100;
    arena.tick(800, input({ domainPose: true }));
    expect(arena.domainMs).toBe(0);
    arena.tick(250, input({ domainPose: true }));
    expect(arena.domainMs).toBeGreaterThan(6000);
    expect(arena.stats.domains).toBe(1);
    const orb = arena.spawn("orb", { x: 0.2, y: 0.3 }, { x: 0, y: 0.2 }, 0);
    arena.tick(1000, input());
    expect(orb.y).toBeCloseTo(0.344, 2);
  });
  it("ends on a destroyed core or time limit, and freezes a victory score", () => {
    const arena = battle();
    arena.health = 8;
    arena.spawn("orb", { x: 0.5, y: 0.87 }, { x: 0, y: 0 }, 0);
    arena.tick(20, input());
    expect(arena.status).toBe("defeat");
    const timeout = battle();
    timeout.elapsed = 149990;
    timeout.tick(20, input());
    expect(timeout.status).toBe("defeat");
    const won = battle();
    won.elapsed = 70000;
    won.tick(20, input());
    won.bossHp = 12;
    won.tick(
      20,
      input({
        slash: { from: { x: 0.3, y: BOSS.y }, to: { x: 0.7, y: BOSS.y } },
      }),
    );
    expect(won.status).toBe("victory");
    const score = won.score;
    won.tick(5000, input());
    expect(won.score).toBe(score);
  });
  it("moving projectiles cannot tunnel through the core on a long frame", () => {
    const arena = battle();
    arena.spawn("orb", { x: 0.5, y: 0.4 }, { x: 0, y: 4 }, 0);
    arena.tick(200, input());
    expect(arena.health).toBe(92);
    expect(
      segmentDistance(
        { x: 0.5, y: 0.5 },
        { x: 0.1, y: 0.5 },
        { x: 0.9, y: 0.5 },
      ),
    ).toBeCloseTo(0);
  });
  it("recommends a concrete exercise from actual mistakes", () => {
    expect(
      advice({ ...freshStats(), weakThrows: 2, throws: 3, returns: 1 }).lesson,
    ).toBe("pinch");
    expect(
      advice({ ...freshStats(), cuts: 5, offTargetCuts: 4, cutHits: 1 }).lesson,
    ).toBe("swipe");
    expect(
      advice({ ...freshStats(), cuts: 3, cutHits: 3, damage: 2 }).lesson,
    ).toBe("shield");
  });
});

it("can be won through all phases using spatial actions, parries and the domain", () => {
  const arena = battle();
  let nextSlash = 0;
  for (let time = 0; time < 150000 && !arena.ended; time += 40) {
    let control = input();
    if (arena.energy >= 100 || arena.domainHold > 0)
      control = input({ domainPose: true });
    else if (arena.held) {
      if (arena.heldMs > 700)
        control = input({
          released: true,
          velocity: { x: BOSS.x - arena.held.x, y: BOSS.y - arena.held.y - 1 },
        });
      else
        control = input({
          pinching: true,
          position: { x: arena.held.x, y: arena.held.y },
        });
    } else if (arena.exposed && time >= nextSlash) {
      control = input({
        slash: { from: { x: 0.3, y: BOSS.y }, to: { x: 0.7, y: BOSS.y } },
      });
      nextSlash = time + 400;
    } else {
      const enemy = arena.entities.find(
        (e) => e.team === "enemy" && e.telegraph <= 0,
      );
      if (enemy?.kind === "orb")
        control = input(
          enemy.id % 3 === 0
            ? { shield: true, position: enemy }
            : { pinching: true, position: enemy },
        );
      else if (enemy && time >= nextSlash) {
        control = input({
          slash: {
            from: { x: enemy.x - 0.13, y: enemy.y },
            to: { x: enemy.x + 0.13, y: enemy.y },
          },
        });
        nextSlash = time + 400;
      }
    }
    arena.tick(40, control);
    arena.drainEvents();
  }
  expect(arena.status).toBe("victory");
  expect(arena.phase).toBe(2);
  expect(arena.stats.catches).toBeGreaterThan(0);
  expect(arena.stats.parries).toBeGreaterThan(0);
  expect(arena.stats.cutHits).toBeGreaterThan(0);
  expect(arena.stats.domains).toBeGreaterThan(0);
});

it("one continuous cut cannot remove both layers of armor", () => {
  const arena = battle();
  const crystal = arena.spawn("armored", { x: 0.5, y: 0.5 }, { x: 0, y: 0 }, 0);
  arena.tick(
    20,
    input({
      slash: { from: { x: 0.3, y: 0.5 }, to: { x: 0.52, y: 0.5 }, id: 1 },
    }),
  );
  arena.tick(
    20,
    input({
      slash: { from: { x: 0.3, y: 0.5 }, to: { x: 0.7, y: 0.5 }, id: 1 },
    }),
  );
  expect(crystal.hp).toBe(1);
  expect(arena.stats.cuts).toBe(1);
  arena.tick(400, input());
  arena.tick(
    20,
    input({
      slash: { from: { x: 0.7, y: 0.5 }, to: { x: 0.3, y: 0.5 }, id: 2 },
    }),
  );
  expect(arena.entities).not.toContain(crystal);
});
