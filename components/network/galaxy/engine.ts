/**
 * StarEngine — deterministic, calm 3D word-constellation renderer.
 * Ported from the Star Atlas prototype's `galaxy-engine.js` to a plain TS class
 * (mounted from a client component). Layout is computed once and frozen (no live
 * physics); heavy drawing is 3 draw calls (stars, claim-rings, links). Camera has
 * a locked up-vector and damping, so it never disorients. Picking is screen-space.
 */
import * as THREE from "three";

import type { AtlasData, AtlasNeighbor } from "./atlas";

type Vec3 = [number, number, number];
const COL: Record<string, Vec3> = {
  core: [0.749, 0.851, 0.949],
  advanced: [0.796, 0.725, 0.914],
  hub: [0.949, 0.851, 0.627],
  claimed: [0.478, 0.796, 0.671],
  used: [0.741, 1.0, 0.878],
  quiet: [0.62, 0.67, 0.74],
};
const LINK: Record<string, Vec3> = {
  synonym: [0.42, 0.78, 0.66], antonym: [0.9, 0.56, 0.55],
  intensity: [0.93, 0.8, 0.5], collocation: [0.55, 0.6, 0.7],
  builds_on: [0.7, 0.63, 0.88], advanced_form: [0.72, 0.62, 0.93],
  morphological: [0.5, 0.72, 0.88],
};

function mulberry(seed: number) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const VERT = `
attribute vec3 aColor; attribute float aSize; attribute float aAlpha; attribute float aSeed;
uniform float uTime; uniform float uDpr;
varying vec3 vColor; varying float vAlpha;
void main(){
  vColor = aColor;
  float tw = 0.86 + 0.14 * sin(uTime * 0.7 + aSeed * 6.2831);
  vAlpha = aAlpha * tw;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = min(48.0, aSize * uDpr * (820.0 / max(1.0, -mv.z)));
  gl_Position = projectionMatrix * mv;
}`;
const FRAG = `
varying vec3 vColor; varying float vAlpha;
void main(){
  float d = length(gl_PointCoord - vec2(0.5)) * 2.0;
  if (d > 1.0) discard;
  float core = smoothstep(0.46, 0.0, d);
  float halo = smoothstep(1.0, 0.16, d) * 0.34;
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
varying float vAlpha;
void main(){
  float d = length(gl_PointCoord - vec2(0.5)) * 2.0;
  float ring = smoothstep(0.62, 0.76, d) * (1.0 - smoothstep(0.88, 1.0, d));
  if (ring < 0.01) discard;
  gl_FragColor = vec4(0.60, 0.93, 0.79, ring * vAlpha * 0.95);
}`;

export type StarEngineOptions = {
  onSelect?: (lemma: string | null) => void;
  onHover?: (lemma: string | null) => void;
  onZoomLevel?: (level: "galaxy" | "cluster" | "star") => void;
};

type WordT = { lemma: string; display: string; tier: "core" | "advanced"; chart: string; degree: number };
type ChartT = { id: string; name: string; glyph: string; hue: string };
type EdgeT = { source: string; target: string; type: string };

export class StarEngine {
  private host: HTMLElement;
  private opts: StarEngineOptions;
  private data: AtlasData;

  private canvas!: HTMLCanvasElement;
  private labels!: HTMLDivElement;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private renderer!: THREE.WebGLRenderer;
  private dpr = 1;
  private _dead = false;
  private _t0 = 0;
  private _level: string | null = null;
  private _nearestChart: string | null = null;
  private _linkKey = "";
  private _ro?: ResizeObserver;
  private linkGain = 1;
  private vw = 800;
  private vh = 600;

  private words: WordT[] = [];
  private charts: ChartT[] = [];
  private edges: EdgeT[] = [];
  // Prototype-less maps: lemmas/chart-ids like "constructor" are valid words but
  // reserved Object.prototype keys, so a plain {} would return inherited members.
  private adj: Record<string, AtlasNeighbor[]> = Object.create(null);
  private index: Record<string, number> = Object.create(null);

  private cam!: {
    theta: number; phi: number; dist: number;
    tTheta: number; tPhi: number; tDist: number;
    target: THREE.Vector3; tTarget: THREE.Vector3;
  };
  private state = {
    mode: "chart" as string, chart: null as string | null, focus: null as string | null,
    hover: null as string | null, claimed: new Set<string>(), used: new Set<string>(),
    route: [] as string[], routeIndex: 0, panelOffset: 0, dimAll: false,
  };

  private chartCenter: Record<string, THREE.Vector3> = Object.create(null);
  private frames: Record<string, { axis: THREE.Vector3; u: THREE.Vector3; v: THREE.Vector3 }> = Object.create(null);
  private base!: Float32Array;
  private disp!: Float32Array;
  private goal!: Float32Array;
  private screen!: Float32Array;
  private onScreen!: Uint8Array;
  private alpha!: Float32Array;
  private goalAlpha!: Float32Array;

  private aColor!: Float32Array;
  private aSize!: Float32Array;
  private aAlpha!: Float32Array;
  private starGeo!: THREE.BufferGeometry;
  private starMat!: THREE.ShaderMaterial;
  private stars!: THREE.Points;

  private rSize!: Float32Array;
  private rAlpha!: Float32Array;
  private rGain!: Float32Array;
  private ringGeo!: THREE.BufferGeometry;

  private lPos!: Float32Array;
  private lCol!: Float32Array;
  private linkGeo!: THREE.BufferGeometry;

  private routePos!: Float32Array;
  private routeGeo!: THREE.BufferGeometry;
  private route!: THREE.LineSegments;

  private labelEls: HTMLDivElement[] = [];
  private chartEls: HTMLDivElement[] = [];

  constructor(host: HTMLElement, data: AtlasData, opts: StarEngineOptions = {}) {
    this.host = host;
    this.data = data;
    this.opts = opts;

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

    this._initScene();
    this._buildLayout();
    this._buildObjects();
    this._bindInput();

    this._ro = new ResizeObserver(() => this._resize());
    this._ro.observe(host);
    this._resize();
    this._t0 = performance.now();
    requestAnimationFrame(this._loop);
  }

  dispose() {
    this._dead = true;
    this._ro?.disconnect();
    this.renderer?.dispose();
    this.host.innerHTML = "";
  }

  private _initScene() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(52, 1, 1, 6000);
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas, antialias: true, alpha: true, preserveDrawingBuffer: true,
    });
    this.renderer.setClearColor(0x070b16, 1);
    this.renderer.sortObjects = false;
    this.dpr = Math.min(window.devicePixelRatio || 1, 1.75);
    this.renderer.setPixelRatio(this.dpr);

    this.cam = {
      theta: 0.7, phi: 1.15, dist: 980, tTheta: 0.7, tPhi: 1.15, tDist: 980,
      target: new THREE.Vector3(), tTarget: new THREE.Vector3(),
    };

    const n = 1500, pos = new Float32Array(n * 3);
    const rnd = mulberry(99);
    for (let i = 0; i < n; i++) {
      const r = 2200 + rnd() * 1800, th = rnd() * Math.PI * 2, ph = Math.acos(2 * rnd() - 1);
      pos[i * 3] = r * Math.sin(ph) * Math.cos(th);
      pos[i * 3 + 1] = r * Math.sin(ph) * Math.sin(th);
      pos[i * 3 + 2] = r * Math.cos(ph);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    this.scene.add(new THREE.Points(g, new THREE.PointsMaterial({
      color: 0xdfe7f5, size: 2.0, sizeAttenuation: false, transparent: true, opacity: 0.32, depthWrite: false,
    })));
  }

  private _buildLayout() {
    this.charts = this.data.charts;
    this.words = this.data.words;
    this.edges = this.data.edges;
    this.adj = this.data.adj;
    for (let i = 0; i < this.words.length; i++) this.index[this.words[i].lemma] = i;

    const C = this.charts.length, R = 470;
    for (let i = 0; i < C; i++) {
      const y = 1 - (i / Math.max(1, C - 1)) * 1.55 - 0.22;
      const rad = Math.sqrt(Math.max(0.02, 1 - y * y));
      const th = i * 2.39996;
      const c = new THREE.Vector3(Math.cos(th) * rad, y * 0.72, Math.sin(th) * rad).multiplyScalar(R);
      this.chartCenter[this.charts[i].id] = c;
      const axis = c.clone().normalize();
      const u = new THREE.Vector3(0, 1, 0).cross(axis);
      if (u.lengthSq() < 0.01) u.set(1, 0, 0);
      u.normalize();
      const v = axis.clone().cross(u).normalize();
      this.frames[this.charts[i].id] = { axis, u, v };
    }

    const groups: Record<string, WordT[]> = Object.create(null);
    for (const w of this.words) (groups[w.chart] ??= []).push(w);
    this.base = new Float32Array(this.words.length * 3);
    const rnd = mulberry(7);
    for (const id of Object.keys(groups)) {
      const list = groups[id].slice().sort((a, b) => b.degree - a.degree);
      const N = list.length;
      // "drift" = unclustered words. Scatter them diffusely over the whole sphere
      // as ambient field stars instead of packing them into one dense disc.
      if (id === "drift") {
        for (let j = 0; j < N; j++) {
          const yv = rnd() * 2 - 1;
          const rr = Math.sqrt(Math.max(0, 1 - yv * yv));
          const ang = rnd() * Math.PI * 2;
          const rad = R * (1.02 + (rnd() - 0.5) * 0.34);
          const k = this.index[list[j].lemma] * 3;
          this.base[k] = Math.cos(ang) * rr * rad;
          this.base[k + 1] = yv * 0.72 * rad;
          this.base[k + 2] = Math.sin(ang) * rr * rad;
        }
        continue;
      }
      const f = this.frames[id], c = this.chartCenter[id];
      if (!f || !c) continue;
      for (let j = 0; j < N; j++) {
        const t = (j + 0.5) / N;
        const rr = 34 + Math.sqrt(t) * 122;
        const ang = j * 2.39996 + rnd() * 0.35;
        const out = (rnd() - 0.5) * 62;
        const p = new THREE.Vector3().copy(c)
          .addScaledVector(f.u, Math.cos(ang) * rr)
          .addScaledVector(f.v, Math.sin(ang) * rr)
          .addScaledVector(f.axis, out);
        const k = this.index[list[j].lemma] * 3;
        this.base[k] = p.x; this.base[k + 1] = p.y; this.base[k + 2] = p.z;
      }
    }

    // deterministic relaxation so no two stars overlap (chart-scoped → cheap)
    const MIN = 30, n = this.words.length;
    for (let pass = 0; pass < 90; pass++) {
      for (let i = 0; i < n; i++) {
        if (this.words[i].chart === "drift") continue; // scattered field stars — no de-overlap needed
        for (let j = i + 1; j < n; j++) {
          if (this.words[i].chart !== this.words[j].chart) continue;
          const ax = this.base[i * 3] - this.base[j * 3];
          const ay = this.base[i * 3 + 1] - this.base[j * 3 + 1];
          const az = this.base[i * 3 + 2] - this.base[j * 3 + 2];
          const d2 = ax * ax + ay * ay + az * az;
          if (d2 > MIN * MIN || d2 < 1e-6) continue;
          const d = Math.sqrt(d2), push = ((MIN - d) / d) * 0.5;
          this.base[i * 3] += ax * push; this.base[i * 3 + 1] += ay * push; this.base[i * 3 + 2] += az * push;
          this.base[j * 3] -= ax * push; this.base[j * 3 + 1] -= ay * push; this.base[j * 3 + 2] -= az * push;
        }
      }
    }

    this.disp = new Float32Array(this.base);
    this.goal = new Float32Array(this.base);
    this.screen = new Float32Array(this.words.length * 2);
    this.onScreen = new Uint8Array(this.words.length);
    this.alpha = new Float32Array(this.words.length).fill(1);
    this.goalAlpha = new Float32Array(this.words.length).fill(1);
  }

  private _buildObjects() {
    const n = this.words.length;
    const g = new THREE.BufferGeometry();
    this.aColor = new Float32Array(n * 3);
    this.aSize = new Float32Array(n);
    this.aAlpha = new Float32Array(n).fill(1);
    const aSeed = new Float32Array(n);
    const rnd = mulberry(31);
    for (let i = 0; i < n; i++) aSeed[i] = rnd();
    g.setAttribute("position", new THREE.BufferAttribute(this.disp, 3));
    g.setAttribute("aColor", new THREE.BufferAttribute(this.aColor, 3));
    g.setAttribute("aSize", new THREE.BufferAttribute(this.aSize, 1));
    g.setAttribute("aAlpha", new THREE.BufferAttribute(this.aAlpha, 1));
    g.setAttribute("aSeed", new THREE.BufferAttribute(aSeed, 1));
    this.starGeo = g;
    this.starMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uDpr: { value: this.dpr } },
      vertexShader: VERT, fragmentShader: FRAG,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.stars = new THREE.Points(g, this.starMat);
    this.stars.frustumCulled = false;
    this.scene.add(this.stars);

    const rg = new THREE.BufferGeometry();
    this.rSize = new Float32Array(n);
    this.rAlpha = new Float32Array(n);
    this.rGain = new Float32Array(n);
    rg.setAttribute("position", new THREE.BufferAttribute(this.disp, 3));
    rg.setAttribute("aSize", new THREE.BufferAttribute(this.rSize, 1));
    rg.setAttribute("aAlpha", new THREE.BufferAttribute(this.rAlpha, 1));
    this.ringGeo = rg;
    const rings = new THREE.Points(rg, new THREE.ShaderMaterial({
      uniforms: { uDpr: { value: this.dpr } },
      vertexShader: RING_VERT, fragmentShader: RING_FRAG,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    rings.frustumCulled = false;
    this.scene.add(rings);

    const m = this.edges.length;
    this.lPos = new Float32Array(m * 6);
    this.lCol = new Float32Array(m * 6);
    const lg = new THREE.BufferGeometry();
    lg.setAttribute("position", new THREE.BufferAttribute(this.lPos, 3));
    lg.setAttribute("color", new THREE.BufferAttribute(this.lCol, 3));
    this.linkGeo = lg;
    const links = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    links.frustumCulled = false;
    this.scene.add(links);

    const rp = new Float32Array(64 * 6);
    const rgeo = new THREE.BufferGeometry();
    rgeo.setAttribute("position", new THREE.BufferAttribute(rp, 3));
    this.routePos = rp; this.routeGeo = rgeo;
    this.route = new THREE.LineSegments(rgeo, new THREE.LineBasicMaterial({
      color: 0xf2d9a0, transparent: true, opacity: 0.55, depthWrite: false,
    }));
    this.route.frustumCulled = false;
    this.route.visible = false;
    this.scene.add(this.route);

    this.labelEls = this.words.map((wd) => {
      const el = document.createElement("div");
      el.textContent = wd.display;
      el.style.cssText = "position:absolute;transform:translate(-50%,-50%);white-space:nowrap;" +
        "font:500 12.5px/1 'IBM Plex Sans',system-ui,sans-serif;letter-spacing:.01em;" +
        "color:#F1EEE6;opacity:0;transition:opacity .22s ease;text-shadow:0 1px 8px rgba(7,11,22,.95),0 0 2px rgba(7,11,22,1);" +
        "padding:2px 5px;border-radius:5px;will-change:transform,opacity";
      this.labels.appendChild(el);
      return el;
    });
    this.chartEls = this.charts.map((ch) => {
      const el = document.createElement("div");
      el.innerHTML = `<span style="font-size:10px;letter-spacing:.22em;opacity:.55">${ch.glyph}</span>` +
        `<span style="margin-left:8px">${ch.name.toUpperCase()}</span>`;
      el.style.cssText = "position:absolute;transform:translate(-50%,-50%);white-space:nowrap;" +
        "font:600 11px/1 'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.18em;" +
        `color:${ch.hue};opacity:0;transition:opacity .3s ease;` +
        "text-shadow:0 1px 10px rgba(7,11,22,.98);will-change:transform,opacity";
      this.labels.appendChild(el);
      return el;
    });
    this._refreshAttrs();
  }

  private _bindInput() {
    let drag: { x: number; y: number; id: number } | null = null;
    let moved = 0;
    let pinch: number | null = null;

    this.host.addEventListener("pointerdown", (ev) => {
      if (ev.pointerType === "touch" && ev.isPrimary === false) return;
      drag = { x: ev.clientX, y: ev.clientY, id: ev.pointerId };
      moved = 0;
      this.host.style.cursor = "grabbing";
      this.host.setPointerCapture(ev.pointerId);
    });
    this.host.addEventListener("pointermove", (ev) => {
      if (drag && ev.pointerId === drag.id) {
        const dx = ev.clientX - drag.x, dy = ev.clientY - drag.y;
        moved += Math.abs(dx) + Math.abs(dy);
        this.cam.tTheta -= dx * 0.0042;
        this.cam.tPhi = Math.max(0.22, Math.min(Math.PI - 0.22, this.cam.tPhi - dy * 0.0042));
        drag.x = ev.clientX; drag.y = ev.clientY;
        return;
      }
      const hit = this._pick(ev);
      if (hit !== this.state.hover) {
        this.state.hover = hit;
        this.host.style.cursor = hit ? "pointer" : "grab";
        this._refreshAttrs();
        this.opts.onHover?.(hit);
      }
    });
    this.host.addEventListener("pointerup", (ev) => {
      if (!drag || ev.pointerId !== drag.id) return;
      this.host.releasePointerCapture(ev.pointerId);
      this.host.style.cursor = "grab";
      const wasClick = moved < 7;
      drag = null;
      if (!wasClick) return;
      this.opts.onSelect?.(this._pick(ev));
    });
    this.host.addEventListener("pointercancel", () => { drag = null; this.host.style.cursor = "grab"; });
    this.host.addEventListener("wheel", (ev) => {
      ev.preventDefault();
      this.cam.tDist = Math.max(120, Math.min(1700, this.cam.tDist * Math.exp(ev.deltaY * 0.0011)));
    }, { passive: false });
    this.host.addEventListener("touchstart", (ev) => {
      if (ev.touches.length === 2) {
        pinch = Math.hypot(ev.touches[0].clientX - ev.touches[1].clientX, ev.touches[0].clientY - ev.touches[1].clientY);
      }
    }, { passive: true });
    this.host.addEventListener("touchmove", (ev) => {
      if (ev.touches.length === 2 && pinch) {
        const d = Math.hypot(ev.touches[0].clientX - ev.touches[1].clientX, ev.touches[0].clientY - ev.touches[1].clientY);
        this.cam.tDist = Math.max(120, Math.min(1700, this.cam.tDist * (pinch / d)));
        pinch = d;
      }
    }, { passive: true });
    this.host.addEventListener("touchend", () => { pinch = null; }, { passive: true });
  }

  private _pick(ev: { clientX: number; clientY: number }): string | null {
    const r = this.host.getBoundingClientRect();
    const mx = ev.clientX - r.left, my = ev.clientY - r.top;
    let best: string | null = null, bestD = 26 * 26;
    for (let i = 0; i < this.words.length; i++) {
      if (!this.onScreen[i] || this.alpha[i] < 0.22) continue;
      const dx = this.screen[i * 2] - mx, dy = this.screen[i * 2 + 1] - my;
      const d2 = dx * dx + dy * dy;
      const pad = this.state.claimed.has(this.words[i].lemma) ? 90 : 0;
      if (d2 < bestD + pad) { bestD = d2; best = this.words[i].lemma; }
    }
    return best;
  }

  // ---------- public API ----------
  setClaimed(set: Set<string>) { this.state.claimed = set || new Set(); this._refreshAttrs(); }
  setUsed(set: Set<string>) { this.state.used = set || new Set(); this._refreshAttrs(); }
  setMode(mode: string) {
    this.state.mode = mode;
    this.route.visible = mode === "run" && this.state.route.length > 1;
    this._refreshAttrs();
  }
  setRoute(lemmas: string[], idx: number) {
    this.state.route = lemmas || [];
    this.state.routeIndex = idx || 0;
    this._writeRoute();
    this.route.visible = this.state.mode === "run" && this.state.route.length > 1;
  }
  setPanelOffset(px: number) { this.state.panelOffset = px || 0; }
  setLinkStrength(v: number | null) { this.linkGain = v == null ? 1 : v; this._writeLinks(); }

  setChart(id: string | null, options?: { keepCamera?: boolean }) {
    this.state.chart = id || null;
    this._refreshAttrs();
    if (id && this.chartCenter[id] && !options?.keepCamera) {
      this.cam.tTarget.copy(this.chartCenter[id]);
      this.cam.tDist = 330;
    } else if (!id) {
      this.cam.tTarget.set(0, 0, 0);
      this.cam.tDist = 980;
    }
  }

  focusStar(lemma: string, options?: { keepCamera?: boolean }) {
    const i = this.index[lemma];
    if (i == null) return;
    this.state.focus = lemma;
    const chart = this.words[i].chart;
    if (this.state.chart && this.state.chart !== chart) this.state.chart = null;
    this._gather();
    this._refreshAttrs();
    if (!options?.keepCamera) {
      this.cam.tTarget.set(this.base[i * 3], this.base[i * 3 + 1], this.base[i * 3 + 2]);
      this.cam.tDist = Math.min(this.cam.tDist, 235);
      if (this.cam.tDist < 175) this.cam.tDist = 190;
    }
  }

  clearFocus() { this.state.focus = null; this._gather(); this._refreshAttrs(); }
  resetView() {
    this.state.focus = null; this.state.chart = null;
    this._gather(); this._refreshAttrs();
    this.cam.tTarget.set(0, 0, 0);
    this.cam.tDist = 980;
  }
  neighborsOf(lemma: string) { return (this.adj[lemma] || []).slice(); }
  screenPosOf(lemma: string) {
    const i = this.index[lemma];
    if (i == null || !this.onScreen[i]) return null;
    return { x: this.screen[i * 2], y: this.screen[i * 2 + 1] };
  }

  // ---------- state → attributes ----------
  private _gather() {
    const f = this.state.focus, n = this.words.length;
    if (!f) { this.goal.set(this.base); return; }
    const fi = this.index[f];
    const c = new THREE.Vector3(this.base[fi * 3], this.base[fi * 3 + 1], this.base[fi * 3 + 2]);
    const fr = this.frames[this.words[fi].chart];
    const nb = this.adj[f] || [];
    this.goal.set(this.base);
    const k = fi * 3;
    this.goal[k] = c.x; this.goal[k + 1] = c.y; this.goal[k + 2] = c.z;
    const ring = 84, N = Math.max(1, nb.length);
    for (let i = 0; i < nb.length; i++) {
      const idx = this.index[nb[i].lemma];
      if (idx == null) continue;
      const a = (i / N) * Math.PI * 2 + 0.35;
      const lift = ((i % 3) - 1) * 22;
      const p = new THREE.Vector3().copy(c)
        .addScaledVector(fr.u, Math.cos(a) * ring)
        .addScaledVector(fr.v, Math.sin(a) * ring)
        .addScaledVector(fr.axis, lift);
      this.goal[idx * 3] = p.x; this.goal[idx * 3 + 1] = p.y; this.goal[idx * 3 + 2] = p.z;
    }
    void n;
  }

  private _refreshAttrs() {
    const s = this.state, n = this.words.length;
    let nbSet: Set<string> | null = null;
    if (s.focus) {
      nbSet = new Set();
      (this.adj[s.focus] || []).forEach((x) => nbSet!.add(x.lemma));
    }
    const routeSet = new Set(s.route);
    const ladder = s.mode === "ladder";

    for (let i = 0; i < n; i++) {
      const wd = this.words[i], claimed = s.claimed.has(wd.lemma), used = s.used.has(wd.lemma);
      const c = used ? COL.used : claimed ? COL.claimed
        : wd.degree === 0 ? COL.quiet
          : wd.tier === "advanced" ? COL.advanced
            : wd.degree >= 8 ? COL.hub : COL.core;
      this.aColor[i * 3] = c[0]; this.aColor[i * 3 + 1] = c[1]; this.aColor[i * 3 + 2] = c[2];

      let size = 7.6 + Math.sqrt(wd.degree) * 2.7;
      if (claimed) size += 2.0;
      if (used) size += 2.8;
      if (wd.lemma === s.hover) size += 4.0;
      if (wd.lemma === s.focus) size += 7.0;
      if (s.mode === "run" && routeSet.has(wd.lemma)) size += 3.6;
      this.aSize[i] = size;

      let a = 1;
      if (s.focus) a = wd.lemma === s.focus ? 1 : (nbSet!.has(wd.lemma) ? 0.95 : 0.14);
      else if (s.chart) a = wd.chart === s.chart ? 1 : 0.13;
      else if (s.mode === "run" && s.route.length) a = routeSet.has(wd.lemma) ? 1 : 0.22;
      else if (ladder) a = (wd.tier === "advanced" || wd.degree >= 6) ? 1 : 0.3;
      if (s.dimAll) a *= 0.35;
      this.goalAlpha[i] = a;

      this.rSize[i] = size + 9;
      this.rGain[i] = used ? 1 : claimed ? 0.4 : 0;
      this.rAlpha[i] = this.rGain[i] * Math.max(0.18, a);
    }
    this.starGeo.attributes.aColor.needsUpdate = true;
    this.starGeo.attributes.aSize.needsUpdate = true;
    this.ringGeo.attributes.aSize.needsUpdate = true;
    this.ringGeo.attributes.aAlpha.needsUpdate = true;
    this._writeLinks();
    this._linkKey = ""; // let the loop re-apply zoom-reveal links next frame if browsing
  }

  /**
   * Star alpha multiplier while browsing — a semantic zoom. Far away only chart
   * hubs shine over a faint dust; as you zoom in, more stars fade up (the chart
   * you're facing fullest), and the camera frustum keeps the near view local.
   */
  private _browseVis(i: number, level: string, near: string | null): number {
    const wd = this.words[i];
    if (this.state.claimed.has(wd.lemma)) return 1; // your stars always stay lit
    if (level === "galaxy") return wd.degree >= 11 ? 1 : 0.05; // overview: only strong hubs + dust
    if (level === "cluster") return wd.chart === near ? 1 : wd.degree >= 5 ? 0.55 : 0.14;
    return wd.chart === near ? 1 : 0.45; // close in: most stars up, faced chart brightest
  }

  /** Link intensity that mirrors _browseVis's semantic zoom. */
  private _writeLinksZoom(level: string, near: string | null) {
    const gain = this.linkGain == null ? 1 : this.linkGain;
    for (let i = 0; i < this.edges.length; i++) {
      const ed = this.edges[i];
      const a = this.index[ed.source], b = this.index[ed.target];
      const base = LINK[ed.type] || [0.5, 0.55, 0.62];
      const wa = this.words[a], wb = this.words[b];
      const bothHub = wa.degree >= 11 && wb.degree >= 11;
      const bothMid = wa.degree >= 5 && wb.degree >= 5;
      const inChart = wa.chart === near && wb.chart === near;
      let w: number;
      if (level === "galaxy") w = bothHub ? 0.12 : 0.015;
      else if (level === "cluster") w = inChart ? 0.3 : bothMid ? 0.09 : 0.025;
      else w = inChart ? 0.33 : 0.1;
      w *= gain;
      for (let v = 0; v < 2; v++) {
        const o = (i * 2 + v) * 3;
        this.lCol[o] = base[0] * w; this.lCol[o + 1] = base[1] * w; this.lCol[o + 2] = base[2] * w;
      }
    }
    this.linkGeo.attributes.color.needsUpdate = true;
  }

  private _writeLinks() {
    const s = this.state;
    const ladder = s.mode === "ladder";
    for (let i = 0; i < this.edges.length; i++) {
      const ed = this.edges[i];
      const a = this.index[ed.source], b = this.index[ed.target];
      const base = LINK[ed.type] || [0.5, 0.55, 0.62];
      const isLadder = ed.type === "advanced_form" || ed.type === "builds_on";
      let w = 0.17;
      if (s.focus) w = ed.source === s.focus || ed.target === s.focus ? 0.95 : 0.03;
      else if (s.chart) w = (this.words[a].chart === s.chart && this.words[b].chart === s.chart) ? 0.3 : 0.02;
      else if (ladder) w = isLadder ? 0.75 : 0.02;
      else if (s.mode === "run") w = 0.05;
      if (s.dimAll) w *= 0.4;
      w *= this.linkGain == null ? 1 : this.linkGain;
      for (let v = 0; v < 2; v++) {
        const o = (i * 2 + v) * 3;
        this.lCol[o] = base[0] * w; this.lCol[o + 1] = base[1] * w; this.lCol[o + 2] = base[2] * w;
      }
    }
    this.linkGeo.attributes.color.needsUpdate = true;
  }

  private _writeRoute() {
    const r = this.state.route;
    let seg = 0;
    for (let i = 0; i + 1 < r.length && seg < 63; i++) {
      const a = this.index[r[i]], b = this.index[r[i + 1]];
      if (a == null || b == null) continue;
      const o = seg * 6;
      this.routePos[o] = this.disp[a * 3]; this.routePos[o + 1] = this.disp[a * 3 + 1]; this.routePos[o + 2] = this.disp[a * 3 + 2];
      this.routePos[o + 3] = this.disp[b * 3]; this.routePos[o + 4] = this.disp[b * 3 + 1]; this.routePos[o + 5] = this.disp[b * 3 + 2];
      seg++;
    }
    this.routeGeo.setDrawRange(0, seg * 2);
    this.routeGeo.attributes.position.needsUpdate = true;
  }

  private _resize() {
    const w = this.host.clientWidth || 800, h = this.host.clientHeight || 600;
    this.vw = w; this.vh = h;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  }

  private _loop = (now: number) => {
    if (this._dead) return;
    requestAnimationFrame(this._loop);
    const c = this.cam, k = 0.085;

    c.theta += (c.tTheta - c.theta) * k;
    c.phi += (c.tPhi - c.phi) * k;
    c.dist += (c.tDist - c.dist) * k;
    c.target.lerp(c.tTarget, k);

    const off = this.state.panelOffset;
    const eye = new THREE.Vector3(
      c.target.x + c.dist * Math.sin(c.phi) * Math.cos(c.theta),
      c.target.y + c.dist * Math.cos(c.phi),
      c.target.z + c.dist * Math.sin(c.phi) * Math.sin(c.theta),
    );
    this.camera.position.copy(eye);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(c.target);
    if (off) {
      const perPx = (2 * Math.tan((this.camera.fov * Math.PI / 180) / 2) * c.dist) / Math.max(1, this.vh);
      const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0);
      const shift = right.multiplyScalar((off / 2) * perPx);
      this.camera.position.add(shift);
      this.camera.lookAt(c.target.clone().add(shift));
    }
    this.camera.updateMatrixWorld();

    const n = this.words.length;
    for (let i = 0; i < n * 3; i++) {
      const d = this.goal[i] - this.disp[i];
      if (Math.abs(d) > 0.05) this.disp[i] += d * 0.075;
      else this.disp[i] = this.goal[i];
    }
    // Zoom-reveal: when just browsing (no focus/chart/run/ladder), a chart's
    // stars materialise as the camera nears it; far, only chart hubs remain.
    const s = this.state;
    const browse = !s.focus && !s.chart && s.mode !== "ladder" && !(s.mode === "run" && s.route.length > 0);
    const lvl = this._level || "galaxy";
    const near = this._nearestChart;
    for (let i = 0; i < n; i++) {
      let goal = this.goalAlpha[i];
      if (browse) goal *= this._browseVis(i, lvl, near);
      const da = goal - this.alpha[i];
      if (Math.abs(da) > 0.004) this.alpha[i] += da * 0.11;
      else this.alpha[i] = goal;
      this.aAlpha[i] = this.alpha[i];
      if (this.rGain[i] > 0) this.rAlpha[i] = this.rGain[i] * Math.max(0.18, this.alpha[i]);
    }
    // Links follow the same reveal; only rewritten when the zoom band or nearest
    // chart changes (or on any state change, which resets the key).
    const linkKey = browse ? lvl + ":" + (near || "") : "state";
    if (linkKey !== this._linkKey) {
      this._linkKey = linkKey;
      if (browse) this._writeLinksZoom(lvl, near);
      else this._writeLinks();
    }
    this.starGeo.attributes.position.needsUpdate = true;
    this.starGeo.attributes.aAlpha.needsUpdate = true;
    this.ringGeo.attributes.position.needsUpdate = true;
    this.ringGeo.attributes.aAlpha.needsUpdate = true;

    for (let i = 0; i < this.edges.length; i++) {
      const a = this.index[this.edges[i].source] * 3, b = this.index[this.edges[i].target] * 3;
      const o = i * 6;
      this.lPos[o] = this.disp[a]; this.lPos[o + 1] = this.disp[a + 1]; this.lPos[o + 2] = this.disp[a + 2];
      this.lPos[o + 3] = this.disp[b]; this.lPos[o + 4] = this.disp[b + 1]; this.lPos[o + 5] = this.disp[b + 2];
    }
    this.linkGeo.attributes.position.needsUpdate = true;
    if (this.route.visible) this._writeRoute();

    this.starMat.uniforms.uTime.value = (now - this._t0) / 1000;
    this._project();
    this.renderer.render(this.scene, this.camera);
  };

  private _project() {
    const v = new THREE.Vector3(), hw = this.vw / 2, hh = this.vh / 2;
    const s = this.state;
    const level = this.cam.dist > 620 ? "galaxy" : this.cam.dist > 275 ? "cluster" : "star";
    if (level !== this._level) {
      this._level = level;
      this.opts.onZoomLevel?.(level as "galaxy" | "cluster" | "star");
    }
    let nbSet: Set<string> | null = null;
    if (s.focus) {
      nbSet = new Set();
      (this.adj[s.focus] || []).forEach((x) => nbSet!.add(x.lemma));
    }
    // The chart you're diving toward: nearest the camera eye, blended slightly
    // toward the look-at target so orbiting steers which region reveals.
    const probe = this.camera.position.clone().lerp(this.cam.target, 0.35);
    let nearestChart: string | null = null, nearestD = Infinity;
    for (let i = 0; i < this.charts.length; i++) {
      const d = this.chartCenter[this.charts[i].id].distanceTo(probe);
      if (d < nearestD) { nearestD = d; nearestChart = this.charts[i].id; }
    }
    this._nearestChart = nearestChart;

    for (let i = 0; i < this.words.length; i++) {
      v.set(this.disp[i * 3], this.disp[i * 3 + 1], this.disp[i * 3 + 2]).project(this.camera);
      const on = v.z < 1 && v.x > -1.15 && v.x < 1.15 && v.y > -1.15 && v.y < 1.15;
      this.onScreen[i] = on ? 1 : 0;
      const x = v.x * hw + hw, y = -v.y * hh + hh;
      this.screen[i * 2] = x; this.screen[i * 2 + 1] = y;

      const wd = this.words[i], el = this.labelEls[i];
      let show = false;
      if (!on || this.alpha[i] < 0.2) show = false;
      else if (s.focus) show = wd.lemma === s.focus || nbSet!.has(wd.lemma);
      else if (wd.lemma === s.hover) show = true;
      else if (s.mode === "run" && s.route.indexOf(wd.lemma) >= 0) show = true;
      else if (s.chart) show = wd.chart === s.chart;
      else if (level === "star" || level === "cluster") show = wd.chart === nearestChart;
      else show = s.claimed.has(wd.lemma) && wd.degree >= 9;

      if (show) {
        el.style.transform = `translate(-50%,-50%) translate(${x.toFixed(1)}px,${(y - 17).toFixed(1)}px)`;
        let dim = wd.lemma === s.focus ? 1 : (s.focus ? 0.86 : 0.8);
        if (wd.lemma === s.hover) dim = 1;
        el.style.opacity = String(dim);
        el.style.fontWeight = wd.lemma === s.focus ? "600" : "500";
        el.style.fontSize = wd.lemma === s.focus ? "15px" : "12.5px";
        el.style.color = s.claimed.has(wd.lemma) ? "#8FE3C0" : "#F1EEE6";
      } else if (el.style.opacity !== "0") {
        el.style.opacity = "0";
      }
    }

    for (let i = 0; i < this.charts.length; i++) {
      const ch = this.charts[i], cel = this.chartEls[i];
      let vis = ch.id !== "drift" && !s.focus && (level === "galaxy" || (s.chart && s.chart === ch.id));
      if (s.chart && s.chart !== ch.id) vis = false;
      if (!vis) { if (cel.style.opacity !== "0") cel.style.opacity = "0"; continue; }
      v.copy(this.chartCenter[ch.id]).project(this.camera);
      if (v.z > 1) { cel.style.opacity = "0"; continue; }
      const cx = v.x * hw + hw, cy = -v.y * hh + hh;
      cel.style.transform = `translate(-50%,-50%) translate(${cx.toFixed(1)}px,${(cy - 30).toFixed(1)}px)`;
      cel.style.opacity = "0.95";
    }
  }
}
