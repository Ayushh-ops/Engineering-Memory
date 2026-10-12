import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';

export type G3Node = {
  id: string;
  name: string;
  folder: string;
  risk: number;
  kind: 'imports' | 'importedBy' | 'indirect';
  via?: string;
};
type Props = { center: { id: string; name: string; folder: string }; nodes: G3Node[]; onSelect?: (id: string) => void; resetSignal?: number };

const Y = new THREE.Vector3(0, 1, 0);

const fib = (i: number, n: number) => {
  const y = 1 - (2 * (i + 0.5)) / n;
  const r = Math.sqrt(Math.max(0, 1 - y * y));
  const t = i * 2.399963;
  return new THREE.Vector3(Math.cos(t) * r, y, Math.sin(t) * r);
};

type Item = {
  id: string;
  mesh: THREE.Mesh;
  lbl: CSS2DObject;
  el: HTMLElement;
  pri: number;
  always: boolean;
  hover: boolean;
  below: boolean;
  shown: boolean;
  hold: number;
  passes: number;
  bw: number;
  bh: number;
};

export default function Graph3D({ center, nodes, onSelect, resetSignal = 0 }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const fitRef = useRef<() => void>(() => {});
  const selRef = useRef(onSelect);
  selRef.current = onSelect;
  const key = center.id + '|' + nodes.map((n) => n.id + n.kind + n.risk + (n.via || '')).join(',');

  useEffect(() => { fitRef.current(); }, [resetSignal]);

  useEffect(() => {
    const el = host.current!;
    const W = () => el.clientWidth || 600;
    const H = () => el.clientHeight || 400;
    const scene = new THREE.Scene();

    const cam = new THREE.PerspectiveCamera(45, W() / H(), 1, 6000);
    const gl = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    gl.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    gl.setSize(W(), H());
    gl.domElement.style.touchAction = 'none';
    const lr = new CSS2DRenderer();
    lr.setSize(W(), H());
    Object.assign(lr.domElement.style, { position: 'absolute', inset: '0', pointerEvents: 'none', touchAction: 'none' });
    el.style.touchAction = 'none';
    el.append(gl.domElement, lr.domElement);
    scene.add(new THREE.AmbientLight(0xffffff, 0.95));
    const dl = new THREE.DirectionalLight(0xffffff, 1.1);
    dl.position.set(200, 400, 300);
    scene.add(dl);
    const controls = new OrbitControls(cam, gl.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.5;

    const group = new THREE.Group();
    scene.add(group);
    const items: Item[] = [];
    const meshes: THREE.Mesh[] = [];

    const makeLabel = (name: string, folder: string, color: string, below: boolean, isCenter = false) => {
      const wrap = document.createElement('div');
      const d = document.createElement('div');
      d.style.cssText = `transform:translateY(${below ? '125%' : '-125%'});background:rgba(16,22,26,.9);border:1px solid ${color};border-radius:6px;padding:3px 9px;font:500 12px/1.3 'IBM Plex Mono',monospace;color:#fff;white-space:nowrap;text-align:center;transition:opacity .18s ease;pointer-events:none;opacity:0;`;
      const a = document.createElement('div');
      a.textContent = name;
      a.style.fontWeight = isCenter ? '700' : '600';
      if (isCenter) a.style.fontSize = '15px';
      const b = document.createElement('div');
      b.textContent = folder.length > 26 ? '…' + folder.slice(-25) : folder;
      b.style.cssText = `font-size:${isCenter ? '11px' : '10.5px'};color:#8A918C`;
      d.append(a, b);
      wrap.append(d);
      return { obj: new CSS2DObject(wrap), el: d };
    };

    const addCube = (
      n: { id: string; name: string; folder: string },
      pos: THREE.Vector3,
      size: number,
      color: string,
      emissiveIntensity: number,
      pri: number,
      always: boolean,
      below = false,
      isCenter = false
    ) => {
      const mat = new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity,
        roughness: 0.45,
        metalness: 0.1,
        transparent: true,
        opacity: 1.0,
        polygonOffset: true,
        polygonOffsetFactor: 2,
        polygonOffsetUnits: 2,
      });
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(size, size, size), mat);
      mesh.position.copy(pos);
      mesh.userData = { id: n.id, size };

      const outlineMat = new THREE.LineBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.35,
        depthWrite: false,
      });
      const outline = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry), outlineMat);
      outline.renderOrder = 2;
      outline.scale.setScalar(1.003);
      mesh.add(outline);

      const { obj: lbl, el: labelEl } = makeLabel(n.name, n.folder, color, below, isCenter);
      mesh.add(lbl);
      group.add(mesh);
      meshes.push(mesh);
      items.push({
        id: n.id,
        mesh,
        lbl,
        el: labelEl,
        pri,
        always,
        hover: false,
        below,
        shown: isCenter || always,
        hold: isCenter || always ? 20 : 0,
        passes: isCenter || always ? 2 : 0,
        bw: 0,
        bh: 0,
      });
      return mesh;
    };

    const link = (
      a: THREE.Vector3,
      b: THREE.Vector3,
      ha: number,
      hb: number,
      color: string,
      dashed = false,
      isHighRisk = false,
      forcedOpacity?: number
    ) => {
      const d = b.clone().sub(a).normalize();
      if (b.distanceTo(a) < 0.001) return;
      const s = a.clone().addScaledVector(d, ha * 1.02);
      const e = b.clone().addScaledVector(d, -hb * 1.02);
      const total = s.distanceTo(e);
      if (total <= 2) return;

      const opacity = forcedOpacity !== undefined ? forcedOpacity : (isHighRisk ? 0.9 : 0.6);
      const mt = new THREE.MeshBasicMaterial({ color, transparent: true, opacity });

      // Edge line from border to border with 2px thickness (radius ~1.0)
      if (!dashed) {
        const cyl = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.0, total, 6), mt);
        cyl.position.copy(s.clone().addScaledVector(d, total / 2));
        cyl.quaternion.setFromUnitVectors(Y, d);
        group.add(cyl);
      } else {
        const dashLen = 9;
        const gap = 9;
        for (let t = 0; t < total; t += dashLen + gap) {
          const len = Math.min(dashLen, total - t);
          if (len <= 0) break;
          const seg = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, len, 6), mt);
          seg.position.copy(s.clone().addScaledVector(d, t + len / 2));
          seg.quaternion.setFromUnitVectors(Y, d);
          group.add(seg);
        }
      }

      // One arrowhead at 58% along the edge pointing in edge direction
      const coneR = dashed ? 6 : 8;
      const coneL = dashed ? 18 : 24;
      const midPos = s.clone().addScaledVector(d, total * 0.58);
      const cone = new THREE.Mesh(new THREE.ConeGeometry(coneR, coneL, 16), mt);
      cone.position.copy(midPos);
      cone.quaternion.setFromUnitVectors(Y, d);
      group.add(cone);
    };

    // Glow halo behind selected cube
    const makeHalo = () => {
      const canvas = document.createElement('canvas');
      canvas.width = 128;
      canvas.height = 128;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        const grad = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
        grad.addColorStop(0, 'rgba(79, 209, 181, 0.35)');
        grad.addColorStop(0.5, 'rgba(79, 209, 181, 0.15)');
        grad.addColorStop(1, 'rgba(79, 209, 181, 0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 128, 128);
      }
      const tex = new THREE.CanvasTexture(canvas);
      const sMat = new THREE.SpriteMaterial({
        map: tex,
        transparent: true,
        depthWrite: false,
        depthTest: true,
      });
      const sp = new THREE.Sprite(sMat);
      sp.scale.set(420, 420, 1);
      sp.position.set(0, 0, 0);
      sp.renderOrder = -1;
      return sp;
    };
    group.add(makeHalo());

    // Selected center cube: size 120, colour #4FD1B5, emissiveIntensity 0.5, label below, 15px bold
    const CS = 120;
    const centerMesh = addCube(center, new THREE.Vector3(0, 0, 0), CS, '#4FD1B5', 0.5, 1000, true, true, true);

    // Direct nodes
    const direct = nodes.filter((n) => n.kind !== 'indirect').sort((a, b) => b.risk - a.risk);
    const top10DirectIds = new Set(direct.slice(0, 10).map((n) => n.id));
    const top3DirectIds = new Set(direct.slice(0, 3).map((n) => n.id));

    type DirectItem = {
      node: G3Node;
      pos: THREE.Vector3;
      size: number;
      color: string;
      emissiveIntensity: number;
      isTop10: boolean;
      isHighRisk: boolean;
    };
    const directItems: DirectItem[] = [];

    const nDirect = direct.length;
    direct.forEach((node, i) => {
      const v = fib(i, Math.max(1, nDirect));
      const radius = i % 3 === 0 ? 240 : i % 3 === 1 ? 330 : 420;
      const pos = v.clone().multiplyScalar(radius);
      const size = 28 + (Math.min(100, Math.max(0, node.risk)) / 100) * 16;
      const color = node.kind === 'imports' ? '#4FD1B5' : '#F0B35F';
      const emissiveIntensity = 0.1 + (Math.min(100, Math.max(0, node.risk)) / 100) * 0.5;
      const isTop10 = top10DirectIds.has(node.id);
      const isHighRisk = top3DirectIds.has(node.id);
      directItems.push({ node, pos, size, color, emissiveIntensity, isTop10, isHighRisk });
    });

    // 12 relaxation iterations (min distance 80 between cubes; selected cube fixed at origin; no cube within 160 of origin)
    for (let iter = 0; iter < 12; iter++) {
      for (let a = 0; a < directItems.length; a++) {
        for (let b = a + 1; b < directItems.length; b++) {
          const itemA = directItems[a];
          const itemB = directItems[b];
          const delta = itemA.pos.clone().sub(itemB.pos);
          const d = delta.length();
          if (d < 80) {
            const overlap = 80 - d;
            const norm = d > 0.001 ? delta.divideScalar(d) : new THREE.Vector3(0, 1, 0);
            itemA.pos.addScaledVector(norm, overlap * 0.5);
            itemB.pos.addScaledVector(norm, -overlap * 0.5);
          }
        }
      }

      // Never put any cube within 160 units of the origin
      directItems.forEach((item) => {
        const dist = item.pos.length();
        if (dist < 160) {
          if (dist > 0.001) {
            item.pos.normalize().multiplyScalar(160);
          } else {
            item.pos.set(160, 0, 0);
          }
        }
      });
    }

    const directMeshMap = new Map<string, { mesh: THREE.Mesh; size: number }>();
    directItems.forEach((item) => {
      const mesh = addCube(item.node, item.pos, item.size, item.color, item.emissiveIntensity, item.node.risk + 10, item.isTop10);
      directMeshMap.set(item.node.id, { mesh, size: item.size });

      if (item.node.kind === 'imports') {
        // selected -> dependency
        link(new THREE.Vector3(0, 0, 0), item.pos, CS / 2, item.size / 2, '#4FD1B5', false, item.isHighRisk);
      } else {
        // importer -> selected
        link(item.pos, new THREE.Vector3(0, 0, 0), item.size / 2, CS / 2, '#F0B35F', false, item.isHighRisk);
      }
    });

    // Indirect nodes
    const ind = nodes.filter((n) => n.kind === 'indirect');
    const sortedInd = [...ind].sort((a, b) => b.risk - a.risk);
    const top8IndirectIds = new Set(sortedInd.slice(0, 8).map((n) => n.id));

    const groupedByVia = new Map<string, G3Node[]>();
    const orphaned: G3Node[] = [];

    sortedInd.forEach((n) => {
      if (n.via && directMeshMap.has(n.via)) {
        const list = groupedByVia.get(n.via) || [];
        list.push(n);
        groupedByVia.set(n.via, list);
      } else {
        orphaned.push(n);
      }
    });

    groupedByVia.forEach((children, via) => {
      const parentInfo = directMeshMap.get(via)!;
      const parentPos = parentInfo.mesh.position;
      const count = children.length;

      children.forEach((n, k) => {
        const dir = parentPos.clone().add(fib(k, count).multiplyScalar(0.9)).normalize();
        const pos = parentPos.clone().addScaledVector(dir, 200);

        const isTop8Ind = top8IndirectIds.has(n.id);
        const pri = isTop8Ind ? 0.01 + (n.risk / 10000) : 0;

        addCube(n, pos, 24, '#9AA5B1', 0.35, pri, isTop8Ind);
        link(parentPos, pos, parentInfo.size / 2, 12, '#9AA5B1', true, false, 0.7);
      });
    });

    const M = orphaned.length;
    orphaned.forEach((n, j) => {
      const v = fib(j, Math.max(1, M));
      const pos = v.multiplyScalar(640);
      const isTop8Ind = top8IndirectIds.has(n.id);
      const pri = isTop8Ind ? 0.01 + (n.risk / 10000) : 0;

      addCube(n, pos, 24, '#9AA5B1', 0.35, pri, isTop8Ind);
    });

    // Sort labels by priority only once on build
    items.sort((a, b) => b.pri - a.pri);
    let orderedItems = [...items];

    // Camera initial position & fit
    const camDir = new THREE.Vector3(0.55, 0.4, 1).normalize();

    const fit = () => {
      let R = CS + CS / 2;
      meshes.forEach((m) => {
        const s = m.userData.size || 30;
        const d = m.position.length() + s;
        if (d > R) R = d;
      });

      const half = THREE.MathUtils.degToRad(cam.fov / 2);
      const dist = (R / Math.sin(Math.min(half, Math.atan(Math.tan(half) * cam.aspect)))) * 1.18;
      cam.far = dist * 4;
      controls.target.set(0, 0, 0);
      cam.position.copy(camDir).multiplyScalar(dist);
      cam.updateProjectionMatrix();
      controls.update();
    };
    fitRef.current = fit;
    fit();

    // Hover and select
    const ray = new THREE.Raycaster();
    const ptr = new THREE.Vector2();
    let down = { x: 0, y: 0 };
    const pick = (e: PointerEvent) => {
      const r = gl.domElement.getBoundingClientRect();
      ptr.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ptr, cam);
      const hit = ray.intersectObjects(meshes, false)[0];
      return hit ? (hit.object as THREE.Mesh) : null;
    };

    // Label collision & visibility hysteresis computation
    const v = new THREE.Vector3();
    const computeOverlaps = () => {
      const w = W(), h = H();
      const placed: { x: number; y: number; w: number; h: number }[] = [];
      const isPhone = typeof window !== 'undefined' && window.innerWidth <= 767;
      const top4RiskyIds = isPhone
        ? new Set([...nodes].sort((a, b) => (b.risk || 0) - (a.risk || 0)).slice(0, 4).map((n) => n.id))
        : null;

      orderedItems.forEach((it) => {
        if (isPhone && it.id !== center.id && !top4RiskyIds?.has(it.id) && !it.hover) {
          it.shown = false;
          it.el.style.opacity = '0';
          return;
        }

        // Measure label sizes once after mount and cache them
        if (!it.bw) {
          it.bw = (it.el.offsetWidth || 110) + 6;
          it.bh = (it.el.offsetHeight || 34) + 4;
        }

        v.copy(it.mesh.position).project(cam);
        const sx = (v.x * 0.5 + 0.5) * w;
        const sy = (-v.y * 0.5 + 0.5) * h + (it.below ? (it.id === center.id ? 80 : 46) : -46);
        const box = { x: sx - it.bw / 2, y: sy - it.bh / 2, w: it.bw, h: it.bh };

        const want = it.always || it.hover || it.id === center.id;
        const clash = want && it.id !== center.id && !it.hover && placed.some((p) =>
          box.x < p.x + p.w && box.x + box.w > p.x && box.y < p.y + p.h && box.y + box.h > p.y
        );

        const candidate = want && !clash;

        if (it.hover || it.id === center.id) {
          it.shown = true;
          it.hold = 20;
          it.passes = 2;
          placed.push(box);
        } else if (it.shown) {
          if (candidate) {
            it.hold = Math.max(it.hold, 20);
            it.passes = 2;
            placed.push(box);
          } else {
            if (it.hold > 0) {
              placed.push(box);
            } else {
              it.shown = false;
              it.passes = 0;
            }
          }
        } else {
          if (candidate) {
            it.passes++;
            if (it.passes >= 2) {
              it.shown = true;
              it.hold = 20;
              placed.push(box);
            }
          } else {
            it.passes = 0;
          }
        }

        it.el.style.opacity = it.shown ? '1' : '0';
      });
    };

    let lastHoverMesh: THREE.Mesh | null = null;
    const onMove = (e: PointerEvent) => {
      const h = pick(e);
      if (h !== lastHoverMesh) {
        lastHoverMesh = h;
        items.forEach((it) => {
          it.hover = it.mesh === h;
          it.mesh.scale.setScalar(it.mesh === h ? 1.12 : 1);
        });
        gl.domElement.style.cursor = h ? 'pointer' : 'grab';
        const hovered = items.find((it) => it.hover);
        orderedItems = hovered ? [hovered, ...items.filter((it) => it !== hovered)] : [...items];
        computeOverlaps();
      }
    };

    let interacted = false;
    const onDown = (e: PointerEvent) => {
      interacted = true;
      controls.autoRotate = false;
      down = { x: e.clientX, y: e.clientY };
    };
    const onUp = (e: PointerEvent) => {
      if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) return;
      const h = pick(e);
      if (h && h.userData.id !== center.id) selRef.current?.(h.userData.id);
    };
    gl.domElement.addEventListener('pointermove', onMove);
    gl.domElement.addEventListener('pointerdown', onDown);
    gl.domElement.addEventListener('pointerup', onUp);

    let raf = 0;
    let frameCount = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      controls.update();

      frameCount++;
      // Decrement hold frame count
      items.forEach((it) => {
        if (it.hold > 0) it.hold--;
      });

      // Run overlap check every 12th frame
      if (frameCount % 12 === 0) {
        computeOverlaps();
      }

      gl.render(scene, cam);
      lr.render(scene, cam);
    };
    loop();

    let lastW = W(), lastH = H();
    const ro = new ResizeObserver(() => {
      const w = W(), h = H();
      if (Math.abs(w - lastW) > 2 || Math.abs(h - lastH) > 2) {
        lastW = w;
        lastH = h;
        cam.aspect = w / h;
        cam.updateProjectionMatrix();
        gl.setSize(w, h);
        lr.setSize(w, h);
        if (!interacted) {
          fit();
        }
      }
    });
    ro.observe(el);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      gl.domElement.removeEventListener('pointermove', onMove);
      gl.domElement.removeEventListener('pointerdown', onDown);
      gl.domElement.removeEventListener('pointerup', onUp);
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
        const mt = m.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mt)) mt.forEach((x) => x.dispose());
        else mt?.dispose();
      });
      gl.dispose();
      el.replaceChildren();
      void centerMesh;
    };
  }, [key]);

  return <div ref={host} style={{ position: 'absolute', inset: 0 }} />;
}
