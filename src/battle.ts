import type { Lesson } from './gestures';

export const ROUND_MS = 60_000;
export const ATTACK_MS = 8_000;
export const REQUIRED_SEALS = 9;
const RECOVERY_MS = 950;
const order: Lesson[] = ['pinch', 'shield', 'swipe'];

export type BattleStatus = 'countdown' | 'fighting' | 'victory' | 'defeat';
export type BattleEvent = 'cast' | 'damage' | null;

/** Gameplay uses active time: a hidden tab or missing hand must not cost a life. */
export class Battle {
  status: BattleStatus = 'countdown';
  countdownMs = 3_000;
  remainingMs = ROUND_MS;
  attackMs = ATTACK_MS;
  recoveryMs = 0;
  health = 3;
  score = 0;
  seals = 0;
  combo = 0;
  maxCombo = 0;
  turn = 0;
  reason: 'time' | 'lives' | null = null;
  event: BattleEvent = null;
  casts: Record<Lesson, number> = { pinch: 0, shield: 0, swipe: 0 };

  get expected(): Lesson { return order[this.turn % order.length]; }
  get ended() { return this.status === 'victory' || this.status === 'defeat'; }

  tick(deltaMs: number, tracking: boolean) {
    if (!tracking || this.ended || !Number.isFinite(deltaMs) || deltaMs <= 0) return;
    let remaining = deltaMs;
    if (this.status === 'countdown') {
      const consumed = Math.min(remaining, this.countdownMs);
      this.countdownMs -= consumed;
      remaining -= consumed;
      if (this.countdownMs > 0) return;
      this.status = 'fighting';
    }

    while (remaining > 0 && !this.ended) {
      const recovering = this.recoveryMs > 0;
      const consumed = Math.min(remaining, this.remainingMs, recovering ? this.recoveryMs : this.attackMs);
      remaining -= consumed;
      this.remainingMs -= consumed;
      if (recovering) this.recoveryMs -= consumed;
      else this.attackMs -= consumed;

      if (this.remainingMs <= 0) {
        this.status = 'defeat'; this.reason = 'time';
      } else if (recovering && this.recoveryMs <= 0) {
        this.turn++; this.attackMs = ATTACK_MS; this.event = null;
      } else if (!recovering && this.attackMs <= 0) {
        this.health--; this.combo = 0; this.event = 'damage';
        if (this.health === 0) { this.status = 'defeat'; this.reason = 'lives'; }
        else this.recoveryMs = RECOVERY_MS;
      }
    }
  }

  cast(gesture: Lesson): boolean {
    if (this.status !== 'fighting' || this.recoveryMs > 0 || gesture !== this.expected) return false;
    this.combo++;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    this.casts[gesture]++;
    this.seals++;
    this.score += 100 + Math.floor(this.attackMs / ATTACK_MS * 50) + Math.min(this.combo - 1, 4) * 25;
    this.event = 'cast';
    if (this.seals === REQUIRED_SEALS) {
      this.status = 'victory';
      this.score += Math.ceil(this.remainingMs / 1000) * 10 + this.health * 100;
    } else this.recoveryMs = RECOVERY_MS;
    return true;
  }
}

export function readBest(storage: Pick<Storage, 'getItem'>): number {
  try {
    const score = Number(storage.getItem('rift.best-score.v1'));
    return Number.isSafeInteger(score) && score > 0 ? score : 0;
  } catch { return 0; }
}

export function saveBest(storage: Pick<Storage, 'getItem' | 'setItem'>, score: number): number {
  const best = Math.max(readBest(storage), Number.isSafeInteger(score) && score > 0 ? score : 0);
  try { storage.setItem('rift.best-score.v1', String(best)); } catch { /* Private storage can be unavailable. Gameplay still works. */ }
  return best;
}
