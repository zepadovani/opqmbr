// Categorias de produção e a paleta que as identifica.
//
// Regra do §3.3 do PLANO: a paleta categórica tem 8 slots em ordem fixa. A nona
// categoria NÃO ganha cor nova — ela vira OUTROS. Cor segue a entidade, nunca a
// posição no ranking de um filtro: por isso o mapa categoria→cor é calculado uma
// vez sobre o total nacional e reusado em todos os gráficos da página.

import type { ProducaoAnual } from "./tipos";

export const OUTROS = "OUTROS";

/**
 * Recorte de volume (PLANO §4.1a). "Total registrado" é o que a Plataforma tem;
 * "núcleo comparável" é o subconjunto que todos os programas registram de forma
 * parecida — artigo, livro, anais, partitura, tradução e produção
 * artístico-cultural. Os dois convivem: a distância entre eles é a medida de
 * política de preenchimento, e por isso o núcleo nunca substitui o total.
 */
export type Escopo = "total" | "nucleo";

export function filtrarPorEscopo(data: ProducaoAnual[], escopo: Escopo): ProducaoAnual[] {
  return escopo === "nucleo" ? data.filter((r) => r.classe === "nucleo") : data;
}

export const COR_SERIE = [
  "var(--serie-1)",
  "var(--serie-2)",
  "var(--serie-3)",
  "var(--serie-4)",
  "var(--serie-5)",
  "var(--serie-6)",
  "var(--serie-7)",
  "var(--serie-8)",
];

export const COR_OUTROS = "var(--serie-outros)";

/** Rampa sequencial (magnitude), clara→escura. */
export const RAMPA_SEQ = [
  "var(--seq-100)",
  "var(--seq-200)",
  "var(--seq-300)",
  "var(--seq-400)",
  "var(--seq-500)",
  "var(--seq-600)",
  "var(--seq-700)",
];

export function corSequencial(fracao: number): string {
  if (!Number.isFinite(fracao) || fracao <= 0) return "transparent";
  const i = Math.min(RAMPA_SEQ.length - 1, Math.floor(fracao * RAMPA_SEQ.length));
  return RAMPA_SEQ[i];
}

/** Texto legível sobre a célula: a rampa escurece, então inverte no fim. */
export function tintaSobreSequencial(fracao: number): string {
  return fracao >= 0.55 ? "#fff" : "var(--color-text)";
}

export function anosPresentes(data: ProducaoAnual[]): number[] {
  return Array.from(new Set(data.map((r) => r.ano_base))).sort((a, b) => a - b);
}

/**
 * O mínimo para categorizar uma linha: qualquer contagem por rubrica serve, venha
 * de `producao_por_ano` ou de uma tabela derivada (coautoria docente+discente).
 */
export type LinhaCategorizavel = Pick<ProducaoAnual, "tipo" | "subtipo" | "n">;

/**
 * As 8 categorias de maior volume nacional, mais OUTROS. Derivar do dado (e não
 * de uma lista fixa) evita que uma categoria nova apareça sem cor; agrupar o
 * resto evita inventar um 9º matiz.
 */
export function categoriasPrincipais(data: LinhaCategorizavel[], limite = 8): string[] {
  const total = new Map<string, number>();
  for (const r of data) {
    const k = r.subtipo || r.tipo;
    total.set(k, (total.get(k) ?? 0) + r.n);
  }
  const ordenadas = [...total.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
  const principais = ordenadas.slice(0, limite);
  return ordenadas.length > limite ? [...principais, OUTROS] : principais;
}

export function corDaCategoria(categoria: string, categorias: string[]): string {
  if (categoria === OUTROS) return COR_OUTROS;
  const i = categorias.indexOf(categoria);
  return i >= 0 && i < COR_SERIE.length ? COR_SERIE[i] : COR_OUTROS;
}

export function categoriaDaLinha(r: LinhaCategorizavel, categorias: string[]): string {
  const k = r.subtipo || r.tipo;
  return categorias.includes(k) ? k : OUTROS;
}

/** matriz[sigla][categoria] = contagem no período inteiro. */
export function porProgramaECategoria(
  data: ProducaoAnual[],
  categorias: string[],
): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>();
  for (const r of data) {
    const cat = categoriaDaLinha(r, categorias);
    if (!out.has(r.sigla)) out.set(r.sigla, new Map());
    const linha = out.get(r.sigla)!;
    linha.set(cat, (linha.get(cat) ?? 0) + r.n);
  }
  return out;
}

/** matriz[sigla][ano][categoria] = contagem. */
export function porProgramaAnoCategoria(
  data: ProducaoAnual[],
  categorias: string[],
): Map<string, Map<number, Map<string, number>>> {
  const out = new Map<string, Map<number, Map<string, number>>>();
  for (const r of data) {
    const cat = categoriaDaLinha(r, categorias);
    if (!out.has(r.sigla)) out.set(r.sigla, new Map());
    const porAno = out.get(r.sigla)!;
    if (!porAno.has(r.ano_base)) porAno.set(r.ano_base, new Map());
    const linha = porAno.get(r.ano_base)!;
    linha.set(cat, (linha.get(cat) ?? 0) + r.n);
  }
  return out;
}

function perfil(linha: Map<string, number>, categorias: string[]): number[] {
  const total = [...linha.values()].reduce((s, v) => s + v, 0) || 1;
  return categorias.map((c) => (linha.get(c) ?? 0) / total);
}

function distanciaCosseno(a: number[], b: number[]): number {
  let ab = 0, aa = 0, bb = 0;
  for (let i = 0; i < a.length; i++) {
    ab += a[i] * b[i];
    aa += a[i] * a[i];
    bb += b[i] * b[i];
  }
  const den = Math.sqrt(aa) * Math.sqrt(bb);
  return den === 0 ? 1 : 1 - ab / den;
}

/**
 * Ordena os programas encadeando vizinhos mais próximos pelo perfil de produção.
 * Ordem alfabética esconde o agrupamento — e o agrupamento é o achado: é o que
 * mostra que existem "famílias" de regime, não 20 casos isolados. Com n=20 uma
 * cadeia gulosa basta; clusterização hierárquica seria precisão falsa aqui.
 */
export function ordenarPorSimilaridade(
  matriz: Map<string, Map<string, number>>,
  categorias: string[],
): string[] {
  const siglas = [...matriz.keys()];
  if (siglas.length <= 2) return siglas.sort();

  const perfis = new Map(siglas.map((s) => [s, perfil(matriz.get(s)!, categorias)]));

  // Começa pelo programa mais atípico — assim a cadeia atravessa o espaço em vez
  // de orbitar o centro.
  const media = categorias.map((_, i) =>
    siglas.reduce((s, sig) => s + perfis.get(sig)![i], 0) / siglas.length,
  );
  let atual = siglas.reduce((pior, s) =>
    distanciaCosseno(perfis.get(s)!, media) > distanciaCosseno(perfis.get(pior)!, media) ? s : pior,
  );

  const ordem = [atual];
  const restantes = new Set(siglas.filter((s) => s !== atual));
  while (restantes.size > 0) {
    let proximo = "";
    let melhor = Infinity;
    for (const s of restantes) {
      const d = distanciaCosseno(perfis.get(atual)!, perfis.get(s)!);
      if (d < melhor) {
        melhor = d;
        proximo = s;
      }
    }
    ordem.push(proximo);
    restantes.delete(proximo);
    atual = proximo;
  }
  return ordem;
}
