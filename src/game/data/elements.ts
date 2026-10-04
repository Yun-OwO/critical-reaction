export interface ElementData {
  id: string;
  name: string;
  valenceElectrons: number;
  color: string;
}

export const elements: ElementData[] = [
  { id: 'H', name: '氢', valenceElectrons: 1, color: '#E8F4FF' },
  { id: 'C', name: '碳', valenceElectrons: 4, color: '#3D3D4A' },
  { id: 'O', name: '氧', valenceElectrons: 6, color: '#FF3B30' }
];
