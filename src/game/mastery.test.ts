import { expect, it } from "vitest";
import { MasteryGate } from "./mastery";
import { emptyControl } from "./control";
const palm = { ...emptyControl(), valid: true, open: true };
const fist = { ...emptyControl(), valid: true, fist: true };
function arm(gate: MasteryGate) {
  for (let i = 0; i < 6; i++) gate.update(fist, 50);
}
it("never accepts a held palm or elapsed time without a new confirmation sequence", () => {
  const gate = new MasteryGate();
  for (let i = 0; i < 200; i++) expect(gate.update(palm, 100)).toBe(false);
  expect(gate.armed).toBe(false);
  arm(gate);
  expect(gate.armed).toBe(true);
  for (let i = 0; i < 12; i++) expect(gate.update(palm, 50)).toBe(false);
  expect(gate.update(palm, 50)).toBe(true);
});
it("requires continuous measured holding and ignores long frame gaps", () => {
  const gate = new MasteryGate();
  arm(gate);
  expect(gate.update(palm, 5000)).toBe(false);
  for (let i = 0; i < 10; i++) gate.update(palm, 50);
  gate.update(fist, 50);
  expect(gate.hold).toBe(0);
  expect(gate.update(palm, 100)).toBe(false);
});
it.each([
  emptyControl(),
  { ...palm, trackingGrace: true },
  { ...palm, quality: "Верни руку" },
])("requires a fresh fist after tracking loss or invalid pose", (input) => {
  const gate = new MasteryGate();
  arm(gate);
  gate.update(palm, 100);
  gate.update(input, 50);
  expect(gate.armed).toBe(false);
  expect(gate.hold).toBe(0);
  expect(gate.update(palm, 100)).toBe(false);
});
it("resets confirmation on tab pause", () => {
  const gate = new MasteryGate();
  arm(gate);
  gate.pause();
  expect(gate.armed).toBe(false);
  expect(gate.update(palm, 100)).toBe(false);
});
