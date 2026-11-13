import { Component, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { ContactShadows, Html, OrbitControls, useGLTF } from '@react-three/drei';
import { CanvasTexture, DoubleSide, LinearMipmapLinearFilter, MeshStandardMaterial, SRGBColorSpace } from 'three';
import { Pause, Play, RotateCcw, TriangleAlert } from 'lucide-react';
import { MODEL_FILE } from '../../utils/garmentGeometry';
import { TEXTURE_HEIGHT, TEXTURE_WIDTH, paintDesignTexture } from '../../utils/designTexture';

/**
 * Interactive 3D garment: the same design the 2D views show, painted onto a texture atlas and wrapped
 * around a .glb model. Drag to rotate 360°, scroll / pinch to zoom, right-drag (two fingers) to pan.
 * Loaded lazily so three.js only downloads when the buyer opens the 3D view.
 */

const CAMERA = { position: [0, 0.04, 1.85], fov: 35 };

function hasWebGL() {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(window.WebGLRenderingContext && (canvas.getContext('webgl2') || canvas.getContext('webgl')));
  } catch {
    return false;
  }
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
    if (this.state.error) return <Fallback message="The 3D model could not be displayed on this device. The 2D views show the same design." />;
    return this.props.children;
  }
}

function Fallback({ message }) {
  return (
    <div className="flex h-full min-h-[18rem] flex-col items-center justify-center gap-2 p-6 text-center text-sm text-slate-500">
      <TriangleAlert className="h-6 w-6 text-amber-500" />
      {message}
    </div>
  );
}

function Garment({ specs, onWarnings }) {
  const { nodes } = useGLTF(MODEL_FILE[specs.garmentType] || MODEL_FILE['Crew Neck']);
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
      onWarnings?.(warnings);
    });
    return () => {
      cancelled = true;
    };
  }, [canvas, texture, specs, onWarnings]);

  return <mesh geometry={geometry} material={material} castShadow />;
}

function Loading() {
  return (
    <Html center>
      <div className="whitespace-nowrap rounded-lg bg-white/90 px-3 py-1.5 text-xs font-medium text-slate-600 shadow">Loading 3D model…</div>
    </Html>
  );
}

export default function Shirt3DViewer({ specs, className = '', height = '26rem' }) {
  const controls = useRef(null);
  const [autoRotate, setAutoRotate] = useState(true);
  const [warnings, setWarnings] = useState([]);
  const webgl = useMemo(hasWebGL, []);

  if (!webgl) return <Fallback message="Your browser does not support WebGL, so the 3D view is unavailable. The 2D views show the same design." />;

  return (
    <div className={`relative ${className}`} style={{ height }}>
      <ViewerBoundary>
        <Canvas
          shadows
          dpr={[1, 2]}
          camera={CAMERA}
          gl={{ antialias: true, preserveDrawingBuffer: false }}
          aria-label={`Interactive 3D model of the ${specs.garmentType || 'garment'}`}
        >
          <ambientLight intensity={0.55} />
          <hemisphereLight args={['#ffffff', '#b9c2d0', 0.75]} />
          <directionalLight position={[1.6, 2.2, 2.4]} intensity={1.6} castShadow shadow-mapSize={[1024, 1024]} />
          <directionalLight position={[-2, 1, -2.2]} intensity={0.9} />
          <Suspense fallback={<Loading />}>
            <Garment specs={specs} onWarnings={setWarnings} />
          </Suspense>
          <ContactShadows position={[0, -0.56, 0]} opacity={0.35} scale={2.4} blur={2.4} far={1} />
          <OrbitControls
            ref={controls}
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
        </Canvas>
      </ViewerBoundary>

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
          onClick={() => {
            setAutoRotate(false);
            controls.current?.reset();
          }}
          className="flex items-center gap-1 rounded-lg bg-white/90 px-2.5 py-1.5 text-xs font-medium text-slate-700 shadow-sm hover:bg-white"
        >
          <RotateCcw className="h-3.5 w-3.5" /> Reset view
        </button>
      </div>
      <p className="pointer-events-none absolute bottom-2 left-0 right-0 text-center text-[11px] text-slate-500">Drag to rotate · scroll or pinch to zoom · right-drag to pan</p>
      {warnings.length > 0 && (
        <div className="absolute left-3 right-3 top-12 rounded-lg bg-amber-50/95 px-3 py-2 text-xs text-amber-800 shadow-sm">{warnings.join(' ')}</div>
      )}
    </div>
  );
}

Object.values(MODEL_FILE).forEach((file) => useGLTF.preload(file));
