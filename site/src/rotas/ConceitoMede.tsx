import { useEffect, useState } from "react";
import LogoPPG from "../componentes/LogoPPG";
import { logoUrl } from "../dados/logos";
import { corSequencial, tintaSobreSequencial } from "../dados/series";
import { loadProgramas, loadDistribuicaoNotas, loadIndices } from "../dados/loaders";
import type { Programa, DistribuicaoNotas, ProgramaIndices } from "../dados/tipos";
import { inteiro, pct } from "../dados/formato";

export default function ConceitoMede() {
  const [programas, setProgramas] = useState<Programa[] | null>(null);
  const [distNotas, setDistNotas] = useState<DistribuicaoNotas | null>(null);
  const [indices, setIndices] = useState<ProgramaIndices[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([loadProgramas(), loadDistribuicaoNotas(), loadIndices()])
      .then(([p, d, x]) => {
        setProgramas(p);
        setDistNotas(d);
        setIndices(x);
      })
      .catch((e: unknown) => setError(String(e)));
  }, []);

  if (error) return <div className="error">Erro ao carregar dados: {error}</div>;
  if (!programas || !distNotas || !indices)
    return <div className="loading">Carregando…</div>;

  const avaliados = programas.filter((p) => p.nota_2025 !== null);

  return (
    <div>
      <h1>O que o conceito mede</h1>
      <p className="page-subtitle">
        A nota de 2025 avalia o quadriênio 2021–2024; a nota anterior avalia 2017–2020.
        Ao correlacionar produção com a nota nova, filtre 2021–2024 — a base cobre
        2020–2024.
      </p>

      <h2>Variação de nota: 2017–2020 → 2021–2024</h2>
      <p className="chart-nota">
        Cada linha é um programa, ordenado pela nota nova. Ponto vazado = nota antiga,
        ponto cheio = nota de 2025.
      </p>
      <DumbbellNotas programas={avaliados} />

      <h2>Matriz de transição</h2>
      <MatrizTransicao programas={avaliados} />

      <h2>Perfil dos índices, lado a lado</h2>
      <p className="chart-nota">
        Cada linha é um programa atravessando oito índices. A pergunta do capítulo não é
        "quem produz mais tem nota maior?" — com n=20 essa correlação é frágil —, e sim{" "}
        <strong>o que distingue quem subiu de quem ficou parado</strong>. Passe o mouse
        numa linha para isolá-la.
      </p>
      <CoordenadasParalelas indices={indices} />

      <h2>Onde cada programa está no país</h2>
      <p className="chart-nota">
        A nota crua diz pouco a quem é de fora da CAPES. O percentil diz mais: um 5 em
        Música é melhor do que parece, porque a distribuição nacional é concentrada em 3, 4
        e 5.
      </p>
      <Benchmark programas={avaliados} dist={distNotas} />

      <h2>Distribuição de notas: Música vs. ARTES vs. Brasil</h2>
      <p style={{ fontSize: "0.875rem", color: "var(--color-text-muted)", marginBottom: "1rem" }}>
        ARTES: 74 programas · Brasil: 4.555 programas (Avaliação Quadrienal 2025).
      </p>
      <GradeDistribution dist={distNotas} />

    </div>
  );
}

// Os três programas que foram à reconsideração (CTC-ES 241) e tiveram a nota
// mantida. Isso não existe na API do Sucupira — veio da planilha oficial.
const RECONSIDERACAO = new Set(["UFSJ", "UNB", "UNIRIO"]);

const COR_SUBIU = "var(--serie-6)";
const COR_MANTEVE = "var(--color-text-muted)";

/**
 * Dumbbell: uma linha por programa, nota antiga (ponto vazado) → nova (cheio).
 *
 * Substituiu um slope chart, que com 5 níveis de nota e 20 programas empilhava
 * rótulos ilegíveis ("UNICAMP" impresso sobre "UFRJ") e fundia numa linha só
 * todos os programas com a mesma trajetória. Aqui cada programa tem a sua
 * linha: não há colisão possível, e a ordenação por nota nova revela o padrão
 * que o slope escondia.
 */
function DumbbellNotas({ programas }: { programas: Programa[] }) {
  const comAntes = programas.filter((p) => p.nota_anterior !== null && p.nota_2025 !== null);
  const semAntes = programas.filter((p) => p.nota_anterior === null && p.nota_2025 !== null);

  const ordenados = [...comAntes].sort((a, b) => {
    const nb = (b.nota_2025 ?? 0) - (a.nota_2025 ?? 0);
    if (nb !== 0) return nb;
    const vb = (b.variacao ?? 0) - (a.variacao ?? 0);
    if (vb !== 0) return vb;
    return a.sigla.localeCompare(b.sigla);
  });

  const notas = [3, 4, 5, 6, 7];
  const LINHA = 26;
  const M = { top: 28, right: 24, bottom: 8, left: 150 };
  const W = 640;
  const iw = W - M.left - M.right;
  const ih = ordenados.length * LINHA;
  const H = ih + M.top + M.bottom;

  const x = (nota: number) => ((nota - 3) / 4) * iw;
  const y = (i: number) => i * LINHA + LINHA / 2;

  return (
    <div className="tabela-rolavel">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: "100%", maxWidth: W, display: "block" }}
        role="img"
        aria-label="Nota de cada programa antes e depois da Quadrienal 2025"
      >
        <g transform={`translate(${M.left},${M.top})`}>
          {notas.map((n) => (
            <g key={n}>
              <line x1={x(n)} x2={x(n)} y1={-8} y2={ih} stroke="var(--color-border)" />
              <text x={x(n)} y={-14} textAnchor="middle" className="eixo-rotulo">
                {n}
              </text>
            </g>
          ))}

          {ordenados.map((p, i) => {
            const antes = p.nota_anterior as number;
            const depois = p.nota_2025 as number;
            const subiu = depois > antes;
            const cor = subiu ? COR_SUBIU : COR_MANTEVE;
            return (
              <g key={p.sigla}>
                {/* Chip branco atrás do logo: as marcas são tinta escura sobre
                    transparente e sumiriam no tema escuro (docs/PLANO.md §3.4). */}
                <rect x={-M.left + 2} y={y(i) - 9} width={26} height={18} rx={2} fill="#fff" stroke="var(--color-border)" />
                <image
                  href={logoUrl(p.sigla)}
                  x={-M.left + 4}
                  y={y(i) - 7}
                  width={22}
                  height={14}
                  preserveAspectRatio="xMidYMid meet"
                />
                <text x={-M.left + 34} y={y(i) + 4} className="dumbbell-rotulo">
                  {p.sigla}
                  {RECONSIDERACAO.has(p.sigla) && <tspan className="dumbbell-marca"> ✳</tspan>}
                </text>
                {subiu ? (
                  <>
                    <line
                      x1={x(antes)}
                      x2={x(depois)}
                      y1={y(i)}
                      y2={y(i)}
                      stroke={cor}
                      strokeWidth={3}
                    />
                    <circle cx={x(antes)} cy={y(i)} r={5} fill="var(--color-surface)" stroke={cor} strokeWidth={2} />
                    <circle cx={x(depois)} cy={y(i)} r={6} fill={cor}>
                      <title>{`${p.sigla}: ${antes} → ${depois}`}</title>
                    </circle>
                  </>
                ) : (
                  <circle cx={x(depois)} cy={y(i)} r={5} fill={cor} opacity={0.55}>
                    <title>{`${p.sigla}: manteve ${depois}`}</title>
                  </circle>
                )}
              </g>
            );
          })}
        </g>
      </svg>

      <div className="legenda">
        <span className="legenda-item">
          <span className="legenda-marca" style={{ background: COR_SUBIU }} />
          Subiu de nota ({comAntes.filter((p) => (p.variacao ?? 0) > 0).length})
        </span>
        <span className="legenda-item">
          <span className="legenda-marca" style={{ background: COR_MANTEVE, opacity: 0.55 }} />
          Nota mantida ({comAntes.filter((p) => (p.variacao ?? 0) === 0).length})
        </span>
        <span className="legenda-item">✳ foi à reconsideração e manteve a nota</span>
      </div>

      <p className="chart-nota">
        <strong>Ninguém caiu.</strong>{" "}
        {semAntes.length > 0 && (
          <>
            Fora do gráfico:{" "}
            {semAntes.map((p) => `${p.sigla} (primeira nota: ${p.nota_2025})`).join(", ")} — sem
            nota anterior, não têm trajetória a mostrar.{" "}
          </>
        )}
        UFG segue sem nota, em implantação.
      </p>
    </div>
  );
}

/**
 * Matriz de transição antes × depois. Complementa o dumbbell mostrando o padrão
 * agregado — inclusive a metade inferior vazia, que é o achado mais forte da
 * página e que uma lista de 20 linhas não deixa ver.
 */
function MatrizTransicao({ programas }: { programas: Programa[] }) {
  const notas = [3, 4, 5, 6, 7];
  const contagem = new Map<string, string[]>();
  for (const p of programas) {
    if (p.nota_anterior === null || p.nota_2025 === null) continue;
    const chave = `${p.nota_anterior}|${p.nota_2025}`;
    contagem.set(chave, [...(contagem.get(chave) ?? []), p.sigla]);
  }
  const maxCel = Math.max(1, ...[...contagem.values()].map((v) => v.length));

  return (
    <div className="tabela-rolavel">
      <table className="matriz-transicao">
        <caption>
          Linhas: nota 2017–2020. Colunas: nota 2021–2024. Células abaixo da diagonal
          ficariam preenchidas se algum programa tivesse caído — nenhuma está.
        </caption>
        <thead>
          <tr>
            <th />
            {notas.map((n) => (
              <th key={n} scope="col">{n}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {notas.map((antes) => (
            <tr key={antes}>
              <th scope="row">{antes}</th>
              {notas.map((depois) => {
                const siglas = contagem.get(`${antes}|${depois}`) ?? [];
                const diagonal = antes === depois;
                const abaixo = depois < antes;
                return (
                  <td
                    key={depois}
                    className={abaixo ? "impossivel" : diagonal ? "diagonal" : ""}
                    style={
                      siglas.length > 0
                        ? {
                            background: corSequencial(siglas.length / maxCel),
                            color: tintaSobreSequencial(siglas.length / maxCel),
                          }
                        : undefined
                    }
                    title={siglas.length > 0 ? siglas.join(", ") : undefined}
                  >
                    {siglas.length > 0 ? siglas.length : ""}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------ coordenadas paralelas */

type Eixo = {
  chave: keyof ProgramaIndices;
  rotulo: string;
  nota: string;
  /** Sufixo do valor no tooltip. */
  unidade: string;
};

/* Oito eixos, agrupados por assunto na ordem em que aparecem: três de volume,
   dois de abertura, dois de formação e fechamento, um de projetos. Mais que
   isso vira emaranhado; menos deixa de ser perfil. */
const EIXOS: Eixo[] = [
  { chave: "prod_per_docente", rotulo: "produções / docente", nota: "Volume total registrado — inflado por política de preenchimento; ver o capítulo de regimes.", unidade: "" },
  { chave: "artigos_per_docente", rotulo: "artigos / docente", nota: "Artigo em periódico por docente.", unidade: "" },
  { chave: "musica_per_docente", rotulo: "música / docente", nota: "Produção artístico-cultural em música por docente.", unidade: "" },
  { chave: "pct_intl_pais", rotulo: "% internacional", nota: "Produções realizadas fora do Brasil (só ARTÍSTICO-CULTURAL tem o campo).", unidade: "%" },
  { chave: "pct_externo", rotulo: "% particip. externo", nota: "Pessoas com vínculo externo entre as que assinam produção.", unidade: "%" },
  { chave: "pct_discente", rotulo: "% discente", nota: "Discentes entre as pessoas que assinam produção.", unidade: "%" },
  { chave: "endogenia_coautoria", rotulo: "endogenia", nota: "Coautorias que não saem do próprio programa.", unidade: "%" },
  { chave: "taxa_orfaos", rotulo: "% projetos órfãos", nota: "Projetos sem nenhuma produção vinculada — indicador de preenchimento antes de pesquisa.", unidade: "%" },
];

type Agrupamento = "nota" | "variacao";

/** Uma casa decimal e vírgula: o site inteiro é em pt-BR. */
function numero(v: number): string {
  return v.toLocaleString("pt-BR", { maximumFractionDigits: 1 });
}

function CoordenadasParalelas({ indices }: { indices: ProgramaIndices[] }) {
  const [agrupamento, setAgrupamento] = useState<Agrupamento>("nota");
  const [destaque, setDestaque] = useState<string | null>(null);

  // Sem os dois índices centrais a linha seria interpolada por cima do buraco.
  const linhas = indices.filter((p) => p.prod_per_docente !== null && p.n_docentes > 0);

  const escalas = EIXOS.map((e) => {
    const vals = linhas
      .map((p) => p[e.chave] as number | null)
      .filter((v): v is number => v !== null);
    return { min: Math.min(...vals), max: Math.max(...vals) };
  });

  const W = 720;
  const H = 360;
  // Margem superior generosa: os rótulos dos eixos são longos e vão inclinados;
  // na horizontal, "% internacional" e "% particip. externo" se sobrepõem.
  const M = { top: 62, right: 132, bottom: 44, left: 40 };
  const iw = W - M.left - M.right;
  const ih = H - M.top - M.bottom;

  const x = (i: number) => (i / (EIXOS.length - 1)) * iw;
  const y = (v: number, i: number) => {
    const { min, max } = escalas[i];
    return max === min ? ih / 2 : ih - ((v - min) / (max - min)) * ih;
  };

  /* Cor por grupo, não por programa: 20 matizes seriam indistinguíveis, e a
     pergunta é sobre grupos. No modo "variação", cinza é quem manteve — a
     maioria — e a cor destaca a exceção. */
  const grupo = (p: ProgramaIndices): string => {
    if (agrupamento === "nota") return p.nota_2025 === null ? "sem nota" : `nota ${p.nota_2025}`;
    if (p.variacao_nota === null) return "sem histórico";
    return p.variacao_nota > 0 ? "subiu" : "manteve";
  };

  const CORES_NOTA: Record<string, string> = {
    "nota 3": "var(--serie-outros)",
    "nota 4": "var(--seq-200)",
    "nota 5": "var(--seq-400)",
    "nota 6": "var(--seq-600)",
    "nota 7": "var(--seq-700)",
    "sem nota": "var(--color-suppressed)",
  };
  const CORES_VARIACAO: Record<string, string> = {
    subiu: COR_SUBIU,
    manteve: COR_MANTEVE,
    "sem histórico": "var(--color-suppressed)",
  };

  const cor = (p: ProgramaIndices) =>
    (agrupamento === "nota" ? CORES_NOTA : CORES_VARIACAO)[grupo(p)] ?? COR_MANTEVE;

  const grupos = [...new Set(linhas.map(grupo))].sort();

  function caminho(p: ProgramaIndices): string | null {
    const pontos: string[] = [];
    EIXOS.forEach((e, i) => {
      const v = p[e.chave] as number | null;
      if (v === null) return;
      pontos.push(`${pontos.length === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v, i).toFixed(1)}`);
    });
    return pontos.length >= 2 ? pontos.join(" ") : null;
  }

  return (
    <div>
      <div className="chart-controles">
        <div className="segmented" role="group" aria-label="Agrupamento">
          <button
            type="button"
            className={agrupamento === "nota" ? "ativo" : ""}
            onClick={() => setAgrupamento("nota")}
            aria-pressed={agrupamento === "nota"}
          >
            Por conceito
          </button>
          <button
            type="button"
            className={agrupamento === "variacao" ? "ativo" : ""}
            onClick={() => setAgrupamento("variacao")}
            aria-pressed={agrupamento === "variacao"}
          >
            Por variação de nota
          </button>
        </div>
        <span className="chart-nota" style={{ margin: 0 }}>
          {agrupamento === "nota"
            ? "Cor = nota de 2025. Se houvesse um perfil típico por conceito, as linhas de mesma cor andariam juntas."
            : "Cor = subiu ou manteve. Nenhum programa caiu."}
        </span>
      </div>

      <div className="chips">
        {linhas.map((p) => (
          <button
            key={p.sigla}
            type="button"
            className={destaque === p.sigla ? "chip ativo" : "chip"}
            onClick={() => setDestaque(destaque === p.sigla ? null : p.sigla)}
            aria-pressed={destaque === p.sigla}
            style={destaque === p.sigla ? { borderColor: cor(p), color: cor(p) } : undefined}
          >
            {p.sigla}
          </button>
        ))}
      </div>

      <div className="tabela-rolavel">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          style={{ width: "100%", maxWidth: W, display: "block" }}
          role="img"
          aria-label="Perfil dos programas em oito índices"
        >
          <g transform={`translate(${M.left},${M.top})`}>
            {EIXOS.map((e, i) => (
              <g key={e.chave as string}>
                <line x1={x(i)} x2={x(i)} y1={0} y2={ih} stroke="var(--color-border)" />
                <text
                  x={x(i)}
                  y={-10}
                  textAnchor="start"
                  className="eixo-rotulo"
                  transform={`rotate(-34 ${x(i)} -10)`}
                >
                  <title>{e.nota}</title>
                  {e.rotulo}
                </text>
                <text x={x(i)} y={ih + 16} textAnchor="middle" className="eixo-rotulo">
                  {numero(escalas[i].max)}
                  {e.unidade}
                </text>
                <text x={x(i)} y={ih + 28} textAnchor="middle" className="eixo-rotulo">
                  ↓ {numero(escalas[i].min)}
                  {e.unidade}
                </text>
              </g>
            ))}

            {linhas.map((p) => {
              const d = caminho(p);
              if (!d) return null;
              const ativo = destaque === null || destaque === p.sigla;
              return (
                <path
                  key={p.sigla}
                  d={d}
                  fill="none"
                  stroke={cor(p)}
                  strokeWidth={destaque === p.sigla ? 3 : 1.5}
                  opacity={ativo ? (destaque === p.sigla ? 1 : 0.7) : 0.12}
                  onMouseEnter={() => setDestaque(p.sigla)}
                  onMouseLeave={() => setDestaque(null)}
                  style={{ cursor: "pointer" }}
                >
                  <title>
                    {`${p.sigla} — ${grupo(p)}\n` +
                      EIXOS.map((e) => {
                        const v = p[e.chave] as number | null;
                        return `${e.rotulo}: ${v === null ? "—" : numero(v) + e.unidade}`;
                      }).join("\n")}
                  </title>
                </path>
              );
            })}

            {destaque !== null &&
              EIXOS.map((e, i) => {
                const p = linhas.find((l) => l.sigla === destaque);
                const v = p ? (p[e.chave] as number | null) : null;
                if (v === null || !p) return null;
                return (
                  <circle key={e.chave as string} cx={x(i)} cy={y(v, i)} r={4} fill={cor(p)} />
                );
              })}

            {destaque !== null && (
              <text x={iw + 10} y={12} className="serie-rotulo">
                {destaque}
              </text>
            )}
          </g>
        </svg>
      </div>

      <div className="legenda">
        {grupos.map((g) => (
          <span key={g} className="legenda-item">
            <span
              className="legenda-marca"
              style={{
                background:
                  (agrupamento === "nota" ? CORES_NOTA : CORES_VARIACAO)[g] ?? COR_MANTEVE,
              }}
            />
            {g}
          </span>
        ))}
      </div>

      <p className="chart-nota">
        Cada eixo é escalado do <strong>menor ao maior valor observado</strong> entre os 20
        programas — a posição é relativa ao grupo, nunca a um padrão externo. Os números
        embaixo de cada eixo são esses extremos. Um eixo sem cruzamento entre as cores
        seria um índice que "explica" a nota; a leitura honesta aqui é que{" "}
        <strong>nenhum deles separa os grupos sozinho</strong>, e com n=20 não há teste que
        sustente mais do que isso. "Produções / docente" em especial mistura pesquisa com
        política de preenchimento.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------ benchmark */

/** Percentil médio: metade dos empates conta abaixo, metade acima. */
function percentil(dist: Record<string, number>, nota: number): number {
  const total = Object.values(dist).reduce((s, v) => s + v, 0);
  if (total === 0) return 0;
  let abaixo = 0;
  let iguais = 0;
  for (const [n, q] of Object.entries(dist)) {
    const valor = Number(n);
    if (valor < nota) abaixo += q;
    else if (valor === nota) iguais += q;
  }
  return ((abaixo + iguais / 2) / total) * 100;
}

function Benchmark({
  programas,
  dist,
}: {
  programas: Programa[];
  dist: DistribuicaoNotas;
}) {
  const nArtes = Object.values(dist.artes).reduce((s, v) => s + v, 0);
  const nBrasil = Object.values(dist.brasil).reduce((s, v) => s + v, 0);

  const linhas = [...programas]
    .filter((p) => p.nota_2025 !== null)
    .map((p) => ({
      p,
      artes: percentil(dist.artes, p.nota_2025 as number),
      brasil: percentil(dist.brasil, p.nota_2025 as number),
    }))
    .sort((a, b) => b.brasil - a.brasil || a.p.sigla.localeCompare(b.p.sigla));

  return (
    <div>
      <div className="barras-cabecalho">
        <span className="barra-rotulo" />
        <span className="barra-trilho">percentil no Brasil ({nBrasil.toLocaleString("pt-BR")} programas)</span>
        <span className="barra-valor">
          <span className="forte">nota</span>
          <span>Brasil</span>
          <span>ARTES</span>
        </span>
      </div>
      <div className="barras-empilhadas">
        {linhas.map(({ p, artes, brasil }) => (
          <div key={p.sigla} className="barra-linha">
            <span className="barra-rotulo">
              <LogoPPG sigla={p.sigla} tamanho="sm" />
              {p.sigla}
            </span>
            <span className="barra-trilho">
              <span
                className="barra-segmento"
                style={{ width: `${brasil}%`, background: corSequencial(brasil / 100) }}
                title={`${p.sigla}: nota ${p.nota_2025} — acima de ~${pct(brasil, 0)} dos programas do país`}
              />
            </span>
            <span className="barra-valor">
              <span className="forte">{p.nota_2025}</span>
              <span>{pct(brasil, 0)}</span>
              <span>{pct(artes, 0)}</span>
            </span>
          </div>
        ))}
      </div>
      <p className="chart-nota">
        Percentil <strong>médio</strong>: como a nota tem só cinco níveis e há centenas de
        empates, metade dos programas de mesma nota conta abaixo e metade acima. Sem esse
        cuidado, um 4 apareceria ora como percentil 30, ora como 70, dependendo do lado
        pelo qual se conta. Base: {nBrasil.toLocaleString("pt-BR")} programas avaliados no
        país e {nArtes} na área ARTES (Quadrienal 2025). Comparação entre <em>áreas</em>{" "}
        diferentes é aproximada por construção — cada área calibra a própria escala, e um 5
        em ARTES não é o mesmo objeto que um 5 em Medicina.
      </p>
    </div>
  );
}

function GradeDistribution({ dist }: { dist: DistribuicaoNotas }) {
  const notas = ["1", "2", "3", "4", "5", "6", "7"];
  const max = Math.max(...notas.flatMap((n) => [dist.musica[n] ?? 0, dist.artes[n] ?? 0]));

  /* Música e ARTES viram barra; Brasil fica em número. Pôr as três na mesma
     escala esmagaria as duas primeiras (4.555 contra 20), e escalas diferentes
     na mesma figura convidam à comparação errada. */
  return (
    <div className="tabela-rolavel">
      <table className="tabela-dados">
        <thead>
          <tr>
            <th>Nota</th>
            <th>Música (20)</th>
            <th>ARTES (74)</th>
            <th className="num">Brasil (4.555)</th>
          </tr>
        </thead>
        <tbody>
          {notas.map((nota) => (
            <tr key={nota}>
              <td>
                <span className={`nota-badge nota-${nota}`}>{nota}</span>
              </td>
              <td>
                <BarraNota n={dist.musica[nota] ?? 0} max={max} cor="var(--seq-500)" />
              </td>
              <td>
                <BarraNota n={dist.artes[nota] ?? 0} max={max} cor="var(--serie-7)" />
              </td>
              <td className="num" style={{ color: "var(--color-text-muted)" }}>
                {dist.brasil[nota] ? inteiro(dist.brasil[nota]) : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BarraNota({ n, max, cor }: { n: number; max: number; cor: string }) {
  return (
    <span className="barra-trilho" style={{ maxWidth: 180 }}>
      <span
        className="barra-segmento"
        style={{ width: `${max > 0 ? (n / max) * 100 : 0}%`, background: cor }}
        title={`${n} programas`}
      />
      {n > 0 && (
        <span style={{ fontSize: "0.75rem", color: "var(--color-text-muted)", marginLeft: "0.5rem" }}>
          {n}
        </span>
      )}
    </span>
  );
}
