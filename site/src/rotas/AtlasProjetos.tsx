import { useEffect, useMemo, useRef, useState } from "react";
import { select } from "d3-selection";
import { zoom as d3zoom, zoomIdentity, type D3ZoomEvent, type ZoomBehavior, type ZoomTransform } from "d3-zoom";
import { drag as d3drag } from "d3-drag";
import { forceSimulation, forceX, forceY, forceCollide, type Simulation, type SimulationNodeDatum } from "d3-force";
import "d3-transition";
import { loadAtlas, loadAtlasHdbscan, loadAtlasTopicos, loadAtlasCoautoria, loadProgramas, loadProducoesProjeto } from "../dados/loaders";
import Atlas3D from "./Atlas3D";
import { corInstituicao } from "../dados/cores";
import type { Atlas, AtlasCluster, AtlasProjeto, Programa, ProducoesPorProjeto } from "../dados/tipos";

// Rótulos por método de clusterização (§4.2.5 item 3) — cada método
// alternativo tem seu jeito de nomear "grupo" e de gerar palavra-chave;
// centralizado aqui em vez de `if`/ternário espalhado pela JSX.
const ROTULO_GRUPO: Record<Metodo, string> = {
  anppom: "Subárea — 1º nível (ANPPOM)",
  hdbscan: "Cluster (HDBSCAN)",
  topicos: "Tópico (LDA)",
  coautoria: "Comunidade (rede)",
};
const ROTULO_GRUPO_TABELA: Record<Metodo, string> = {
  anppom: "Subáreas",
  hdbscan: "Clusters (HDBSCAN)",
  topicos: "Tópicos (LDA)",
  coautoria: "Comunidades (rede de colaboração)",
};
const ROTULO_COLUNA_GRUPO: Record<Metodo, string> = {
  anppom: "Área (ANPPOM)",
  hdbscan: "Cluster",
  topicos: "Tópico",
  coautoria: "Comunidade",
};
const ROTULO_COLUNA_PALAVRAS: Record<Metodo, string> = {
  anppom: "Subáreas temáticas (2º nível)",
  hdbscan: "Palavras-chave (TF-IDF)",
  topicos: "Termos do tópico",
  coautoria: "Palavras-chave (TF-IDF, calculada depois)",
};

const ROTULO_CLASSE: Record<string, string> = {
  nucleo: "Núcleo comparável",
  difusao: "Difusão e ensino",
  tecnica: "Técnica, serviço e gestão",
  indefinido: "Rubrica indefinida",
};

const W = 760;
const H = 680;
const M = { top: 24, right: 24, bottom: 36, left: 24 };
const iw = W - M.left - M.right;
const ih = H - M.top - M.bottom;

const COR_FUNDO = "var(--color-border)";

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function raio(nProducoes: number): number {
  return clamp(2.5 + Math.sqrt(nProducoes) * 1.1, 2.5, 9);
}

/** `forceCollide` empurra pra abrir espaço, mas não sabe onde fica a borda
 * do gráfico — numa região densa (colisão de dezenas de pontos perto do
 * alvo) ele empurra pra fora do retângulo útil, e como o SVG tem
 * `width`/`height` fixos (não `viewBox`), o que passa da borda não aparece
 * cortado — some. Clampar `x`/`y` de cada nó a cada tick (não só a posição
 * relatada pro React) mantém a física consistente: a velocidade também para
 * de empurrar na direção que já bateu na parede. */
function clamparNaBorda(n: { x?: number; y?: number; r: number }): void {
  if (n.x !== undefined) n.x = clamp(n.x, M.left + n.r, W - M.right - n.r);
  if (n.y !== undefined) n.y = clamp(n.y, M.top + n.r, H - M.bottom - n.r);
}

/** Alvo de interação sempre do mesmo tamanho — o ponto visível encolhe com
 * poucas produções, mas são dados públicos (nenhuma supressão em jogo aqui,
 * ao contrário de contagem de pessoas); não há razão pra um projeto com uma
 * produção só ficar difícil demais de passar o mouse em cima. */
const RAIO_ALVO = 7;

// Mesma projeção equirretangular de MapaLocalizador.tsx (K = cos da latitude
// de referência, pra não distorcer longitude perto do equador vs. no Sul).
const LAT_REF = (-15 * Math.PI) / 180;
const K_PROJECAO = Math.cos(LAT_REF);

type Modo = "subarea" | "instituicao";
type OrganizarPor = "tema" | "localidade";
type Dimensao = "2d" | "3d";
/** §4.2.5 item 6 — topologia geográfica encadeada: 3 níveis de agrupamento
 * dentro do modo Localidade, do mais agregado ao mais fino. */
type AgruparLocalidade = "regiao" | "uf" | "instituicao";
type Metodo = "anppom" | "hdbscan" | "topicos" | "coautoria";
type MetodoAlternativo = Exclude<Metodo, "anppom">;

// Carregadores dos métodos alternativos (§4.2.5 item 3) — mapa em vez de
// um `if` por método: um método novo vira só mais uma entrada aqui, não
// mexe no efeito de carregamento nem no estado.
const LOADERS_ALTERNATIVOS: Record<MetodoAlternativo, () => Promise<Atlas>> = {
  hdbscan: loadAtlasHdbscan,
  topicos: loadAtlasTopicos,
  coautoria: loadAtlasCoautoria,
};

interface NoPonto extends SimulationNodeDatum {
  id: string;
  sigla: string;
  r: number;
  temaX: number;
  temaY: number;
  alvoX: number;
  alvoY: number;
}

/** Projeta (lon,lat) -> pixel, ajustado ao retângulo útil do gráfico —
 * mesma lógica de MapaLocalizador.tsx, reimplementada aqui porque aqui o
 * "mapa" é o layout inteiro do atlas, não um desenho da malha de UFs. */
function projetarGeografia(pontos: Array<{ lon: number; lat: number }>) {
  let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
  for (const { lon, lat } of pontos) {
    minLon = Math.min(minLon, lon);
    maxLon = Math.max(maxLon, lon);
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
  }
  const larguraGraus = (maxLon - minLon) * K_PROJECAO || 1;
  const alturaGraus = maxLat - minLat || 1;
  const k = Math.min(iw / larguraGraus, ih / alturaGraus);
  const offX = (iw - larguraGraus * k) / 2;
  const offY = (ih - alturaGraus * k) / 2;
  return {
    x: (lon: number) => M.left + offX + (lon - minLon) * K_PROJECAO * k,
    y: (lat: number) => M.top + offY + (maxLat - lat) * k,
  };
}

/**
 * Centro "desamontoado" de um grupo geográfico qualquer (instituição, UF ou
 * região — §4.2.5 item 6, topologia encadeada): parte da posição geográfica
 * real (centroide do grupo) mas roda uma simulação de força SÓ entre os
 * grupos — poucos nós (20 instituições, 15 UFs com programa, 5 regiões), não
 * 934 — com `forceCollide` do tamanho aproximado da nuvem de cada um. Sem
 * isso, grupos próximos (USP/UNICAMP/UNESP, todas em SP; ou os estados do
 * Sudeste entre si) desenhariam uma nuvem só, ilegível. O resultado continua
 * reconhecível como "mapa do Brasil" (a simulação só afasta o necessário)
 * mas cada grupo vira seu próprio blob.
 */
function calcularCentrosGeograficos(
  grupos: Array<{ chave: string; n: number; lat: number; lon: number }>,
): Map<string, { x: number; y: number }> {
  const proj = projetarGeografia(grupos.map((g) => ({ lon: g.lon, lat: g.lat })));

  type NoGrupo = SimulationNodeDatum & { chave: string; alvoX: number; alvoY: number; r: number };
  const nos: NoGrupo[] = grupos.map((g) => {
    const alvoX = proj.x(g.lon);
    const alvoY = proj.y(g.lat);
    return { chave: g.chave, alvoX, alvoY, r: Math.sqrt(g.n) * 3.4 + 10, x: alvoX, y: alvoY };
  });

  const sim = forceSimulation(nos)
    .force("x", forceX<NoGrupo>((d) => d.alvoX).strength(0.35))
    .force("y", forceY<NoGrupo>((d) => d.alvoY).strength(0.35))
    .force("collide", forceCollide<NoGrupo>((d) => d.r))
    .stop();
  for (let i = 0; i < 300; i++) sim.tick();

  return new Map(nos.map((n) => [n.chave, { x: n.x ?? n.alvoX, y: n.y ?? n.alvoY }]));
}

/** Agrupa instituições (com coordenada) por `uf` ou `regiao`, calculando o
 * centroide (média simples de lat/lon dos programas do grupo) e a contagem
 * de projetos (soma das instituições do grupo) — insumo de
 * `calcularCentrosGeograficos` pros níveis UF e Região. */
function agruparPorGeografia(
  programas: Programa[],
  instituicoes: Array<{ sigla: string; n: number }>,
  nivel: "uf" | "regiao",
): Array<{ chave: string; n: number; lat: number; lon: number }> {
  const porSigla = new Map(programas.filter((p) => p.lat !== null && p.lon !== null).map((p) => [p.sigla, p]));
  const acumulado = new Map<string, { n: number; somaLat: number; somaLon: number; contagem: number }>();
  for (const i of instituicoes) {
    const p = porSigla.get(i.sigla);
    if (!p) continue;
    const chave = nivel === "uf" ? p.uf : p.regiao;
    const atual = acumulado.get(chave) ?? { n: 0, somaLat: 0, somaLon: 0, contagem: 0 };
    atual.n += i.n;
    atual.somaLat += p.lat as number;
    atual.somaLon += p.lon as number;
    atual.contagem += 1;
    acumulado.set(chave, atual);
  }
  return [...acumulado.entries()].map(([chave, a]) => ({
    chave, n: a.n, lat: a.somaLat / a.contagem, lon: a.somaLon / a.contagem,
  }));
}

export default function AtlasProjetos() {
  const [atlasAnppom, setAtlasAnppom] = useState<Atlas | null>(null);
  const [atlasAlternativos, setAtlasAlternativos] = useState<Partial<Record<MetodoAlternativo, Atlas>>>({});
  const [metodo, setMetodo] = useState<Metodo>("anppom");
  const [carregandoAlternativo, setCarregandoAlternativo] = useState(false);
  const atlas = metodo === "anppom" ? atlasAnppom : (atlasAlternativos[metodo] ?? null);
  const [programas, setProgramas] = useState<Programa[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [modo, setModo] = useState<Modo>("subarea");
  const [organizarPor, setOrganizarPor] = useState<OrganizarPor>("tema");
  const [dimensao, setDimensao] = useState<Dimensao>("2d");
  const [agruparLocalidade, setAgruparLocalidade] = useState<AgruparLocalidade>("instituicao");
  const [temasSel, setTemasSel] = useState<Set<number>>(() => new Set());
  const [subareas2Sel, setSubareas2Sel] = useState<Set<string>>(() => new Set());
  const [siglasSel, setSiglasSel] = useState<Set<string>>(() => new Set());
  const [hover, setHover] = useState<{ p: AtlasProjeto; x: number; y: number } | null>(null);
  const [transform, setTransform] = useState<ZoomTransform>(zoomIdentity);
  const [pronto, setPronto] = useState(false);

  const [projetoAberto, setProjetoAberto] = useState<AtlasProjeto | null>(null);
  const [producoesPorProjeto, setProducoesPorProjeto] = useState<ProducoesPorProjeto | null>(null);
  const [carregandoProducoes, setCarregandoProducoes] = useState(false);

  const [posicoes, setPosicoes] = useState<Map<string, { x: number; y: number }> | null>(null);

  const svgRef = useRef<SVGSVGElement>(null);
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const arrastouRef = useRef(false);

  const simRef = useRef<Simulation<NoPonto, undefined> | null>(null);
  const nosPorId = useRef<Map<string, NoPonto>>(new Map());
  const centrosPorNivel = useRef<Partial<Record<AgruparLocalidade, Map<string, { x: number; y: number }>>>>({});

  useEffect(() => {
    loadAtlas()
      .then(setAtlasAnppom)
      .catch((e: unknown) => setError(String(e)));
    loadProgramas()
      .then(setProgramas)
      .catch(() => {}); // localidade é um extra — sem programas.json, "tema" continua funcionando
  }, []);

  // Métodos alternativos (§4.2.5 item 3) só são buscados quando o usuário
  // troca pela 1ª vez — o método padrão (ANPPOM) já carrega no mount acima;
  // não faz sentido pagar o fetch de todos sempre.
  useEffect(() => {
    if (metodo === "anppom" || atlasAlternativos[metodo] || carregandoAlternativo) return;
    setCarregandoAlternativo(true);
    LOADERS_ALTERNATIVOS[metodo]()
      .then((dados) => setAtlasAlternativos((atual) => ({ ...atual, [metodo]: dados })))
      .catch((e: unknown) => setError(String(e)))
      .finally(() => setCarregandoAlternativo(false));
  }, [metodo, atlasAlternativos, carregandoAlternativo]);

  // d3-zoom substitui o viewBox mexido à mão: cuida de roda do mouse,
  // arrastar (quando não começa em cima de um ponto — d3-drag captura o
  // pointerdown do ponto antes) e pinça no touch, tudo de uma vez.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const zoom = d3zoom<SVGSVGElement, unknown>()
      .scaleExtent([1, 14])
      .translateExtent([[0, 0], [W, H]])
      .on("zoom", (ev: D3ZoomEvent<SVGSVGElement, unknown>) => setTransform(ev.transform));
    select(svg).call(zoom);
    zoomRef.current = zoom;
    return () => {
      select(svg).on(".zoom", null);
    };
    // svgRef só existe depois que `atlas` carrega e o <svg> é montado — sem
    // essa dependência o efeito roda uma vez com a ref ainda nula (fica no
    // "Carregando…") e nunca mais liga o listener.
  }, [atlas]);

  const instituicoes = useMemo(() => {
    if (!atlas) return [];
    const contagem = new Map<string, number>();
    for (const p of atlas.projetos) {
      contagem.set(p.sigla, (contagem.get(p.sigla) ?? 0) + 1);
    }
    return [...contagem.entries()]
      .map(([sigla, n]) => ({ sigla, n }))
      .sort((a, b) => b.n - a.n);
  }, [atlas]);

  const siglasOrdenadasAlfabeto = useMemo(() => {
    if (!atlas) return [];
    return [...new Set(atlas.projetos.map((p) => p.sigla))].sort();
  }, [atlas]);

  // Constrói a simulação UMA vez, quando os dados chegam — não a cada troca
  // de filtro ou destaque, que não mexe em posição. `forceX`/`forceY` lêem
  // `alvoX`/`alvoY` de cada nó, que o efeito de "organizar por" muda depois
  // sem recriar a simulação (dá pra reaquecer e animar a transição).
  //
  // Posição vira `state` do React (um `Map` novo por tick), não atributo de
  // DOM escrito à mão: a 1ª versão escrevia `cx`/`cy` direto via refs, sem
  // passar por props do React — mais rápido em teoria, mas todo re-render
  // por outro motivo (troca de destaque, hover) não tocava `cx`/`cy` E os
  // eventos de mouse do "alvo" paravam de disparar de forma confiável (o
  // bug do hover quebrado). Deixar o React dono da posição de novo custa um
  // `setState` por tick — 934 nós, aceitável — e devolve previsibilidade.
  useEffect(() => {
    if (!atlas) return;
    const xs = atlas.projetos.map((p) => p.x);
    const ys = atlas.projetos.map((p) => p.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const k = Math.min(iw / (maxX - minX || 1), ih / (maxY - minY || 1));
    const offX = (iw - (maxX - minX) * k) / 2;
    const offY = (ih - (maxY - minY) * k) / 2;
    const temaX = (v: number) => M.left + offX + (v - minX) * k;
    const temaY = (v: number) => M.top + offY + (maxY - v) * k;

    const nos: NoPonto[] = atlas.projetos.map((p) => {
      const tx = temaX(p.x);
      const ty = temaY(p.y);
      return { id: p.id, sigla: p.sigla, r: raio(p.n_producoes), temaX: tx, temaY: ty, alvoX: tx, alvoY: ty, x: tx, y: ty };
    });
    nosPorId.current = new Map(nos.map((n) => [n.id, n]));
    setPosicoes(new Map(nos.map((n) => [n.id, { x: n.x!, y: n.y! }])));

    const sim = forceSimulation(nos)
      .force("x", forceX<NoPonto>((d) => d.alvoX).strength(0.2))
      .force("y", forceY<NoPonto>((d) => d.alvoY).strength(0.2))
      .force("collide", forceCollide<NoPonto>((d) => d.r + 1))
      .alpha(0.9)
      .on("tick", () => {
        for (const n of sim.nodes()) clamparNaBorda(n);
        setPosicoes(new Map(sim.nodes().map((n) => [n.id, { x: n.x ?? n.alvoX, y: n.y ?? n.alvoY }])));
      });
    simRef.current = sim;
    setPronto(true);

    return () => {
      sim.stop();
      simRef.current = null;
      setPronto(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [atlas]);

  // Trocar "organizar por" não recria a simulação — só o alvo de cada nó
  // muda. Mas mutar `alvoX`/`alvoY` sozinho não bastava: `forceX`/`forceY`
  // capturam o array de alvos UMA VEZ, na hora que `initialize()` roda (ao
  // anexar o force com `.force("x", …)`) — não reavaliam o accessor
  // `(d) => d.alvoX` a cada tick. Resultado do bug original: o `forceX`
  // continuava com o alvo antigo internamente, então o "teleporte" de
  // `x`/`y` durava só o 1º tick — no seguinte, o force (mirando no alvo
  // velho) puxava tudo de volta pro lugar de antes. Corrigido reanexando
  // `forceX`/`forceY` (instâncias novas) toda vez que o alvo muda — isso
  // força o d3 a reinicializar o array interno com os `alvoX`/`alvoY`
  // atuais. Força 0.2 é fraca de propósito (deixa a colisão dominar o
  // assentamento fino e não estoura quando alguém arrasta um ponto); por
  // isso o `x`/`y` também é teleportado pro alvo — só a força fraca não
  // venceria a distância antes do alpha decair.
  useEffect(() => {
    if (!pronto || !simRef.current) return;
    if (organizarPor === "tema") {
      for (const n of nosPorId.current.values()) {
        n.alvoX = n.temaX;
        n.alvoY = n.temaY;
        n.x = n.temaX;
        n.y = n.temaY;
      }
    } else {
      if (!programas) return;
      const programaPorSigla = new Map(programas.map((p) => [p.sigla, p]));

      if (!centrosPorNivel.current[agruparLocalidade]) {
        if (agruparLocalidade === "instituicao") {
          const grupos = instituicoes.flatMap((i) => {
            const p = programaPorSigla.get(i.sigla);
            return p && p.lat !== null && p.lon !== null
              ? [{ chave: i.sigla, n: i.n, lat: p.lat, lon: p.lon }]
              : [];
          });
          centrosPorNivel.current.instituicao = calcularCentrosGeograficos(grupos);
        } else {
          const grupos = agruparPorGeografia(programas, instituicoes, agruparLocalidade);
          centrosPorNivel.current[agruparLocalidade] = calcularCentrosGeograficos(grupos);
        }
      }
      const centros = centrosPorNivel.current[agruparLocalidade]!;

      // Instituição usa a sigla direto; UF/Região sobem um nível via o
      // programa da sigla — 3 níveis encadeados (§4.2.5 item 6), mesmo
      // desamontoado por força em todos, só muda a chave de agrupamento.
      function chaveDoNo(n: NoPonto): string {
        if (agruparLocalidade === "instituicao") return n.sigla;
        const p = programaPorSigla.get(n.sigla);
        if (!p) return "";
        return agruparLocalidade === "uf" ? p.uf : p.regiao;
      }

      for (const n of nosPorId.current.values()) {
        const c = centros.get(chaveDoNo(n));
        // Clampeado aqui, não só no tick: o centro "desamontoado" de um
        // grupo pequeno pode cair perto da borda, e sem isso o forceX mira
        // num alvo fora do retângulo útil o tempo todo.
        const alvoX = clamp(c?.x ?? W / 2, M.left + n.r, W - M.right - n.r);
        const alvoY = clamp(c?.y ?? H / 2, M.top + n.r, H - M.bottom - n.r);
        n.alvoX = alvoX;
        n.alvoY = alvoY;
        n.x = alvoX;
        n.y = alvoY;
      }
    }
    simRef.current
      .force("x", forceX<NoPonto>((d) => d.alvoX).strength(0.2))
      .force("y", forceY<NoPonto>((d) => d.alvoY).strength(0.2))
      .alpha(1)
      .restart();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizarPor, agruparLocalidade, pronto, programas]);

  if (error) return <div className="error">Erro ao carregar dados: {error}</div>;
  if (!atlasAnppom || !posicoes) return <div className="loading">Carregando…</div>;

  // Enquanto a variante HDBSCAN carrega (troca de método), `atlas` fica null
  // um instante — cai pro ANPPOM em vez de branquear a página inteira;
  // `posicoes`/`nosPorId` também continuam com os dados antigos até o novo
  // efeito (dependente de `[atlas]`) rodar, então os dois ficam consistentes.
  const dados = atlas ?? atlasAnppom;

  const total = dados.projetos.length;
  const clustersOrdenados = [...dados.clusters].sort((a, b) => b.n_projetos - a.n_projetos);
  const temasAtivos = clustersOrdenados.filter((c) => temasSel.has(c.cluster));
  // Tema (nível 1) é sempre público — mudança de diretriz do usuário
  // (2026-08-08): antes o tooltip/painel só mostravam a subárea de 2º
  // nível (só existe no método ANPPOM) e o título, este último escondido
  // pra cluster pequeno (LIMIAR_TITULO_PUBLICO) — o tema (nível 1) nunca
  // aparecia em lugar nenhum por ponto. Ele já é informação agregada e
  // pública por construção (aparece nos checkboxes da sidebar e na tabela
  // de clusters, com contagem, pra todo mundo, mesmo cluster pequeno) —
  // não tem razão pra ficar de fora do tooltip/painel, e sem tamanho de
  // cluster nenhum interferindo: TÍTULO é o que precisa de limiar, tema
  // não.
  const temaPorCluster = new Map(clustersOrdenados.map((c) => [c.cluster, c.tema]));

  /** Combina os três filtros possíveis — instituição, tema, subárea de 2º
   * nível — cada um é um conjunto (múltipla escolha, pedido do usuário);
   * dentro de um filtro os itens somam (OU: UFMG ou UFBA), entre filtros
   * diferentes multiplicam (E: UFMG E Educação Musical). Filtro vazio = não
   * restringe nada. */
  function destacadoDe(p: AtlasProjeto): boolean {
    if (siglasSel.size > 0 && !siglasSel.has(p.sigla)) return false;
    if (temasSel.size > 0 && !temasSel.has(p.cluster)) return false;
    if (subareas2Sel.size > 0 && (!p.subarea || !subareas2Sel.has(p.subarea))) return false;
    return true;
  }
  const algumFiltroAtivo = siglasSel.size > 0 || temasSel.size > 0 || subareas2Sel.size > 0;
  const contagemFiltrada = algumFiltroAtivo ? dados.projetos.filter(destacadoDe).length : total;

  function alternar<T>(set: Set<T>, valor: T): Set<T> {
    const proximo = new Set(set);
    if (proximo.has(valor)) proximo.delete(valor);
    else proximo.add(valor);
    return proximo;
  }

  function alternarSigla(sigla: string) {
    setSiglasSel((atual) => alternar(atual, sigla));
  }

  /** Desmarcar um tema também tira as subáreas de 2º nível que só existiam
   * dentro dele — senão o filtro continua ativo (o ponto some do mapa) sem
   * checkbox visível pra explicar por quê, porque a seção de subárea de 2º
   * nível só lista as dos temas marcados. */
  function alternarTema(cluster: number) {
    setTemasSel((atual) => {
      const proximo = alternar(atual, cluster);
      if (atual.has(cluster) && !proximo.has(cluster)) {
        const c = clustersOrdenados.find((c) => c.cluster === cluster);
        if (c) {
          const removidas = new Set(c.subareas);
          setSubareas2Sel((sub) => {
            const restante = new Set([...sub].filter((s) => !removidas.has(s)));
            return restante.size === sub.size ? sub : restante;
          });
        }
      }
      return proximo;
    });
  }

  function alternarSubarea2(s: string) {
    setSubareas2Sel((atual) => alternar(atual, s));
  }

  function limparFiltros() {
    setSiglasSel(new Set());
    setTemasSel(new Set());
    setSubareas2Sel(new Set());
  }

  /** Trocar de método reinicia tema/subárea de 2º nível — os `cluster` de
   * cada método não têm relação entre si (ids da ANPPOM são a taxonomia
   * oficial; ids do HDBSCAN não têm significado fora da própria rodada), e
   * a subárea de 2º nível nem existe no HDBSCAN. Instituição persiste — é o
   * único filtro com o mesmo significado nos dois métodos. Fecha o painel
   * de produções: o ponto clicado pode nem existir na posição atual do
   * novo método. */
  function mudarMetodo(m: Metodo) {
    setMetodo(m);
    setTemasSel(new Set());
    setSubareas2Sel(new Set());
    setProjetoAberto(null);
  }

  /** Clique no ponto abre o painel de produções vinculadas (em vez de
   * destacar) — destacar já tem os chips acima; expandir produção só dá pra
   * fazer clicando no próprio ponto. Carrega `producoes_projeto.json`
   * (~700KB gzip) só na 1ª vez que alguém expande, nunca no mount da página. */
  function abrirProjeto(p: AtlasProjeto) {
    setProjetoAberto((atual) => (atual?.id === p.id ? null : p));
    if (!producoesPorProjeto && !carregandoProducoes) {
      setCarregandoProducoes(true);
      loadProducoesProjeto()
        .then(setProducoesPorProjeto)
        .catch(() => setProducoesPorProjeto({}))
        .finally(() => setCarregandoProducoes(false));
    }
  }

  /** d3-drag no alvo de interação de cada ponto. Fixa o nó na posição do
   * ponteiro (`fx`/`fy`) e reaquece a simulação (`alphaTarget`) durante o
   * arrasto — como num force-directed graph de verdade, os vizinhos que
   * colidem com o nó arrastado são empurrados pelo `forceCollide` em tempo
   * real, não só o próprio ponto se move. Solta no fim do arrasto: o nó
   * volta a obedecer `forceX`/`forceY` e reequilibra com o resto. */
  function refArrastavel(node: SVGCircleElement | null, id: string) {
    if (!node) return;
    select(node).call(
      d3drag<SVGCircleElement, unknown>()
        .on("start", (ev) => {
          ev.sourceEvent.stopPropagation(); // não deixa o d3-zoom também "ver" esse gesto
          arrastouRef.current = false;
          simRef.current?.alphaTarget(0.35).restart();
          const n = nosPorId.current.get(id);
          if (n) {
            n.fx = n.x;
            n.fy = n.y;
          }
        })
        .on("drag", (ev) => {
          arrastouRef.current = true;
          const n = nosPorId.current.get(id);
          if (n) {
            n.fx = clamp(ev.x, M.left + n.r, W - M.right - n.r);
            n.fy = clamp(ev.y, M.top + n.r, H - M.bottom - n.r);
          }
        })
        .on("end", () => {
          simRef.current?.alphaTarget(0);
          const n = nosPorId.current.get(id);
          if (n) {
            n.fx = null;
            n.fy = null;
          }
        }),
    );
  }

  return (
    <div>
      <h1>O atlas de projetos</h1>
      <p className="page-subtitle">
        934 projetos de pesquisa dos 20 programas, um ponto por projeto. Organize por
        semelhança de assunto (embeddings da descrição, reduzidos a duas dimensões por
        UMAP) ou por onde fica o programa; classificados em 9 subáreas — as 8 oficiais
        da ANPPOM (2025) mais Musicoterapia, destacada de "Demais Subáreas e
        Interfaces" como categoria própria.
      </p>

      <p className="chart-nota">
        {metodo === "anppom" ? (
          <>
            <strong>A classificação por subárea é feita por leitura, não por palavra-chave.</strong>{" "}
            {dados.aviso_rotulo}{" "} Cada projeto foi classificado a partir do título e do
            resumo completo, não por comparação estatística de vocabulário — um ajuste
            anterior baseado só em similaridade de embedding confundia sistematicamente
            Performance Musical com Composição e Sonologia. Ainda é automático, sem
            conferência humana projeto a projeto; alguns casos de fronteira podem estar na
            subárea vizinha.
          </>
        ) : (
          <>
            <strong>Este método não usa a taxonomia da ANPPOM.</strong> {dados.aviso_rotulo}
          </>
        )}{" "}
        Título do projeto só é público para clusters com pelo menos
        {" "}{dados.limiar_titulo_publico} membros (decisão registrada no PLANO). O
        tema (nível 1) é sempre público, mesmo em cluster pequeno — é informação
        agregada, já visível na sidebar e na tabela abaixo; só o título individual
        depende do limiar. Os demais pontos identificam programa, ano, tema e nº de
        produções, sem o título.
      </p>

      <p className="chart-nota">
        <strong>A cor é sempre por instituição</strong> (legenda abaixo do mapa),
        em todo modo — extraída do logo de cada uma, não de uma paleta
        arbitrária. Com 20 instituições, cores vizinhas ainda podem ficar
        parecidas para quem tem daltonismo — por isso a legenda nomeia cada uma e
        clicar isola: nunca confie só na cor.
      </p>

      {/* Método de clusterização (§4.2.5 item 3) — segmented por conta própria,
       * fora da grade da sidebar: troca o gráfico inteiro (posição, clusters,
       * tabela), não é um filtro que restringe pontos como os de baixo. */}
      <div className="chart-controles">
        <div className="segmented" role="group" aria-label="Método de clusterização">
          <button
            type="button"
            className={metodo === "anppom" ? "ativo" : ""}
            aria-pressed={metodo === "anppom"}
            onClick={() => mudarMetodo("anppom")}
          >
            ANPPOM (leitura)
          </button>
          <button
            type="button"
            className={metodo === "hdbscan" ? "ativo" : ""}
            aria-pressed={metodo === "hdbscan"}
            onClick={() => mudarMetodo("hdbscan")}
          >
            HDBSCAN (não supervisionado)
          </button>
          <button
            type="button"
            className={metodo === "topicos" ? "ativo" : ""}
            aria-pressed={metodo === "topicos"}
            onClick={() => mudarMetodo("topicos")}
          >
            Tópicos (LDA)
          </button>
          <button
            type="button"
            className={metodo === "coautoria" ? "ativo" : ""}
            aria-pressed={metodo === "coautoria"}
            onClick={() => mudarMetodo("coautoria")}
          >
            Coautoria (rede)
          </button>
        </div>
        {metodo !== "anppom" && carregandoAlternativo && (
          <span className="chart-nota" style={{ margin: 0 }}>Carregando…</span>
        )}
      </div>

      <div className="atlas-layout">
        {/* Painel lateral de propósito (pedido do usuário, 2026-08-08): a
         * versão anterior — 1ª como parede de chips, depois como <details>
         * de selects de escolha única — não deixava marcar mais de uma
         * instituição/subárea ao mesmo tempo, e ainda competia por espaço
         * horizontal com o gráfico. Checkboxes: cada filtro é um conjunto
         * (múltipla escolha), lateral porque cresce verticalmente com a
         * lista (20 instituições, até ~20 subáreas de 2º nível por tema)
         * sem empurrar o gráfico pra baixo. */}
        <aside className="atlas-sidebar">
          <div className="atlas-sidebar-cab">
            <strong>Filtrar pontos do mapa</strong>
            {algumFiltroAtivo && (
              <span className="chart-nota" style={{ margin: 0 }}>
                {contagemFiltrada} de {total} projetos
              </span>
            )}
            {algumFiltroAtivo && (
              <button type="button" className="chip" onClick={limparFiltros}>
                Limpar filtros
              </button>
            )}
          </div>

          <details open className="atlas-sidebar-secao">
            <summary>
              Instituição{siglasSel.size > 0 ? ` (${siglasSel.size})` : ""}
            </summary>
            <div className="atlas-checkbox-lista">
              {instituicoes.map(({ sigla, n }) => (
                <label key={sigla} className="atlas-checkbox">
                  <input type="checkbox" checked={siglasSel.has(sigla)} onChange={() => alternarSigla(sigla)} />
                  <span className="legenda-marca" style={{ background: corInstituicao(sigla) }} />
                  {sigla} ({n})
                </label>
              ))}
            </div>
          </details>

          <details open className="atlas-sidebar-secao">
            <summary>
              {ROTULO_GRUPO[metodo]}
              {temasSel.size > 0 ? ` (${temasSel.size})` : ""}
            </summary>
            <div className="atlas-checkbox-lista">
              {clustersOrdenados.map((c) => (
                <label key={c.cluster} className="atlas-checkbox">
                  <input type="checkbox" checked={temasSel.has(c.cluster)} onChange={() => alternarTema(c.cluster)} />
                  {c.tema} ({c.n_projetos})
                </label>
              ))}
            </div>
          </details>

          {metodo === "anppom" && (
            <details className="atlas-sidebar-secao">
              <summary>
                Subárea — 2º nível{subareas2Sel.size > 0 ? ` (${subareas2Sel.size})` : ""}
              </summary>
              {temasAtivos.length === 0 ? (
                <p className="chart-nota" style={{ margin: "0.5rem 0" }}>
                  Marque uma subárea de 1º nível pra ver as de 2º nível.
                </p>
              ) : (
                temasAtivos.map((c) => (
                  <div key={c.cluster} className="atlas-sidebar-subgrupo">
                    <div className="atlas-sidebar-subgrupo-titulo">{c.tema}</div>
                    <div className="atlas-checkbox-lista">
                      {c.subareas.map((s) => (
                        <label key={s} className="atlas-checkbox">
                          <input type="checkbox" checked={subareas2Sel.has(s)} onChange={() => alternarSubarea2(s)} />
                          {s}
                        </label>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </details>
          )}
        </aside>

        <div className="atlas-main">
          <div className="chart-controles">
            <div className="segmented" role="group" aria-label="Organizar por">
              <button
                type="button"
                className={organizarPor === "tema" ? "ativo" : ""}
                aria-pressed={organizarPor === "tema"}
                onClick={() => setOrganizarPor("tema")}
              >
                Tema
              </button>
              <button
                type="button"
                className={organizarPor === "localidade" ? "ativo" : ""}
                aria-pressed={organizarPor === "localidade"}
                disabled={dimensao === "3d"}
                title={dimensao === "3d" ? "Localidade em 3D ainda não existe — só o layout temático (ver PLANO)" : undefined}
                onClick={() => setOrganizarPor("localidade")}
              >
                Localidade
              </button>
            </div>
            <div className="segmented" role="group" aria-label="Dimensão">
              <button
                type="button"
                className={dimensao === "2d" ? "ativo" : ""}
                aria-pressed={dimensao === "2d"}
                onClick={() => setDimensao("2d")}
              >
                2D
              </button>
              <button
                type="button"
                className={dimensao === "3d" ? "ativo" : ""}
                aria-pressed={dimensao === "3d"}
                onClick={() => {
                  setDimensao("3d");
                  setOrganizarPor("tema"); // não existe "localidade" em 3D ainda
                }}
              >
                3D
              </button>
            </div>
            <div className="segmented" role="group" aria-label="Tabela abaixo do mapa">
              <button
                type="button"
                className={modo === "subarea" ? "ativo" : ""}
                aria-pressed={modo === "subarea"}
                onClick={() => setModo("subarea")}
              >
                Subáreas
              </button>
              <button
                type="button"
                className={modo === "instituicao" ? "ativo" : ""}
                aria-pressed={modo === "instituicao"}
                onClick={() => setModo("instituicao")}
              >
                Instituições
              </button>
            </div>
          </div>

          {/* Topologia geográfica encadeada (§4.2.5 item 6) — só faz sentido
           * dentro do modo Localidade; Tema não agrupa por geografia. */}
          {organizarPor === "localidade" && (
            <div className="chart-controles">
              <div className="segmented" role="group" aria-label="Agrupar geografia por">
                <button
                  type="button"
                  className={agruparLocalidade === "regiao" ? "ativo" : ""}
                  aria-pressed={agruparLocalidade === "regiao"}
                  onClick={() => setAgruparLocalidade("regiao")}
                >
                  Região
                </button>
                <button
                  type="button"
                  className={agruparLocalidade === "uf" ? "ativo" : ""}
                  aria-pressed={agruparLocalidade === "uf"}
                  onClick={() => setAgruparLocalidade("uf")}
                >
                  UF
                </button>
                <button
                  type="button"
                  className={agruparLocalidade === "instituicao" ? "ativo" : ""}
                  aria-pressed={agruparLocalidade === "instituicao"}
                  onClick={() => setAgruparLocalidade("instituicao")}
                >
                  Instituição
                </button>
              </div>
              <span className="chart-nota" style={{ margin: 0 }}>
                Cada nível reagrupa os mesmos 934 pontos por um centro geográfico mais
                agregado — a cor continua sempre por instituição, só a posição muda.
              </span>
            </div>
          )}

          <p className="chart-nota">
            <strong>Como ler a posição:</strong>{" "}
            {metodo === "coautoria" ? (
              <>
                no modo Tema, X/Y vêm do layout de força do próprio grafo de
                colaboração (<code>spring_layout</code>) — pontos próximos estão perto na REDE
                (compartilham gente com quem compartilha gente), não perto em
                conteúdo. Sem aresta nenhuma, um ponto "sem colaboração registrada"
                não participa desse layout — fica numa margem à parte, não porque o
                tema seja diferente, mas porque não há vizinho de rede.
              </>
            ) : (
              <>
                no modo Tema, X/Y não são grandezas — vêm do UMAP, uma projeção 2D
                do espaço de embeddings dos resumos (modelo multilíngue{" "}
                <code>paraphrase-multilingual-MiniLM-L12-v2</code>). Pontos próximos
                têm vocabulário e temática acadêmica parecidos; a distância exata
                não tem unidade nem significado isolado, só a proximidade relativa
                importa.
              </>
            )}{" "}
            No modo Localidade a posição já não é UMAP nem rede: é a geografia real,
            desamontoada só o suficiente para não sobrepor — em 3 níveis
            encadeados (Região/UF/Instituição, botões acima), do centroide mais
            agregado ao mais fino, sempre a partir da coordenada real da sede de
            cada programa. O tamanho do ponto é sempre nº de produções no
            quadriênio, e a cor é sempre a instituição.
            {dimensao === "3d" && (
              <>
                {" "}
                <strong>Em 3D</strong> a posição vem de uma redução independente da
                2D (mesmo método, terceira dimensão própria) — não é a mesma nuvem
                "com profundidade", é outra projeção. Arraste pra girar, roda do
                mouse dá zoom.
              </>
            )}
          </p>

          {dimensao === "3d" ? (
            <div style={{ position: "relative", overflowX: "auto" }}>
              <Atlas3D
                projetos={dados.projetos}
                destacadoDe={destacadoDe}
                algumFiltroAtivo={algumFiltroAtivo}
                projetoAbertoId={projetoAberto?.id ?? null}
                onSelecionar={abrirProjeto}
                onHover={(p, x, y) => setHover({ p, x, y })}
                onHoverFim={() => setHover(null)}
              />
              {hover && (
                <div className="atlas-tooltip" style={{ left: hover.x + 12, top: hover.y + 12 }}>
                  <strong>{hover.p.sigla}</strong> · {hover.p.ano ?? "sem ano"} · {hover.p.n_producoes} produções
                  <div className="atlas-tooltip-nota">Tema: {temaPorCluster.get(hover.p.cluster) ?? "—"}</div>
                  {hover.p.subarea && <div className="atlas-tooltip-nota">Subárea: {hover.p.subarea}</div>}
                  {hover.p.nome ? (
                    <div>{hover.p.nome}</div>
                  ) : (
                    <div className="atlas-tooltip-nota">título não público (cluster pequeno)</div>
                  )}
                </div>
              )}
            </div>
          ) : (
          <div style={{ position: "relative", overflowX: "auto" }}>
            <svg
              ref={svgRef}
              width={W}
              height={H}
              role="img"
              aria-label="Atlas de projetos, posição por semelhança temática ou por localidade, cor por instituição"
              style={{ touchAction: "none" }}
            >
              <g transform={`translate(${transform.x},${transform.y}) scale(${transform.k})`}>
                {dados.projetos.map((p) => {
                  const apagado = algumFiltroAtivo && !destacadoDe(p);
                  const fill = apagado ? COR_FUNDO : corInstituicao(p.sigla);
                  const pos = posicoes.get(p.id);
                  if (!pos) return null;
                  const aberto = projetoAberto?.id === p.id;
                  return (
                    <g key={p.id}>
                      <circle
                        cx={pos.x}
                        cy={pos.y}
                        r={raio(p.n_producoes)}
                        fill={fill}
                        opacity={apagado ? 0.15 : 0.85}
                        stroke={aberto ? "var(--color-text)" : "none"}
                        strokeWidth={aberto ? 2 : 0}
                      />
                      {!apagado && (
                        <circle
                          ref={(node) => refArrastavel(node, p.id)}
                          cx={pos.x}
                          cy={pos.y}
                          r={RAIO_ALVO}
                          fill="transparent"
                          onMouseEnter={(ev) => setHover({ p, x: ev.clientX, y: ev.clientY })}
                          onMouseMove={(ev) => setHover({ p, x: ev.clientX, y: ev.clientY })}
                          onMouseLeave={() => setHover(null)}
                          onClick={() => {
                            if (arrastouRef.current) {
                              arrastouRef.current = false;
                              return;
                            }
                            abrirProjeto(p);
                          }}
                          style={{ cursor: "grab" }}
                        />
                      )}
                    </g>
                  );
                })}
              </g>
            </svg>
            {hover && (
              <div className="atlas-tooltip" style={{ left: hover.x + 12, top: hover.y + 12 }}>
                <strong>{hover.p.sigla}</strong> · {hover.p.ano ?? "sem ano"} · {hover.p.n_producoes} produções
                <div className="atlas-tooltip-nota">Tema: {temaPorCluster.get(hover.p.cluster) ?? "—"}</div>
                {hover.p.subarea && <div className="atlas-tooltip-nota">Subárea: {hover.p.subarea}</div>}
                {hover.p.nome ? (
                  <div>{hover.p.nome}</div>
                ) : (
                  <div className="atlas-tooltip-nota">título não público (cluster pequeno)</div>
                )}
              </div>
            )}
          </div>
          )}

          <div className="legenda">
            {siglasOrdenadasAlfabeto.map((sigla) => (
              <span key={sigla} className="legenda-item">
                <span className="legenda-marca" style={{ background: corInstituicao(sigla) }} />
                {sigla}
              </span>
            ))}
          </div>

          <p className="chart-nota" style={{ marginTop: 0 }}>
            Tamanho do ponto = nº de produções do projeto no quadriênio. Marque
            instituição, subárea ou subárea de 2º nível no painel ao lado (ou acima,
            em telas estreitas) pra destacar — os três filtros combinam entre si, e
            dentro de cada um dá pra marcar mais de um. Passe o mouse sobre um ponto
            pra ver programa, ano e produções; <strong>clique no próprio ponto</strong>{" "}
            pra expandir as produções vinculadas, com link pra Plataforma Sucupira
            quando disponível.
          </p>

          {projetoAberto && (
            <PainelProjeto
              projeto={projetoAberto}
              tema={temaPorCluster.get(projetoAberto.cluster) ?? "—"}
              producoes={producoesPorProjeto?.[projetoAberto.id] ?? null}
              carregando={carregandoProducoes}
              onFechar={() => setProjetoAberto(null)}
            />
          )}
        </div>
      </div>

      {modo === "subarea" ? (
        <>
          <h2>{ROTULO_GRUPO_TABELA[metodo]}</h2>
          <div className="tabela-rolavel">
            <table className="tabela-dados">
              <thead>
                <tr>
                  <th>{ROTULO_COLUNA_GRUPO[metodo]}</th>
                  <th className="num">Projetos</th>
                  <th>{ROTULO_COLUNA_PALAVRAS[metodo]}</th>
                  <th>Título público</th>
                </tr>
              </thead>
              <tbody>
                {clustersOrdenados.map((c) => (
                  <LinhaCluster key={c.cluster} c={c} />
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <>
          <h2>Instituições</h2>
          <div className="tabela-rolavel">
            <table className="tabela-dados">
              <thead>
                <tr>
                  <th>Instituição</th>
                  <th className="num">Projetos</th>
                </tr>
              </thead>
              <tbody>
                {instituicoes.map(({ sigla, n }) => (
                  <tr key={sigla}>
                    <td className="forte">
                      <span className="legenda-marca" style={{ background: corInstituicao(sigla) }} /> {sigla}
                    </td>
                    <td className="num">{n}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Produções vinculadas ao projeto clicado — expande abaixo do gráfico (não
 * modal, pra não brigar com o `d3-zoom`/`d3-drag` do SVG por baixo). Título e
 * link saem para todo projeto (decisão do usuário, 2026-08-08, §4.2.5), sem o
 * limiar de cluster que protege o título do *projeto* — exceto quando o
 * próprio título da produção contém nome de pessoa real da base: aí
 * `nome`/`link` vêm `null` do build (`producoes_projeto.json`), e o item
 * aparece só com tipo/ano.
 */
function PainelProjeto({
  projeto,
  tema,
  producoes,
  carregando,
  onFechar,
}: {
  projeto: AtlasProjeto;
  tema: string;
  producoes: import("../dados/tipos").ProducaoProjeto[] | null;
  carregando: boolean;
  onFechar: () => void;
}) {
  return (
    <div className="atlas-painel">
      <div className="atlas-painel-cab">
        <div>
          <strong>{projeto.sigla}</strong> · {projeto.ano ?? "sem ano"} ·{" "}
          {projeto.n_producoes} produções
          {/* Tema é sempre público (mudança de diretriz, 2026-08-08) —
           * diferente do título, não depende do tamanho do cluster. */}
          <div className="chart-nota" style={{ margin: 0 }}>Tema: {tema}</div>
          {projeto.subarea && <div className="chart-nota" style={{ margin: 0 }}>{projeto.subarea}</div>}
          {projeto.nome && <div style={{ marginTop: "0.25rem" }}>{projeto.nome}</div>}
        </div>
        <button type="button" className="chip" onClick={onFechar} aria-label="Fechar produções do projeto">
          Fechar ✕
        </button>
      </div>

      {carregando && <p className="chart-nota">Carregando produções…</p>}

      {!carregando && producoes && producoes.length === 0 && (
        <p className="chart-nota">Nenhuma produção com link disponível nesta base para este projeto.</p>
      )}

      {!carregando && producoes && producoes.length > 0 && (
        <ul className="atlas-painel-lista">
          {producoes.map((pr, i) => (
            <li key={i}>
              {pr.nome && pr.link ? (
                <a href={pr.link} target="_blank" rel="noreferrer">
                  {pr.nome}
                </a>
              ) : (
                <span className="chart-nota" style={{ margin: 0 }}>
                  título não divulgável (contém nome de pessoa)
                </span>
              )}
              <div className="atlas-tooltip-nota">
                {ROTULO_CLASSE[pr.classe] ?? pr.classe} · {pr.tipo} — {pr.subtipo}
                {pr.ano ? ` · ${pr.ano}` : ""}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function LinhaCluster({ c }: { c: AtlasCluster }) {
  return (
    <tr>
      <td className="forte">{c.tema}</td>
      <td className="num">{c.n_projetos}</td>
      <td>{c.subareas.join(", ")}</td>
      <td>{c.titulo_publico ? "sim" : "não"}</td>
    </tr>
  );
}
