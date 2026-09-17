import type {
  Programa,
  ProducaoAnual,
  TotalNacional,
  RedeProgramas,
  DistribuicaoNotas,
  Internacionalizacao,
  ProgramaIndices,
  PerfilPrograma,
  RedeRegioes,
  CoautoriaDocDisc,
  RedeObrasPorTipo,
  Comparabilidade,
  Cobertura,
  Concentracao,
  Projetos,
  EndogeniaPrograma,
  Atlas,
  ProducoesPorProjeto,
} from "./tipos";

const BASE = import.meta.env.BASE_URL + "data/";

async function load<T>(name: string): Promise<T> {
  const res = await fetch(`${BASE}${name}.json`);
  if (!res.ok) throw new Error(`Failed to load ${name}.json: ${res.status}`);
  return res.json() as Promise<T>;
}

export const loadProgramas = () => load<Programa[]>("programas");
export const loadProducaoAnual = () => load<ProducaoAnual[]>("producao_por_ano");
export const loadTotaisNacionais = () => load<TotalNacional[]>("totais_nacionais");
export const loadRedeProgramas = () => load<RedeProgramas>("rede_programas");
export const loadDistribuicaoNotas = () => load<DistribuicaoNotas>("distribuicao_notas");
export const loadInternacionalizacao = () => load<Internacionalizacao>("internacionalizacao");
export const loadIndices = () => load<ProgramaIndices[]>("indices");
export const loadPerfilProgramas = () => load<PerfilPrograma[]>("perfil_programas");
export const loadRedeRegioes = () => load<RedeRegioes[]>("rede_regioes");
/** Mesma forma de RedeRegioes, um nível abaixo. */
export const loadRedeUfs = () => load<RedeRegioes[]>("rede_ufs");
export const loadCoautoriaDocDisc = () =>
  load<CoautoriaDocDisc[]>("coautoria_docente_discente");
export const loadRedeObrasPorTipo = () => load<RedeObrasPorTipo>("rede_obras_por_tipo");
export const loadComparabilidade = () => load<Comparabilidade>("comparabilidade");
export const loadCobertura = () => load<Cobertura>("cobertura");
export const loadConcentracao = () => load<Concentracao>("concentracao");
export const loadProjetos = () => load<Projetos>("projetos");
export const loadEndogenia = () => load<EndogeniaPrograma[]>("endogenia");
export const loadAtlas = () => load<Atlas>("atlas");
/** Variante HDBSCAN não supervisionada (§4.2.5 item 3) — carregar só quando o
 * usuário trocar o método de clusterização, nunca no mount do Atlas. */
export const loadAtlasHdbscan = () => load<Atlas>("atlas_hdbscan");
export const loadAtlasTopicos = () => load<Atlas>("atlas_topicos");
export const loadAtlasCoautoria = () => load<Atlas>("atlas_coautoria");
/** ~700KB gzipado — carregar só quando o usuário expandir o 1º projeto, nunca no mount do Atlas. */
export const loadProducoesProjeto = () => load<ProducoesPorProjeto>("producoes_projeto");
