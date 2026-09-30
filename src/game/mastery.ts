import type { Control } from "./control";

/** A fresh, deliberate fist → open sequence; elapsed time alone never accepts. */
export class MasteryGate {
  armed = false;
  hold = 0;
  private fistMs = 0;
  pause() {
    this.armed = false;
    this.hold = this.fistMs = 0;
  }
  update(input: Control, delta: number) {
    const dt = delta > 0 && delta <= 150 ? delta : 0;
    if (!input.valid || input.trackingGrace || input.quality) {
      this.pause();
      return false;
    }
    if (!this.armed) {
      this.fistMs = input.fist ? this.fistMs + dt : 0;
      if (this.fistMs >= 300) this.armed = true;
      return false;
    }
    this.hold = input.open ? this.hold + dt : 0;
    return this.hold >= 650;
  }
}
