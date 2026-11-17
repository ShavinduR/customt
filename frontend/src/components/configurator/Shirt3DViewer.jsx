import { Component, Suspense, forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { ContactShadows, Html, OrbitControls, useGLTF } from '@react-three/drei';
import { CanvasTexture, DoubleSide, LinearMipmapLinearFilter, MeshStandardMaterial, SRGBColorSpace, Spherical, Vector3 } from 'three';
import { Gauge, Pause, Play, RotateCcw, TriangleAlert } from 'lucide-react';
import { MODEL_FILE } from '../../utils/garmentGeometry';
import { TEXTURE_HEIGHT, TEXTURE_WIDTH, paintDesignTexture } from '../../utils/designTexture';

/**
 * Interactive 3D garment: the same design the 2D views show, painted onto a texture atlas and wrapped
 * around a .glb model. Drag to rotate 360°, scroll / pinch to zoom, right-drag (two fingers) to pan.
 * Loaded lazily so three.js only downloads when the 3D view is opened.
 *
 * Performance (important on mid-range phones):
 *  - frameloop "demand": nothing is drawn while the model is still, so an idle viewer costs no GPU/battery.
 *  - Adaptive quality: while the buyer turns the model (or a camera preset animates) the canvas renders at a
 *    lower pixel ratio; ~300 ms after it settles it re-renders once at full sharpness.
 *
 * variant "light" (default) is the compact viewer used on RFQ/auction pages; "studio" is the dark design
 * studio viewer with a floating view toolbar (Front, Back, Side, Reset) and a quality indicator.
 */

const CAMERA = { position: [0, 0.04, 1.85], fov: 35 };
const HOME = new Spherical().setFromVector3(new Vector3(...CAMERA.position));
const ORIGIN = new Vector3(0, 0, 0);
/** Camera azimuth per preset (three.js Spherical.theta: 0 = looking at the front, from +Z). */
// The wearer's left sleeve faces +X (the viewer's right in the front view), so "Side" shows that sleeve.
const VIEW_THETA = { front: 0, back: Math.PI, side: Math.PI / 2, leftSleeve: Math.PI / 2, rightSleeve: -Math.PI / 2, reset: 0 };
const PRESET_MS = 480;
const SETTLE_MS = 300;

function hasWebGL() {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(window.WebGLRenderingContext && (canvas.getContext('webgl2') || canvas.getContext('webgl')));
  } catch {
    return false;
  }
}

/** Full-quality pixel ratio: the screen's own, capped at 2 (1.5 on touch devices, which are usually phones). */
function fullDpr() {
  const device = window.devicePixelRatio || 1;
  const coarse = window.matchMedia?.('(pointer: coarse)').matches;
  return Math.min(device, coarse ? 1.5 : 2);
}

class ViewerBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  render() {
    if (this.state.error) return <Fallback dark={this.props.dark} message="The 3D model could not be displayed on this device. The 2D views show the same design." />;
    return this.props.children;
  }
}

function Fallback({ message, dark = false }) {
  return (
    <div className={`flex h-full min-h-[18rem] flex-col items-center justify-center gap-2 p-6 text-center text-sm ${dark ? 'text-zinc-400' : 'text-slate-500'}`}>
      <TriangleAlert className="h-6 w-6 text-amber-500" />
      {message}
    </div>
  );
}

function Garment({ specs, onWarnings }) {
  const { nodes } = useGLTF(MODEL_FILE[specs.garmentType] || MODEL_FILE['Crew Neck']);
  const invalidate = useThree((s) => s.invalidate);
  const geometry = (nodes.Shirt || Object.values(nodes).find((n) => n.isMesh)).geometry;

  const { canvas, texture, material } = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = TEXTURE_WIDTH;
    c.height = TEXTURE_HEIGHT;
    const tex = new CanvasTexture(c);
    tex.flipY = false;
    tex.colorSpace = SRGBColorSpace;
    tex.anisotropy = 8;
    tex.minFilter = LinearMipmapLinearFilter;
    const mat = new MeshStandardMaterial({ map: tex, roughness: 0.9, metalness: 0, side: DoubleSide });
    // The inside of the garment (seen through the neck and hem) is shaded darker.
    mat.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', '#include <map_fragment>\nif (!gl_FrontFacing) diffuseColor.rgb *= 0.5;');
    };
    mat.customProgramCacheKey = () => 'customt-fabric-inside';
    return { canvas: c, texture: tex, material: mat };
  }, []);

  useEffect(
    () => () => {
      texture.dispose();
      material.dispose();
    },
    [texture, material]
  );

  useEffect(() => {
    let cancelled = false;
    paintDesignTexture(canvas, specs).then((warnings) => {
      if (cancelled) return;
      texture.needsUpdate = true;
      invalidate();
      onWarnings?.(warnings);
    });
    return () => {
      cancelled = true;
    };
  }, [canvas, texture, specs, onWarnings, invalidate]);

  return <mesh geometry={geometry} material={material} castShadow />;
}

/**
 * Adaptive resolution. Drops the pixel ratio when the buyer starts dragging (OrbitControls "start"), keeps it
 * low through the damping glide after release, and restores full sharpness once the view has been still for
 * SETTLE_MS. Auto-spin alone never lowers quality. `hold(true/false)` lets camera presets use the same rule.
 */
const AdaptiveQuality = forwardRef(function AdaptiveQuality({ onChange }, ref) {
  const controls = useThree((s) => s.controls);
  const setDpr = useThree((s) => s.setDpr);
  const invalidate = useThree((s) => s.invalidate);
  const state = useRef({ moving: false, dragging: false, held: false, endedAt: 0, timer: null });
  const levels = useMemo(() => {
    const full = fullDpr();
    return { full, low: Math.max(0.6, Math.round(full * 0.5 * 100) / 100) };
  }, []);

  const apply = useCallback(
    (moving) => {
      const s = state.current;
      if (s.moving === moving) return;
      s.moving = moving;
      setDpr(moving ? levels.low : levels.full);
      invalidate();
      onChange?.({ moving, dpr: moving ? levels.low : levels.full });
    },
    [setDpr, invalidate, levels, onChange]
  );

  const settle = useCallback(() => {
    const s = state.current;
    clearTimeout(s.timer);
    s.timer = setTimeout(() => {
      if (!s.dragging && !s.held) apply(false);
    }, SETTLE_MS);
  }, [apply]);

  useImperativeHandle(
    ref,
    () => ({
      hold(on) {
        state.current.held = on;
        if (on) {
          clearTimeout(state.current.timer);
          apply(true);
        } else settle();
      },
    }),
    [apply, settle]
  );

  useEffect(() => {
    onChange?.({ moving: false, dpr: levels.full });
    if (!controls) return undefined;
    const s = state.current;
    const onStart = () => {
      s.dragging = true;
      clearTimeout(s.timer);
      apply(true);
    };
    const onEnd = () => {
      s.dragging = false;
      s.endedAt = performance.now();
      settle();
    };
    // Damping keeps the camera gliding after release; keep the low ratio until it stops (max ~1 s).
    const onMove = () => {
      if (s.moving && !s.dragging && !s.held && performance.now() - s.endedAt < 1000) settle();
    };
    controls.addEventListener('start', onStart);
    controls.addEventListener('end', onEnd);
    controls.addEventListener('change', onMove);
    return () => {
      clearTimeout(s.timer);
      controls.removeEventListener('start', onStart);
      controls.removeEventListener('end', onEnd);
      controls.removeEventListener('change', onMove);
    };
  }, [controls, apply, settle, levels, onChange]);

  return null;
});

/** Animates the camera to a preset view along the orbit sphere (shortest way round), keeping the zoom. */
function CameraRig({ request, quality }) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls);
  const invalidate = useThree((s) => s.invalidate);
  const anim = useRef(null);

  useEffect(() => {
    if (!request || !controls) return;
    const from = new Spherical().setFromVector3(camera.position.clone().sub(controls.target));
    const reset = request.view === 'reset';
    let turn = (VIEW_THETA[request.view] ?? 0) - from.theta;
    turn = ((((turn + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;
    anim.current = {
      start: performance.now(),
      from,
      turn,
      toPhi: HOME.phi,
      toRadius: reset ? HOME.radius : from.radius,
      fromTarget: controls.target.clone(),
    };
    quality.current?.hold(true);
    invalidate();
  }, [request, camera, controls, invalidate, quality]);

  useFrame(() => {
    const a = anim.current;
    if (!a || !controls) return;
    const k = Math.min(1, (performance.now() - a.start) / PRESET_MS);
    const e = k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2; // easeInOutCubic
    const lerp = (x, y) => x + (y - x) * e;
    controls.target.lerpVectors(a.fromTarget, ORIGIN, e);
    camera.position.setFromSpherical(new Spherical(lerp(a.from.radius, a.toRadius), lerp(a.from.phi, a.toPhi), a.from.theta + a.turn * e)).add(controls.target);
    camera.lookAt(controls.target);
    controls.update();
    if (k < 1) invalidate();
    else {
      anim.current = null;
      quality.current?.hold(false);
    }
  });

  return null;
}

function Loading({ dark }) {
  return (
    <Html center>
      <div className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-medium shadow ${dark ? 'bg-zinc-800/90 text-zinc-200' : 'bg-white/90 text-slate-600'}`}>Loading 3D model…</div>
    </Html>
  );
}

const STUDIO_VIEWS = [
  { view: 'front', label: 'Front' },
  { view: 'back', label: 'Back' },
  { view: 'side', label: 'Side' },
];

function GlassButton({ active = false, className = '', ...props }) {
  return (
    <button
      type="button"
      className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 ${
        active ? 'bg-brand-500 text-white shadow-[0_0_18px_-4px] shadow-brand-500' : 'text-zinc-200 hover:bg-white/10 hover:text-white'
      } ${className}`}
      {...props}
    />
  );
}

export default function Shirt3DViewer({ specs, className = '', height = '26rem', variant = 'light', view, onViewChange }) {
  const studio = variant === 'studio';
  const quality = useRef(null);
  const [autoRotate, setAutoRotate] = useState(!studio);
  const [warnings, setWarnings] = useState([]);
  const [rig, setRig] = useState(null);
  const [activeView, setActiveView] = useState('front');
  // The Canvas dpr prop follows this state: R3F re-applies the prop on every render, so it must match.
  const [q, setQ] = useState(() => ({ moving: false, dpr: fullDpr() }));
  const webgl = useMemo(hasWebGL, []);

  const goTo = useCallback(
    (next) => {
      setAutoRotate(false);
      setActiveView(next === 'reset' ? 'front' : next);
      setRig({ view: next, at: Date.now() });
      if (next !== 'reset') onViewChange?.(next);
    },
    [onViewChange]
  );

  // The studio can drive the camera from outside (e.g. picking "Back" in the 2D pattern turns the model round).
  useEffect(() => {
    if (!view || view === activeView) return;
    setAutoRotate(false);
    setActiveView(view);
    setRig({ view, at: Date.now() });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  if (!webgl) return <Fallback dark={studio} message="Your browser does not support WebGL, so the 3D view is unavailable. The 2D views show the same design." />;

  return (
    <div className={`relative ${className}`} style={{ height }}>
      <ViewerBoundary dark={studio}>
        <Canvas
          shadows
          frameloop={autoRotate ? 'always' : 'demand'}
          dpr={q.dpr}
          camera={CAMERA}
          gl={{ antialias: true, preserveDrawingBuffer: false, alpha: true }}
          aria-label={`Interactive 3D model of the ${specs.garmentType || 'garment'}`}
        >
          <ambientLight intensity={studio ? 0.5 : 0.55} />
          <hemisphereLight args={['#ffffff', studio ? '#3f3f46' : '#b9c2d0', 0.75]} />
          <directionalLight position={[1.6, 2.2, 2.4]} intensity={1.6} castShadow shadow-mapSize={[1024, 1024]} />
          <directionalLight position={[-2, 1, -2.2]} intensity={studio ? 1.1 : 0.9} />
          {studio && <directionalLight position={[0, 0.6, -2.5]} intensity={0.6} color="#a5b4fc" />}
          <Suspense fallback={<Loading dark={studio} />}>
            <Garment specs={specs} onWarnings={setWarnings} />
          </Suspense>
          <ContactShadows position={[0, -0.56, 0]} opacity={studio ? 0.6 : 0.35} scale={2.4} blur={2.4} far={1} />
          <OrbitControls
            makeDefault
            enablePan
            enableZoom
            enableDamping
            autoRotate={autoRotate}
            autoRotateSpeed={1.6}
            minDistance={0.8}
            maxDistance={4}
            target={[0, 0, 0]}
          />
          <AdaptiveQuality ref={quality} onChange={setQ} />
          <CameraRig request={rig} quality={quality} />
        </Canvas>
      </ViewerBoundary>

      {studio ? (
        <>
          <div className="absolute left-1/2 top-4 flex -translate-x-1/2 items-center gap-1 rounded-xl border border-white/15 bg-white/[0.07] p-1 shadow-2xl shadow-black/40 backdrop-blur-xl" role="toolbar" aria-label="3D view controls">
            {STUDIO_VIEWS.map((v) => {
              const on = !autoRotate && (activeView === v.view || (v.view === 'side' && /Sleeve$/.test(activeView)));
              return (
                <GlassButton key={v.view} active={on} aria-pressed={on} onClick={() => goTo(v.view)}>
                  {v.label}
                </GlassButton>
              );
            })}
            <span className="mx-1 h-5 w-px bg-white/15" aria-hidden="true" />
            <GlassButton onClick={() => goTo('reset')} title="Reset camera">
              <RotateCcw className="h-3.5 w-3.5" /> Reset
            </GlassButton>
            <GlassButton active={autoRotate} aria-pressed={autoRotate} onClick={() => setAutoRotate((v) => !v)} title={autoRotate ? 'Stop turntable' : 'Turntable spin'}>
              {autoRotate ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
              <span className="hidden sm:inline">Spin</span>
            </GlassButton>
          </div>
          <div
            className={`pointer-events-none absolute bottom-3 left-3 flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-wider backdrop-blur-md transition-colors ${
              q.moving ? 'border-amber-400/30 bg-amber-400/10 text-amber-300' : 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300'
            }`}
            title="The 3D view renders at a lower resolution while it moves, then sharpens when still."
          >
            <Gauge className="h-3 w-3" />
            {q.moving ? 'Fast' : 'HD'} · {q.dpr.toFixed(2).replace(/\.?0+$/, '')}×
          </div>
          <p className="pointer-events-none absolute bottom-3 right-3 hidden text-[11px] text-zinc-500 md:block">Drag to rotate · scroll or pinch to zoom · right-drag to pan</p>
        </>
      ) : (
        <>
          <div className="absolute right-3 top-3 flex gap-1.5">
            <button
              type="button"
              onClick={() => setAutoRotate((v) => !v)}
              className="flex items-center gap-1 rounded-lg bg-white/90 px-2.5 py-1.5 text-xs font-medium text-slate-700 shadow-sm hover:bg-white"
              aria-pressed={autoRotate}
            >
              {autoRotate ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
              {autoRotate ? 'Stop spin' : 'Spin'}
            </button>
            <button
              type="button"
              onClick={() => goTo('reset')}
              className="flex items-center gap-1 rounded-lg bg-white/90 px-2.5 py-1.5 text-xs font-medium text-slate-700 shadow-sm hover:bg-white"
            >
              <RotateCcw className="h-3.5 w-3.5" /> Reset view
            </button>
          </div>
          <p className="pointer-events-none absolute bottom-2 left-0 right-0 text-center text-[11px] text-slate-500">Drag to rotate · scroll or pinch to zoom · right-drag to pan</p>
        </>
      )}
      {warnings.length > 0 && (
        <div className={`absolute left-3 right-3 rounded-lg px-3 py-2 text-xs shadow-sm ${studio ? 'top-16 border border-amber-400/30 bg-amber-950/80 text-amber-200' : 'top-12 bg-amber-50/95 text-amber-800'}`}>{warnings.join(' ')}</div>
      )}
    </div>
  );
}

Object.values(MODEL_FILE).forEach((file) => useGLTF.preload(file));
