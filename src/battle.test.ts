import { describe, expect, it } from 'vitest';
import { ATTACK_MS, Battle, readBest, saveBest } from './battle';

function started() { const battle = new Battle(); battle.tick(3000, true); return battle; }

describe('battle', () => {
  it('freezes countdown and both timers when the hand is missing', () => {
    const battle = new Battle();
    battle.tick(10000, false);
    expect(battle.countdownMs).toBe(3000);
    battle.tick(3000, true);
    battle.tick(10000, false);
    expect(battle.remainingMs).toBe(60000);
    expect(battle.attackMs).toBe(8000);
  });

  it('rejects a wrong spell, early casting, and duplicate casting in recovery', () => {
    const battle = new Battle();
    expect(battle.cast('pinch')).toBe(false);
    battle.tick(3000, true);
    expect(battle.cast('shield')).toBe(false);
    expect(battle.cast('pinch')).toBe(true);
    expect(battle.cast('pinch')).toBe(false);
    expect(battle.seals).toBe(1);
    battle.tick(950, true);
    expect(battle.expected).toBe('shield');
    expect(battle.cast('shield')).toBe(true);
  });

  it('finishes after nine seals, records all three spells, and locks the result', () => {
    const battle = started();
    for (let i = 0; i < 9; i++) {
      battle.tick(1000, true);
      expect(battle.cast(battle.expected)).toBe(true);
      if (i < 8) battle.tick(950, true);
    }
    expect(battle.status).toBe('victory');
    expect(battle.casts).toEqual({ pinch: 3, shield: 3, swipe: 3 });
    expect(battle.maxCombo).toBe(9);
    const finalScore = battle.score;
    battle.tick(120000, true);
    expect(battle.cast('pinch')).toBe(false);
    expect(battle.score).toBe(finalScore);
    expect(battle.status).toBe('victory');
  });

  it('loses a life for a missed attack and resets the combo', () => {
    const battle = started();
    battle.cast('pinch'); battle.tick(950, true);
    battle.tick(ATTACK_MS, true);
    expect(battle.health).toBe(2);
    expect(battle.combo).toBe(0);
    expect(battle.maxCombo).toBe(1);
    expect(battle.event).toBe('damage');
    battle.tick(950, true);
    expect(battle.expected).toBe('swipe');
  });

  it('handles a long active frame spanning several deadlines', () => {
    const battle = started();
    battle.tick(3 * ATTACK_MS + 2 * 950, true);
    expect(battle.status).toBe('defeat');
    expect(battle.health).toBe(0);
    expect(battle.reason).toBe('lives');
  });

  it('ends on the global timer even when the next attack has time left', () => {
    const battle = started();
    for (let i = 0; i < 7; i++) {
      battle.tick(7400, true);
      battle.cast(battle.expected);
      battle.tick(950, true);
    }
    expect(battle.status).toBe('fighting');
    battle.tick(1550, true);
    expect(battle.status).toBe('defeat');
    expect(battle.reason).toBe('time');
    expect(battle.health).toBe(3);
    expect(battle.remainingMs).toBe(0);
  });

  it('counts exactly the same active time at different frame rates', () => {
    const coarse = started(), fine = started();
    coarse.tick(10000, true);
    for (let i = 0; i < 1000; i++) fine.tick(10, true);
    expect(coarse).toEqual(fine);
  });
});

describe('local record', () => {
  it('keeps the higher record and ignores malformed values', () => {
    let value = 'broken';
    const storage = { getItem: () => value, setItem: (_key: string, next: string) => { value = next; } };
    expect(readBest(storage)).toBe(0);
    expect(saveBest(storage, 500)).toBe(500);
    expect(saveBest(storage, 100)).toBe(500);
    expect(saveBest(storage, NaN)).toBe(500);
    expect(value).toBe('500');
  });
  it('works when browser storage is blocked', () => {
    const storage = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
    expect(readBest(storage)).toBe(0);
    expect(saveBest(storage, 100)).toBe(100);
  });
});
