import type { Hand } from './gestures';

export class TutorialGate {
  phase: 'demo' | 'prepare' | 'practice' = 'demo';
  remainingMs = 3000;
  fistMs = 0;
  private lastTime: number | null = null;

  reset() {
    this.phase = 'demo'; this.remainingMs = 3000; this.fistMs = 0; this.lastTime = null;
  }

  pause() { this.lastTime = null; this.fistMs = 0; }

  update(hand: Hand | null, now: number): boolean {
    const delta = this.lastTime === null ? 0 : now - this.lastTime;
    const dt = delta >= 0 && delta <= 250 ? delta : 0;
    this.lastTime = now;
    if (this.phase === 'demo') {
      this.remainingMs = Math.max(0, this.remainingMs - dt);
      if (this.remainingMs === 0) this.phase = 'prepare';
      return false;
    }
    if (this.phase === 'prepare') {
      this.fistMs = hand && !hand.quality && hand.extended === 0 ? this.fistMs + dt : 0;
      if (this.fistMs >= 400) this.phase = 'practice';
    }
    return this.phase === 'practice';
  }
}
