import { describe, expect, it } from "vitest";
import { Arena, BOSS, advice, freshStats } from "./arena";
import { emptyControl, type Control } from "./control";
const input = (o: Partial<Control> = {}): Control => ({
  ...emptyControl(),
  valid: true,
  ...o,
});
const open = input({ open: true });
function advance(a: Arena, ms: number, c: Control = input()) {
  for (let t = 0; t < ms; t += 50) a.tick(50, c);
}
function battle() {
  const a = new Arena();
  advance(a, 3000);
  return a;
}
function burst(a: Arena, p = { x: 0.5, y: 0.5 }) {
  a.tick(50, open);
  advance(a, 1600, input({ fist: true, position: p }));
  a.tick(50, open);
}
function cut(a: Arena, y = 0.5, id = 1) {
  advance(a, 350, input({ bladeSign: true }));
  a.tick(50, input({ slash: { from: { x: 0.1, y }, to: { x: 0.9, y }, id } }));
  advance(a, 350);
}
describe("spatial spell combat", () => {
  it("explains a cut blocked by the boss without calling it an off-target cut", () => {
    const a = battle();
    // Keep the path away from spawned projectiles, directly across the eye.
    a.magic.bladeMs = 1000;
    a.tick(
      1,
      input({
        slash: {
          from: { x: 0.45, y: BOSS.y },
          to: { x: 0.55, y: BOSS.y },
          id: 101,
        },
      }),
    );
    a.entities = [];
    advance(a, 300);
    expect(a.bossHp).toBe(240);
    expect(a.stats.offTargetCuts).toBe(0);
    expect(a.hint).toContain("завеса");
    expect(a.drainEvents()).toContainEqual(
      expect.objectContaining({ type: "block", text: "ЗАЩИТА БОССА" }),
    );
  });
  it("shows actual damage, including the final hit, and ends the attack window on victory", () => {
    const a = battle();
    a.elapsed = 70000;
    a.phase = 2;
    a.bossHp = 7;
    a.magic.bladeMs = 1000;
    a.tick(
      1,
      input({
        slash: {
          from: { x: 0.45, y: BOSS.y },
          to: { x: 0.55, y: BOSS.y },
          id: 102,
        },
      }),
    );
    a.entities = [];
    advance(a, 300);
    expect(a.status).toBe("victory");
    expect(a.attackWindowMs).toBe(0);
    expect(a.drainEvents()).toContainEqual(
      expect.objectContaining({ type: "boss", text: "−7" }),
    );
  });
  it("keeps the opening countdown continuous when territory bridges a boss cycle", () => {
    const a = battle();
    a.phase = 2;
    a.elapsed = 73000;
    expect(a.attackWindowMs).toBe(1000);
    a.domainMs = 6000;
    expect(a.attackWindowMs).toBe(10000);
    const remaining = a.attackWindowMs;
    a.tick(2000, emptyControl());
    expect(a.attackWindowMs).toBe(remaining);
    a.domainMs = 0;
    a.elapsed = 66000;
    expect(a.attackWindowMs).toBe(0);
  });
  it("draws multiple enemies into the actual vortex and releases a physical wave", () => {
    const a = new Arena("vortex");
    advance(a, 50, open);
    const before = a.entities[0].x;
    advance(a, 1500, input({ fist: true, position: { x: 0.5, y: 0.5 } }));
    expect(a.entities[0].x).toBeGreaterThan(before);
    a.tick(50, open);
    advance(a, 500);
    expect(a.stats.burstHits).toBe(1);
    expect(a.practiceDone).toBe(true);
  });
  it("a distant wave misses; targets are not destroyed everywhere", () => {
    const a = new Arena("vortex");
    a.spawn("crystal", { x: 0.9, y: 0.1 }, { x: 0, y: 0 }, 0);
    burst(a, { x: 0.025, y: 0.975 });
    advance(a, 900);
    expect(a.practiceDone).toBe(false);
  });
  it("only signed cuts intersecting a target can finish the lesson", () => {
    const a = new Arena("swipe");
    advance(a, 50);
    a.tick(
      50,
      input({
        slash: { from: { x: 0.1, y: 0.5 }, to: { x: 0.9, y: 0.5 }, id: 1 },
      }),
    );
    advance(a, 400);
    expect(a.practiceDone).toBe(false);
    cut(a, 0.2, 2);
    expect(a.stats.offTargetCuts).toBe(1);
    cut(a, 0.5, 3);
    expect(a.practiceDone).toBe(true);
  });
  it("one continuous cut cannot strip two armor layers", () => {
    const a = battle();
    const e = a.spawn("armored", { x: 0.5, y: 0.5 }, { x: 0, y: 0 }, 0);
    advance(a, 350, input({ bladeSign: true }));
    for (let i = 0; i < 4; i++)
      a.tick(
        50,
        input({
          slash: { from: { x: 0.1, y: 0.5 }, to: { x: 0.9, y: 0.5 }, id: 9 },
        }),
      );
    advance(a, 200);
    expect(e.hp).toBe(1);
    expect(a.stats.cuts).toBe(1);
    cut(a, 0.5, 10);
    expect(a.entities).not.toContain(e);
  });
  it("off-position reflection misses and a correctly placed fresh seal returns a projectile", () => {
    const a = new Arena("shield");
    const e = a.spawn("orb", { x: 0.5, y: 0.5 }, { x: 0, y: 0.1 }, 0);
    advance(a, 300, input({ shield: true, position: { x: 0.1, y: 0.5 } }));
    expect(a.practiceDone).toBe(false);
    a.tick(50, input());
    // A second, resting hand must not disable the primary hand's protection.
    a.tick(
      50,
      input({ shield: true, twoHands: true, position: { x: 0.5, y: 0.55 } }),
    );
    expect(a.practiceDone).toBe(true);
    expect(e.team).toBe("friendly");
    expect(a.stats.parries).toBe(1);
  });
  it("pauses all physics on tracking loss and safely drops the unfinished spell", () => {
    const a = battle();
    a.tick(50, open);
    advance(a, 900, input({ fist: true }));
    const time = a.elapsed;
    a.tick(10000, emptyControl());
    expect(a.elapsed).toBe(time);
    expect(a.magic.vortex).toBeNull();
    a.tick(50, open);
    expect(a.stats.bursts).toBe(0);
  });
  it("drains protection and only restores it when the shield is lowered", () => {
    const a = battle();
    advance(a, 7000, input({ shield: true, position: { x: 0.05, y: 0.5 } }));
    expect(a.shieldActive).toBe(false);
    expect(a.shieldEnergy).toBe(0);
    advance(a, 2000);
    expect(a.shieldEnergy).toBeGreaterThan(30);
  });
  it("expands territory only after the entire drawn ritual", () => {
    const a = new Arena("domain");
    advance(
      a,
      750,
      input({ open: true, secondOpen: true, twoHands: true, domainPose: true }),
    );
    expect(a.magic.stage).toBe("draw");
    for (let i = 0; i <= 64; i++) {
      const angle = (i / 64) * Math.PI * 2;
      a.tick(
        40,
        input({
          pinching: true,
          position: {
            x: 0.5 + 0.22 * Math.cos(angle),
            y: 0.5 + (0.22 / 0.7) * Math.sin(angle),
          },
        }),
      );
    }
    a.tick(50, open);
    expect(a.magic.stage).toBe("release");
    advance(a, 450, input({ open: true, secondOpen: true, handGap: 0.4 }));
    expect(a.stats.domains).toBe(1);
    expect(a.practiceDone).toBe(true);
    expect(a.domainMs).toBeGreaterThan(7000);
  });
  it("completes all three phases and can win using real spell actions", () => {
    const a = battle();
    // A simple agent prepares compression and chooses where threats are densest.
    for (let n = 0; n < 100 && !a.ended; n++) {
      const target = a.entities.find((e) => e.team === "enemy");
      const p =
        a.phase === 2
          ? { x: 0.5, y: 0.35 }
          : target
            ? { x: target.x, y: Math.min(0.6, target.y + 0.1) }
            : { x: 0.5, y: 0.4 };
      burst(a, p);
      advance(a, 900, input({ shield: true, position: { x: 0.5, y: 0.8 } }));
    }
    expect(a.phase).toBe(2);
    expect(a.status).toBe("victory");
    expect(a.stats.bursts).toBeGreaterThan(10);
    expect(a.score).toBeGreaterThan(0);
  });
  it("ends on destroyed core or timeout and freezes completed scores", () => {
    const a = battle();
    a.health = 8;
    a.spawn("orb", { x: 0.5, y: 0.89 }, { x: 0, y: 1 }, 0);
    a.tick(50, input());
    expect(a.status).toBe("defeat");
    const b = battle();
    b.elapsed = 149999;
    b.tick(50, input());
    expect(b.status).toBe("defeat");
    const score = b.score;
    b.tick(5000, open);
    expect(b.score).toBe(score);
  });
  it("gives training advice from concrete mistakes", () => {
    expect(advice({ ...freshStats(), failedRituals: 1 }).lesson).toBe("domain");
    expect(advice({ ...freshStats(), offTargetCuts: 3 }).lesson).toBe("swipe");
    expect(advice({ ...freshStats(), damage: 2 }).lesson).toBe("shield");
  });
});
