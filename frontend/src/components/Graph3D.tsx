import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';

export type G3Node = { id: string; name: string; folder: string; risk: number; kind: 'imports' | 'importedBy' | 'indirect' };
type Props = { center: { id: string; name: string; folder: string }; nodes: G3Node[]; onSelect?: (id: string) => void; resetSignal?: number };

const PALETTE = ['#F0B35F', '#7AA2F7', '#F7768E', '#9ECE6A', '#BB9AF7', '#2AC3DE', '#FF9E64', '#73DACA', '#F4A6D7', '#E0AF68', '#A3E635', '#FB7185', '#60A5FA'];
const hash = (s: string) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); };
const Y = new THREE.Vector3(0, 1, 0);

type Item = { id: string; mesh: THREE.Mesh; lbl: CSS2DObject; pri: number; always: boolean; hover: boolean; below: boolean };

export default function Graph3D({ center, nodes, onSelect, resetSignal = 0 }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const fitRef = useRef<() => void>(() => {});
  const selRef = useRef(onSelect);
  selRef.current = onSelect;
  const key = center.id + '|' + nodes.map((n) => n.id + n.kind + n.risk).join(',');

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
    const lr = new CSS2DRenderer();
    lr.setSize(W(), H());
    Object.assign(lr.domElement.style, { position: 'absolute', inset: '0', pointerEvents: 'none' });
    el.append(gl.domElement, lr.domElement);
    scene.add(new THREE.AmbientLight(0xffffff, 0.95));
    const dl = new THREE.DirectionalLight(0xffffff, 1.1);
    dl.position.set(200, 400, 300);
    scene.add(dl);
    const controls = new OrbitControls(cam, gl.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;

    const group = new THREE.Group();
    scene.add(group);
    const items: Item[] = [];
    const meshes: THREE.Mesh[] = [];

    const makeLabel = (name: string, folder: string, color: string, below: boolean) => {
      const wrap = document.createElement('div');
      const d = document.createElement('div');
      d.style.cssText = `transform:translateY(${below ? '125%' : '-125%'});background:rgba(16,22,26,.9);border:1px solid ${color};border-radius:6px;padding:3px 9px;font:500 12px/1.3 'IBM Plex Mono',monospace;color:#fff;white-space:nowrap;text-align:center`;
      const a = document.createElement('div');
      a.textContent = name;
      a.style.fontWeight = '600';
      const b = document.createElement('div');
      b.textContent = folder.length > 26 ? '…' + folder.slice(-25) : folder;
      b.style.cssText = 'font-size:10.5px;color:#8A918C';
      d.append(a, b);
      wrap.append(d);
      return new CSS2DObject(wrap);
    };

    const addCube = (n: { id: string; name: string; folder: string }, pos: THREE.Vector3, size: number, color: string, pri: number, always: boolean, below = false) => {
      const mat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.18, roughness: 0.45, metalness: 0.1, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(size, size, size), mat);
      mesh.position.copy(pos);
      mesh.userData = { id: n.id, size };
      mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 })));
      const lbl = makeLabel(n.name, n.folder, color, below);
      mesh.add(lbl);
      group.add(mesh);
      meshes.push(mesh);
      items.push({ id: n.id, mesh, lbl, pri, always, hover: false, below });
      return mesh;
    };

    const link = (a: THREE.Vector3, b: THREE.Vector3, ha: number, hb: number, color: string) => {
      const d = b.clone().sub(a).normalize();
      const s = a.clone().addScaledVector(d, ha * 0.9);
      const e = b.clone().addScaledVector(d, -hb * 0.9);
      const L = s.distanceTo(e);
      const mt = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8 });
      const cy = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, L, 6), mt);
      cy.position.copy(s.clone().add(e).multiplyScalar(0.5));
      cy.quaternion.setFromUnitVectors(Y, d);
      group.add(cy);
      const cone = new THREE.Mesh(new THREE.ConeGeometry(5, 14, 12), mt);
      cone.position.copy(e.clone().addScaledVector(d, -7));
      cone.quaternion.setFromUnitVectors(Y, d);
      group.add(cone);
    };

    // center
    const centerMesh = addCube(center, new THREE.Vector3(0, 0, 0), 52, '#4FD1B5', 1000, true, true);
    const CS = 52;

    // direct nodes
    const direct = nodes.filter((n) => n.kind !== 'indirect').sort((a, b) => b.risk - a.risk);
    const colorOf = new Map(direct.map((n, i) => [n.id, PALETTE[i % PALETTE.length]]));
    const left = direct.filter((n) => n.kind === 'imports');
    const right = direct.filter((n) => n.kind === 'importedBy');
    const RINGS = [190, 270, 350];
    const spread = (list: G3Node[], a0: number, a1: number) =>
      list.forEach((n, i) => {
        const th = a0 + ((i + 0.5) / list.length) * (a1 - a0);
        const R = RINGS[i % 3];
        const pos = new THREE.Vector3(R * 1.4 * Math.cos(th), (hash(n.id) % 37) - 18, R * 0.55 * Math.sin(th));
        const size = 26 + (Math.min(100, n.risk) / 100) * 16;
        const color = colorOf.get(n.id)!;
        addCube(n, pos, size, color, n.risk, true);
        if (n.kind === 'imports') link(new THREE.Vector3(0, 0, 0), pos, CS / 2, size / 2, color);
        else link(pos, new THREE.Vector3(0, 0, 0), size / 2, CS / 2, color);
      });
    const PAD = 0.25;
    if (left.length && right.length) {
      spread(right, -Math.PI / 2 + PAD, Math.PI / 2 - PAD);
      spread(left, Math.PI / 2 + PAD, (3 * Math.PI) / 2 - PAD);
    } else {
      spread(direct, 0.2, Math.PI * 2 - 0.2);
    }

    // indirect nodes
    const ind = nodes.filter((n) => n.kind === 'indirect');
    ind.forEach((n, i) => {
      const th = ((i + 0.5) / ind.length) * Math.PI * 2;
      addCube(n, new THREE.Vector3(470 * 1.4 * Math.cos(th), (hash(n.id) % 37) - 18, 470 * 0.55 * Math.sin(th)), 16, '#6B7480', 0, false);
    });

    // fit camera
    const fit = () => {
      let mx = 0, my = 0, mz = 0;
      meshes.forEach((m) => { const s = m.userData.size / 2; mx = Math.max(mx, Math.abs(m.position.x) + s); my = Math.max(my, Math.abs(m.position.y) + s); mz = Math.max(mz, Math.abs(m.position.z) + s); });
      const t = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
      const dh = (my + 90) / (t * 0.78);
      const dw = (mx + 70) / (t * cam.aspect * 0.78);
      const dist = Math.max(dh, dw) + mz;
      controls.target.set(0, 0, 0);
      cam.position.set(0, 0.42, 1).normalize().multiplyScalar(dist);
      cam.updateProjectionMatrix();
      controls.update();
    };
    fitRef.current = fit;
    fit();

    // hover and select
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
    const onMove = (e: PointerEvent) => {
      const h = pick(e);
      items.forEach((it) => { it.hover = it.mesh === h; it.mesh.scale.setScalar(it.mesh === h ? 1.12 : 1); });
      gl.domElement.style.cursor = h ? 'pointer' : 'grab';
    };
    const onDown = (e: PointerEvent) => { down = { x: e.clientX, y: e.clientY }; };
    const onUp = (e: PointerEvent) => {
      if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) return;
      const h = pick(e);
      if (h && h.userData.id !== center.id) selRef.current?.(h.userData.id);
    };
    gl.domElement.addEventListener('pointermove', onMove);
    gl.domElement.addEventListener('pointerdown', onDown);
    gl.domElement.addEventListener('pointerup', onUp);

    // label collision (higher priority wins)
    const v = new THREE.Vector3();
    const order = [...items].sort((a, b) => (b.hover ? 999 : b.pri) - (a.hover ? 999 : a.pri));
    const updateLabels = () => {
      const w = W(), h = H();
      const placed: { x: number; y: number; w: number; h: number }[] = [];
      [...items].sort((a, b) => (b.hover ? 999 : b.pri) - (a.hover ? 999 : a.pri)).forEach((it) => {
        const want = it.always || it.hover;
        if (!want) { it.lbl.visible = false; return; }
        v.copy(it.mesh.position).project(cam);
        const sx = (v.x * 0.5 + 0.5) * w;
        const sy = (-v.y * 0.5 + 0.5) * h + (it.below ? 46 : -46);
        const inner = it.lbl.element.firstElementChild as HTMLElement | null;
        const bw = (inner?.offsetWidth || 110) + 6, bh = (inner?.offsetHeight || 34) + 4;
        const box = { x: sx - bw / 2, y: sy - bh / 2, w: bw, h: bh };
        const clash = !it.hover && it.id !== center.id && placed.some((p) => box.x < p.x + p.w && box.x + box.w > p.x && box.y < p.y + p.h && box.y + box.h > p.y);
        it.lbl.visible = !clash;
        if (!clash) placed.push(box);
      });
    };
    void order;

    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      controls.update();
      updateLabels();
      gl.render(scene, cam);
      lr.render(scene, cam);
    };
    loop();

    const ro = new ResizeObserver(() => {
      cam.aspect = W() / H();
      gl.setSize(W(), H());
      lr.setSize(W(), H());
      fit();
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
