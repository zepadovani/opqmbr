import { useEffect, useMemo, useState } from "react";
import LogoPPG, { RotuloPPG } from "../componentes/LogoPPG";
import {
  loadComparabilidade,
  loadConcentracao,
  loadPerfilProgramas,
  loadProducaoAnual,
} from "../dados/loaders";
import {
  OUTROS,
  anosPresentes,
  categoriaDaLinha,
  categoriasPrincipais,
  corDaCategoria,
  corSequencial,
  filtrarPorEscopo,
  ordenarPorSimilaridade,
  porProgramaAnoCategoria,
  porProgramaECategoria,
  tintaSobreSequencial,
} from "../dados/series";
import type { Escopo } from "../dados/series";
import type {
  ClasseProducao,
  Comparabilidade,
  Concentracao,
  ConcentracaoPrograma,
  PerfilPrograma,
  ProducaoAnual,
} from "../dados/tipos";

type Modo = "composicao" | "volume";

export default function RegimesProducao() {
  const [data, setData] = useState<ProducaoAnual[] | null>(null);
  const [perfil, setPerfil] = useState<PerfilPrograma[] | null>(null);
  const [comparabilidade, setComparabilidade] = useState<Comparabilidade | null>(null);
  const [concentracao, setConcentracao] = useState<Concentracao | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [modo, setModo] = useState<Modo>("composicao");
  const [escopo, setEscopo] = useState<Escopo>("total");

  useEffect(() => {
    Promise.all([
      loadProducaoAnual(),
      loadPerfilProgramas(),
      loadComparabilidade(),
      loadConcentracao(),
    ])
      .then(([d, p, c, k]) => {
        setData(d);
        setPerfil(p);
        setComparabilidade(c);
        setConcentracao(k);
      })
      .catch((e: unknown) => setError(String(e)));
  }, []);

  // A paleta sai do total nacional e nunca do recorte em uso: cor segue a
  // entidade, então alternar entre "total registrado" e "núcleo comparável" não
  // pode repintar categoria nenhuma (§3.3).
  const paleta = useMemo(() => (data ? categoriasPrincipais(data) : []), [data]);

  const derivado = useMemo(() => {
    if (!data) return null;
    const dataEscopo = filtrarPorEscopo(data, escopo);
    const anos = anosPresentes(dataEscopo);
    // Categorias visíveis = as da paleta que têm volume neste recorte. No núcleo
    // as rubricas fora do top-8 nacional (partitura, tradução, artes cênicas e
    // visuais) continuam somadas em OUTROS, em vez de ganharem matiz novo.
    const volume = new Map<string, number>();
    for (const r of dataEscopo) {
      const c = categoriaDaLinha(r, paleta);
      volume.set(c, (volume.get(c) ?? 0) + r.n);
    }
    const categorias = paleta.filter((c) => (volume.get(c) ?? 0) > 0);
    // O heatmap normalizado divide por contagens de pessoas do quadriênio
    // 2021–2024; somar 2020 no numerador inflaria a taxa em silêncio. Todo o
    // painel de perfil usa o mesmo recorte, por isso.
    const doQuadrienio = dataEscopo.filter((r) => r.ano_base >= 2021 && r.ano_base <= 2024);
    const porPrograma = porProgramaECategoria(doQuadrienio, categorias);
    const ordem = ordenarPorSimilaridade(porPrograma, categorias);
    const serie = porProgramaAnoCategoria(dataEscopo, categorias);
    return { anos, categorias, porPrograma, ordem, serie, dataEscopo };
  }, [data, escopo, paleta]);

  if (error) return <div className="error">Erro ao carregar dados: {error}</div>;
  if (!data || !derivado || !perfil || !comparabilidade || !concentracao)
    return <div className="loading">Carregando…</div>;

  const { anos, categorias, porPrograma, ordem, serie, dataEscopo } = derivado;
  const periodo = `${anos[0]}–${anos[anos.length - 1]}`;

  return (
    <div>
      <h1>Regimes de produção</h1>
      <p className="page-subtitle">
        O que cada programa produz, e como isso mudou entre {periodo}. "Regime" aqui é a
        <em> composição</em> da produção — a mistura de tipos —, não o volume: um programa
        pequeno de artigos e um grande de recitais têm regimes diferentes mesmo com
        contagens parecidas.
      </p>

      <h2>Antes de comparar volume</h2>
      <p className="chart-nota">
        O total registrado <strong>não mede a mesma coisa</strong> em todo programa. A
        diferença nasce da política de preenchimento — quanto cada equipe registra sob
        relatório de pesquisa, parecer ad hoc, serviço técnico, curso de curta duração,
        organização de evento — não do volume real de trabalho. Dois programas com corpo
        docente do mesmo tamanho podem divergir várias vezes no total registrado por essa
        razão, a ponto de inverter a ordem de quem mais publica artigo em periódico. O
        "núcleo comparável" abaixo é o subconjunto que todos registram de forma parecida —
        ele não substitui o total, fica ao lado dele, e a distância entre os dois é a
        medida do fenômeno.
      </p>
      <PainelComparabilidade dados={comparabilidade} />

      <h2>Recorte de volume</h2>
      <div className="chart-controles">
        <div className="segmented" role="group" aria-label="Recorte de volume">
          <button
            type="button"
            className={escopo === "total" ? "ativo" : ""}
            onClick={() => setEscopo("total")}
            aria-pressed={escopo === "total"}
          >
            Total registrado
          </button>
          <button
            type="button"
            className={escopo === "nucleo" ? "ativo" : ""}
            onClick={() => setEscopo("nucleo")}
            aria-pressed={escopo === "nucleo"}
          >
            Núcleo comparável
          </button>
        </div>
        <span className="chart-nota" style={{ margin: 0 }}>
          {escopo === "total"
            ? "Tudo que a Plataforma registra como produção, inclusive atividade e serviço."
            : "Só artigo, livro, anais, partitura, tradução e produção artístico-cultural."}{" "}
          Vale para <strong>todos</strong> os gráficos abaixo.
        </span>
      </div>

      <h2>Perfil de cada programa</h2>
      <p className="chart-nota">
        Quadriênio avaliado, <strong>2021–2024</strong> — o mesmo recorte das contagens de
        pessoas, para as visões normalizadas serem comparáveis. As linhas estão ordenadas
        por semelhança de perfil, não por ordem alfabética: programas vizinhos produzem
        coisas parecidas.
      </p>
      <HeatmapPerfil
        ordem={ordem}
        categorias={categorias}
        porPrograma={porPrograma}
        perfil={perfil}
      />

      <h2>Trajetória, programa a programa</h2>
      <div className="chart-controles">
        <div className="segmented" role="group" aria-label="Modo de leitura">
          <button
            type="button"
            className={modo === "composicao" ? "ativo" : ""}
            onClick={() => setModo("composicao")}
            aria-pressed={modo === "composicao"}
          >
            Composição (100%)
          </button>
          <button
            type="button"
            className={modo === "volume" ? "ativo" : ""}
            onClick={() => setModo("volume")}
            aria-pressed={modo === "volume"}
          >
            Volume (escala comum)
          </button>
        </div>
        <span className="chart-nota" style={{ margin: 0 }}>
          {modo === "composicao"
            ? "Compara o regime independentemente do tamanho do programa."
            : "Mesma escala nos 20 — mostra as ordens de grandeza que o modo 100% esconde."}
        </span>
      </div>
      <SmallMultiples
        ordem={ordem}
        anos={anos}
        categorias={categorias}
        paleta={paleta}
        serie={serie}
        modo={modo}
      />

      <h2>Comparar programas lado a lado</h2>
      <Comparador
        ordem={[...ordem].sort()}
        anos={anos}
        categorias={categorias}
        paleta={paleta}
        serie={serie}
      />

      <h2>Quem produz, dentro de cada programa</h2>
      <p className="chart-nota">
        Até aqui cada programa foi um bloco. Esta seção olha para dentro dele: a
        produção está espalhada pelo corpo docente ou concentrada em poucas pessoas? A
        pergunta é sobre a <strong>forma da distribuição</strong>, nunca sobre quem —
        nenhum indivíduo aparece aqui, nem anônimo.
      </p>
      <Concentracao dados={concentracao} />

      <h2>Leitura global</h2>
      <p className="chart-nota">
        Somando os 20 programas. A queda de 2022 e a recuperação seguinte são de{" "}
        <strong>registro</strong> tanto quanto de atividade: o que a Plataforma mostra é o
        que foi preenchido.
      </p>
      <TotalNacional anos={anos} categorias={categorias} paleta={paleta} data={dataEscopo} />

      <Legenda categorias={categorias} paleta={paleta} />
      {escopo === "nucleo" && (
        <p className="chart-nota">
          No núcleo, "Outros tipos" reúne partitura musical, tradução, artes cênicas e
          artes visuais — rubricas do núcleo que ficam fora das oito de maior volume
          nacional. Elas não ganham cor nova para a paleta não mudar de significado entre
          os dois recortes.
        </p>
      )}

      <h2>Totais por ano</h2>
      <TabelaTotais anos={anos} categorias={categorias} paleta={paleta} data={dataEscopo} />

      <p className="chart-nota" style={{ marginTop: "1.5rem" }}>
        Produções contabilizadas por programa (não deduplicadas): os ~280 trabalhos
        reportados por mais de um programa são contados em cada um. A base cobre{" "}
        {periodo} — <strong>não há produção com ano-base 2025</strong> na Plataforma até a
        data da coleta, então o ano não aparece nas séries em vez de aparecer como zero.
      </p>
    </div>
  );
}

/* -------------------------------------------------- comparabilidade (§4.1a) */

/* As quatro classes numa rampa sequencial, e não em quatro matizes: a distância
   até o núcleo é uma dimensão só. Matiz categórico sugeriria quatro coisas
   independentes, que não é o caso. */
const COR_CLASSE: Record<ClasseProducao, string> = {
  nucleo: "var(--seq-600)",
  difusao: "var(--seq-400)",
  tecnica: "var(--seq-200)",
  indefinido: "var(--color-suppressed)",
};

type OrdemComparabilidade = "total" | "pct_nucleo" | "granularidade" | "administrativos";

const ORDENS_COMPARABILIDADE: Array<{ chave: OrdemComparabilidade; rotulo: string }> = [
  { chave: "pct_nucleo", rotulo: "% no núcleo comparável" },
  { chave: "granularidade", rotulo: "índice de granularidade" },
  { chave: "total", rotulo: "total registrado" },
  { chave: "administrativos", rotulo: "títulos administrativos" },
];

function PainelComparabilidade({ dados }: { dados: Comparabilidade }) {
  const [ordem, setOrdem] = useState<OrdemComparabilidade>("pct_nucleo");
  const [desc, setDesc] = useState(true);
  const [proporcional, setProporcional] = useState(false);

  const comProducao = dados.programas.filter((p) => p.total > 0);
  const maxTotal = Math.max(...comProducao.map((p) => p.total));

  const linhas = [...comProducao].sort((a, b) => {
    const valor = (p: (typeof comProducao)[number]) =>
      ordem === "total"
        ? p.total
        : ordem === "pct_nucleo"
          ? (p.pct_nucleo ?? 0)
          : ordem === "granularidade"
            ? (p.granularidade ?? 0)
            : p.administrativos / p.total;
    const d = valor(b) - valor(a);
    return desc ? d : -d;
  });

  const semProducao = dados.programas.filter((p) => p.total === 0).map((p) => p.sigla);

  return (
    <div>
      <div className="chart-controles">
        <label>
          Ordenar por{" "}
          <select
            value={ordem}
            onChange={(e) => setOrdem(e.target.value as OrdemComparabilidade)}
          >
            {ORDENS_COMPARABILIDADE.map((o) => (
              <option key={o.chave} value={o.chave}>
                {o.rotulo}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="chip ativo"
          onClick={() => setDesc((d) => !d)}
          aria-label={desc ? "Ordem decrescente; clique para crescente" : "Ordem crescente; clique para decrescente"}
        >
          {desc ? "▼ maior primeiro" : "▲ menor primeiro"}
        </button>
        <button
          type="button"
          className={proporcional ? "chip ativo" : "chip"}
          onClick={() => setProporcional((v) => !v)}
          aria-pressed={proporcional}
        >
          {proporcional ? "barra ∝ volume" : "barra em 100%"}
        </button>
      </div>

      <div className="barras-cabecalho">
        <span className="barra-rotulo" />
        <span className="barra-trilho" />
        <span className="barra-valor">
          <span className="forte">total</span>
          <span>% núcleo</span>
          <span>granul.</span>
        </span>
      </div>

      <div className="barras-empilhadas">
        {linhas.map((p) => (
          <div key={p.sigla} className="barra-linha">
            <span className="barra-rotulo">
              <LogoPPG sigla={p.sigla} tamanho="sm" />
              {p.sigla}
            </span>
            <span className="barra-trilho">
              <span
                className="barra-grupo"
                style={{ width: proporcional ? `${(p.total / maxTotal) * 100}%` : "100%" }}
              >
                {dados.classes.map((c) => {
                  const n = p[`n_${c.chave}`];
                  if (n <= 0) return null;
                  return (
                    <span
                      key={c.chave}
                      className="barra-segmento"
                      style={{
                        width: `${(n / p.total) * 100}%`,
                        background: COR_CLASSE[c.chave],
                      }}
                      title={`${p.sigla} · ${c.rotulo}: ${n} (${((n / p.total) * 100).toFixed(1)}%)`}
                    />
                  );
                })}
              </span>
            </span>
            <span className="barra-valor">
              <span className="forte">{p.total.toLocaleString("pt-BR")}</span>
              <span>{p.pct_nucleo === null ? "—" : `${p.pct_nucleo.toFixed(0)}%`}</span>
              <span
                title={
                  p.granularidade === null
                    ? "sem divisor publicável"
                    : `${p.por_docente} produções por docente, contra a mediana nacional de ${dados.mediana_por_docente}`.replace(/\./g, ",")
                }
              >
                {p.granularidade === null ? "—" : `${p.granularidade.toFixed(1)}×`}
              </span>
            </span>
          </div>
        ))}
      </div>

      <div className="legenda">
        {dados.classes.map((c) => (
          <span key={c.chave} className="legenda-item" title={c.descricao}>
            <span className="legenda-marca" style={{ background: COR_CLASSE[c.chave] }} />
            {c.rotulo}
          </span>
        ))}
      </div>

      <p className="chart-nota">
        <strong>Índice de granularidade</strong> = produções por docente ÷ mediana nacional
        ({dados.mediana_por_docente?.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}{" "}
        no quadriênio). 2,0× significa "registra o dobro por
        docente", <em>não</em> "produz o dobro" — é a distância até a prática mediana de
        preenchimento, e serve como aviso ao lado de qualquer barra de tamanho.
        {semProducao.length > 0 &&
          ` Sem produção no quadriênio, e por isso fora do gráfico: ${semProducao.join(", ")}.`}
      </p>
      <p className="chart-nota">
        A classificação de cada rubrica é uma regra fixa e versionada
        (<code>analise/nucleo.py</code>), aplicada no build — não é escolha de tela.
        Rubrica que a Plataforma não identifica ("OUTRO") fica em "rubrica indefinida",
        fora do núcleo: não por julgamento de valor, e sim porque não se sabe o que é.
      </p>
      <details className="tabela-detalhe">
        <summary>Títulos de rotina administrativa registrados como produção</summary>
        <p className="chart-nota">
          Relatório anual de atividades, parecer ad hoc, participação em comissão: itens de
          rotina, tipicamente um registro por pessoa por ano. A regra que os marca é
          deliberadamente estreita e nunca toca o núcleo — um livro chamado "Pareceres"
          não vira administrativo.
        </p>
        <div className="tabela-rolavel">
          <table className="tabela-dados">
            <thead>
              <tr>
                <th>Programa</th>
                <th className="num">Administrativos</th>
                <th className="num">% do total</th>
              </tr>
            </thead>
            <tbody>
              {[...comProducao]
                .filter((p) => p.administrativos > 0)
                .sort((a, b) => b.administrativos - a.administrativos)
                .map((p) => (
                  <tr key={p.sigla}>
                    <td>{p.sigla}</td>
                    <td className="num">{p.administrativos.toLocaleString("pt-BR")}</td>
                    <td className="num">
                      {((p.administrativos / p.total) * 100).toFixed(1)}%
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

/* ------------------------------------------------- concentração (§4.1b.1) */

type OrdemConcentracao = "gini" | "tipos_efetivos" | "mediana" | "n_docentes";

const ORDENS_CONCENTRACAO: Array<{ chave: OrdemConcentracao; rotulo: string }> = [
  { chave: "gini", rotulo: "desigualdade (Gini)" },
  { chave: "tipos_efetivos", rotulo: "variedade de tipos" },
  { chave: "mediana", rotulo: "produção mediana por docente" },
  { chave: "n_docentes", rotulo: "docentes que publicaram" },
];

/** Uma ou duas casas, com vírgula: o site inteiro é em pt-BR. */
function num(v: number | null | undefined, casas = 2): string {
  return v === null || v === undefined
    ? "—"
    : v.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });
}

function Concentracao({ dados }: { dados: Concentracao }) {
  const [ordem, setOrdem] = useState<OrdemConcentracao>("gini");
  const [destaque, setDestaque] = useState<string | null>(null);

  const linhas = [...dados.programas].sort(
    (a, b) => (b[ordem] ?? -1) - (a[ordem] ?? -1) || a.sigla.localeCompare(b.sigla),
  );
  const comCurva = linhas.filter((p) => p.lorenz && p.lorenz.length > 1);
  const semCurva = linhas.filter((p) => !p.lorenz || p.lorenz.length <= 1);

  const W = 360;
  const H = 300;
  const M = { top: 12, right: 12, bottom: 40, left: 46 };
  const iw = W - M.left - M.right;
  const ih = H - M.top - M.bottom;
  const x = (v: number) => v * iw;
  const y = (v: number) => ih - v * ih;

  function caminho(p: ConcentracaoPrograma): string {
    return (p.lorenz ?? [])
      .map((pt, i) => `${i === 0 ? "M" : "L"}${x(pt.pop).toFixed(1)},${y(pt.producao).toFixed(1)}`)
      .join(" ");
  }

  return (
    <div>
      <div className="chart-controles">
        <label>
          Ordenar por{" "}
          <select value={ordem} onChange={(e) => setOrdem(e.target.value as OrdemConcentracao)}>
            {ORDENS_CONCENTRACAO.map((o) => (
              <option key={o.chave} value={o.chave}>
                {o.rotulo}
              </option>
            ))}
          </select>
        </label>
        <span className="chart-nota" style={{ margin: 0 }}>
          Passe o mouse numa linha da tabela para isolar a curva.
        </span>
      </div>

      <div className="rede-layout">
        <div className="tabela-rolavel">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            style={{ width: "100%", maxWidth: W, display: "block" }}
            role="img"
            aria-label="Curvas de Lorenz da produção por docente"
          >
            <g transform={`translate(${M.left},${M.top})`}>
              {[0, 0.5, 1].map((f) => (
                <g key={f}>
                  <line x1={0} x2={iw} y1={y(f)} y2={y(f)} stroke="var(--color-border)" />
                  <text x={-8} y={y(f) + 4} textAnchor="end" className="eixo-rotulo">
                    {(f * 100).toFixed(0)}%
                  </text>
                  <text x={x(f)} y={ih + 16} textAnchor="middle" className="eixo-rotulo">
                    {(f * 100).toFixed(0)}%
                  </text>
                </g>
              ))}
              {/* A diagonal é a igualdade perfeita: cada docente produzindo o
                  mesmo. A distância até ela É a desigualdade — o Gini é o dobro
                  da área entre as duas. */}
              <line
                x1={0}
                y1={ih}
                x2={iw}
                y2={0}
                stroke="var(--color-text-muted)"
                strokeDasharray="4 3"
              />
              {comCurva.map((p) => {
                const ativo = destaque === null || destaque === p.sigla;
                return (
                  <path
                    key={p.sigla}
                    d={caminho(p)}
                    fill="none"
                    stroke={destaque === p.sigla ? "var(--color-accent)" : "var(--seq-400)"}
                    strokeWidth={destaque === p.sigla ? 2.5 : 1.2}
                    opacity={ativo ? (destaque === p.sigla ? 1 : 0.45) : 0.08}
                    onMouseEnter={() => setDestaque(p.sigla)}
                    onMouseLeave={() => setDestaque(null)}
                    style={{ cursor: "pointer" }}
                  >
                    <title>{`${p.sigla}: Gini ${num(p.gini)}`}</title>
                  </path>
                );
              })}
              <text x={iw / 2} y={ih + 34} textAnchor="middle" className="eixo-rotulo">
                docentes, do que menos publica ao que mais publica
              </text>
            </g>
          </svg>
          <p className="chart-nota">
            Eixo vertical: participação acumulada na produção do programa. Uma curva
            colada na diagonal é um programa em que todos publicam parecido; quanto mais
            ela afunda, mais a produção depende de poucas pessoas.
          </p>
        </div>

        <div className="tabela-rolavel">
          <table className="tabela-dados">
            <thead>
              <tr>
                <th>Programa</th>
                <th className="num" title="0 = todos produzem igual; 1 = tudo numa pessoa só">
                  Gini
                </th>
                <th className="num" title="Produções por docente no quadriênio: mediana e intervalo interquartil">
                  Mediana (IQR)
                </th>
                <th className="num" title="1/HHI sobre as rubricas: em quantos tipos o programa publica, de fato">
                  Tipos efetivos
                </th>
                <th className="num">Docentes</th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((p) => (
                <tr
                  key={p.sigla}
                  onMouseEnter={() => setDestaque(p.sigla)}
                  onMouseLeave={() => setDestaque(null)}
                  style={destaque === p.sigla ? { background: "var(--color-accent-light)" } : undefined}
                >
                  <td>
                    <RotuloPPG sigla={p.sigla} />
                  </td>
                  <td className="num forte">{num(p.gini)}</td>
                  <td className="num">
                    {p.mediana === null
                      ? "—"
                      : `${num(p.mediana, 0)} (${num(p.p25, 0)}–${num(p.p75, 0)})`}
                  </td>
                  <td className="num">
                    {num(p.tipos_efetivos, 1)}{" "}
                    <span style={{ color: "var(--color-text-muted)" }}>de {p.n_tipos}</span>
                  </td>
                  <td className="num">{p.n_docentes ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <p className="chart-nota">
        <strong>Como isto respeita a privacidade, e o que se perde com isso.</strong> Cada
        ponto da curva agrega ao menos {dados.limiar_supressao} pessoas, e programa com
        menos de {dados.limiar_supressao * 2} docentes-autores não ganha curva
        {semCurva.length > 0 && ` (${semCurva.map((p) => p.sigla).join(", ")})`}. Máximo,
        decil superior e qualquer lista ordenada de pessoas ficam de fora: num programa de
        onze docentes, "o decil superior" é uma pessoa, com nome recuperável por quem
        conhece a área. O que se perde é a cauda — justamente a parte mais chamativa.
      </p>
      <p className="chart-nota">
        <strong>Cuidado com o denominador.</strong> "Docente" aqui é quem{" "}
        <em>aparece como autor</em> na Plataforma no quadriênio, não o quadro credenciado:
        quem não publicou nada não existe nesta conta. Isso <strong>subestima</strong> a
        desigualdade, porque os zeros somem. E o numerador é o total registrado, com toda
        a variação de preenchimento do painel lá em cima — um Gini alto pode ser
        concentração de pesquisa ou concentração de <em>registro</em>.
      </p>
    </div>
  );
}

/* ---------------------------------------------------------------- heatmap */

type Normalizacao = "share" | "membros" | "docentes" | "discentes";

const NORMALIZACOES: Array<{ chave: Normalizacao; rotulo: string; nota: string }> = [
  {
    chave: "share",
    rotulo: "% do programa",
    nota: "Perfil puro: a mistura de tipos, sem influência de tamanho.",
  },
  {
    chave: "membros",
    rotulo: "por membro",
    nota: "Produções por pessoa vinculada (docentes + discentes + egressos + pós-doc).",
  },
  {
    chave: "docentes",
    rotulo: "por docente",
    nota: "Produções por docente. É a leitura que mais aproxima a de um comitê de avaliação.",
  },
  {
    chave: "discentes",
    rotulo: "por discente/egresso",
    nota: "Produções por discente ou egresso — mede a produção que passa pela formação.",
  },
];

function divisor(p: PerfilPrograma | undefined, norma: Normalizacao): number | null {
  if (!p) return null;
  switch (norma) {
    case "membros":
      return p.n_membros;
    case "docentes":
      return p.n_docentes;
    case "discentes":
      return (p.n_discentes ?? 0) + (p.n_egressos ?? 0) || null;
    default:
      return null;
  }
}

function HeatmapPerfil({
  ordem,
  categorias,
  porPrograma,
  perfil,
}: {
  ordem: string[];
  categorias: string[];
  porPrograma: Map<string, Map<string, number>>;
  perfil: PerfilPrograma[];
}) {
  const [norma, setNorma] = useState<Normalizacao>("share");
  const [ativas, setAtivas] = useState<Set<string>>(() => new Set(categorias));
  const porSigla = new Map(perfil.map((p) => [p.sigla, p]));

  const visiveis = categorias.filter((c) => ativas.has(c));

  const linhas = ordem.map((sigla) => {
    const linha = porPrograma.get(sigla)!;
    /* O denominador do modo "% do programa" é o total das categorias
       SELECIONADAS, não o total do programa: desligar "apresentação de
       trabalho" para comparar o resto e continuar dividindo pelo total antigo
       daria percentuais que não somam 100 e não respondem nada. */
    const total = visiveis.reduce((s, c) => s + (linha.get(c) ?? 0), 0);
    const div = divisor(porSigla.get(sigla), norma);
    const valores = visiveis.map((c) => {
      const n = linha.get(c) ?? 0;
      if (norma === "share") return total > 0 ? (n / total) * 100 : 0;
      return div && div > 0 ? n / div : null;
    });
    return { sigla, total, valores, div };
  });

  const max = Math.max(
    1e-9,
    ...linhas.flatMap((l) => l.valores.filter((v): v is number => v !== null)),
  );

  const semDivisor = linhas.filter((l) => norma !== "share" && !l.div).map((l) => l.sigla);

  function formatar(v: number): string {
    if (norma === "share") return v >= 0.5 ? v.toFixed(0) : "";
    if (v === 0) return "";
    return v >= 10 ? v.toFixed(0) : v.toFixed(1).replace(".", ",");
  }

  return (
    <div>
      <div className="chart-controles">
        <div className="segmented" role="group" aria-label="Normalização">
          {NORMALIZACOES.map((n) => (
            <button
              key={n.chave}
              type="button"
              className={norma === n.chave ? "ativo" : ""}
              onClick={() => setNorma(n.chave)}
              aria-pressed={norma === n.chave}
            >
              {n.rotulo}
            </button>
          ))}
        </div>
        <span className="chart-nota" style={{ margin: 0 }}>
          {NORMALIZACOES.find((n) => n.chave === norma)!.nota}
        </span>
      </div>

      <fieldset className="filtro-grupo">
        <legend>
          Tipos de produção
          <button
            type="button"
            className="link-botao"
            onClick={() =>
              setAtivas(ativas.size === categorias.length ? new Set() : new Set(categorias))
            }
          >
            {ativas.size === categorias.length ? "limpar" : "todos"}
          </button>
        </legend>
        {categorias.map((c) => {
          const ligado = ativas.has(c);
          return (
            <label key={c} className={ligado ? "filtro-item ativo" : "filtro-item"}>
              <input
                type="checkbox"
                checked={ligado}
                onChange={() =>
                  setAtivas((atual) => {
                    const novo = new Set(atual);
                    if (novo.has(c)) novo.delete(c);
                    else novo.add(c);
                    return novo;
                  })
                }
              />
              {c === OUTROS ? "Outros tipos" : c}
            </label>
          );
        })}
      </fieldset>

      {visiveis.length === 0 ? (
        <p className="chart-nota">Nenhum tipo selecionado.</p>
      ) : (
      <div className="tabela-rolavel">
        <table className="heatmap">
          <thead>
            <tr>
              <th className="heatmap-canto">Programa</th>
              {visiveis.map((c) => (
                <th key={c} className="heatmap-col">
                  <span>{c === OUTROS ? "Outros tipos" : c}</span>
                </th>
              ))}
              <th className="heatmap-total">{norma === "share" ? "Total" : "Divisor"}</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map(({ sigla, valores, total, div }) => (
              <tr key={sigla}>
                <th scope="row" className="heatmap-linha">
                  <LogoPPG sigla={sigla} tamanho="sm" />
                  <span>{sigla}</span>
                </th>
                {valores.map((v, i) => {
                  if (v === null) {
                    return (
                      <td
                        key={visiveis[i]}
                        className="celula-suprimida"
                        title={`${sigla}: sem divisor publicável (contagem de pessoas suprimida, n < 5)`}
                      />
                    );
                  }
                  const f = v / max;
                  return (
                    <td
                      key={visiveis[i]}
                      style={{ background: corSequencial(f), color: tintaSobreSequencial(f) }}
                      title={
                        norma === "share"
                          ? `${sigla} · ${visiveis[i]}: ${v.toFixed(1)}% dos tipos selecionados`
                          : `${sigla} · ${visiveis[i]}: ${v.toFixed(2)} por ${NORMALIZACOES.find((n) => n.chave === norma)!.rotulo.replace("por ", "")}`
                      }
                    >
                      {formatar(v)}
                    </td>
                  );
                })}
                <td className="heatmap-total">
                  {norma === "share"
                    ? total.toLocaleString("pt-BR")
                    : div
                      ? div.toLocaleString("pt-BR")
                      : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}

      <p className="chart-nota">
        {norma === "share"
          ? `Números em % ${
              visiveis.length === categorias.length
                ? "da produção do programa"
                : "do que o programa produziu nos tipos selecionados — o denominador acompanha o filtro"
            }. Célula em branco = abaixo de 0,5%.`
          : "Números = produções por pessoa no quadriênio 2021–2024, e não por ano."}{" "}
        A ordem das linhas é sempre a de semelhança de perfil, para as visões serem
        comparáveis entre si.
        {norma !== "share" && (
          <>
            {" "}
            <strong>Cuidado:</strong> "docente", "discente" e "egresso" aqui são contagens
            de pessoas que <em>aparecem como autoras</em> na Plataforma no período — não o
            quadro credenciado do programa. Quem não publicou não é contado, o que puxa os
            índices para cima, e a diferença entre programas é em parte prática de
            preenchimento.
            {semDivisor.length > 0 && ` Sem divisor publicável: ${semDivisor.join(", ")}.`}
          </>
        )}
      </p>
    </div>
  );
}

/* -------------------------------------------------------- small multiples */

function SmallMultiples({
  ordem,
  anos,
  categorias,
  paleta,
  serie,
  modo,
}: {
  ordem: string[];
  anos: number[];
  categorias: string[];
  /** Lista completa de categorias — define a cor, e não muda com o recorte. */
  paleta: string[];
  serie: Map<string, Map<number, Map<string, number>>>;
  modo: Modo;
}) {
  // Escala compartilhada: eixo y livre por facet ficaria mais bonito e mentiria
  // na comparação, que é justamente o objetivo desta grade.
  const maxAnual = Math.max(
    ...ordem.flatMap((sigla) =>
      anos.map((ano) => {
        const porCat = serie.get(sigla)?.get(ano);
        return porCat ? [...porCat.values()].reduce((s, v) => s + v, 0) : 0;
      }),
    ),
  );

  return (
    <div className="grade-facets">
      {ordem.map((sigla) => (
        <Facet
          key={sigla}
          sigla={sigla}
          anos={anos}
          categorias={categorias}
          paleta={paleta}
          serie={serie.get(sigla)}
          modo={modo}
          maxAnual={maxAnual}
        />
      ))}
    </div>
  );
}

function Facet({
  sigla,
  anos,
  categorias,
  paleta,
  serie,
  modo,
  maxAnual,
}: {
  sigla: string;
  anos: number[];
  categorias: string[];
  paleta: string[];
  serie?: Map<number, Map<string, number>>;
  modo: Modo;
  maxAnual: number;
}) {
  const W = 200;
  const H = 96;
  const M = { top: 6, right: 6, bottom: 16, left: 6 };
  const iw = W - M.left - M.right;
  const ih = H - M.top - M.bottom;

  const totais = anos.map((ano) => {
    const porCat = serie?.get(ano);
    return porCat ? [...porCat.values()].reduce((s, v) => s + v, 0) : 0;
  });
  const totalPeriodo = totais.reduce((s, v) => s + v, 0);

  const x = (i: number) => (anos.length === 1 ? iw / 2 : (i / (anos.length - 1)) * iw);
  const denom = (i: number) => (modo === "composicao" ? totais[i] || 1 : maxAnual);
  const y = (v: number, i: number) => ih - (v / denom(i)) * ih;

  // Empilhamento de baixo para cima, na ordem fixa das categorias.
  const base = anos.map(() => 0);
  const faixas = categorias.map((cat) => {
    const pontos = anos.map((ano, i) => {
      const v = serie?.get(ano)?.get(cat) ?? 0;
      const de = base[i];
      base[i] += v;
      return { i, de, ate: de + v };
    });
    return { cat, pontos };
  });

  function caminho(pontos: { i: number; de: number; ate: number }[]): string {
    const topo = pontos.map((p) => `${p.i === 0 ? "M" : "L"}${x(p.i).toFixed(1)},${y(p.ate, p.i).toFixed(1)}`);
    const baixo = [...pontos]
      .reverse()
      .map((p) => `L${x(p.i).toFixed(1)},${y(p.de, p.i).toFixed(1)}`);
    return `${topo.join(" ")} ${baixo.join(" ")} Z`;
  }

  return (
    <figure className="facet">
      <figcaption>
        <LogoPPG sigla={sigla} tamanho="sm" />
        <span className="facet-sigla">{sigla}</span>
        <span className="facet-total">{totalPeriodo.toLocaleString("pt-BR")}</span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Produção de ${sigla} por tipo`}>
        <g transform={`translate(${M.left},${M.top})`}>
          <rect x={0} y={0} width={iw} height={ih} fill="var(--color-bg)" />
          {faixas.map(({ cat, pontos }) => (
            <path
              key={cat}
              d={caminho(pontos)}
              fill={corDaCategoria(cat, paleta)}
              stroke="var(--color-surface)"
              strokeWidth={0.5}
            >
              <title>{`${sigla} · ${cat}`}</title>
            </path>
          ))}
          {anos.map((ano, i) => (
            <text key={ano} x={x(i)} y={ih + 12} textAnchor="middle" className="facet-ano">
              {String(ano).slice(2)}
            </text>
          ))}
        </g>
      </svg>
    </figure>
  );
}

/* ------------------------------------------------------------ comparador */

const MAX_COMPARADOS = 4;

function Comparador({
  ordem,
  anos,
  categorias,
  paleta,
  serie,
}: {
  ordem: string[];
  anos: number[];
  categorias: string[];
  paleta: string[];
  serie: Map<string, Map<number, Map<string, number>>>;
}) {
  const [selecionados, setSelecionados] = useState<string[]>(() => ordem.slice(0, 3));
  const [categoria, setCategoria] = useState<string>(categorias[0]);
  // Trocar o recorte pode tirar do ar a categoria selecionada (ex.: "apresentação
  // de trabalho" não existe no núcleo). Cair na primeira disponível é melhor que
  // desenhar uma série de zeros sem dizer por quê.
  const categoriaAtiva = categorias.includes(categoria) ? categoria : categorias[0];

  function alternar(sigla: string) {
    setSelecionados((atual) =>
      atual.includes(sigla)
        ? atual.filter((s) => s !== sigla)
        : atual.length >= MAX_COMPARADOS
          ? atual
          : [...atual, sigla],
    );
  }

  const W = 640;
  const H = 240;
  const M = { top: 12, right: 96, bottom: 32, left: 48 };
  const iw = W - M.left - M.right;
  const ih = H - M.top - M.bottom;

  const valores = selecionados.map((sigla) => ({
    sigla,
    pontos: anos.map((ano) => serie.get(sigla)?.get(ano)?.get(categoriaAtiva) ?? 0),
  }));
  const max = Math.max(1, ...valores.flatMap((v) => v.pontos));

  const x = (i: number) => (anos.length === 1 ? iw / 2 : (i / (anos.length - 1)) * iw);
  const y = (v: number) => ih - (v / max) * ih;

  // Cor pela posição na lista de seleção seria "cor pelo rank"; aqui a cor segue
  // a posição fixa do programa na ordem geral, então filtrar não repinta ninguém.
  const cor = (sigla: string) =>
    corDaCategoria(paleta[ordem.indexOf(sigla) % paleta.length], paleta);

  return (
    <div>
      <div className="chart-controles">
        <label>
          Tipo de produção{" "}
          <select value={categoriaAtiva} onChange={(e) => setCategoria(e.target.value)}>
            {categorias.map((c) => (
              <option key={c} value={c}>
                {c === OUTROS ? "Outros tipos" : c}
              </option>
            ))}
          </select>
        </label>
        <span className="chart-nota" style={{ margin: 0 }}>
          Até {MAX_COMPARADOS} programas — {selecionados.length} selecionado
          {selecionados.length === 1 ? "" : "s"}.
        </span>
      </div>

      <div className="chips">
        {ordem.map((sigla) => {
          const ativo = selecionados.includes(sigla);
          return (
            <button
              key={sigla}
              type="button"
              className={ativo ? "chip ativo" : "chip"}
              onClick={() => alternar(sigla)}
              aria-pressed={ativo}
              disabled={!ativo && selecionados.length >= MAX_COMPARADOS}
              style={ativo ? { borderColor: cor(sigla), color: cor(sigla) } : undefined}
            >
              {sigla}
            </button>
          );
        })}
      </div>

      {selecionados.length === 0 ? (
        <p className="chart-nota">Selecione ao menos um programa.</p>
      ) : (
        <div className="tabela-rolavel">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            style={{ width: "100%", maxWidth: W, display: "block" }}
            role="img"
            aria-label={`Comparação de ${categoriaAtiva} entre programas`}
          >
            <g transform={`translate(${M.left},${M.top})`}>
              {[0, 0.5, 1].map((f) => (
                <g key={f}>
                  <line x1={0} x2={iw} y1={y(max * f)} y2={y(max * f)} stroke="var(--color-border)" />
                  <text x={-8} y={y(max * f) + 4} textAnchor="end" className="eixo-rotulo">
                    {Math.round(max * f).toLocaleString("pt-BR")}
                  </text>
                </g>
              ))}
              {anos.map((ano, i) => (
                <text key={ano} x={x(i)} y={ih + 20} textAnchor="middle" className="eixo-rotulo">
                  {ano}
                </text>
              ))}
              {valores.map(({ sigla, pontos }) => (
                <g key={sigla}>
                  <path
                    d={pontos.map((v, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(v)}`).join(" ")}
                    fill="none"
                    stroke={cor(sigla)}
                    strokeWidth={2}
                  />
                  {pontos.map((v, i) => (
                    <circle key={i} cx={x(i)} cy={y(v)} r={4} fill={cor(sigla)}>
                      <title>{`${sigla} · ${anos[i]}: ${v}`}</title>
                    </circle>
                  ))}
                  <text
                    x={iw + 8}
                    y={y(pontos[pontos.length - 1]) + 4}
                    className="serie-rotulo"
                    fill={cor(sigla)}
                  >
                    {sigla}
                  </text>
                </g>
              ))}
            </g>
          </svg>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------- total nacional */

function TotalNacional({
  anos,
  categorias,
  paleta,
  data,
}: {
  anos: number[];
  categorias: string[];
  paleta: string[];
  data: ProducaoAnual[];
}) {
  const porAnoCat = new Map<number, Map<string, number>>();
  for (const r of data) {
    const cat = categoriaDaLinha(r, categorias);
    if (!porAnoCat.has(r.ano_base)) porAnoCat.set(r.ano_base, new Map());
    const linha = porAnoCat.get(r.ano_base)!;
    linha.set(cat, (linha.get(cat) ?? 0) + r.n);
  }

  const W = 640;
  const H = 240;
  const M = { top: 12, right: 16, bottom: 32, left: 56 };
  const iw = W - M.left - M.right;
  const ih = H - M.top - M.bottom;

  const totais = anos.map((ano) =>
    [...(porAnoCat.get(ano)?.values() ?? [])].reduce((s, v) => s + v, 0),
  );
  const max = Math.max(...totais);
  const x = (i: number) => (i / (anos.length - 1)) * iw;
  const y = (v: number) => ih - (v / max) * ih;

  const base = anos.map(() => 0);
  const faixas = categorias.map((cat) => {
    const pontos = anos.map((ano, i) => {
      const v = porAnoCat.get(ano)?.get(cat) ?? 0;
      const de = base[i];
      base[i] += v;
      return { i, de, ate: de + v };
    });
    return { cat, pontos };
  });

  return (
    <div className="tabela-rolavel">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: "100%", maxWidth: W, display: "block" }}
        role="img"
        aria-label="Produção nacional por tipo e ano"
      >
        <g transform={`translate(${M.left},${M.top})`}>
          {[0, 0.5, 1].map((f) => (
            <g key={f}>
              <line x1={0} x2={iw} y1={y(max * f)} y2={y(max * f)} stroke="var(--color-border)" />
              <text x={-8} y={y(max * f) + 4} textAnchor="end" className="eixo-rotulo">
                {Math.round(max * f).toLocaleString("pt-BR")}
              </text>
            </g>
          ))}
          {faixas.map(({ cat, pontos }) => (
            <path
              key={cat}
              d={`${pontos.map((p) => `${p.i === 0 ? "M" : "L"}${x(p.i)},${y(p.ate)}`).join(" ")} ${[...pontos]
                .reverse()
                .map((p) => `L${x(p.i)},${y(p.de)}`)
                .join(" ")} Z`}
              fill={corDaCategoria(cat, paleta)}
              stroke="var(--color-surface)"
              strokeWidth={1}
            >
              <title>{cat}</title>
            </path>
          ))}
          {anos.map((ano, i) => (
            <text key={ano} x={x(i)} y={ih + 20} textAnchor="middle" className="eixo-rotulo">
              {ano}
            </text>
          ))}
        </g>
      </svg>
    </div>
  );
}

/* ------------------------------------------------------------- legenda */

function Legenda({ categorias, paleta }: { categorias: string[]; paleta: string[] }) {
  return (
    <div className="legenda">
      {categorias.map((c) => (
        <span key={c} className="legenda-item">
          <span className="legenda-marca" style={{ background: corDaCategoria(c, paleta) }} />
          {c === OUTROS ? "Outros tipos" : c}
        </span>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------- tabela */

function TabelaTotais({
  anos,
  categorias,
  paleta,
  data,
}: {
  anos: number[];
  categorias: string[];
  paleta: string[];
  data: ProducaoAnual[];
}) {
  const porCatAno = new Map<string, Map<number, number>>();
  for (const r of data) {
    const cat = categoriaDaLinha(r, categorias);
    if (!porCatAno.has(cat)) porCatAno.set(cat, new Map());
    const linha = porCatAno.get(cat)!;
    linha.set(r.ano_base, (linha.get(r.ano_base) ?? 0) + r.n);
  }
  const totalPorAno = anos.map((ano) =>
    [...porCatAno.values()].reduce((s, m) => s + (m.get(ano) ?? 0), 0),
  );

  return (
    <div className="tabela-rolavel">
      <table className="tabela-dados">
        <thead>
          <tr>
            <th>Tipo</th>
            {anos.map((a) => (
              <th key={a} className="num">{a}</th>
            ))}
            <th className="num">Total</th>
          </tr>
        </thead>
        <tbody>
          {categorias.map((cat) => {
            const vals = anos.map((a) => porCatAno.get(cat)?.get(a) ?? 0);
            const total = vals.reduce((s, v) => s + v, 0);
            return (
              <tr key={cat}>
                <td>
                  <span className="legenda-marca" style={{ background: corDaCategoria(cat, paleta) }} />
                  {cat === OUTROS ? "Outros tipos" : cat}
                </td>
                {vals.map((v, i) => (
                  <td key={i} className="num">
                    {v > 0 ? v.toLocaleString("pt-BR") : "—"}
                  </td>
                ))}
                <td className="num forte">{total.toLocaleString("pt-BR")}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <td className="forte">Total</td>
            {totalPorAno.map((v, i) => (
              <td key={i} className="num forte">{v.toLocaleString("pt-BR")}</td>
            ))}
            <td className="num forte">
              {totalPorAno.reduce((s, v) => s + v, 0).toLocaleString("pt-BR")}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
