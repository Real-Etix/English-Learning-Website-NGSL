/** Progressive, frozen-layout Star Atlas renderer. */
import * as THREE from "three";

import type { FullGalaxyData } from "../../../lib/galaxy/full-codec";
import type {
  ChartShard,
  GalaxyChart,
  GalaxyManifest,
  PositionedWord,
  ShardEdge,
  Vec3,
} from "../../../lib/galaxy/types";

import { GalaxySceneModel } from "./scene-model";
import {
  markGalaxyInteractive,
  markGalaxyRendererVisible,
} from "./deferred-boot";
import type { GalaxyQualityProfile } from "./quality";

const MAX_WORD_LABELS = 200;
const PICK_RADIUS_SQ = 26 * 26;
const MAX_ROUTE_SEGMENTS = 64;
const DEFERRED_WORD_LABEL_BATCH = 12;
const DEFERRED_CHART_LABEL_BATCH = 4;

function clampWordLabelBudget(value: number): number {
  return Math.max(1, Math.min(MAX_WORD_LABELS, Math.round(value || MAX_WORD_LABELS)));
}

const COL: Record<string, Vec3> = {
  core: [0.749, 0.851, 0.949],
  advanced: [0.796, 0.725, 0.914],
  hub: [0.949, 0.851, 0.627],
  claimed: [0.478, 0.796, 0.671],
  used: [0.741, 1, 0.878],
  quiet: [0.62, 0.67, 0.74],
};

const LINK: Record<string, Vec3> = {
  synonym: [0.42, 0.78, 0.66],
  antonym: [0.9, 0.56, 0.55],
  intensity: [0.93, 0.8, 0.5],
  collocation: [0.55, 0.6, 0.7],
  builds_on: [0.7, 0.63, 0.88],
  advanced_form: [0.72, 0.62, 0.93],
  morphological: [0.5, 0.72, 0.88],
};

const VERT = `
attribute vec3 aColor; attribute float aSize; attribute float aAlpha; attribute float aSeed;
uniform float uTime; uniform float uDpr; uniform float uTwinkle;
varying vec3 vColor; varying float vAlpha;
void main(){
  vColor = aColor;
  float twinkle = 0.86 + 0.14 * sin(uTime * 0.7 + aSeed * 6.2831);
  float tw = mix(1.0, twinkle, uTwinkle);
  vAlpha = aAlpha * tw;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = min(48.0, aSize * uDpr * (820.0 / max(1.0, -mv.z)));
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = `
uniform float uGlow;
varying vec3 vColor; varying float vAlpha;
void main(){
  float d = length(gl_PointCoord - vec2(0.5)) * 2.0;
  if (d > 1.0) discard;
  float core = smoothstep(0.46, 0.0, d);
  float halo = smoothstep(1.0, 0.16, d) * (0.18 + uGlow * 0.16);
  float a = (core * 1.15 + halo) * vAlpha;
  gl_FragColor = vec4(vColor * (0.80 + core * 1.15), a);
}`;

const RING_VERT = `
attribute float aSize; attribute float aAlpha;
uniform float uDpr; varying float vAlpha;
void main(){
  vAlpha = aAlpha;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = min(56.0, aSize * uDpr * (820.0 / max(1.0, -mv.z)));
  gl_Position = projectionMatrix * mv;
}`;

const RING_FRAG = `
uniform float uGlow;
varying float vAlpha;
void main(){
  float d = length(gl_PointCoord - vec2(0.5)) * 2.0;
  float ring = smoothstep(0.62, 0.76, d) * (1.0 - smoothstep(0.88, 1.0, d));
  if (ring < 0.01) discard;
  gl_FragColor = vec4(0.60, 0.93, 0.79, ring * vAlpha * (0.45 + uGlow * 0.5));
}`;

function mulberry(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export type ProxyPoint = {
  chartId: string;
  xyz: Vec3;
  seed: number;
};

export type ProxyLayout = {
  points: ProxyPoint[];
  labelChartIds: string[];
};

export type DeferredLabelChunk = {
  wordStart: number;
  wordCount: number;
  chartStart: number;
  chartCount: number;
};

export function planDeferredLabelChunks(
  wordLabelCount: number,
  chartLabelCount: number,
  options: { wordBatchSize?: number; chartBatchSize?: number } = {},
): DeferredLabelChunk[] {
  const wordBatchSize = Math.max(1, options.wordBatchSize ?? DEFERRED_WORD_LABEL_BATCH);
  const chartBatchSize = Math.max(1, options.chartBatchSize ?? DEFERRED_CHART_LABEL_BATCH);
  const chunks: DeferredLabelChunk[] = [];
  let wordStart = 0;
  let chartStart = 0;

  while (wordStart < wordLabelCount || chartStart < chartLabelCount) {
    const wordCount = Math.min(wordBatchSize, Math.max(0, wordLabelCount - wordStart));
    const chartCount = Math.min(chartBatchSize, Math.max(0, chartLabelCount - chartStart));
    if (wordCount || chartCount) {
      chunks.push({ wordStart, wordCount, chartStart, chartCount });
    }
    wordStart += wordCount;
    chartStart += chartCount;
  }

  return chunks;
}

function normalizedCrossUp(center: Vec3): { axis: Vec3; u: Vec3; v: Vec3 } {
  const length = Math.hypot(center[0], center[1], center[2]) || 1;
  const axis: Vec3 = [center[0] / length, center[1] / length, center[2] / length];
  let u: Vec3 = [axis[2], 0, -axis[0]];
  let uLength = Math.hypot(...u);
  if (uLength < 0.01) {
    u = [1, 0, 0];
    uLength = 1;
  }
  u = [u[0] / uLength, u[1] / uLength, u[2] / uLength];
  const v: Vec3 = [
    axis[1] * u[2] - axis[2] * u[1],
    axis[2] * u[0] - axis[0] * u[2],
    axis[0] * u[1] - axis[1] * u[0],
  ];
  return { axis, u, v };
}

/** Pure deterministic proxy generation; real positions always come from assets. */
export function buildProxyLayout(manifest: GalaxyManifest): ProxyLayout {
  const points: ProxyPoint[] = [];
  for (const chart of manifest.charts) {
    const count = Math.min(24, Math.max(1, chart.wordCount));
    const random = mulberry(chart.previewSeed);
    if (chart.id === "drift") {
      for (let index = 0; index < count; index++) {
        const y = random() * 2 - 1;
        const radiusAtY = Math.sqrt(Math.max(0, 1 - y * y));
        const angle = random() * Math.PI * 2;
        const radius = 470 * (1.02 + (random() - 0.5) * 0.34);
        points.push({
          chartId: chart.id,
          seed: random(),
          xyz: [
            Math.cos(angle) * radiusAtY * radius,
            y * 0.72 * radius,
            Math.sin(angle) * radiusAtY * radius,
          ],
        });
      }
      continue;
    }

    const frame = normalizedCrossUp(chart.center);
    for (let index = 0; index < count; index++) {
      const progress = (index + 0.5) / count;
      const radius = chart.radius * (0.2 + Math.sqrt(progress) * 0.72);
      const angle = index * 2.39996 + random() * 0.35;
      const depth = (random() - 0.5) * chart.radius * 0.42;
      points.push({
        chartId: chart.id,
        seed: random(),
        xyz: [
          chart.center[0] + frame.u[0] * Math.cos(angle) * radius + frame.v[0] * Math.sin(angle) * radius + frame.axis[0] * depth,
          chart.center[1] + frame.u[1] * Math.cos(angle) * radius + frame.v[1] * Math.sin(angle) * radius + frame.axis[1] * depth,
          chart.center[2] + frame.u[2] * Math.cos(angle) * radius + frame.v[2] * Math.sin(angle) * radius + frame.axis[2] * depth,
        ],
      });
    }
  }
  return {
    points,
    labelChartIds: manifest.charts.filter((chart) => chart.id !== "drift").map((chart) => chart.id),
  };
}

export type ProgressiveEngineOptions = {
  onSelectWord?: (lemma: string | null) => void;
  onSelectChart?: (chartId: string) => void;
  onApproachChart?: (chartId: string | null) => void;
  onZoomLevel?: (level: "galaxy" | "cluster" | "star") => void;
  onContextFailure?: () => void;
  onInteractive?: () => void;
  onConstellationVisible?: () => void;
};

type GalaxyMode = "chart" | "run" | "ladder";
export type ZoomLevel = "galaxy" | "cluster" | "star";

export type TransferableAlphaState = {
  lemmas: readonly string[];
  current: ArrayLike<number>;
  target: ArrayLike<number>;
};

export function transferAlphaStateByLemma(
  nextLemmas: readonly string[],
  defaultTarget: ArrayLike<number>,
  previous?: TransferableAlphaState | null,
): { current: Float32Array; target: Float32Array } {
  const current = new Float32Array(nextLemmas.length);
  const target = new Float32Array(defaultTarget);
  if (!previous) return { current, target };

  const previousIndex = new Map(previous.lemmas.map((lemma, index) => [lemma, index]));
  nextLemmas.forEach((lemma, index) => {
    const oldIndex = previousIndex.get(lemma);
    if (oldIndex === undefined) return;
    current[index] = previous.current[oldIndex];
    target[index] = previous.target[oldIndex];
  });
  return { current, target };
}

export function focusCameraDistance(currentDistance: number): number {
  const capped = Math.min(currentDistance, 235);
  return capped < 175 ? 190 : capped;
}

export function zoomLevelTransition(
  previous: ZoomLevel | null,
  distance: number,
): { level: ZoomLevel; changed: boolean } {
  const level = zoomLevel(distance);
  return { level, changed: level !== previous };
}

type WordLayer = {
  words: PositionedWord[];
  index: Map<string, number>;
  positions: Float32Array;
  alpha: Float32Array;
  targetAlpha: Float32Array;
  colors: Float32Array;
  sizes: Float32Array;
  geometry: THREE.BufferGeometry;
  points: THREE.Points;
  ringSizes: Float32Array;
  ringAlpha: Float32Array;
  ringGain: Float32Array;
  ringGeometry: THREE.BufferGeometry;
  rings: THREE.Points;
  screen: Float32Array;
  onScreen: Uint8Array;
};

function hasVisibleRingData(layer: Pick<WordLayer, "ringGain">): boolean {
  return layer.ringGain.some((gain) => gain > 0);
}

type ProxyLayer = {
  points: ProxyPoint[];
  positions: Float32Array;
  alpha: Float32Array;
  targetAlpha: Float32Array;
  geometry: THREE.BufferGeometry;
  object: THREE.Points;
  screen: Float32Array;
  onScreen: Uint8Array;
};

type PickResult = { type: "word"; id: string } | { type: "chart"; id: string } | null;

function wordColor(word: PositionedWord, claimed: boolean, used: boolean): Vec3 {
  if (used) return COL.used;
  if (claimed) return COL.claimed;
  if (word.degree === 0) return COL.quiet;
  if (word.tier === "advanced") return COL.advanced;
  return word.degree >= 8 ? COL.hub : COL.core;
}

function zoomLevel(distance: number): ZoomLevel {
  return distance > 620 ? "galaxy" : distance > 275 ? "cluster" : "star";
}

export class ProgressiveStarEngine {
  private readonly host: HTMLElement;
  private readonly manifest: GalaxyManifest;
  private readonly options: ProgressiveEngineOptions;
  private readonly model: GalaxySceneModel;
  private readonly chartById: Map<string, GalaxyChart>;
  private readonly events = new AbortController();
  private readonly reducedMotion: boolean;

  private readonly canvas: HTMLCanvasElement;
  private readonly labels: HTMLDivElement;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly starMaterial: THREE.ShaderMaterial;
  private readonly ringMaterial: THREE.ShaderMaterial;
  private readonly proxyLayer: ProxyLayer;
  private readonly labelChartIds: string[];
  private readonly deferredLabelChunks: DeferredLabelChunk[];
  private readonly labelElements: HTMLDivElement[] = [];
  private readonly chartElements = new Map<string, HTMLDivElement>();

  private residentLayer: WordLayer | null = null;
  private fullLayer: WordLayer | null = null;
  private linkGeometry = new THREE.BufferGeometry();
  private linkObject: THREE.LineSegments;
  private routePositions = new Float32Array(MAX_ROUTE_SEGMENTS * 6);
  private routeGeometry = new THREE.BufferGeometry();
  private routeObject: THREE.LineSegments;
  private backgroundGeometry: THREE.BufferGeometry;
  private backgroundObject: THREE.Points;
  private backgroundMaterial: THREE.PointsMaterial;
  private resizeObserver?: ResizeObserver;
  private animationFrame = 0;
  private dead = false;
  private firstRender = false;
  private labelsBuilt = false;
  private contextLost = false;
  private contextFailureReported = false;
  private labelBuildChunkIndex = 0;
  private labelBuildTimer = 0;
  private restoreTimer?: ReturnType<typeof setTimeout>;
  private maxWordLabels = MAX_WORD_LABELS;

  private dpr = 1;
  private width = 800;
  private height = 600;
  private startTime = 0;
  private lastFrameNow = 0;
  private frameDeltaMs = 16.67;
  private transitionMs = 320;
  private level: ZoomLevel = "galaxy";
  private notifiedLevel: ZoomLevel | null = null;
  private nearestChart: string | null = null;
  private approachCandidate: string | null = null;
  private approachSince = 0;
  private approachedChart: string | null = null;
  private labelWords: PositionedWord[] = [];
  private focusNeighbors = new Set<string>();

  private readonly cameraState = {
    theta: 0.7,
    phi: 1.15,
    distance: 980,
    targetTheta: 0.7,
    targetPhi: 1.15,
    targetDistance: 980,
    target: new THREE.Vector3(),
    targetGoal: new THREE.Vector3(),
  };

  private readonly state = {
    mode: "chart" as GalaxyMode,
    chart: null as string | null,
    focus: null as string | null,
    hover: null as string | null,
    claimed: new Set<string>(),
    used: new Set<string>(),
    route: [] as string[],
    routeSet: new Set<string>(),
    routeIndex: 0,
    panelOffset: 0,
  };

  private readonly projectVector = new THREE.Vector3();
  private readonly eyeVector = new THREE.Vector3();
  private readonly rightVector = new THREE.Vector3();
  private readonly shiftVector = new THREE.Vector3();
  private readonly lookVector = new THREE.Vector3();
  private readonly probeVector = new THREE.Vector3();

  constructor(host: HTMLElement, manifest: GalaxyManifest, options: ProgressiveEngineOptions = {}) {
    this.host = host;
    this.manifest = manifest;
    this.options = options;
    this.model = new GalaxySceneModel(manifest);
    this.chartById = new Map(manifest.charts.map((chart) => [chart.id, chart]));
    this.reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

    host.style.position = "absolute";
    host.style.inset = "0";
    host.style.overflow = "hidden";
    host.style.touchAction = "none";
    host.style.cursor = "grab";

    this.canvas = document.createElement("canvas");
    this.canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block";
    host.appendChild(this.canvas);
    this.labels = document.createElement("div");
    this.labels.style.cssText = "position:absolute;inset:0;pointer-events:none;overflow:hidden";
    host.appendChild(this.labels);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(52, 1, 1, 6000);
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: true,
    });
    this.renderer.setClearColor(0x070b16, 1);
    this.renderer.sortObjects = false;
    this.dpr = Math.min(window.devicePixelRatio || 1, 1.75);
    this.renderer.setPixelRatio(this.dpr);

    this.starMaterial = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uDpr: { value: this.dpr }, uTwinkle: { value: 1 }, uGlow: { value: 1 } },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.ringMaterial = new THREE.ShaderMaterial({
      uniforms: { uDpr: { value: this.dpr }, uGlow: { value: 1 } },
      vertexShader: RING_VERT,
      fragmentShader: RING_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    ({ geometry: this.backgroundGeometry, material: this.backgroundMaterial, object: this.backgroundObject } = this.buildBackground());
    const proxyLayout = buildProxyLayout(manifest);
    this.labelChartIds = proxyLayout.labelChartIds;
    this.deferredLabelChunks = planDeferredLabelChunks(MAX_WORD_LABELS, this.labelChartIds.length);
    this.proxyLayer = this.buildProxyLayer(proxyLayout);
    this.linkObject = new THREE.LineSegments(this.linkGeometry, new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }));
    this.linkObject.frustumCulled = false;
    this.scene.add(this.linkObject);
    this.routeGeometry.setAttribute("position", new THREE.BufferAttribute(this.routePositions, 3));
    this.routeObject = new THREE.LineSegments(this.routeGeometry, new THREE.LineBasicMaterial({
      color: 0xf2d9a0,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    }));
    this.routeObject.frustumCulled = false;
    this.routeObject.visible = false;
    this.scene.add(this.routeObject);

    this.bindContextLifecycle();
    this.bindInput();
    markGalaxyInteractive();
    this.options.onInteractive?.();

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(host);
    this.resize();
    this.startTime = performance.now();
    this.lastFrameNow = this.startTime;
    this.animationFrame = requestAnimationFrame(this.loop);
  }

  setQuality(profile: GalaxyQualityProfile): void {
    this.dpr = profile.pixelRatio;
    this.maxWordLabels = clampWordLabelBudget(profile.maxWordLabels);
    this.transitionMs = Math.max(80, profile.transitionMs);
    this.renderer.setPixelRatio(profile.pixelRatio);
    this.starMaterial.uniforms.uDpr.value = profile.pixelRatio;
    this.starMaterial.uniforms.uTwinkle.value = profile.twinkle ? 1 : 0;
    this.starMaterial.uniforms.uGlow.value = profile.glow / 2;
    this.ringMaterial.uniforms.uDpr.value = profile.pixelRatio;
    this.ringMaterial.uniforms.uGlow.value = profile.glow / 2;
    this.backgroundGeometry.setDrawRange(0, profile.backgroundStars);
    this.backgroundMaterial.opacity = profile.glow === 0 ? 0.18 : profile.glow === 1 ? 0.24 : 0.32;
    this.updateLabelTransitions(profile.transitionMs);
    this.resize();
  }

  upsertChart(shard: ChartShard): void {
    this.model.upsertChart(shard);
    this.rebuildResidentLayer();
    this.setProxyChartTarget(shard.chartId, 0);
    this.refreshContext();
  }

  removeChart(chartId: string): void {
    this.model.removeChart(chartId);
    this.rebuildResidentLayer();
    if (!this.fullLayer) this.setProxyChartTarget(chartId, 1);
    this.refreshContext();
  }

  enterFull(data: FullGalaxyData): void {
    const previousLayer = this.fullLayer ?? this.residentLayer;
    const oldFullLayer = this.fullLayer;
    this.model.enterFull(data);
    this.fullLayer = this.buildWordLayer(this.model.visibleWords(), previousLayer);
    this.disposeWordLayer(oldFullLayer);
    this.fullLayer.points.visible = true;
    this.fullLayer.rings.visible = hasVisibleRingData(this.fullLayer);
    if (this.residentLayer) {
      this.residentLayer.points.visible = false;
      this.residentLayer.rings.visible = false;
    }
    this.proxyLayer.targetAlpha.fill(0);
    this.refreshContext();
  }

  exitFull(): void {
    this.model.exitFull();
    this.disposeWordLayer(this.fullLayer);
    this.fullLayer = null;
    if (this.residentLayer) {
      this.residentLayer.points.visible = true;
      this.residentLayer.rings.visible = hasVisibleRingData(this.residentLayer);
    }
    this.syncProxyTargets();
    this.refreshContext();
  }

  setClaimed(lemmas: Set<string>): void {
    this.state.claimed = new Set(lemmas);
    this.refreshWordAttributes();
    this.refreshLabelAssignments();
  }

  setUsed(lemmas: Set<string>): void {
    this.state.used = new Set(lemmas);
    this.refreshWordAttributes();
  }

  setMode(mode: GalaxyMode): void {
    this.state.mode = mode;
    this.routeObject.visible = mode === "run" && this.state.route.length > 1;
    this.refreshWordAttributes();
    this.rebuildLinks();
  }

  setRoute(lemmas: string[], index: number): void {
    this.state.route = [...lemmas];
    this.state.routeSet = new Set(lemmas);
    this.state.routeIndex = index;
    this.routeObject.visible = this.state.mode === "run" && lemmas.length > 1;
    this.refreshWordAttributes();
    this.writeRoute();
    this.rebuildLinks();
    this.refreshLabelAssignments();
  }

  setChart(chartId: string | null, options?: { keepCamera?: boolean }): void {
    this.state.chart = chartId;
    this.model.setChart(chartId);
    this.refreshWordAttributes();
    this.rebuildLinks();
    this.refreshLabelAssignments();
    const chart = chartId ? this.chartById.get(chartId) : null;
    if (chart && !options?.keepCamera) {
      this.cameraState.targetGoal.set(...chart.center);
      this.cameraState.targetDistance = 330;
    } else if (!chartId) {
      this.cameraState.targetGoal.set(0, 0, 0);
      this.cameraState.targetDistance = 980;
    }
  }

  focusStar(lemma: string, options?: { keepCamera?: boolean }): boolean {
    const word = this.model.getWord(lemma);
    if (!word) return false;
    this.state.focus = lemma;
    if (this.state.chart && this.state.chart !== word.chartId) {
      this.state.chart = null;
      this.model.setChart(null);
    }
    this.refreshFocusNeighbors();
    this.refreshWordAttributes();
    this.rebuildLinks();
    this.refreshLabelAssignments();
    if (!options?.keepCamera) {
      this.cameraState.targetGoal.set(...word.xyz);
      this.cameraState.targetDistance = focusCameraDistance(this.cameraState.targetDistance);
    }
    return true;
  }

  clearFocus(): void {
    this.state.focus = null;
    this.refreshFocusNeighbors();
    this.refreshWordAttributes();
    this.rebuildLinks();
    this.refreshLabelAssignments();
  }

  resetView(): void {
    this.state.focus = null;
    this.state.chart = null;
    this.model.setChart(null);
    this.refreshFocusNeighbors();
    this.refreshWordAttributes();
    this.rebuildLinks();
    this.refreshLabelAssignments();
    this.cameraState.targetGoal.set(0, 0, 0);
    this.cameraState.targetDistance = 980;
  }

  setPanelOffset(px: number): void {
    this.state.panelOffset = px || 0;
  }

  screenPosOf(lemma: string): { x: number; y: number } | null {
    const layer = this.activeWordLayer();
    const index = layer?.index.get(lemma);
    if (!layer || index === undefined || !layer.onScreen[index]) return null;
    return { x: layer.screen[index * 2], y: layer.screen[index * 2 + 1] };
  }

  dispose(): void {
    if (this.dead) return;
    this.dead = true;
    cancelAnimationFrame(this.animationFrame);
    this.events.abort();
    this.resizeObserver?.disconnect();
    if (this.labelBuildTimer) window.clearTimeout(this.labelBuildTimer);
    if (this.restoreTimer) clearTimeout(this.restoreTimer);
    this.disposeWordLayer(this.residentLayer);
    this.disposeWordLayer(this.fullLayer);
    this.proxyLayer.geometry.dispose();
    this.backgroundGeometry.dispose();
    this.backgroundMaterial.dispose();
    this.linkGeometry.dispose();
    this.routeGeometry.dispose();
    (this.linkObject.material as THREE.Material).dispose();
    (this.routeObject.material as THREE.Material).dispose();
    this.starMaterial.dispose();
    this.ringMaterial.dispose();
    this.renderer.dispose();
    this.canvas.remove();
    this.labels.remove();
  }

  private buildBackground(): { geometry: THREE.BufferGeometry; material: THREE.PointsMaterial; object: THREE.Points } {
    const count = 1500;
    const positions = new Float32Array(count * 3);
    const random = mulberry(99);
    for (let index = 0; index < count; index++) {
      const radius = 2200 + random() * 1800;
      const theta = random() * Math.PI * 2;
      const phi = Math.acos(2 * random() - 1);
      positions[index * 3] = radius * Math.sin(phi) * Math.cos(theta);
      positions[index * 3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
      positions[index * 3 + 2] = radius * Math.cos(phi);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({
      color: 0xdfe7f5,
      size: 2,
      sizeAttenuation: false,
      transparent: true,
      opacity: 0.32,
      depthWrite: false,
    });
    geometry.setDrawRange(0, count);
    const object = new THREE.Points(geometry, material);
    this.scene.add(object);
    return { geometry, material, object };
  }

  private buildProxyLayer(layout: ProxyLayout): ProxyLayer {
    const count = layout.points.length;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const alpha = new Float32Array(count).fill(1);
    const targetAlpha = new Float32Array(count).fill(1);
    const seeds = new Float32Array(count);
    layout.points.forEach((point, index) => {
      positions.set(point.xyz, index * 3);
      const chart = this.chartById.get(point.chartId);
      const color = point.chartId === "drift" ? new THREE.Color(0x9eaabc) : new THREE.Color(chart?.hue ?? "#bfd9f2");
      colors[index * 3] = color.r;
      colors[index * 3 + 1] = color.g;
      colors[index * 3 + 2] = color.b;
      sizes[index] = 8.2 + Math.min(5.5, Math.sqrt(chart?.wordCount ?? 1) * 0.2);
      seeds[index] = point.seed;
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("aColor", new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute("aAlpha", new THREE.BufferAttribute(alpha, 1));
    geometry.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 1));
    const object = new THREE.Points(geometry, this.starMaterial);
    object.frustumCulled = false;
    this.scene.add(object);
    return {
      points: layout.points,
      positions,
      alpha,
      targetAlpha,
      geometry,
      object,
      screen: new Float32Array(count * 2),
      onScreen: new Uint8Array(count),
    };
  }

  private buildWordLayer(words: PositionedWord[], previous: WordLayer | null = null): WordLayer {
    const count = words.length;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const alpha = new Float32Array(count);
    const targetAlpha = new Float32Array(count).fill(1);
    const seeds = new Float32Array(count);
    const random = mulberry(31);
    const index = new Map<string, number>();
    words.forEach((word, wordIndex) => {
      index.set(word.lemma, wordIndex);
      positions.set(word.xyz, wordIndex * 3);
      seeds[wordIndex] = random();
    });

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("aColor", new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute("aAlpha", new THREE.BufferAttribute(alpha, 1));
    geometry.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 1));
    const points = new THREE.Points(geometry, this.starMaterial);
    points.frustumCulled = false;
    this.scene.add(points);

    const ringSizes = new Float32Array(count);
    const ringAlpha = new Float32Array(count);
    const ringGain = new Float32Array(count);
    const ringGeometry = new THREE.BufferGeometry();
    ringGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    ringGeometry.setAttribute("aSize", new THREE.BufferAttribute(ringSizes, 1));
    ringGeometry.setAttribute("aAlpha", new THREE.BufferAttribute(ringAlpha, 1));
    const rings = new THREE.Points(ringGeometry, this.ringMaterial);
    rings.frustumCulled = false;
    this.scene.add(rings);

    const layer = {
      words,
      index,
      positions,
      alpha,
      targetAlpha,
      colors,
      sizes,
      geometry,
      points,
      ringSizes,
      ringAlpha,
      ringGain,
      ringGeometry,
      rings,
      screen: new Float32Array(count * 2),
      onScreen: new Uint8Array(count),
    };
    this.refreshLayerAttributes(layer);
    const transferred = transferAlphaStateByLemma(
      words.map((word) => word.lemma),
      targetAlpha,
      previous && {
        lemmas: previous.words.map((word) => word.lemma),
        current: previous.alpha,
        target: previous.targetAlpha,
      },
    );
    alpha.set(transferred.current);
    targetAlpha.set(transferred.target);
    for (let index = 0; index < count; index++) {
      ringAlpha[index] = ringGain[index] * Math.max(0.18, alpha[index]);
    }
    return layer;
  }

  private disposeWordLayer(layer: WordLayer | null): void {
    if (!layer) return;
    this.scene.remove(layer.points, layer.rings);
    layer.geometry.dispose();
    layer.ringGeometry.dispose();
  }

  private rebuildResidentLayer(): void {
    const oldLayer = this.residentLayer;
    this.residentLayer = this.buildWordLayer(this.model.residentWords(), oldLayer);
    const residentVisible = !this.fullLayer;
    this.residentLayer.points.visible = residentVisible;
    this.residentLayer.rings.visible = residentVisible && hasVisibleRingData(this.residentLayer);
    this.disposeWordLayer(oldLayer);
  }

  private wordLabelTransition(): string {
    return this.reducedMotion ? "none" : `opacity ${Math.max(120, this.transitionMs * 0.75)}ms ease`;
  }

  private chartLabelTransition(): string {
    return this.reducedMotion ? "none" : `opacity ${Math.max(140, this.transitionMs * 0.9)}ms ease`;
  }

  private createWordLabelElement(): HTMLDivElement {
    const element = document.createElement("div");
    element.dataset.starLabel = "";
    element.style.cssText = "position:absolute;transform:translate(-50%,-50%);white-space:nowrap;" +
      "font:500 12.5px/1 'IBM Plex Sans',system-ui,sans-serif;letter-spacing:.01em;" +
      `color:#F1EEE6;opacity:0;transition:${this.wordLabelTransition()};text-shadow:0 1px 8px rgba(7,11,22,.95),0 0 2px rgba(7,11,22,1);` +
      "padding:2px 5px;border-radius:5px;will-change:transform,opacity";
    return element;
  }

  private createChartLabelElement(chartId: string): HTMLDivElement | null {
    const chart = this.chartById.get(chartId);
    if (!chart) return null;
    const element = document.createElement("div");
    element.dataset.chartLabel = chart.id;
    const glyph = document.createElement("span");
    glyph.textContent = chart.glyph;
    glyph.style.cssText = "font-size:10px;letter-spacing:.22em;opacity:.55";
    const name = document.createElement("span");
    name.textContent = chart.name.toUpperCase();
    name.style.marginLeft = "8px";
    element.append(glyph, name);
    element.style.cssText = "position:absolute;transform:translate(-50%,-50%);white-space:nowrap;" +
      "font:600 11px/1 'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.18em;" +
      `color:${chart.hue};opacity:0;transition:${this.chartLabelTransition()};` +
      "text-shadow:0 1px 10px rgba(7,11,22,.98);will-change:transform,opacity";
    return element;
  }

  private buildLabelChunk(chunk: DeferredLabelChunk): void {
    const fragment = document.createDocumentFragment();
    for (let index = 0; index < chunk.wordCount; index++) {
      const element = this.createWordLabelElement();
      fragment.appendChild(element);
      this.labelElements.push(element);
    }

    for (let index = 0; index < chunk.chartCount; index++) {
      const chartId = this.labelChartIds[chunk.chartStart + index];
      if (!chartId) continue;
      const element = this.createChartLabelElement(chartId);
      if (!element) continue;
      fragment.appendChild(element);
      this.chartElements.set(chartId, element);
    }

    if (fragment.childNodes.length) this.labels.appendChild(fragment);
  }

  private scheduleDeferredLabels(): void {
    if (this.labelsBuilt || this.labelBuildTimer || this.dead) return;
    if (this.labelBuildChunkIndex >= this.deferredLabelChunks.length) {
      this.labelsBuilt = true;
      return;
    }
    this.labelBuildTimer = window.setTimeout(() => {
      this.labelBuildTimer = 0;
      if (this.dead) return;
      const chunk = this.deferredLabelChunks[this.labelBuildChunkIndex];
      if (!chunk) {
        this.labelsBuilt = true;
        return;
      }
      this.buildLabelChunk(chunk);
      this.labelBuildChunkIndex += 1;
      this.refreshLabelAssignments();
      if (this.labelBuildChunkIndex >= this.deferredLabelChunks.length) {
        this.labelsBuilt = true;
        return;
      }
      this.scheduleDeferredLabels();
    }, 0);
  }

  private updateLabelTransitions(transitionMs: number): void {
    if (this.reducedMotion) return;
    const wordTransition = `opacity ${Math.max(120, transitionMs * 0.75)}ms ease`;
    const chartTransition = `opacity ${Math.max(140, transitionMs * 0.9)}ms ease`;
    for (const element of this.labelElements) element.style.transition = wordTransition;
    for (const element of this.chartElements.values()) element.style.transition = chartTransition;
  }

  private bindContextLifecycle(): void {
    const signal = this.events.signal;
    this.canvas.addEventListener("webglcontextlost", (event) => {
      event.preventDefault();
      this.contextLost = true;
      if (this.restoreTimer) clearTimeout(this.restoreTimer);
      setTimeout(() => {
        if (!this.dead && this.contextLost) this.renderer.forceContextRestore();
      }, 0);
      this.restoreTimer = setTimeout(() => {
        if (this.contextLost) this.reportContextFailure();
      }, 2000);
    }, { signal });
    this.canvas.addEventListener("webglcontextrestored", () => {
      this.contextLost = false;
      if (this.restoreTimer) clearTimeout(this.restoreTimer);
      this.restoreTimer = undefined;
      this.renderer.resetState();
      this.resize();
    }, { signal });
  }

  private reportContextFailure(): void {
    if (this.contextFailureReported) return;
    this.contextFailureReported = true;
    this.options.onContextFailure?.();
  }

  private bindInput(): void {
    let drag: { x: number; y: number; id: number } | null = null;
    let moved = 0;
    let pinch: number | null = null;
    const signal = this.events.signal;

    this.host.addEventListener("pointerdown", (event) => {
      if (event.pointerType === "touch" && event.isPrimary === false) return;
      drag = { x: event.clientX, y: event.clientY, id: event.pointerId };
      moved = 0;
      this.host.style.cursor = "grabbing";
      this.host.setPointerCapture(event.pointerId);
    }, { signal });
    this.host.addEventListener("pointermove", (event) => {
      if (drag && event.pointerId === drag.id) {
        const dx = event.clientX - drag.x;
        const dy = event.clientY - drag.y;
        moved += Math.abs(dx) + Math.abs(dy);
        this.cameraState.targetTheta -= dx * 0.0042;
        this.cameraState.targetPhi = Math.max(0.22, Math.min(Math.PI - 0.22, this.cameraState.targetPhi - dy * 0.0042));
        drag.x = event.clientX;
        drag.y = event.clientY;
        return;
      }
      const pick = this.pick(event);
      const hover = pick?.type === "word" ? pick.id : null;
      if (hover !== this.state.hover) {
        this.state.hover = hover;
        this.host.style.cursor = pick ? "pointer" : "grab";
        this.refreshWordAttributes();
        this.refreshLabelAssignments();
      }
    }, { signal });
    this.host.addEventListener("pointerup", (event) => {
      if (!drag || event.pointerId !== drag.id) return;
      this.host.releasePointerCapture(event.pointerId);
      this.host.style.cursor = "grab";
      const click = moved < 7;
      drag = null;
      if (!click) return;
      const pick = this.pick(event);
      if (pick?.type === "word") this.options.onSelectWord?.(pick.id);
      else if (pick?.type === "chart") this.options.onSelectChart?.(pick.id);
      else this.options.onSelectWord?.(null);
    }, { signal });
    this.host.addEventListener("pointercancel", () => {
      drag = null;
      this.host.style.cursor = "grab";
    }, { signal });
    this.host.addEventListener("wheel", (event) => {
      event.preventDefault();
      this.cameraState.targetDistance = Math.max(120, Math.min(1700, this.cameraState.targetDistance * Math.exp(event.deltaY * 0.0011)));
    }, { passive: false, signal });
    this.host.addEventListener("touchstart", (event) => {
      if (event.touches.length === 2) {
        pinch = Math.hypot(
          event.touches[0].clientX - event.touches[1].clientX,
          event.touches[0].clientY - event.touches[1].clientY,
        );
      }
    }, { passive: true, signal });
    this.host.addEventListener("touchmove", (event) => {
      if (event.touches.length === 2 && pinch) {
        const distance = Math.hypot(
          event.touches[0].clientX - event.touches[1].clientX,
          event.touches[0].clientY - event.touches[1].clientY,
        );
        this.cameraState.targetDistance = Math.max(120, Math.min(1700, this.cameraState.targetDistance * (pinch / distance)));
        pinch = distance;
      }
    }, { passive: true, signal });
    this.host.addEventListener("touchend", () => {
      pinch = null;
    }, { passive: true, signal });
  }

  private pick(event: { clientX: number; clientY: number }): PickResult {
    const bounds = this.host.getBoundingClientRect();
    const x = event.clientX - bounds.left;
    const y = event.clientY - bounds.top;
    let best: PickResult = null;
    let bestDistance = PICK_RADIUS_SQ;
    const layer = this.activeWordLayer();
    if (layer) {
      for (let index = 0; index < layer.words.length; index++) {
        if (!layer.onScreen[index] || layer.alpha[index] < 0.22) continue;
        const dx = layer.screen[index * 2] - x;
        const dy = layer.screen[index * 2 + 1] - y;
        const distance = dx * dx + dy * dy;
        const claimedPadding = this.state.claimed.has(layer.words[index].lemma) ? 90 : 0;
        if (distance < bestDistance + claimedPadding) {
          bestDistance = distance;
          best = { type: "word", id: layer.words[index].lemma };
        }
      }
    }
    for (let index = 0; index < this.proxyLayer.points.length; index++) {
      if (!this.proxyLayer.onScreen[index] || this.proxyLayer.alpha[index] < 0.22) continue;
      const dx = this.proxyLayer.screen[index * 2] - x;
      const dy = this.proxyLayer.screen[index * 2 + 1] - y;
      const distance = dx * dx + dy * dy;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = { type: "chart", id: this.proxyLayer.points[index].chartId };
      }
    }
    return best;
  }

  private setProxyChartTarget(chartId: string, alpha: number): void {
    if (this.fullLayer) return;
    this.proxyLayer.points.forEach((point, index) => {
      if (point.chartId === chartId) this.proxyLayer.targetAlpha[index] = alpha;
    });
  }

  private syncProxyTargets(): void {
    const residentCharts = new Set(this.model.residentWords().map((word) => word.chartId));
    this.proxyLayer.points.forEach((point, index) => {
      this.proxyLayer.targetAlpha[index] = residentCharts.has(point.chartId) ? 0 : 1;
    });
  }

  private activeWordLayer(): WordLayer | null {
    return this.fullLayer ?? this.residentLayer;
  }

  private refreshContext(): void {
    this.refreshFocusNeighbors();
    this.refreshWordAttributes();
    this.rebuildLinks();
    this.writeRoute();
    this.refreshLabelAssignments();
  }

  private refreshFocusNeighbors(): void {
    this.focusNeighbors.clear();
    if (!this.state.focus) return;
    for (const edge of this.model.residentEdges()) {
      if (edge.source === this.state.focus) this.focusNeighbors.add(edge.target);
      if (edge.target === this.state.focus) this.focusNeighbors.add(edge.source);
    }
  }

  private refreshWordAttributes(): void {
    if (this.residentLayer) this.refreshLayerAttributes(this.residentLayer);
    if (this.fullLayer) this.refreshLayerAttributes(this.fullLayer);
  }

  private refreshLayerAttributes(layer: WordLayer): void {
    layer.words.forEach((word, index) => {
      const claimed = this.state.claimed.has(word.lemma);
      const used = this.state.used.has(word.lemma);
      const color = wordColor(word, claimed, used);
      layer.colors.set(color, index * 3);
      let size = 7.6 + Math.sqrt(word.degree) * 2.7;
      if (claimed) size += 2;
      if (used) size += 2.8;
      if (word.lemma === this.state.hover) size += 4;
      if (word.lemma === this.state.focus) size += 7;
      if (this.state.mode === "run" && this.state.routeSet.has(word.lemma)) size += 3.6;
      layer.sizes[index] = size;

      let alpha = 1;
      if (this.state.focus) alpha = word.lemma === this.state.focus ? 1 : this.focusNeighbors.has(word.lemma) ? 0.95 : 0.14;
      else if (this.state.chart) alpha = word.chartId === this.state.chart ? 1 : 0.13;
      else if (this.state.mode === "run" && this.state.route.length) alpha = this.state.routeSet.has(word.lemma) ? 1 : 0.22;
      else if (this.state.mode === "ladder") alpha = word.tier === "advanced" || word.degree >= 6 ? 1 : 0.3;
      layer.targetAlpha[index] = alpha;
      layer.ringSizes[index] = size + 9;
      layer.ringGain[index] = used ? 1 : claimed ? 0.4 : 0;
    });
    layer.geometry.getAttribute("aColor").needsUpdate = true;
    layer.geometry.getAttribute("aSize").needsUpdate = true;
    layer.ringGeometry.getAttribute("aSize").needsUpdate = true;
    layer.rings.visible = hasVisibleRingData(layer);
  }

  private browseVisibility(word: PositionedWord): number {
    if (this.state.claimed.has(word.lemma)) return 1;
    if (this.level === "galaxy") return word.degree >= 11 ? 1 : 0.05;
    if (this.level === "cluster") return word.chartId === this.nearestChart ? 1 : word.degree >= 5 ? 0.55 : 0.14;
    return word.chartId === this.nearestChart ? 1 : 0.45;
  }

  private isBrowsing(): boolean {
    return !this.state.focus && !this.state.chart && this.state.mode !== "ladder"
      && !(this.state.mode === "run" && this.state.route.length > 0);
  }

  private rebuildLinks(): void {
    const layer = this.activeWordLayer();
    const positions: number[] = [];
    const colors: number[] = [];
    if (layer) {
      for (const edge of this.model.residentEdges()) {
        const source = layer.index.get(edge.source);
        const target = layer.index.get(edge.target);
        if (source === undefined || target === undefined || !this.edgeVisible(edge, layer)) continue;
        const sourceOffset = source * 3;
        const targetOffset = target * 3;
        positions.push(
          layer.positions[sourceOffset], layer.positions[sourceOffset + 1], layer.positions[sourceOffset + 2],
          layer.positions[targetOffset], layer.positions[targetOffset + 1], layer.positions[targetOffset + 2],
        );
        const color = LINK[edge.type] ?? [0.5, 0.55, 0.62];
        const weight = this.edgeWeight(edge, layer);
        colors.push(
          color[0] * weight, color[1] * weight, color[2] * weight,
          color[0] * weight, color[1] * weight, color[2] * weight,
        );
      }
    }
    this.linkGeometry.dispose();
    this.linkGeometry = new THREE.BufferGeometry();
    this.linkGeometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
    this.linkGeometry.setAttribute("color", new THREE.BufferAttribute(new Float32Array(colors), 3));
    this.linkObject.geometry = this.linkGeometry;
  }

  private edgeVisible(edge: ShardEdge, layer: WordLayer): boolean {
    if (this.state.focus) return edge.source === this.state.focus || edge.target === this.state.focus;
    if (this.state.chart) {
      return layer.words[layer.index.get(edge.source)!].chartId === this.state.chart
        && layer.words[layer.index.get(edge.target)!].chartId === this.state.chart;
    }
    if (this.state.mode === "ladder") return edge.type === "advanced_form" || edge.type === "builds_on";
    if (this.state.mode === "run") return this.state.routeSet.has(edge.source) && this.state.routeSet.has(edge.target);
    const sourceWord = layer.words[layer.index.get(edge.source)!];
    const targetWord = layer.words[layer.index.get(edge.target)!];
    if (this.level === "galaxy") return sourceWord.degree >= 11 && targetWord.degree >= 11;
    if (this.level === "cluster") return sourceWord.chartId === this.nearestChart && targetWord.chartId === this.nearestChart;
    return sourceWord.chartId === this.nearestChart || targetWord.chartId === this.nearestChart;
  }

  private edgeWeight(edge: ShardEdge, layer: WordLayer): number {
    if (this.state.focus) return 0.95;
    if (this.state.chart) return 0.3;
    if (this.state.mode === "ladder") return 0.75;
    if (this.state.mode === "run") return 0.55;
    const sourceWord = layer.words[layer.index.get(edge.source)!];
    const targetWord = layer.words[layer.index.get(edge.target)!];
    if (this.level === "galaxy") return 0.12;
    if (this.level === "cluster") return sourceWord.chartId === this.nearestChart && targetWord.chartId === this.nearestChart ? 0.3 : 0.09;
    return 0.33;
  }

  private writeRoute(): void {
    const layer = this.activeWordLayer();
    let segments = 0;
    if (layer) {
      for (let index = 0; index + 1 < this.state.route.length && segments < MAX_ROUTE_SEGMENTS; index++) {
        const source = layer.index.get(this.state.route[index]);
        const target = layer.index.get(this.state.route[index + 1]);
        if (source === undefined || target === undefined) continue;
        const output = segments * 6;
        this.routePositions.set(layer.positions.subarray(source * 3, source * 3 + 3), output);
        this.routePositions.set(layer.positions.subarray(target * 3, target * 3 + 3), output + 3);
        segments++;
      }
    }
    this.routeGeometry.setDrawRange(0, segments * 2);
    this.routeGeometry.getAttribute("position").needsUpdate = true;
  }

  private refreshLabelAssignments(): void {
    this.labelWords = this.model.labelCandidates({
      focus: this.state.focus,
      hover: this.state.hover,
      route: this.state.routeSet,
      claimed: this.state.claimed,
      max: this.maxWordLabels,
    });
    for (let index = 0; index < this.labelElements.length; index++) {
      const word = this.labelWords[index];
      this.labelElements[index].textContent = word?.display ?? "";
      if (!word) this.labelElements[index].style.opacity = "0";
    }
  }

  private resize(): void {
    this.width = this.host.clientWidth || 800;
    this.height = this.host.clientHeight || 600;
    this.renderer.setSize(this.width, this.height, false);
    this.camera.aspect = this.width / Math.max(1, this.height);
    this.camera.updateProjectionMatrix();
  }

  private loop = (now: number): void => {
    if (this.dead) return;
    this.animationFrame = requestAnimationFrame(this.loop);
    this.frameDeltaMs = Math.max(1, now - this.lastFrameNow);
    this.lastFrameNow = now;
    const damping = this.reducedMotion ? 1 : Math.min(1, (this.frameDeltaMs * 2.5) / this.transitionMs);
    const camera = this.cameraState;
    camera.theta += (camera.targetTheta - camera.theta) * damping;
    camera.phi += (camera.targetPhi - camera.phi) * damping;
    camera.distance += (camera.targetDistance - camera.distance) * damping;
    camera.target.lerp(camera.targetGoal, damping);

    this.eyeVector.set(
      camera.target.x + camera.distance * Math.sin(camera.phi) * Math.cos(camera.theta),
      camera.target.y + camera.distance * Math.cos(camera.phi),
      camera.target.z + camera.distance * Math.sin(camera.phi) * Math.sin(camera.theta),
    );
    this.camera.position.copy(this.eyeVector);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(camera.target);
    this.camera.updateMatrixWorld();
    if (this.state.panelOffset) {
      const unitsPerPixel = (2 * Math.tan((this.camera.fov * Math.PI / 180) / 2) * camera.distance) / Math.max(1, this.height);
      this.rightVector.setFromMatrixColumn(this.camera.matrixWorld, 0);
      this.shiftVector.copy(this.rightVector).multiplyScalar((this.state.panelOffset / 2) * unitsPerPixel);
      this.camera.position.add(this.shiftVector);
      this.lookVector.copy(camera.target).add(this.shiftVector);
      this.camera.lookAt(this.lookVector);
      this.camera.updateMatrixWorld();
    }

    this.updateAlphas();
    this.starMaterial.uniforms.uTime.value = (now - this.startTime) / 1000;
    this.project(now);
    if (!this.contextLost) {
      this.renderer.render(this.scene, this.camera);
      if (!this.firstRender) {
        this.firstRender = true;
        markGalaxyRendererVisible();
        this.options.onConstellationVisible?.();
        this.scheduleDeferredLabels();
      }
    }
  };

  private updateAlphas(): void {
    const rate = this.reducedMotion ? 1 : Math.min(1, (this.frameDeltaMs * 2.75) / this.transitionMs);
    let proxyChanged = false;
    for (let index = 0; index < this.proxyLayer.alpha.length; index++) {
      const delta = this.proxyLayer.targetAlpha[index] - this.proxyLayer.alpha[index];
      if (Math.abs(delta) > 0.004) {
        this.proxyLayer.alpha[index] += delta * rate;
        proxyChanged = true;
      } else if (this.proxyLayer.alpha[index] !== this.proxyLayer.targetAlpha[index]) {
        this.proxyLayer.alpha[index] = this.proxyLayer.targetAlpha[index];
        proxyChanged = true;
      }
    }
    if (proxyChanged) this.proxyLayer.geometry.getAttribute("aAlpha").needsUpdate = true;
    const layer = this.activeWordLayer();
    if (!layer) return;
    let changed = false;
    const browsing = this.isBrowsing();
    for (let index = 0; index < layer.words.length; index++) {
      const goal = layer.targetAlpha[index] * (browsing ? this.browseVisibility(layer.words[index]) : 1);
      const delta = goal - layer.alpha[index];
      if (Math.abs(delta) > 0.004) {
        layer.alpha[index] += delta * rate;
        changed = true;
      } else if (layer.alpha[index] !== goal) {
        layer.alpha[index] = goal;
        changed = true;
      }
      layer.ringAlpha[index] = layer.ringGain[index] * Math.max(0.18, layer.alpha[index]);
    }
    if (changed) layer.geometry.getAttribute("aAlpha").needsUpdate = true;
    layer.ringGeometry.getAttribute("aAlpha").needsUpdate = true;
  }

  private project(now: number): void {
    const previousLevel = this.level;
    const previousNearest = this.nearestChart;
    const transition = zoomLevelTransition(this.notifiedLevel, this.cameraState.distance);
    this.level = transition.level;
    this.nearestChart = this.findNearestChart();
    if (transition.changed) {
      this.notifiedLevel = transition.level;
      this.options.onZoomLevel?.(transition.level);
    }
    if (this.level !== previousLevel || this.nearestChart !== previousNearest) this.rebuildLinks();
    this.updateApproach(now);

    const layer = this.activeWordLayer();
    if (layer) this.projectPositions(layer.positions, layer.screen, layer.onScreen);
    this.projectPositions(this.proxyLayer.positions, this.proxyLayer.screen, this.proxyLayer.onScreen);
    this.projectWordLabels(layer);
    this.projectChartLabels();
  }

  private findNearestChart(): string | null {
    this.probeVector.copy(this.camera.position).lerp(this.cameraState.target, 0.35);
    let nearest: string | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const chart of this.manifest.charts) {
      if (chart.id === "drift") continue;
      const dx = chart.center[0] - this.probeVector.x;
      const dy = chart.center[1] - this.probeVector.y;
      const dz = chart.center[2] - this.probeVector.z;
      const distance = dx * dx + dy * dy + dz * dz;
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearest = chart.id;
      }
    }
    return nearest;
  }

  private updateApproach(now: number): void {
    if (this.level !== "cluster" || !this.nearestChart) {
      this.approachCandidate = null;
      this.approachSince = 0;
      if (this.approachedChart) {
        this.approachedChart = null;
        this.options.onApproachChart?.(null);
      }
      return;
    }
    if (this.approachCandidate !== this.nearestChart) {
      this.approachCandidate = this.nearestChart;
      this.approachSince = now;
      if (this.approachedChart) {
        this.approachedChart = null;
        this.options.onApproachChart?.(null);
      }
      return;
    }
    if (!this.approachedChart && now - this.approachSince >= 300) {
      this.approachedChart = this.nearestChart;
      this.options.onApproachChart?.(this.nearestChart);
    }
  }

  private projectPositions(positions: Float32Array, screen: Float32Array, onScreen: Uint8Array): void {
    const halfWidth = this.width / 2;
    const halfHeight = this.height / 2;
    for (let index = 0; index < onScreen.length; index++) {
      this.projectVector.set(positions[index * 3], positions[index * 3 + 1], positions[index * 3 + 2]).project(this.camera);
      onScreen[index] = this.projectVector.z < 1 && this.projectVector.x > -1.15 && this.projectVector.x < 1.15
        && this.projectVector.y > -1.15 && this.projectVector.y < 1.15 ? 1 : 0;
      screen[index * 2] = this.projectVector.x * halfWidth + halfWidth;
      screen[index * 2 + 1] = -this.projectVector.y * halfHeight + halfHeight;
    }
  }

  private projectWordLabels(layer: WordLayer | null): void {
    const labelCount = Math.min(this.labelWords.length, this.labelElements.length);
    for (let labelIndex = 0; labelIndex < labelCount; labelIndex++) {
      const element = this.labelElements[labelIndex];
      const word = this.labelWords[labelIndex];
      const wordIndex = word && layer ? layer.index.get(word.lemma) : undefined;
      if (!word || !layer || wordIndex === undefined || !layer.onScreen[wordIndex] || layer.alpha[wordIndex] < 0.2
        || !this.wordLabelVisible(word)) {
        if (element.style.opacity !== "0") element.style.opacity = "0";
        continue;
      }
      const x = layer.screen[wordIndex * 2];
      const y = layer.screen[wordIndex * 2 + 1];
      element.style.transform = `translate(-50%,-50%) translate(${x.toFixed(1)}px,${(y - 17).toFixed(1)}px)`;
      let opacity = word.lemma === this.state.focus ? 1 : this.state.focus ? 0.86 : 0.8;
      if (word.lemma === this.state.hover) opacity = 1;
      element.style.opacity = String(opacity);
      element.style.fontWeight = word.lemma === this.state.focus ? "600" : "500";
      element.style.fontSize = word.lemma === this.state.focus ? "15px" : "12.5px";
      element.style.color = this.state.claimed.has(word.lemma) ? "#8FE3C0" : "#F1EEE6";
    }
  }

  private wordLabelVisible(word: PositionedWord): boolean {
    if (this.state.focus) return word.lemma === this.state.focus || this.focusNeighbors.has(word.lemma);
    if (word.lemma === this.state.hover) return true;
    if (this.state.mode === "run" && this.state.routeSet.has(word.lemma)) return true;
    if (this.state.chart) return word.chartId === this.state.chart;
    if (this.level === "star" || this.level === "cluster") return word.chartId === this.nearestChart;
    return this.state.claimed.has(word.lemma) && word.degree >= 9;
  }

  private projectChartLabels(): void {
    const halfWidth = this.width / 2;
    const halfHeight = this.height / 2;
    for (const chart of this.manifest.charts) {
      const element = this.chartElements.get(chart.id);
      if (!element) continue;
      let visible = !this.state.focus && (this.level === "galaxy" || this.state.chart === chart.id);
      if (this.state.chart && this.state.chart !== chart.id) visible = false;
      if (!visible) {
        if (element.style.opacity !== "0") element.style.opacity = "0";
        continue;
      }
      this.projectVector.set(...chart.center).project(this.camera);
      if (this.projectVector.z > 1) {
        element.style.opacity = "0";
        continue;
      }
      const x = this.projectVector.x * halfWidth + halfWidth;
      const y = -this.projectVector.y * halfHeight + halfHeight;
      element.style.transform = `translate(-50%,-50%) translate(${x.toFixed(1)}px,${(y - 30).toFixed(1)}px)`;
      element.style.opacity = "0.95";
    }
  }
}
