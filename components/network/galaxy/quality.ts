export type GalaxyQualityProfile = {
  tier: "mobile" | "desktop";
  pixelRatio: number;
  residentCharts: number;
  backgroundStars: number;
  glow: 0 | 1 | 2;
  twinkle: boolean;
  transitionMs: number;
};

type GalaxyQualityInput = {
  width: number;
  devicePixelRatio: number;
  reducedMotion: boolean;
  saveData?: boolean;
};

const MOBILE_WIDTH = 860;
const FRAME_SAMPLE_SIZE = 120;
const SLOW_FRAME_MS = 33;

function clampPixelRatio(value: number, ceiling: number): number {
  return Math.max(1, Math.min(ceiling, value || 1));
}

function degradedBackground(tier: GalaxyQualityProfile["tier"]): number {
  return tier === "mobile" ? 400 : 900;
}

function baseTransitionMs(tier: GalaxyQualityProfile["tier"], reducedMotion: boolean): number {
  if (reducedMotion) return 140;
  return tier === "mobile" ? 240 : 320;
}

export function initialQuality(input: GalaxyQualityInput): GalaxyQualityProfile {
  const tier = input.width < MOBILE_WIDTH ? "mobile" : "desktop";
  return {
    tier,
    pixelRatio: clampPixelRatio(input.devicePixelRatio, tier === "mobile" ? 1.25 : 1.75),
    residentCharts: tier === "mobile" ? 3 : 8,
    backgroundStars: tier === "mobile" ? 700 : 1500,
    glow: tier === "mobile" ? 1 : 2,
    twinkle: !input.reducedMotion,
    transitionMs: baseTransitionMs(tier, input.reducedMotion),
  };
}

export function degradeQuality(profile: GalaxyQualityProfile): GalaxyQualityProfile {
  const nextBackground = degradedBackground(profile.tier);
  if (profile.backgroundStars > nextBackground) {
    return { ...profile, backgroundStars: nextBackground };
  }
  if (profile.glow > 0) {
    return { ...profile, glow: (profile.glow - 1) as 0 | 1 | 2 };
  }
  if (profile.pixelRatio > 1) {
    return { ...profile, pixelRatio: 1 };
  }
  return profile;
}

export class GalaxyQualityController {
  private profile: GalaxyQualityProfile;
  private frames = 0;
  private totalMs = 0;

  constructor(initialProfile: GalaxyQualityProfile) {
    this.profile = initialProfile;
  }

  current(): GalaxyQualityProfile {
    return this.profile;
  }

  sample(frameMs: number): GalaxyQualityProfile | null {
    this.frames += 1;
    this.totalMs += frameMs;
    if (this.frames < FRAME_SAMPLE_SIZE) return null;

    const average = this.totalMs / this.frames;
    this.frames = 0;
    this.totalMs = 0;

    if (average <= SLOW_FRAME_MS) return null;
    const degraded = degradeQuality(this.profile);
    if (degraded === this.profile) return null;
    if (
      degraded.backgroundStars === this.profile.backgroundStars
      && degraded.glow === this.profile.glow
      && degraded.pixelRatio === this.profile.pixelRatio
    ) {
      return null;
    }
    this.profile = degraded;
    return degraded;
  }
}
