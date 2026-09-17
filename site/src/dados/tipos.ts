// Public data types — these correspond to the JSON files in public/data/.
// Never contains real id_pessoa, id_projeto, or person names.

export interface Programa {
  sigla: string;
  nome_ies: string;
  uf: string;
  regiao: string;
  municipio: string;
  categoria_administrativa: string;
  ror_id: string | null;
  nota_anterior: number | null;
  nota_2025: number | null;
  variacao: number | null;
  /** Coordenadas da cidade-sede, para o mapa da rede. Ver COORDENADAS_SEDE. */
  lat: number | null;
  lon: number | null;
}

/**
 * Classe de comparabilidade da rubrica (PLANO §4.1a). A regra é versionada em
 * `analise/nucleo.py` e vem pronta no JSON — o front nunca a reimplementa.
 */
export type ClasseProducao = "nucleo" | "difusao" | "tecnica" | "indefinido";

export interface ProducaoAnual {
  sigla: string;
  ano_base: number;
  tipo: string;
  subtipo: string;
  n: number;
  classe: ClasseProducao;
}

/** Volume total × núcleo comparável, por programa (quadriênio 2021–2024). */
export interface ComparabilidadePrograma {
  sigla: string;
  total: number;
  n_nucleo: number;
  n_difusao: number;
  n_tecnica: number;
  n_indefinido: number;
  /** Títulos de rotina administrativa (relatório anual, parecer ad hoc…). */
  administrativos: number;
  n_docentes: number | null;
  pct_nucleo: number | null;
  por_docente: number | null;
  por_docente_nucleo: number | null;
  /** Produções por docente ÷ mediana nacional. 2,0 = registra o dobro. */
  granularidade: number | null;
  granularidade_nucleo: number | null;
}

export interface Comparabilidade {
  periodo: [number, number];
  classes: Array<{ chave: ClasseProducao; rotulo: string; descricao: string }>;
  rubricas: Array<{ tipo: string; subtipo: string; classe: ClasseProducao }>;
  mediana_por_docente: number | null;
  mediana_por_docente_nucleo: number | null;
  programas: ComparabilidadePrograma[];
}

export interface TotalNacional {
  ano_base: number;
  tipo: string;
  n_unique: number;
  n_bruto: number;
}

export interface RedeEdge {
  a: string;
  b: string;
  n: number | null;
  suppressed: boolean;
}

export interface RedeAggregate {
  n_programs: number;
  density: number | null;
  degree_distribution: number[];
}

export interface RedeProgramas {
  edges: RedeEdge[];
  aggregate: RedeAggregate;
}

export interface DistribuicaoNotas {
  musica: Record<string, number>;
  artes: Record<string, number>;
  brasil: Record<string, number>;
}

/**
 * Internacionalização com os campos livres já normalizados (§4.1b.4).
 * As regras estão em `analise/paises.py` e `analise/idiomas.py`; o que não dá
 * para saber sai do denominador, em vez de virar "internacional".
 */
export interface InternacionalizacaoPrograma {
  sigla: string;
  /** % das obras **com país legível** realizadas fora do Brasil. */
  pct_intl_pais: number | null;
  n_com_pais: number;
  pct_intl_idioma: number | null;
  n_com_idioma: number;
  /** Quanto da produção do programa tem o campo preenchido. */
  cobertura_pais: number | null;
  cobertura_idioma: number | null;
  n_total: number;
}

export interface Internacionalizacao {
  periodo: [number, number];
  programas: InternacionalizacaoPrograma[];
  /** País com menos de 5 obras entra numa linha agrupada. */
  paises: Array<{ pais: string; n_obras: number; agrupado?: boolean }>;
  n_paises_distintos: number;
  externos_por_ano: Array<{
    ano_base: number;
    tipo_vinculo: string;
    n_obras: number;
    n_pessoas: number;
  }>;
}

export interface ProgramaIndices {
  sigla: string;
  nome_ies: string;
  uf: string;
  regiao: string;
  n_docentes: number;
  n_producoes: number;
  n_teses: number;
  n_projetos: number;
  prod_per_docente: number | null;
  artigos_per_docente: number | null;
  musica_per_docente: number | null;
  anais_per_docente: number | null;
  pct_intl_pais: number | null;
  pct_intl_idioma: number | null;
  pct_externo: number | null;
  pct_discente: number | null;
  endogenia_coautoria: number | null;
  taxa_orfaos: number | null;
  n_financiados: number;
  nota_anterior: number | null;
  nota_2025: number | null;
  variacao_nota: number | null;
}

/** Perfil agregado de cada programa: quadro de pessoas e raio de colaboração. */
export interface PerfilPrograma {
  sigla: string;
  regiao: string;
  n_docentes: number | null;
  n_discentes: number | null;
  n_egressos: number | null;
  n_posdoc: number | null;
  n_externos: number | null;
  n_membros: number | null;
  producoes: number;
  /**
   * Faixas exclusivas, pelo alcance máximo da obra:
   * única + interna + mesma_uf + regional + interregional = producoes.
   */
  autoria_unica: number;
  interna: number;
  /** Coautoria com outro PPG do mesmo estado. */
  mesma_uf: number;
  /** Coautoria com PPG da mesma região, em outra UF. */
  regional: number;
  interregional: number;
  /** Não exclusivos entre si nem com as faixas acima. */
  com_externo: number;
  docente_discente: number;
  coautoria: number;
  sem_producao: boolean;
}

export interface RedeRegioes {
  a: string;
  b: string;
  n: number | null;
  suppressed: boolean;
}

/** Coautoria docente+discente por programa e tipo de produção (2021–2024). */
export interface CoautoriaDocDisc {
  sigla: string;
  tipo: string;
  subtipo: string;
  n_conjunta: number;
  n_coautoria: number;
  n_total: number;
}

/**
 * Rede medida em OBRAS, por tipo de produção. Medida distinta de
 * `RedeProgramas` (pessoas em comum) — ver build_public.build_rede_obras_por_tipo.
 */
export interface RedeObrasPorTipo {
  categorias: string[];
  arestas: Array<{
    a: string;
    b: string;
    categoria: string;
    n: number | null;
    suppressed: boolean;
  }>;
  /** Coautorias que não saem do programa (o laço roxo do cartograma). */
  internas: Array<{ sigla: string; categoria: string; n: number | null; suppressed: boolean }>;
  volume: Array<{ sigla: string; categoria: string; n: number }>;
}

/** Cobertura da base, falhas e lacunas — o apêndice de dados (§4.1.11). */
export interface Cobertura {
  contagens: Array<{ tabela: string; rotulo: string; n: number }>;
  anos: { primeiro: number; ultimo: number };
  falhas: Array<{
    arquivo: string;
    etapa: string;
    n: number;
    por_motivo: Array<{ motivo: string; n: number }>;
  }>;
  campos: Array<{ campo: string; n: number; pct: number | null }>;
  obras_em_mais_de_um_programa: number;
  /** Programas de Música avaliados em 2025 e ausentes da base (profissionais). */
  fora_da_base: Array<{
    codigo_programa: string;
    nome_programa: string;
    sigla_ies: string;
    nivel: string;
    nota_final: string;
  }>;
  quadrienio: {
    periodo: [number, number];
    por_classe: Array<{ chave: ClasseProducao; rotulo: string; n: number }>;
    administrativos: number;
  };
}

/**
 * Concentração da produção entre os docentes de cada programa (§4.1b.1).
 *
 * `lorenz` vem com **pelo menos 5 pessoas por ponto** e é null para programas
 * pequenos demais: com um ponto por pessoa, o último degrau da curva seria o
 * maior produtor. Máximo e decil superior não existem neste JSON de propósito.
 */
export interface ConcentracaoPrograma {
  sigla: string;
  n_docentes: number | null;
  producoes: number;
  gini: number | null;
  lorenz: Array<{ pop: number; producao: number; n_pessoas: number }> | null;
  /** 1/HHI sobre as rubricas: "em quantos tipos o programa publica, de fato". */
  tipos_efetivos: number | null;
  n_tipos: number;
  mediana: number | null;
  p25: number | null;
  p75: number | null;
}

export interface Concentracao {
  periodo: [number, number];
  limiar_supressao: number;
  programas: ConcentracaoPrograma[];
}

/** Esfera da agência de fomento (§4.1b.3). Ver `analise/agencias.py`. */
export type EsferaFomento =
  | "federal"
  | "estadual"
  | "propria_ies"
  | "internacional"
  | "outra";

export interface ProjetosPrograma {
  sigla: string;
  n_projetos: number;
  n_financiados: number;
  n_orfaos: number;
  producoes_de_projetos: number;
  producoes_quadrienio: number;
  pct_financiados: number | null;
  pct_orfaos: number | null;
  /** Produções do quadriênio que apontam para um projeto — preenchimento. */
  pct_producao_com_projeto: number | null;
  esfera_federal: number | null;
  esfera_estadual: number | null;
  esfera_propria_ies: number | null;
  esfera_internacional: number | null;
  esfera_outra: number | null;
}

/**
 * Endogenia por projeto e endogamia acadêmica, duas das quatro medidas do
 * "quanto cada programa é fechado" (§4.1b.5 / §4.3 Cap. 6). A terceira
 * (por coautoria) vem em `ProgramaIndices.endogenia_coautoria`; a quarta
 * (temática) depende do clustering da Fase 3 e não existe ainda.
 *
 * Os numeradores contam pessoas — quando `null`, foram suprimidos (n < 5) e o
 * percentual correspondente também é `null`, para não reconstruir o valor
 * suprimido a partir do percentual e do total.
 */
export interface EndogeniaPrograma {
  sigla: string;
  membros_projeto_exclusivos: number | null;
  membros_projeto_total: number;
  pct_endogenia_projeto: number | null;
  docentes_formados_no_programa: number | null;
  docentes_total: number;
  pct_endogamia_academica: number | null;
}

/**
 * Atlas de projetos por assunto (§4.2.4) — cada projeto classificado numa de
 * 9 subáreas: as 8 oficiais da ANPPOM (2025) mais "Musicoterapia", destacada
 * de "Demais Subáreas e Interfaces" como categoria própria (decisão
 * editorial deste site, não da ANPPOM). Classificação por leitura de
 * título+resumo (humana/LLM, `analise/classificacao_projetos.json`) — não
 * por similaridade de embedding, que confundia sistematicamente Performance
 * Musical com Composição e Sonologia (ver git blame/PLANO §4.2.1). `tema` é
 * a subárea; `palavras_chave` é TF-IDF sobre a descrição dos projetos da
 * subárea, pista adicional — a classificação em si é automática, SEM
 * conferência humana projeto a projeto (ver `aviso_rotulo`, o front precisa
 * repetir esse aviso).
 *
 * Todo projeto cai em alguma subárea — não existe "ruído" aqui (diferente do
 * clustering não supervisionado que este substituiu).
 */
export interface AtlasCluster {
  cluster: number;
  tema: string;
  n_projetos: number;
  subareas: string[];
  titulo_publico: boolean;
}

export interface AtlasProjeto {
  /** Id substituto persistido (`derivados/id_map_projetos.json`) — nunca o id real. */
  id: string;
  sigla: string;
  ano: number | null;
  cluster: number;
  /** Ausente (null) na variante HDBSCAN (§4.2.5 item 3) — não há subárea de
   * 2º nível fora da taxonomia ANPPOM. */
  subarea: string | null;
  x: number;
  y: number;
  /** Redução UMAP (ou spring_layout, na variante coautoria) independente
   * da 2D — não é "x/y com um z a mais": §4.2.5 item 4. */
  x3d: number;
  y3d: number;
  z3d: number;
  n_producoes: number;
  /** Só preenchido quando o cluster tem >= limiar_titulo_publico projetos. */
  nome: string | null;
}

export interface Atlas {
  limiar_titulo_publico: number;
  aviso_rotulo: string;
  clusters: AtlasCluster[];
  projetos: AtlasProjeto[];
}

/**
 * Produções vinculadas a um projeto do atlas (§4.2.5, "melhorias futuras").
 * Carregado à parte, sob demanda (arquivo grande) — ver `loadProducoesProjeto`.
 * Ao contrário do resto do site, título e link de produção não passam pelo
 * limiar de cluster do projeto (decisão do usuário, 2026-08-08): produção já
 * é registro público em outro lugar. Exceção: quando o próprio título da
 * produção contém o nome de uma pessoa real da base, `nome`/`link` vêm
 * `null` — o item continua na lista (pra contagem bater com `n_producoes`),
 * só o texto que vazaria nome some.
 */
export interface ProducaoProjeto {
  nome: string | null;
  tipo: string;
  subtipo: string;
  ano: number | null;
  link: string | null;
  /** Classificação núcleo/difusão/técnica/indefinido — ver `analise/nucleo.py`. */
  classe: string;
}

export type ProducoesPorProjeto = Record<string, ProducaoProjeto[]>;

export interface Projetos {
  periodo: [number, number];
  esferas: Array<{ chave: EsferaFomento; rotulo: string }>;
  programas: ProjetosPrograma[];
  /** Nacional. Toda agência identificada aparece — nunca agrupada num "outras"
   * anônimo. Agência com menos de 5 projetos mantém o nome; só a contagem
   * some (`n_projetos: null`), mesmo padrão de supressão do resto do site. */
  agencias: Array<{
    agencia: string;
    esfera: EsferaFomento;
    n_projetos: number | null;
  }>;
  distribuicao_producoes: Array<{ faixa: string; n_projetos: number }>;
  naturezas: Array<{ natureza: string; n: number }>;
  n_projetos: number;
  n_financiados: number;
}
