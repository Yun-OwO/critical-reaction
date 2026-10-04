export interface ReactionData {
  id: string;
  equation: string;
  deltaH: number;
  reactants: string[];
  radius: number;
  damage: number;
  effectId: string;
}

export const reactions: ReactionData[] = [
  { id: 'R001', equation: '2H2 + O2 -> 2H2O', deltaH: -286, reactants: ['H', 'O'], radius: 150, damage: 30, effectId: 'water-burst' },
  { id: 'R002', equation: 'Na + H2O -> NaOH + 1/2H2', deltaH: -184, reactants: ['Na', 'water'], radius: 120, damage: 24, effectId: 'alkali-pool' },
  { id: 'R003', equation: 'H2SO4 -> 腐蚀', deltaH: -88, reactants: ['acid'], radius: 100, damage: 18, effectId: 'corrosion' },
  { id: 'R004', equation: 'Cl2 + H2O -> HCl + HClO', deltaH: -25, reactants: ['Cl', 'water'], radius: 130, damage: 16, effectId: 'toxic-cloud' },
  { id: 'R005', equation: 'U-235 + n -> 裂变', deltaH: -200, reactants: ['U', 'neutron'], radius: 240, damage: 80, effectId: 'fission' },
  { id: 'R006', equation: 'nC -> 聚合', deltaH: -50, reactants: ['C'], radius: 90, damage: 12, effectId: 'polymer-wall' }
];
