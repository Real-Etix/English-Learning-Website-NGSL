"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import ForceGraph3D from "react-force-graph-3d";
import * as THREE from "three";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";

import type { LiteGraph } from "@/lib/wiki/parse-wiki";

const EDGE_COLOR: Record<string, string> = {
  synonym: "#34d399",
  antonym: "#fb7185",
  intensity: "#fbbf24",
  collocation: "#94a3b8",
  builds_on: "#a78bfa",
  advanced_form: "#a78bfa",
  morphological: "#38bdf8",
};

const CORE_COLOR = new THREE.Color("#7dd3fc");
const ADVANCED_COLOR = new THREE.Color("#c4b5fd");
const HUB_COLOR = new THREE.Color("#fde68a");
const ISOLATED_COLOR = new THREE.Color("#cbd5e1");
const UNDISCOVERED_COLOR = new THREE.Color("#f0abfc"); // words you don't have yet, when exploring a space
const OWNED_COLOR = new THREE.Color("#6ee7b7"); // words already in your space

function nodeColor(node: GNode, owned: Set<string> | undefined, discovery: boolean): THREE.Color {
  if (discovery && owned && !owned.has(node.id)) return UNDISCOVERED_COLOR;
  if (!discovery && owned && owned.has(node.id)) return OWNED_COLOR;
  if (node.degree === 0) return ISOLATED_COLOR;
  if (node.tier === "advanced") return ADVANCED_COLOR;
  if (node.degree >= 8) return HUB_COLOR;
  return CORE_COLOR;
}

function nodeScale(node: GNode, owned: Set<string> | undefined, discovery: boolean): number {
  const base = node.degree === 0 ? 10 : 5 + Math.sqrt(node.degree) * 2.4;
  const undiscovered = discovery && owned !== undefined && !owned.has(node.id);
  return undiscovered ? base + 6 : base;
}

type GNode = {
  id: string;
  display: string;
  tier: "core" | "advanced";
  degree: number;
  pos: string;
};

/** Soft radial-gradient sprite so each node reads as a glowing star. */
function makeGlowTexture(): THREE.Texture {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  // Tight bright core with a fast falloff so stars stay distinct points, not big halos.
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.12, "rgba(255,255,255,0.9)");
  g.addColorStop(0.28, "rgba(255,255,255,0.25)");
  g.addColorStop(0.5, "rgba(255,255,255,0.04)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

/** A distant static starfield for depth behind the graph. */
function makeStarfield(): THREE.Points {
  const n = 1600;
  const positions = new Float32Array(n * 3);
  for (let i = 0; i < n; i += 1) {
    const r = 1400 + Math.random() * 1600;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
    positions[i * 3 + 2] = r * Math.cos(phi);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({
    color: 0xffffff,
    size: 2,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.6,
    depthWrite: false,
  });
  return new THREE.Points(geo, mat);
}

export default function WordGalaxy({
  graph,
  selected,
  onSelect,
  owned,
  discoveryMode,
}: {
  graph: LiteGraph;
  selected: string | null;
  onSelect: (lemma: string | null) => void;
  owned?: Set<string>;
  discoveryMode?: boolean;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fgRef = useRef<any>(null);
  const forcesApplied = useRef(false);
  const [dims, setDims] = useState({ w: 800, h: 600 });
  const glow = useMemo(() => makeGlowTexture(), []);

  const data = useMemo(
    () => ({
      nodes: graph.nodes.map((n) => ({
        id: n.lemma,
        display: n.display,
        tier: n.tier,
        degree: n.degree,
        pos: n.pos,
      })),
      links: graph.edges.map((e) => ({ source: e.source, target: e.target, type: e.type })),
    }),
    [graph],
  );

  // Track container size so the canvas fills its card.
  useEffect(() => {
    if (!wrapRef.current) return;
    const el = wrapRef.current;
    const ro = new ResizeObserver(() => {
      setDims({ w: el.clientWidth, h: el.clientHeight });
    });
    ro.observe(el);
    setDims({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // Add gentle bloom + starfield, and spread the layout so stars don't clump.
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;
    // Softer bloom: only bright cores glow (higher threshold), tighter radius.
    const bloom = new UnrealBloomPass(new THREE.Vector2(dims.w, dims.h), 0.6, 0.35, 0.28);
    fg.postProcessingComposer().addPass(bloom);
    const stars = makeStarfield();
    fg.scene().add(stars);
    return () => {
      fg.scene().remove(stars);
    };
    // run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Recolor/resize existing stars when the owned set changes — so a word turns
  // "collected" the instant you collect it, without rebuilding every sprite.
  useEffect(() => {
    const data = fgRef.current?.graphData?.() as
      | { nodes: (GNode & { __threeObj?: THREE.Sprite })[] }
      | undefined;
    if (!data) return;
    for (const node of data.nodes) {
      const sprite = node.__threeObj;
      if (!sprite) continue;
      (sprite.material as THREE.SpriteMaterial).color.copy(nodeColor(node, owned, discoveryMode === true));
      sprite.scale.setScalar(nodeScale(node, owned, discoveryMode === true));
    }
  }, [owned, discoveryMode]);

  // Fly the camera to the selected star.
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg || !selected) return;
    const node = data.nodes.find((n) => n.id === selected) as
      | (GNode & { x?: number; y?: number; z?: number })
      | undefined;
    if (!node || node.x == null) return;
    const dist = 120;
    const ratio = 1 + dist / Math.hypot(node.x, node.y!, node.z!);
    fg.cameraPosition(
      { x: node.x * ratio, y: node.y! * ratio, z: node.z! * ratio },
      node,
      1000,
    );
  }, [selected, data.nodes]);

  return (
    <div ref={wrapRef} className="h-[640px] w-full">
      <ForceGraph3D
        ref={fgRef}
        width={dims.w}
        height={dims.h}
        graphData={data}
        backgroundColor="#05060f"
        showNavInfo={false}
        nodeLabel={(n: object) => (n as GNode).display}
        nodeThreeObject={(n: object) => {
          const node = n as GNode;
          const material = new THREE.SpriteMaterial({
            map: glow,
            color: nodeColor(node, owned, discoveryMode === true),
            transparent: true,
            opacity: node.degree === 0 ? 0.85 : 1,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
          });
          const sprite = new THREE.Sprite(material);
          sprite.scale.setScalar(nodeScale(node, owned, discoveryMode === true));
          return sprite;
        }}
        linkColor={(l: object) => EDGE_COLOR[(l as { type: string }).type] ?? "#475569"}
        linkOpacity={0.16}
        linkWidth={0.3}
        onNodeClick={(n: object) => onSelect((n as GNode).id)}
        onBackgroundClick={() => onSelect(null)}
        warmupTicks={40}
        cooldownTicks={180}
        onEngineTick={() => {
          // The D3 simulation only exists once ticking starts — configure it here,
          // guarded so it runs exactly once. Stronger repulsion + longer links
          // spread the cloud into distinct stars.
          if (forcesApplied.current) return;
          const fg = fgRef.current;
          const charge = fg?.d3Force?.("charge");
          if (!charge) return;
          charge.strength(-140);
          fg.d3Force?.("link")?.distance(48);
          // Radial containment: gently pull every node toward the origin so
          // link-less words settle in a compact, clickable cloud instead of
          // being flung to a far sparse shell.
          type SimNode = { x: number; y: number; z: number; vx: number; vy: number; vz: number };
          let simNodes: SimNode[] = [];
          const contain: ((alpha: number) => void) & { initialize?: (nds: SimNode[]) => void } = (
            alpha,
          ) => {
            const pull = 0.02 * alpha;
            for (const nd of simNodes) {
              nd.vx -= nd.x * pull;
              nd.vy -= nd.y * pull;
              nd.vz -= (nd.z ?? 0) * pull;
            }
          };
          contain.initialize = (nds: SimNode[]) => {
            simNodes = nds;
          };
          fg.d3Force?.("contain", contain);
          fg.d3ReheatSimulation?.();
          forcesApplied.current = true;
        }}
        onEngineStop={() => fgRef.current?.zoomToFit(700, 60)}
      />
    </div>
  );
}
