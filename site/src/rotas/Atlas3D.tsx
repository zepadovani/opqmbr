import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { corInstituicao } from "../dados/cores";
import type { AtlasProjeto } from "../dados/tipos";

/**
 * Visualização 3D do atlas (§4.2.5 item 4, opção A escolhida pelo usuário —
 * UMAP 3D puro, não o híbrido 2.5D nem o topográfico-geográfico). Mesmo W×H
 * do SVG 2D pra não saltar o layout da página ao trocar de dimensão.
 *
 * `x3d`/`y3d`/`z3d` são uma redução independente da 2D, não "x/y com um z a
 * mais" — cada método de clusterização (`AtlasProjetos.tsx`) gera sua
 * própria (UMAP nos três primeiros; `spring_layout(dim=3)` na coautoria).
 * Mesh individual por ponto (não `InstancedMesh`): 934 draw calls é barato
 * pra GPU moderna, e cada ponto precisa de cor própria (instituição) — dá
 * pra trocar a cor de um mesh sem realocar buffer nenhum, ao contrário de
 * mexer no atributo de cor por instância de um `InstancedMesh`.
 */
const W = 760;
const H = 680;

function raio3d(nProducoes: number): number {
  return Math.min(Math.max(0.09 + Math.sqrt(nProducoes) * 0.028, 0.09), 0.32);
}

/** `corInstituicao` devolve `var(--color-text-muted)` pra sigla desconhecida
 * (funciona como atributo SVG, mas não é um hex válido pro THREE.Color) —
 * cai num cinza neutro nesse caso, em vez de deixar o Color lançar. */
function corTres(sigla: string): THREE.ColorRepresentation {
  const s = corInstituicao(sigla);
  return /^#/.test(s) ? s : 0x999999;
}

const COR_FUNDO_3D = 0xd0d0d0;

interface Props {
  projetos: AtlasProjeto[];
  destacadoDe: (p: AtlasProjeto) => boolean;
  algumFiltroAtivo: boolean;
  projetoAbertoId: string | null;
  onSelecionar: (p: AtlasProjeto) => void;
  onHover: (p: AtlasProjeto, clientX: number, clientY: number) => void;
  onHoverFim: () => void;
}

interface CenaState {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  controls: OrbitControls;
  raycaster: THREE.Raycaster;
  meshes: Map<string, THREE.Mesh>;
  geometria: THREE.SphereGeometry;
}

export default function Atlas3D({
  projetos,
  destacadoDe,
  algumFiltroAtivo,
  projetoAbertoId,
  onSelecionar,
  onHover,
  onHoverFim,
}: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<CenaState | null>(null);

  // Monta a cena UMA vez — câmera, renderer, controles orbitais, loop de
  // render. Reconstruir isso a cada troca de filtro seria caro e reiniciaria
  // a posição da câmera (perder a rotação que a pessoa já fez).
  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, W / H, 0.1, 100);
    camera.position.set(0, 0, 13);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 3;
    controls.maxDistance = 40;

    scene.add(new THREE.AmbientLight(0xffffff, 1));

    const geometria = new THREE.SphereGeometry(1, 12, 10);

    const st: CenaState = {
      scene, camera, renderer, controls,
      raycaster: new THREE.Raycaster(),
      meshes: new Map(),
      geometria,
    };
    stateRef.current = st;

    let vivo = true;
    function tick() {
      if (!vivo) return;
      controls.update();
      renderer.render(scene, camera);
      requestAnimationFrame(tick);
    }
    tick();

    return () => {
      vivo = false;
      controls.dispose();
      for (const mesh of st.meshes.values()) {
        (mesh.material as THREE.Material).dispose();
      }
      geometria.dispose();
      renderer.dispose();
      container.removeChild(renderer.domElement);
      stateRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // (Re)constrói os pontos quando a lista de projetos muda — troca de
  // método de clusterização, cada um com sua própria redução 3D. Normaliza
  // pro mesmo cubo de referência (~10 de lado) independente da escala
  // natural de cada método, senão a câmera fixa em z=13 ficaria longe
  // demais de uns e dentro da nuvem de outros.
  useEffect(() => {
    const st = stateRef.current;
    if (!st || projetos.length === 0) return;

    for (const mesh of st.meshes.values()) {
      st.scene.remove(mesh);
      (mesh.material as THREE.Material).dispose();
    }
    st.meshes.clear();

    const eixos: Array<[number, number]> = (["x3d", "y3d", "z3d"] as const).map((chave) => {
      const valores = projetos.map((p) => p[chave]);
      return [Math.min(...valores), Math.max(...valores)];
    });
    const centro = eixos.map(([min, max]) => (min + max) / 2);
    const maiorFaixa = Math.max(...eixos.map(([min, max]) => max - min), 1e-6);
    const escala = 10 / maiorFaixa;

    for (const p of projetos) {
      const material = new THREE.MeshBasicMaterial({ color: corTres(p.sigla), transparent: true });
      const mesh = new THREE.Mesh(st.geometria, material);
      mesh.position.set(
        (p.x3d - centro[0]) * escala,
        (p.y3d - centro[1]) * escala,
        (p.z3d - centro[2]) * escala,
      );
      const r = raio3d(p.n_producoes);
      mesh.scale.setScalar(r);
      mesh.userData.id = p.id;
      st.scene.add(mesh);
      st.meshes.set(p.id, mesh);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projetos]);

  // Atualiza cor/opacidade/escala conforme filtro e seleção mudam, sem
  // reconstruir a cena — só seta propriedades nos meshes já existentes.
  // Sem array de deps de propósito: `destacadoDe` é uma closure nova a cada
  // render do componente pai (não memoizada), então "deps corretos" rodaria
  // no mesmo ritmo mesmo assim; setar campo em ~934 meshes é barato.
  useEffect(() => {
    const st = stateRef.current;
    if (!st) return;
    for (const p of projetos) {
      const mesh = st.meshes.get(p.id);
      if (!mesh) continue;
      const apagado = algumFiltroAtivo && !destacadoDe(p);
      const material = mesh.material as THREE.MeshBasicMaterial;
      material.color.set(apagado ? COR_FUNDO_3D : corTres(p.sigla));
      material.opacity = apagado ? 0.2 : 0.9;
      const aberto = p.id === projetoAbertoId;
      mesh.scale.setScalar(raio3d(p.n_producoes) * (aberto ? 1.7 : 1));
    }
  });

  // Interação: raycasting no mousemove/click, mesmo padrão de hover/clique
  // do modo 2D (tooltip que segue o cursor, clique abre produções).
  useEffect(() => {
    const st = stateRef.current;
    const container = mountRef.current;
    if (!st || !container) return;

    function pontoDoEvento(ev: MouseEvent): AtlasProjeto | null {
      const rect = container!.getBoundingClientRect();
      const mouse = new THREE.Vector2(
        ((ev.clientX - rect.left) / rect.width) * 2 - 1,
        -((ev.clientY - rect.top) / rect.height) * 2 + 1,
      );
      st!.raycaster.setFromCamera(mouse, st!.camera);
      const hits = st!.raycaster.intersectObjects([...st!.meshes.values()]);
      if (hits.length === 0) return null;
      const id = hits[0].object.userData.id as string;
      return projetos.find((p) => p.id === id) ?? null;
    }

    let arrastando = false;
    function aoBaixar() {
      arrastando = false;
    }
    function aoMover(ev: MouseEvent) {
      if (ev.buttons !== 0) arrastando = true; // arrastar pra rotacionar não deve contar como hover parado
      const p = pontoDoEvento(ev);
      if (p) onHover(p, ev.clientX, ev.clientY);
      else onHoverFim();
    }
    function aoClicar(ev: MouseEvent) {
      if (arrastando) return;
      const p = pontoDoEvento(ev);
      if (p) onSelecionar(p);
    }

    container.addEventListener("pointerdown", aoBaixar);
    container.addEventListener("mousemove", aoMover);
    container.addEventListener("click", aoClicar);
    return () => {
      container.removeEventListener("pointerdown", aoBaixar);
      container.removeEventListener("mousemove", aoMover);
      container.removeEventListener("click", aoClicar);
    };
  }, [projetos, onHover, onHoverFim, onSelecionar]);

  return <div ref={mountRef} style={{ width: W, height: H, touchAction: "none" }} />;
}
