export type VisualQuality = 'auto' | 'low' | 'medium' | 'high';

export interface VisualProfile {
  glowLayers: number;
  glowAlpha: number;
  shadowAlpha: number;
  particleScale: number;
  ambientAlpha: number;
  bloomEnabled: boolean;
  shadowsEnabled: boolean;
  fogParticlesPerSpot: number;
  fogParticlesPerBand: number;
  fogParticlesPerMist: number;
  orbitSegments: number;
}

const STORAGE_KEY = 'critical-reaction-visual-quality';

const PROFILES: Record<Exclude<VisualQuality, 'auto'>, VisualProfile> = {
  // 低质量（移动端/低端设备）：关闭 Bloom 后处理、单层光晕、粒子减半 —— 渲染开销优先
  low: { glowLayers: 1, glowAlpha: 0.4, shadowAlpha: 0.18, particleScale: 0.55, ambientAlpha: 0.04, bloomEnabled: false, shadowsEnabled: true, fogParticlesPerSpot: 12, fogParticlesPerBand: 5, fogParticlesPerMist: 6, orbitSegments: 24 },
  medium: { glowLayers: 3, glowAlpha: 0.7, shadowAlpha: 0.32, particleScale: 0.8, ambientAlpha: 0.07, bloomEnabled: true, shadowsEnabled: true, fogParticlesPerSpot: 24, fogParticlesPerBand: 9, fogParticlesPerMist: 10, orbitSegments: 36 },
  high: { glowLayers: 4, glowAlpha: 1, shadowAlpha: 0.42, particleScale: 1, ambientAlpha: 0.1, bloomEnabled: true, shadowsEnabled: true, fogParticlesPerSpot: 38, fogParticlesPerBand: 14, fogParticlesPerMist: 16, orbitSegments: 48 }
};

let selectedQuality: VisualQuality = 'auto';

function detectQuality(): Exclude<VisualQuality, 'auto'> {
  if (typeof window === 'undefined') return 'medium';
  const touch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4;
  const cores = navigator.hardwareConcurrency ?? 4;
  if (touch || memory <= 2 || cores <= 2) return 'low';
  if (memory >= 8 && cores >= 8) return 'high';
  return 'medium';
}

export function loadVisualQuality(): VisualQuality {
  if (typeof window === 'undefined') return selectedQuality;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === 'auto' || stored === 'low' || stored === 'medium' || stored === 'high') selectedQuality = stored;
  } catch {
    selectedQuality = 'auto';
  }
  return selectedQuality;
}

export function setVisualQuality(quality: VisualQuality): void {
  selectedQuality = quality;
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, quality);
  } catch {
    selectedQuality = 'auto';
  }
}

export function getVisualQuality(): VisualQuality {
  return selectedQuality;
}

export function getVisualProfile(): VisualProfile {
  const quality = selectedQuality === 'auto' ? detectQuality() : selectedQuality;
  return PROFILES[quality];
}

export function visualEffectsSummary(): { bloom: boolean; shadows: boolean } {
  const profile = getVisualProfile();
  return { bloom: profile.bloomEnabled, shadows: profile.shadowsEnabled };
}

export function visualQualityLabel(quality: VisualQuality): string {
  return { auto: '自动', low: '低质量', medium: '中质量', high: '高质量' }[quality];
}

loadVisualQuality();
