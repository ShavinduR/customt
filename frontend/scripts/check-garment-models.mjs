/** Loads each generated .glb with three.js's GLTFLoader and prints what it finds (sanity check). */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Box3, Vector3 } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MODEL_FILE } from '../src/utils/garmentGeometry.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

for (const [garment, file] of Object.entries(MODEL_FILE)) {
  const buf = readFileSync(join(ROOT, 'public', file));
  const arrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const gltf = await new GLTFLoader().parseAsync(arrayBuffer, '');
  const mesh = gltf.scene.getObjectByName('Shirt');
  const size = new Box3().setFromObject(mesh).getSize(new Vector3());
  const { attributes } = mesh.geometry;
  const uv = attributes.uv.array;
  let uMin = 1;
  let uMax = 0;
  let vMin = 1;
  let vMax = 0;
  for (let i = 0; i < uv.length; i += 2) {
    uMin = Math.min(uMin, uv[i]);
    uMax = Math.max(uMax, uv[i]);
    vMin = Math.min(vMin, uv[i + 1]);
    vMax = Math.max(vMax, uv[i + 1]);
  }
  console.log(
    `${garment.padEnd(9)} mesh "${mesh.name}", ${attributes.position.count} vertices, normals: ${Boolean(attributes.normal)}, ` +
      `size ${size.x.toFixed(2)} x ${size.y.toFixed(2)} x ${size.z.toFixed(2)}, uv u ${uMin.toFixed(2)}-${uMax.toFixed(2)} v ${vMin.toFixed(2)}-${vMax.toFixed(2)}`
  );
}
