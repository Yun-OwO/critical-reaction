import { beforeEach, describe, expect, it } from 'vitest';
import {
  damagePlayerState,
  gainFreeElectrons,
  gameState,
  resetRun
} from '../src/game/state/GameState';

describe('electron economy', () => {
  beforeEach(() => {
    resetRun();
  });

  it('starts with zero free electrons', () => {
    expect(gameState.freeElectrons).toBe(0);
    expect(gameState.maxFreeElectrons).toBe(5); // v0.2 基础上限 5
  });

  it('accumulates free electrons', () => {
    gainFreeElectrons(1);
    gainFreeElectrons(1);
    expect(gameState.freeElectrons).toBe(2);
  });

  it('caps free electrons at the maximum', () => {
    gainFreeElectrons(5);
    expect(gameState.freeElectrons).toBe(gameState.maxFreeElectrons);
  });
});

describe('player damage and death', () => {
  beforeEach(() => {
    resetRun();
  });

  it('reduces electron HP without losing electrons on small damage', () => {
    const result = damagePlayerState(10);
    expect(result.lostElectron).toBe(false);
    expect(result.died).toBe(false);
    expect(gameState.ehp).toBe(90);
    expect(gameState.valence).toBe(1);
  });

  it('loses a valence electron when EHP is depleted', () => {
    gameState.ehp = 15;
    const result = damagePlayerState(10);
    expect(result.lostElectron).toBe(false);
    expect(gameState.ehp).toBe(5);

    const second = damagePlayerState(10);
    expect(second.lostElectron).toBe(true);
    expect(second.died).toBe(true);
    expect(gameState.valence).toBe(0);
    expect(gameState.ehp).toBe(0);
  });

  it('dies only after all valence electrons break', () => {
    gameState.maxValence = 3;
    gameState.valence = 3;
    gameState.ehp = 100;
    gameState.ehpMax = 100;

    let died = false;
    let hits = 0;
    while (!died && hits < 100) {
      died = damagePlayerState(10).died;
      hits += 1;
    }
    expect(died).toBe(true);
    expect(gameState.valence).toBe(0);
    expect(gameState.ehp).toBe(0);
    expect(hits).toBe(30);
  });

  it('ignores zero or negative damage', () => {
    const result = damagePlayerState(0);
    expect(result.lostElectron).toBe(false);
    expect(result.died).toBe(false);
    expect(gameState.ehp).toBe(100);
  });

  it('resetRun restores full health after death', () => {
    damagePlayerState(100);
    expect(gameState.valence).toBe(0);
    resetRun();
    expect(gameState.valence).toBe(1);
    expect(gameState.ehp).toBe(100);
    expect(gameState.ehpMax).toBe(100);
  });
});
