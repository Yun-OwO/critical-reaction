export interface Position {
  x: number;
  y: number;
}

export interface Velocity {
  vx: number;
  vy: number;
}

export interface Health {
  current: number;
  max: number;
}

export interface Electron {
  valence: number;
  inner: number;
  free: number;
  oxidationState: number;
}

export interface Faction {
  value: 'player' | 'enemy';
}

export interface Combatant {
  damage: number;
  cooldown: number;
  attackTimer: number;
}
