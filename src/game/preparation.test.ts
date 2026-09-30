import { expect, it } from "vitest";
import { Preparation } from "./preparation";
import { emptyControl } from "./control";
const palm = { ...emptyControl(), valid: true, open: true };
it("cannot scroll through multiple cards with one held palm", () => {
  const p = new Preparation();
  for (let t = 0; t < 5000; t += 50) p.update(palm, 50);
  expect(p.step).toBe(1);
  expect(p.armed).toBe(false);
  for (let t = 0; t < 250; t += 50) p.update(emptyControl(), 50);
  for (let t = 0; t < 800; t += 50) p.update(palm, 50);
  expect(p.step).toBe(2);
});
it("requires fresh measured holding after a pause and allows button progression", () => {
  const p = new Preparation();
  p.elapsed = 1000;
  p.update(palm, 400);
  p.pause();
  p.update(palm, 1000);
  expect(p.step).toBe(0);
  p.next();
  p.next();
  p.next();
  expect(p.complete).toBe(true);
});
