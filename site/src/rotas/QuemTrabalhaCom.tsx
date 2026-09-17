import { useEffect, useMemo, useState } from "react";
import Cartograma from "../componentes/Cartograma";
import LogoPPG, { RotuloPPG } from "../componentes/LogoPPG";
import MapaLocalizador from "../componentes/MapaLocalizador";
import {
  loadCoautoriaDocDisc,
  loadEndogenia,
  loadInternacionalizacao,
  loadPerfilProgramas,
  loadProducaoAnual,
  loadProgramas,
  loadRedeObrasPorTipo,
  loadRedeProgramas,
  loadRedeRegioes,
  loadRedeUfs,
} from "../dados/loaders";
import {
  OUTROS,
  categoriasPrincipais,
  corDaCategoria,
  corSequencial,
  tintaSobreSequencial,
} from "../dados/series";
import { pct } from "../dados/formato";
import type {
  CoautoriaDocDisc,
  EndogeniaPrograma,
  Internacionalizacao,
  PerfilPrograma,
  Programa,
  RedeEdge,
  ProducaoAnual,
  RedeObrasPorTipo,
  RedeProgramas,
  RedeRegioes,
} from "../dados/tipos";

const REGIOES = ["Norte", "Nordeste", "Centro-Oeste", "Sudeste", "Sul"];

const COR_REGIAO: Record<string, string> = {
  Norte: "var(--serie-3)",
  Nordeste: "var(--serie-2)",
  "Centro-Oeste": "var(--serie-4)",
  Sudeste: "var(--serie-1)",
  Sul: "var(--serie-7)",
};

/* Faixas do raio de colaboração, na ordem em que empilham — as mesmas cores e
   os mesmos níveis do cartograma, de propósito: quem lê as duas figuras não
   deve ter de reaprender a legenda. Autoria única é neutra: não é colaboração
   nem fechamento. Cada obra entra na faixa do seu MAIOR alcance. */
const FAIXAS = [
  { chave: "autoria_unica", rotulo: "Autoria única", cor: "var(--color-suppressed)" },
  { chave: "interna", rotulo: "Só do próprio programa", cor: "var(--serie-7)" },
  { chave: "mesma_uf", rotulo: "Com outro PPG da mesma UF", cor: "var(--serie-8)" },
  { chave: "regional", rotulo: "Mesma região, outra UF", cor: "var(--serie-4)" },
  { chave: "interregional", rotulo: "Com PPG de outra região", cor: "var(--serie-1)" },
] as const;

export default function QuemTrabalhaCom() {
  const [rede, setRede] = useState<RedeProgramas | null>(null);
  const [programas, setProgramas] = useState<Programa[] | null>(null);
  const [producao, setProducao] = useState<ProducaoAnual[] | null>(null);
  const [perfil, setPerfil] = useState<PerfilPrograma[] | null>(null);
  const [regioes, setRegioes] = useState<RedeRegioes[] | null>(null);
  const [docDisc, setDocDisc] = useState<CoautoriaDocDisc[] | null>(null);
  const [obras, setObras] = useState<RedeObrasPorTipo | null>(null);
  const [ufs, setUfs] = useState<RedeRegioes[] | null>(null);
  const [intl, setIntl] = useState<Internacionalizacao | null>(null);
  const [endogenia, setEndogenia] = useState<EndogeniaPrograma[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [destaque, setDestaque] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      loadRedeProgramas(),
      loadProgramas(),
      loadProducaoAnual(),
      loadPerfilProgramas(),
      loadRedeRegioes(),
      loadCoautoriaDocDisc(),
      loadRedeObrasPorTipo(),
      loadRedeUfs(),
      loadInternacionalizacao(),
      loadEndogenia(),
    ])
      .then(([r, pg, pr, pf, rg, dd, ob, uf, it, en]) => {
        setRede(r);
        setProgramas(pg);
        setProducao(pr);
        setPerfil(pf);
        setRegioes(rg);
        setDocDisc(dd);
        setObras(ob);
        setUfs(uf);
        setIntl(it);
        setEndogenia(en);
      })
      .catch((e: unknown) => setError(String(e)));
  }, []);

  if (error) return <div className="error">Erro ao carregar dados: {error}</div>;
  if (!rede || !programas || !producao || !perfil || !regioes || !docDisc || !obras || !ufs || !intl || !endogenia)
    return <div className="loading">Carregando…</div>;

  const { edges, aggregate } = rede;
  const topEdges = [...edges]
    .filter((e) => !e.suppressed && e.n !== null)
    .sort((a, b) => (b.n ?? 0) - (a.n ?? 0))
    .slice(0, 15);

  return (
    <div>
      <h1>Quem trabalha com quem</h1>
      <p className="page-subtitle">
        Colaboração medida por <strong>pessoas compartilhadas</strong>: autores que publicam
        em mais de um PPGMus. Produções pertencem a exatamente um programa por construção
        da base, então não existe "produção coautorada entre programas" — o que existe é
        gente em comum.
      </p>

      <div className="headline-stats" style={{ marginBottom: "2rem" }}>
        <Stat valor={aggregate.n_programs} rotulo="programas na rede" />
        <Stat
          valor={aggregate.density !== null ? aggregate.density.toFixed(3) : "—"}
          rotulo="densidade da rede (pares com n ≥ 5)"
        />
        <Stat valor={edges.filter((e) => !e.suppressed).length} rotulo="pares com ≥ 5 pessoas em comum" />
        <Stat valor={edges.filter((e) => e.suppressed).length} rotulo="pares suprimidos (n < 5)" />
      </div>

      <h2>A rede, programa a programa</h2>
      <div className="rede-layout">
        <div>
          <Cartograma
            programas={programas}
            rede={obras}
            destaque={destaque}
            onDestaque={setDestaque}
          />
        </div>
        <MapaLocalizador programas={programas} destaque={destaque} onDestaque={setDestaque} />
      </div>

      <h2>Entre estados</h2>
      <p className="chart-nota">
        Pessoas compartilhadas somadas por par de UFs. A diagonal é a colaboração entre
        PPGMus <em>do mesmo estado</em> — ela só pode ter valor onde há mais de um
        programa: SP (3), MG (3), PR (3) e RJ (2). Nos demais estados a célula é vazia por
        construção, não por falta de colaboração.
      </p>
      <MatrizRecorte dados={ufs} rotulos={ordemUfs(programas)} />

      <h2>Entre regiões</h2>
      <p className="chart-nota">
        O mesmo, agregado por região.
      </p>
      <MatrizRecorte dados={regioes} rotulos={REGIOES} />

      <h2>Raio de colaboração</h2>
      <p className="chart-nota">
        Toda produção cai em exatamente uma faixa, pelo <strong>alcance máximo</strong> que
        ela atinge: autoria única (um autor registrado), ou coautoria cujos autores estão
        ligados só ao próprio programa, a outro PPG da mesma UF, a um PPG da mesma região
        em outro estado, ou a um PPG de outra região. Uma obra que toca outra região não
        vira "mesma UF" só porque também tem um parceiro vizinho.
      </p>
      <RaioColaboracao perfil={perfil} destaque={destaque} onDestaque={setDestaque} />

      <h2>O quanto cada programa é fechado</h2>
      <p className="chart-nota">
        Duas medidas de endogenia, lado a lado (§4.1b.5): <strong>por coautoria</strong> — a
        primeira faixa do raio de colaboração acima, "só do próprio programa" sobre o total de
        coautorias — e <strong>por projeto</strong> — participação dos <code>projeto_membro</code>{" "}
        que não aparecem em projeto de nenhum outro dos 20 programas. Nenhuma das duas é um
        índice: são medidas separadas, mostradas juntas para que a concordância entre elas seja o
        argumento.
      </p>
      <Endogenia
        perfil={perfil}
        endogenia={endogenia}
        programas={programas}
        destaque={destaque}
        onDestaque={setDestaque}
      />

      <h2>Produção conjunta docente + discente</h2>
      <p className="chart-nota">
        Produções com pelo menos um <strong>Docente</strong> e pelo menos um{" "}
        <strong>Discente ou Egresso</strong> entre os autores — orientação que virou obra.
        Barras em <strong>contagem</strong>, segmentadas pelo tipo de produção: a pergunta
        não é só "quanto", é "orientação em quê".
      </p>
      <DocenteDiscente
        dados={docDisc}
        perfil={perfil}
        destaque={destaque}
        onDestaque={setDestaque}
      />

      <h2>Pares com mais pessoas em comum</h2>
      <ParesTopo edges={topEdges} todas={edges} programas={programas} />

      <MatrizSection edges={edges} />

      <p className="chart-nota" style={{ marginTop: "1.5rem" }}>
        <strong>Limite desta medida:</strong> ela só enxerga ligação entre os 20 PPGMus da
        base. Um programa que colabora intensamente com a Educação, com as Artes Visuais ou
        com o exterior aparece aqui como fechado. A seção seguinte é a tentativa de olhar
        para fora desse recorte, com o que a base sustenta.
      </p>

      <h2>Colaboração fora dos 20 programas</h2>
      <p className="chart-nota">
        Três sinais, em ordem de confiança: quem o programa declara como{" "}
        <strong>participante externo</strong>, o <strong>país</strong> onde a obra
        aconteceu, e o <strong>idioma</strong> em que foi publicada. Nenhum deles é
        coautoria com instituição estrangeira — a base não tem a instituição de origem de
        quem vem de fora, e não adianta procurar.
      </p>
      <ForaDosVinte dados={intl} />
    </div>
  );
}

function Stat({ valor, rotulo }: { valor: string | number; rotulo: string }) {
  return (
    <div className="stat-card">
      <div className="stat-value">{valor}</div>
      <div className="stat-label">{rotulo}</div>
    </div>
  );
}

/* ------------------------------------------------------- matriz regional */

/**
 * UFs na ordem norte→sul (a mesma lógica da grade do cartograma), e não
 * alfabética: uma matriz geográfica ordenada por acaso não deixa ver bloco
 * nenhum.
 */
const ORDEM_UF = ["PA", "RN", "PB", "PE", "BA", "DF", "GO", "MG", "RJ", "SP", "PR", "SC", "RS"];

function ordemUfs(programas: Programa[]): string[] {
  const presentes = new Set(programas.map((p) => p.uf));
  const conhecidas = ORDEM_UF.filter((u) => presentes.has(u));
  // Uma UF nova na base não pode sumir da matriz só por não estar na lista.
  const restantes = [...presentes].filter((u) => !ORDEM_UF.includes(u)).sort();
  return [...conhecidas, ...restantes];
}

function MatrizRecorte({ dados, rotulos }: { dados: RedeRegioes[]; rotulos: string[] }) {
  const mapa = new Map<string, RedeRegioes>();
  for (const d of dados) {
    mapa.set(`${d.a}|${d.b}`, d);
    mapa.set(`${d.b}|${d.a}`, d);
  }
  const max = Math.max(1, ...dados.filter((d) => d.n !== null).map((d) => d.n as number));

  return (
    <div className="tabela-rolavel">
      <table className="heatmap heatmap-compacto">
        <thead>
          <tr>
            <th className="heatmap-canto" />
            {rotulos.map((r) => (
              <th key={r} className="heatmap-col">
                <span>{r}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rotulos.map((linha) => (
            <tr key={linha}>
              <th scope="row" className="heatmap-linha">
                <span>{linha}</span>
              </th>
              {rotulos.map((coluna) => {
                const cel = mapa.get(`${linha}|${coluna}`);
                if (!cel) {
                  return (
                    <td key={coluna} title={`${linha} × ${coluna}: nenhuma pessoa em comum`}>
                      —
                    </td>
                  );
                }
                if (cel.suppressed) {
                  return <td key={coluna} className="celula-suprimida" title="Suprimido: n < 5" />;
                }
                const f = (cel.n as number) / max;
                return (
                  <td
                    key={coluna}
                    style={{ background: corSequencial(f), color: tintaSobreSequencial(f) }}
                    title={`${linha} × ${coluna}: ${cel.n} pessoas em comum${linha === coluna ? " (dentro do mesmo recorte)" : ""}`}
                  >
                    {cel.n}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="chart-nota">
        Hachura = par suprimido (menos de 5 pessoas). Travessão = nenhuma pessoa em comum.
      </p>
    </div>
  );
}

/* ---------------------------------------------------- raio de colaboração */

/* Chaves de ordenação do gráfico de barras. "Com qualquer outro PPG" é a soma
   das três faixas de saída — a pergunta "quanto sai do programa" não tem uma
   faixa própria, mas é a que mais se quer ordenar. */
type ChaveOrdem =
  | "total"
  | "autoria_unica"
  | "interna"
  | "externa"
  | "mesma_uf"
  | "regional"
  | "interregional";

const ORDENS: Array<{ chave: ChaveOrdem; rotulo: string }> = [
  { chave: "interregional", rotulo: "% com PPG de outra região" },
  { chave: "regional", rotulo: "% mesma região, outra UF" },
  { chave: "mesma_uf", rotulo: "% com outro PPG da mesma UF" },
  { chave: "externa", rotulo: "% com qualquer outro PPG" },
  { chave: "interna", rotulo: "% só do próprio programa" },
  { chave: "autoria_unica", rotulo: "% de autoria única" },
  { chave: "total", rotulo: "Total de produções" },
];

function RaioColaboracao({
  perfil,
  destaque,
  onDestaque,
}: {
  perfil: PerfilPrograma[];
  destaque: string | null;
  onDestaque: (s: string | null) => void;
}) {
  const [base, setBase] = useState<"todas" | "coautorias">("todas");
  const [ordem, setOrdem] = useState<ChaveOrdem>("interregional");
  const [desc, setDesc] = useState(true);
  const comProducao = perfil.filter((p) => !p.sem_producao);

  const linhas = comProducao
    .map((p) => {
      const faixas =
        base === "todas"
          ? FAIXAS.map((f) => ({ ...f, n: p[f.chave] }))
          : FAIXAS.filter((f) => f.chave !== "autoria_unica").map((f) => ({ ...f, n: p[f.chave] }));
      const total = faixas.reduce((s, f) => s + f.n, 0);
      return { p, faixas, total };
    })
    .filter((l) => l.total > 0)
    .sort((a, b) => {
      // Ordenar por participação, não por contagem: em contagem a lista vira
      // sempre o ranking de tamanho dos programas, que já está na coluna à
      // direita e não é o que a pergunta pede.
      const valor = (l: typeof a) => {
        if (ordem === "total") return l.total;
        if (ordem === "externa") {
          const fora = (["mesma_uf", "regional", "interregional"] as const).reduce(
            (s, k) => s + (l.faixas.find((f) => f.chave === k)?.n ?? 0),
            0,
          );
          return fora / l.total;
        }
        return (l.faixas.find((f) => f.chave === ordem)?.n ?? 0) / l.total;
      };
      const d = valor(b) - valor(a);
      return desc ? d : -d;
    });

  return (
    <div>
      <div className="chart-controles">
        <div className="segmented" role="group" aria-label="Base de cálculo">
          <button type="button" className={base === "todas" ? "ativo" : ""} onClick={() => setBase("todas")} aria-pressed={base === "todas"}>
            Todas as produções
          </button>
          <button
            type="button"
            className={base === "coautorias" ? "ativo" : ""}
            onClick={() => setBase("coautorias")}
            aria-pressed={base === "coautorias"}
          >
            Só as coautorias
          </button>
        </div>
        <span className="chart-nota" style={{ margin: 0 }}>
          {base === "todas"
            ? "A maior parte da produção registrada tem um único autor — o que também é um achado."
            : "Base = produções com 2+ autores registrados; é aqui que o alcance se compara."}
        </span>
      </div>

      <div className="chart-controles">
        <label>
          Ordenar por{" "}
          <select value={ordem} onChange={(e) => setOrdem(e.target.value as ChaveOrdem)}>
            {ORDENS.filter((o) => !(base === "coautorias" && o.chave === "autoria_unica")).map(
              (o) => (
                <option key={o.chave} value={o.chave}>
                  {o.rotulo}
                </option>
              ),
            )}
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
      </div>

      <div className="barras-empilhadas">
        {linhas.map(({ p, faixas, total }) => (
          <div
            key={p.sigla}
            className={destaque === p.sigla ? "barra-linha destacada" : "barra-linha"}
            onClick={() => onDestaque(destaque === p.sigla ? null : p.sigla)}
            role="button"
            tabIndex={0}
            onKeyDown={(ev) => {
              if (ev.key === "Enter" || ev.key === " ") {
                ev.preventDefault();
                onDestaque(destaque === p.sigla ? null : p.sigla);
              }
            }}
          >
            <span className="barra-rotulo">
              <LogoPPG sigla={p.sigla} tamanho="sm" />
              {p.sigla.split("-")[0]}
            </span>
            <span className="barra-trilho">
              {faixas.map((f) => {
                const pct = (f.n / total) * 100;
                if (pct <= 0) return null;
                return (
                  <span
                    key={f.chave}
                    className="barra-segmento"
                    style={{ width: `${pct}%`, background: f.cor }}
                    title={`${p.sigla} · ${f.rotulo}: ${f.n} (${pct.toFixed(1)}%)`}
                  />
                );
              })}
            </span>
            <span className="barra-valor">{total.toLocaleString("pt-BR")}</span>
          </div>
        ))}
      </div>

      <div className="legenda">
        {(base === "todas" ? FAIXAS : FAIXAS.filter((f) => f.chave !== "autoria_unica")).map((f) => (
          <span key={f.chave} className="legenda-item">
            <span className="legenda-marca" style={{ background: f.cor }} />
            {f.rotulo}
          </span>
        ))}
      </div>

      <TabelaOrdenavel perfil={comProducao} />
    </div>
  );
}


/* -------------------------------------------------- endogenia (§4.1b.5) */

/**
 * Slope entre duas das quatro medidas de endogenia do Cap. 6 (§4.3): por
 * coautoria (já embutida no raio de colaboração — "só do próprio programa"
 * sobre as coautorias) e por projeto (nova). A terceira, endogamia acadêmica,
 * fica de fora do gráfico e desce para a tabela: quase todo valor é
 * suprimido (n < 5 pessoas), e forçá-la num terceiro eixo esparso confundiria
 * mais do que explicaria. A quarta (temática) depende do clustering da Fase 3
 * e ainda não existe.
 */
function Endogenia({
  perfil,
  endogenia,
  programas,
  destaque,
  onDestaque,
}: {
  perfil: PerfilPrograma[];
  endogenia: EndogeniaPrograma[];
  programas: Programa[];
  destaque: string | null;
  onDestaque: (s: string | null) => void;
}) {
  const regiaoDe = new Map(programas.map((p) => [p.sigla, p.regiao]));
  const porSigla = new Map(endogenia.map((e) => [e.sigla, e]));

  const linhas = perfil
    .filter((p) => p.coautoria > 0)
    .map((p) => ({
      sigla: p.sigla,
      coautoria: (p.interna / p.coautoria) * 100,
      projeto: porSigla.get(p.sigla)?.pct_endogenia_projeto ?? null,
    }))
    .filter((l): l is { sigla: string; coautoria: number; projeto: number } => l.projeto !== null)
    .sort((a, b) => b.coautoria - a.coautoria);

  const W = 560;
  const H = Math.max(320, linhas.length * 15);
  const M = { top: 30, right: 68, bottom: 12, left: 68 };
  const ih = H - M.top - M.bottom;
  const xE = M.left;
  const xD = W - M.right;
  const y = (v: number) => M.top + ih - (v / 100) * ih;

  const comDocentes = endogenia.filter((e) => e.docentes_total > 0);
  const academicasPublicas = comDocentes.filter((e) => e.pct_endogamia_academica !== null);

  return (
    <div>
      <div className="tabela-rolavel">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          style={{ width: "100%", maxWidth: W, display: "block" }}
          role="img"
          aria-label="Endogenia por coautoria e por projeto, um par de pontos por programa"
        >
          <line x1={xE} x2={xE} y1={M.top} y2={M.top + ih} stroke="var(--color-border)" />
          <line x1={xD} x2={xD} y1={M.top} y2={M.top + ih} stroke="var(--color-border)" />
          <text x={xE} y={M.top - 12} textAnchor="middle" className="eixo-rotulo">
            Por coautoria
          </text>
          <text x={xD} y={M.top - 12} textAnchor="middle" className="eixo-rotulo">
            Por projeto
          </text>
          {[0, 25, 50, 75, 100].map((t) => (
            <text key={t} x={xE - 10} y={y(t) + 4} textAnchor="end" className="eixo-rotulo">
              {t}%
            </text>
          ))}
          {linhas.map((l) => {
            const ativo = destaque === null || destaque === l.sigla;
            const cor = COR_REGIAO[regiaoDe.get(l.sigla) ?? ""] ?? "var(--color-text-muted)";
            return (
              <g
                key={l.sigla}
                opacity={ativo ? (destaque === l.sigla ? 1 : 0.55) : 0.12}
                onMouseEnter={() => onDestaque(l.sigla)}
                onMouseLeave={() => onDestaque(null)}
                style={{ cursor: "pointer" }}
              >
                <line
                  x1={xE}
                  x2={xD}
                  y1={y(l.coautoria)}
                  y2={y(l.projeto)}
                  stroke={cor}
                  strokeWidth={destaque === l.sigla ? 2.5 : 1.2}
                />
                <circle cx={xE} cy={y(l.coautoria)} r={3} fill={cor} />
                <circle cx={xD} cy={y(l.projeto)} r={3} fill={cor} />
                {destaque === l.sigla && (
                  <>
                    <text x={xE - 10} y={y(l.coautoria) + 4} textAnchor="end" className="serie-rotulo">
                      {l.sigla}
                    </text>
                    <text x={xD + 10} y={y(l.projeto) + 4} textAnchor="start" className="serie-rotulo">
                      {l.sigla}
                    </text>
                  </>
                )}
                <title>
                  {`${l.sigla}\nPor coautoria: ${l.coautoria.toFixed(0)}%\nPor projeto: ${l.projeto.toFixed(0)}%`}
                </title>
              </g>
            );
          })}
        </svg>
      </div>

      <div className="legenda">
        {REGIOES.map((r) => (
          <span key={r} className="legenda-item">
            <span className="legenda-marca" style={{ background: COR_REGIAO[r] }} />
            {r}
          </span>
        ))}
      </div>

      <p className="chart-nota">
        Cor = região. As duas medidas concordam bastante — quem fecha numa tende a fechar na
        outra —, o que é o próprio argumento da síntese: não é escolha de desenho, é o dado.
      </p>

      <details className="tabela-detalhe">
        <summary>Endogamia acadêmica (proxy) — a terceira medida, fora do gráfico</summary>
        <p className="chart-nota">
          Docentes que também aparecem como <strong>Discente</strong> ou <strong>Egresso</strong>{" "}
          no mesmo programa, em algum ano — um <strong>limite inferior</strong>, não uma taxa: só
          enxerga quem publicou nas duas fases, então quem passou pelo programa antes da base
          registrar nada, ou sem nunca ter constado como autor, não entra na contagem.
        </p>
        <p className="chart-nota">
          Numerador é contagem de pessoas: em {comDocentes.length - academicasPublicas.length} dos{" "}
          {comDocentes.length} programas com docentes na base o valor é suprimido (menos de 5
          casos) — o que já é um achado com esta medida: docência formada dentro do próprio
          programa, medida assim, é rara.
        </p>
        <div className="tabela-rolavel">
          <table className="tabela-dados">
            <thead>
              <tr>
                <th>Programa</th>
                <th className="num">Docentes</th>
                <th className="num">Formados no próprio programa</th>
              </tr>
            </thead>
            <tbody>
              {[...comDocentes]
                .sort(
                  (a, b) => (b.pct_endogamia_academica ?? -1) - (a.pct_endogamia_academica ?? -1),
                )
                .map((e) => (
                  <tr key={e.sigla}>
                    <td>
                      <RotuloPPG sigla={e.sigla} />
                    </td>
                    <td className="num">{e.docentes_total}</td>
                    {e.pct_endogamia_academica !== null ? (
                      <td className="num forte">
                        {e.docentes_formados_no_programa} ({pct(e.pct_endogamia_academica)})
                      </td>
                    ) : (
                      <td className="num celula-suprimida" title="Suprimido: n < 5 pessoas" />
                    )}
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </details>

      <p className="chart-nota">
        <strong>A quarta medida do capítulo — diversidade temática, por entropia dos clusters de
        projeto — ainda não existe.</strong> Depende do clustering da Fase 3 (§4.2), que classifica
        os 934 projetos por assunto; sem rótulo de cluster não há entropia para calcular. O painel
        completo, com as quatro medidas e o 2×2 endogenia social × diversidade temática, é a
        figura-síntese pretendida para essa fase.
      </p>
    </div>
  );
}

/* ------------------------------------- colaboração fora dos 20 (§4.1b.4) */

function ForaDosVinte({ dados }: { dados: Internacionalizacao }) {
  const [ordem, setOrdem] = useState<"pais" | "idioma" | "cobertura">("pais");

  const maxPais = Math.max(...dados.paises.map((p) => p.n_obras));
  const linhas = [...dados.programas].sort((a, b) => {
    const v = (p: (typeof dados.programas)[number]) =>
      ordem === "pais"
        ? (p.pct_intl_pais ?? -1)
        : ordem === "idioma"
          ? (p.pct_intl_idioma ?? -1)
          : (p.cobertura_pais ?? -1);
    return v(b) - v(a);
  });

  const porAno = new Map<number, { externo: number; sem: number }>();
  for (const e of dados.externos_por_ano) {
    const linha = porAno.get(e.ano_base) ?? { externo: 0, sem: 0 };
    if (e.tipo_vinculo === "Participante externo") linha.externo = e.n_obras;
    else linha.sem = e.n_obras;
    porAno.set(e.ano_base, linha);
  }
  const anos = [...porAno.keys()].sort();
  const maxAno = Math.max(...[...porAno.values()].map((v) => v.externo + v.sem));

  return (
    <div>
      <h3>Onde as obras aconteceram</h3>
      <div className="barras-empilhadas">
        {dados.paises.slice(0, 12).map((p) => (
          <div key={p.pais} className="barra-linha">
            <span className="barra-rotulo" style={{ fontStyle: p.agrupado ? "italic" : undefined }}>
              {p.pais}
            </span>
            <span className="barra-trilho">
              <span
                className="barra-segmento"
                style={{ width: `${(p.n_obras / maxPais) * 100}%`, background: "var(--seq-500)" }}
                title={`${p.pais}: ${p.n_obras} obras`}
              />
            </span>
            <span className="barra-valor">
              <span className="forte">{p.n_obras}</span>
            </span>
          </div>
        ))}
      </div>
      <p className="chart-nota">
        {dados.n_paises_distintos} países além do Brasil no quadriênio. País com menos de 5
        obras entra em "outros", contado e não nomeado. O campo é preenchido à mão e vinha
        com 139 grafias para umas 50 entidades — <code>Brasil</code>, <code>BRASIL</code>,{" "}
        <code>Brazil</code>, <code>BRAIL</code>, e também <code>Online</code>,{" "}
        <code>Porto Alegre</code> e uma data. A normalização está em{" "}
        <code>analise/paises.py</code>; o que não é país sai da conta em vez de virar
        "internacional".
      </p>

      <h3>Participação externa declarada, por ano</h3>
      <div className="barras-empilhadas">
        {anos.map((ano) => {
          const v = porAno.get(ano)!;
          return (
            <div key={ano} className="barra-linha">
              <span className="barra-rotulo">{ano}</span>
              <span className="barra-trilho">
                <span
                  className="barra-segmento"
                  style={{ width: `${(v.externo / maxAno) * 100}%`, background: "var(--seq-600)" }}
                  title={`${ano}: ${v.externo} obras com participante externo`}
                />
                <span
                  className="barra-segmento"
                  style={{ width: `${(v.sem / maxAno) * 100}%`, background: "var(--seq-300)" }}
                  title={`${ano}: ${v.sem} obras com participante sem vínculo`}
                />
              </span>
              <span className="barra-valor">
                <span className="forte">{(v.externo + v.sem).toLocaleString("pt-BR")}</span>
              </span>
            </div>
          );
        })}
      </div>
      <div className="legenda">
        <span className="legenda-item">
          <span className="legenda-marca" style={{ background: "var(--seq-600)" }} />
          Participante externo
        </span>
        <span className="legenda-item">
          <span className="legenda-marca" style={{ background: "var(--seq-300)" }} />
          Sem vínculo
        </span>
      </div>
      <p className="chart-nota">
        "Participante externo" e "sem vínculo" são rótulos do próprio programa, e é o sinal
        mais direto de gente de fora — não depende de campo livre. As duas faixas contam{" "}
        <strong>obras</strong>, não pessoas: quem aparece como "sem vínculo" não tem
        identificador na base, então não há como contar quantas pessoas distintas são.
      </p>

      <h3>Por programa</h3>
      <div className="chart-controles">
        <label>
          Ordenar por{" "}
          <select value={ordem} onChange={(e) => setOrdem(e.target.value as typeof ordem)}>
            <option value="pais">% de obras fora do Brasil</option>
            <option value="idioma">% em idioma estrangeiro</option>
            <option value="cobertura">preenchimento do campo país</option>
          </select>
        </label>
      </div>
      <div className="tabela-rolavel">
        <table className="tabela-dados">
          <thead>
            <tr>
              <th>Programa</th>
              <th className="num" title="Entre as obras com país legível">% fora do Brasil</th>
              <th className="num" title="Quantas obras do programa têm o campo país preenchido">
                (base)
              </th>
              <th className="num" title="Entre as obras com idioma identificado">
                % idioma estrangeiro
              </th>
              <th className="num">(base)</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((p) => (
              <tr key={p.sigla}>
                <td>
                  <RotuloPPG sigla={p.sigla} />
                </td>
                <td className="num forte">
                  {pct(p.pct_intl_pais)}
                </td>
                <td className="num" style={{ color: "var(--color-text-muted)" }}>
                  {p.n_com_pais} de {p.n_total}
                </td>
                <td className="num">
                  {pct(p.pct_intl_idioma)}
                </td>
                <td className="num" style={{ color: "var(--color-text-muted)" }}>
                  {p.n_com_idioma} de {p.n_total}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="chart-nota">
        <strong>Leia a coluna "(base)" antes do percentual.</strong> O campo de país só
        existe para produção artístico-cultural e é preenchido por uns e não por outros: um
        programa com 13% de cobertura tem um percentual calculado sobre um oitavo da
        produção. "0% internacional" e "campo vazio" são coisas diferentes, e sem a base ao
        lado elas se confundem.
      </p>
      <p className="chart-nota">
        <strong>Idioma é proxy fraco:</strong> publicar em inglês não é colaborar com
        estrangeiro. Ele só serve ao lado do país. Duas armadilhas resolvidas em{" "}
        <code>analise/idiomas.py</code>: <code>Idioma Nacional</code> é a categoria da
        Plataforma para português (1.255 registros) e contá-la como estrangeira era o maior
        erro possível aqui; e <code>Kaingang</code> e <code>Guarani</code> são línguas
        brasileiras — publicar nelas é diversidade linguística nacional, não
        internacionalização.
      </p>
      <p className="chart-nota">
        <strong>O que a base não tem:</strong> a instituição de origem de quem vem de fora.
        Sem isso não existe rede PPGMus ↔ instituição estrangeira — só "esta obra aconteceu
        no exterior" e "esta obra teve participante externo". Uma rede de instituições
        exigiria Lattes ou OpenAlex, e é decisão de escopo, não de código.
      </p>
    </div>
  );
}

/* ------------------------------------------------ tabela ordenável */

type ColunaTabela = {
  chave: string;
  rotulo: string;
  valor: (p: PerfilPrograma) => number | null;
  formato: (p: PerfilPrograma) => string;
  /** Numérica desce primeiro (maior no topo); texto sobe. */
  descPrimeiro: boolean;
};

const COLUNAS: ColunaTabela[] = [
  {
    chave: "sigla",
    rotulo: "Programa",
    valor: () => null,
    formato: (p) => p.sigla,
    descPrimeiro: false,
  },
  {
    chave: "producoes",
    rotulo: "Produções",
    valor: (p) => p.producoes,
    formato: (p) => p.producoes.toLocaleString("pt-BR"),
    descPrimeiro: true,
  },
  {
    chave: "coautoria",
    rotulo: "Coautorias",
    valor: (p) => razao(p.coautoria, p.producoes),
    formato: (p) => pctTexto(p.coautoria, p.producoes),
    descPrimeiro: true,
  },
  {
    chave: "interna",
    rotulo: "Só do programa",
    valor: (p) => razao(p.interna, p.coautoria),
    formato: (p) => pctTexto(p.interna, p.coautoria),
    descPrimeiro: true,
  },
  {
    chave: "mesma_uf",
    rotulo: "Mesma UF",
    valor: (p) => razao(p.mesma_uf, p.coautoria),
    formato: (p) => pctTexto(p.mesma_uf, p.coautoria),
    descPrimeiro: true,
  },
  {
    chave: "com_externo",
    rotulo: "Particip. externo",
    valor: (p) => razao(p.com_externo, p.producoes),
    formato: (p) => pctTexto(p.com_externo, p.producoes),
    descPrimeiro: true,
  },
  {
    chave: "docente_discente",
    rotulo: "Doc. + disc.",
    valor: (p) => razao(p.docente_discente, p.coautoria),
    formato: (p) => pctTexto(p.docente_discente, p.coautoria),
    descPrimeiro: true,
  },
];

function razao(n: number, base: number): number | null {
  return base > 0 ? n / base : null;
}

function TabelaOrdenavel({ perfil }: { perfil: PerfilPrograma[] }) {
  const [ordem, setOrdem] = useState<{ chave: string; desc: boolean }>({
    chave: "producoes",
    desc: true,
  });

  const coluna = COLUNAS.find((c) => c.chave === ordem.chave) ?? COLUNAS[1];

  const linhas = [...perfil].sort((a, b) => {
    if (coluna.chave === "sigla") {
      const cmp = a.sigla.localeCompare(b.sigla);
      return ordem.desc ? -cmp : cmp;
    }
    const va = coluna.valor(a);
    const vb = coluna.valor(b);
    // Célula sem base de cálculo vai sempre para o fim, nos dois sentidos: não
    // é "o menor valor", é ausência de valor.
    if (va === null && vb === null) return a.sigla.localeCompare(b.sigla);
    if (va === null) return 1;
    if (vb === null) return -1;
    return ordem.desc ? vb - va : va - vb;
  });

  function alternar(c: ColunaTabela) {
    setOrdem((atual) =>
      atual.chave === c.chave
        ? { chave: c.chave, desc: !atual.desc }
        : { chave: c.chave, desc: c.descPrimeiro },
    );
  }

  return (
    <details className="tabela-detalhe" open>
      <summary>Ver a tabela — clique num cabeçalho para ordenar</summary>
      <div className="tabela-rolavel">
        <table className="tabela-dados tabela-ordenavel">
          <thead>
            <tr>
              {COLUNAS.map((c) => {
                const ativa = ordem.chave === c.chave;
                return (
                  <th
                    key={c.chave}
                    className={c.chave === "sigla" ? "" : "num"}
                    aria-sort={ativa ? (ordem.desc ? "descending" : "ascending") : "none"}
                  >
                    <button type="button" onClick={() => alternar(c)} className={ativa ? "ativa" : ""}>
                      {c.rotulo}
                      <span className="seta" aria-hidden="true">
                        {ativa ? (ordem.desc ? "▼" : "▲") : "↕"}
                      </span>
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {linhas.map((p) => (
              <tr key={p.sigla}>
                {COLUNAS.map((c) => (
                  <td key={c.chave} className={c.chave === "sigla" ? "" : "num"}>
                    {c.chave === "sigla" ? <RotuloPPG sigla={p.sigla} /> : c.formato(p)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="chart-nota">
          "Só do programa" e "mesma UF" são as duas primeiras faixas do raio de
          colaboração; as faixas regionais estão no gráfico acima e nas matrizes. Colunas
          de alcance e "docente + discente" calculadas sobre as coautorias;
          "coautorias" e "com participante externo", sobre o total de produções.
          "Participante externo" é o vínculo registrado pelo próprio programa na Plataforma.
        </p>
      </div>
    </details>
  );
}

function pctTexto(n: number, base: number): string {
  if (base <= 0) return "—";
  return `${((n / base) * 100).toFixed(0)}%`;
}

/* -------------------------------------------------- docente + discente */

type ModoDD = "contagem" | "participacao";

function DocenteDiscente({
  dados,
  perfil,
  destaque,
  onDestaque,
}: {
  dados: CoautoriaDocDisc[];
  perfil: PerfilPrograma[];
  destaque: string | null;
  onDestaque: (s: string | null) => void;
}) {
  const [modo, setModo] = useState<ModoDD>("contagem");

  // Mesmas 8 categorias + OUTROS do capítulo de regimes, e pela mesma razão:
  // a nona categoria não ganha matiz novo. Derivadas do volume conjunto, para
  // a legenda deste gráfico falar dos tipos que ele realmente mostra.
  const categorias = useMemo(
    () =>
      categoriasPrincipais(
        dados.map((d) => ({
          sigla: d.sigla,
          ano_base: 0,
          tipo: d.tipo,
          subtipo: d.subtipo,
          n: d.n_conjunta,
        })),
      ),
    [dados],
  );

  const porPrograma = useMemo(() => {
    const m = new Map<string, Map<string, number>>();
    for (const d of dados) {
      if (d.n_conjunta <= 0) continue;
      const bruto = d.subtipo || d.tipo;
      const cat = categorias.includes(bruto) ? bruto : OUTROS;
      if (!m.has(d.sigla)) m.set(d.sigla, new Map());
      const linha = m.get(d.sigla)!;
      linha.set(cat, (linha.get(cat) ?? 0) + d.n_conjunta);
    }
    return m;
  }, [dados, categorias]);

  const porSiglaPerfil = new Map(perfil.map((p) => [p.sigla, p]));

  const linhas = [...porPrograma.entries()]
    .map(([sigla, cats]) => {
      const total = [...cats.values()].reduce((s, v) => s + v, 0);
      const p = porSiglaPerfil.get(sigla);
      return {
        sigla,
        cats,
        total,
        pctCoautoria: p && p.coautoria > 0 ? (total / p.coautoria) * 100 : 0,
        pctTotal: p && p.producoes > 0 ? (total / p.producoes) * 100 : 0,
      };
    })
    .sort((a, b) => (modo === "contagem" ? b.total - a.total : b.pctCoautoria - a.pctCoautoria));

  const maxTotal = Math.max(1, ...linhas.map((l) => l.total));

  /* Programa sem nenhuma obra conjunta não pode sumir da lista: sumindo, o
     leitor conta 19 barras e não sabe que faltou alguém. Regra do CLAUDE.md —
     toda ausência precisa de explicação visível. */
  const semObras = perfil
    .map((p) => p.sigla)
    .filter((sigla) => !porPrograma.has(sigla))
    .sort();

  return (
    <div>
      <div className="chart-controles">
        <div className="segmented" role="group" aria-label="Escala">
          <button
            type="button"
            className={modo === "contagem" ? "ativo" : ""}
            onClick={() => setModo("contagem")}
            aria-pressed={modo === "contagem"}
          >
            Contagem
          </button>
          <button
            type="button"
            className={modo === "participacao" ? "ativo" : ""}
            onClick={() => setModo("participacao")}
            aria-pressed={modo === "participacao"}
          >
            Composição (100%)
          </button>
        </div>
        <span className="chart-nota" style={{ margin: 0 }}>
          {modo === "contagem"
            ? "Quantas obras orientadas cada programa registrou — comprimento comparável entre programas."
            : "Só a mistura de tipos dentro da produção orientada, sem o efeito de tamanho."}
        </span>
      </div>

      <div className="barras-cabecalho" aria-hidden="true">
        <span>Programa</span>
        <span>Obras docente + discente, por tipo</span>
        <span className="barra-valor">
          <span>obras</span>
          <span>% das coautorias</span>
          <span>% de tudo</span>
        </span>
      </div>

      <div className="barras-empilhadas">
        {linhas.map(({ sigla, cats, total, pctCoautoria, pctTotal }) => (
          <div
            key={sigla}
            className={destaque === sigla ? "barra-linha destacada" : "barra-linha"}
            onClick={() => onDestaque(destaque === sigla ? null : sigla)}
            role="button"
            tabIndex={0}
            onKeyDown={(ev) => {
              if (ev.key === "Enter" || ev.key === " ") {
                ev.preventDefault();
                onDestaque(destaque === sigla ? null : sigla);
              }
            }}
          >
            <span className="barra-rotulo">
              <LogoPPG sigla={sigla} tamanho="sm" />
              {sigla.split("-")[0]}
            </span>
            <span className="barra-trilho">
              {/* No modo contagem a barra ocupa só a fração do maior programa;
                  no modo 100% ela preenche a linha inteira. */}
              <span
                className="barra-grupo"
                style={{ width: modo === "contagem" ? `${(total / maxTotal) * 100}%` : "100%" }}
              >
                {categorias.map((c) => {
                  const n = cats.get(c) ?? 0;
                  if (n <= 0) return null;
                  return (
                    <span
                      key={c}
                      className="barra-segmento"
                      style={{
                        width: `${(n / total) * 100}%`,
                        background: corDaCategoria(c, categorias),
                      }}
                      title={`${sigla} · ${c === OUTROS ? "Outros tipos" : c}: ${n} obras docente+discente`}
                    />
                  );
                })}
              </span>
            </span>
            <span className="barra-valor">
              <span className="forte">{total.toLocaleString("pt-BR")}</span>
              <span>{pctCoautoria.toFixed(0)}%</span>
              <span>{pctTotal.toFixed(0)}%</span>
            </span>
          </div>
        ))}
        {semObras.map((sigla) => (
          <div key={sigla} className="barra-linha vazia">
            <span className="barra-rotulo">
              <LogoPPG sigla={sigla} tamanho="sm" />
              {sigla}
            </span>
            <span className="barra-ausente">nenhuma produção registrada na Plataforma</span>
            <span className="barra-valor">
              <span className="forte">0</span>
              <span>—</span>
              <span>—</span>
            </span>
          </div>
        ))}
      </div>

      <div className="legenda">
        {categorias.map((c) => (
          <span key={c} className="legenda-item">
            <span className="legenda-marca" style={{ background: corDaCategoria(c, categorias) }} />
            {c === OUTROS ? "Outros tipos" : c}
          </span>
        ))}
      </div>

      <p className="chart-nota">
        As três colunas à direita, na ordem: <strong>obras</strong> com pelo menos um docente
        e pelo menos um discente/egresso; que fração elas são das{" "}
        <strong>coautorias</strong> do programa (produções com 2+ autores); e que fração são
        de <strong>toda</strong> a produção dele. O segundo número é sempre bem maior que o
        terceiro porque a maioria dos registros tem um autor só — e trabalho de autor único
        não pode ser coautoria docente+discente. Quadriênio 2021–2024.
      </p>
      <p className="chart-nota">
        <strong>UFG e UEPA são casos à parte.</strong> A UFG não tem nenhuma produção na
        Plataforma — nenhum ano, nenhuma coleção; é programa em implantação, ainda sem nota,
        e a coleta não registrou falha para ele: a ausência é da fonte. A UEPA só tem dados
        de <strong>2024</strong> (176 produções, nenhuma em 2021–2023), o que também
        explica o número muito baixo aqui.
      </p>
    </div>
  );
}

/* --------------------------------------------------------- tabelas antigas */

type VisaoPares = "tabela" | "sankey";

function ParesTopo({
  edges,
  todas,
  programas,
}: {
  edges: Array<{ a: string; b: string; n: number | null }>;
  todas: RedeEdge[];
  programas: Programa[];
}) {
  const [visao, setVisao] = useState<VisaoPares>("sankey");
  const [escopo, setEscopo] = useState<"topo" | "todos">("todos");

  const publicaveis = todas.filter((e) => !e.suppressed && e.n !== null);
  const mostradas = escopo === "topo" ? edges : publicaveis;

  return (
    <div>
      <div className="chart-controles">
        <div className="segmented" role="group" aria-label="Formato">
          <button
            type="button"
            className={visao === "sankey" ? "ativo" : ""}
            onClick={() => setVisao("sankey")}
            aria-pressed={visao === "sankey"}
          >
            Sankey
          </button>
          <button
            type="button"
            className={visao === "tabela" ? "ativo" : ""}
            onClick={() => setVisao("tabela")}
            aria-pressed={visao === "tabela"}
          >
            Tabela
          </button>
        </div>
        <div className="segmented" role="group" aria-label="Quantidade de pares">
          <button
            type="button"
            className={escopo === "todos" ? "ativo" : ""}
            onClick={() => setEscopo("todos")}
            aria-pressed={escopo === "todos"}
          >
            Todos os pares ({publicaveis.length})
          </button>
          <button
            type="button"
            className={escopo === "topo" ? "ativo" : ""}
            onClick={() => setEscopo("topo")}
            aria-pressed={escopo === "topo"}
          >
            15 mais fortes
          </button>
        </div>
      </div>
      {visao === "sankey" ? (
        <SankeyPares edges={mostradas} programas={programas} />
      ) : (
        <EdgeTable edges={mostradas} />
      )}
    </div>
  );
}

/**
 * Sankey dos pares mais fortes. Um Sankey pede origem e destino, e aqui a
 * relação é simétrica — "pessoas em comum" não tem direção. A convenção
 * adotada: à esquerda o programa que aparece primeiro no par ordenado por
 * volume total, à direita o outro. Um programa pode aparecer dos dois lados;
 * isso é propriedade do dado, não defeito do desenho, e está dito na legenda.
 */
function SankeyPares({
  edges,
  programas,
}: {
  edges: Array<{ a: string; b: string; n: number | null }>;
  programas: Programa[];
}) {
  const regiaoDe = new Map(programas.map((p) => [p.sigla, p.regiao]));

  const validas = edges.filter((e) => e.n !== null) as Array<{ a: string; b: string; n: number }>;

  // Total por programa decide de que lado ele fica: o mais "central" à esquerda.
  const total = new Map<string, number>();
  for (const e of validas) {
    total.set(e.a, (total.get(e.a) ?? 0) + e.n);
    total.set(e.b, (total.get(e.b) ?? 0) + e.n);
  }
  const fluxos = validas.map((e) => {
    const esquerda = (total.get(e.a) ?? 0) >= (total.get(e.b) ?? 0) ? e.a : e.b;
    const direita = esquerda === e.a ? e.b : e.a;
    return { esquerda, direita, n: e.n };
  });

  const somaLado = (lado: "esquerda" | "direita") => {
    const m = new Map<string, number>();
    for (const f of fluxos) m.set(f[lado], (m.get(f[lado]) ?? 0) + f.n);
    return [...m.entries()].sort((x, y) => y[1] - x[1]);
  };
  const esquerdos = somaLado("esquerda");
  const direitos = somaLado("direita");

  const W = 720;
  const M = { top: 16, bottom: 16, esquerda: 92, direita: 92 };
  const GAP = 8;
  const LARGURA_NO = 12;
  const somaTotal = fluxos.reduce((s, f) => s + f.n, 0);

  const alturaLado = (lista: Array<[string, number]>) =>
    lista.reduce((s, [, v]) => s + v, 0);
  const maiorLado = Math.max(alturaLado(esquerdos), alturaLado(direitos));
  const maisNos = Math.max(esquerdos.length, direitos.length);
  // Com 61 pares a altura fixa esmagava as faixas finas a menos de 1 px.
  const ALTURA_UTIL = Math.max(360, Math.min(900, fluxos.length * 16));
  const escala = ALTURA_UTIL / maiorLado;
  const H = ALTURA_UTIL + (maisNos - 1) * GAP + M.top + M.bottom;

  function posicionar(lista: Array<[string, number]>) {
    const out = new Map<string, { y0: number; y1: number; usado: number }>();
    let y = M.top;
    for (const [sigla, v] of lista) {
      const h = v * escala;
      out.set(sigla, { y0: y, y1: y + h, usado: 0 });
      y += h + GAP;
    }
    return out;
  }
  const posE = posicionar(esquerdos);
  const posD = posicionar(direitos);

  const xE = M.esquerda;
  const xD = W - M.direita - LARGURA_NO;

  const ordenados = [...fluxos].sort((a, b) => b.n - a.n);

  return (
    <div className="tabela-rolavel">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: "100%", maxWidth: W, display: "block" }}
        role="img"
        aria-label="Diagrama de Sankey dos pares de programas com mais pessoas em comum"
      >
        {ordenados.map((f, i) => {
          const e = posE.get(f.esquerda)!;
          const d = posD.get(f.direita)!;
          const h = f.n * escala;
          const y0 = e.y0 + e.usado;
          const y1 = d.y0 + d.usado;
          e.usado += h;
          d.usado += h;
          const x0 = xE + LARGURA_NO;
          const x1 = xD;
          const meio = (x0 + x1) / 2;
          const caminho = [
            `M${x0},${y0}`,
            `C${meio},${y0} ${meio},${y1} ${x1},${y1}`,
            `L${x1},${y1 + h}`,
            `C${meio},${y1 + h} ${meio},${y0 + h} ${x0},${y0 + h}`,
            "Z",
          ].join(" ");
          return (
            <path
              key={i}
              d={caminho}
              fill={COR_REGIAO[regiaoDe.get(f.esquerda) ?? ""] ?? "var(--color-text-muted)"}
              opacity={0.35}
              className="sankey-fluxo"
            >
              <title>{`${f.esquerda} × ${f.direita}: ${f.n} pessoas em comum`}</title>
            </path>
          );
        })}

        {[
          { lista: esquerdos, pos: posE, x: xE, ancora: "end" as const, dx: -8 },
          { lista: direitos, pos: posD, x: xD, ancora: "start" as const, dx: LARGURA_NO + 8 },
        ].map(({ lista, pos, x, ancora, dx }) =>
          lista.map(([sigla, v]) => {
            const p = pos.get(sigla)!;
            return (
              <g key={`${x}-${sigla}`}>
                <rect
                  x={x}
                  y={p.y0}
                  width={LARGURA_NO}
                  height={Math.max(2, p.y1 - p.y0)}
                  rx={2}
                  fill={COR_REGIAO[regiaoDe.get(sigla) ?? ""] ?? "var(--color-text-muted)"}
                >
                  <title>{`${sigla}: ${v} pessoas em comum nos pares mostrados`}</title>
                </rect>
                <text
                  x={x + dx}
                  y={(p.y0 + p.y1) / 2 + 4}
                  textAnchor={ancora}
                  className="sankey-rotulo"
                >
                  {sigla}
                </text>
              </g>
            );
          }),
        )}
      </svg>
      <p className="chart-nota">
        Espessura da faixa = pessoas que publicam nos dois programas; cor = região do
        programa da esquerda. {fluxos.length} pares, {somaTotal} vínculos de pessoa. A
        relação é <strong>simétrica</strong> — não há origem nem destino: o lado esquerdo
        recebe o programa de maior volume no par, só para o diagrama ter dois lados. Por
        isso o mesmo programa pode aparecer nos dois lados.
      </p>
      <p className="chart-nota">
        <strong>Isto não é coautoria.</strong> A faixa conta pessoas que aparecem como
        autoras nos dois programas — inclusive quem tem vínculo formal duplo e publica
        sempre sozinha. Na base, <strong>11 das 416</strong> pessoas em mais de um programa
        nunca assinaram uma obra com outra pessoa: o vínculo delas é só cadastral. Para a
        medida que <em>exige</em> coautoria — obra com 2+ autores, um deles atuando no
        outro programa — use o cartograma no alto da página, que é medido em obras.
      </p>
    </div>
  );
}

function EdgeTable({ edges }: { edges: Array<{ a: string; b: string; n: number | null }> }) {
  return (
    <div className="tabela-rolavel">
      <table className="tabela-dados" style={{ maxWidth: 500 }}>
        <thead>
          <tr>
            <th>Programa A</th>
            <th>Programa B</th>
            <th className="num">Pessoas em comum</th>
          </tr>
        </thead>
        <tbody>
          {edges.map((e, i) => (
            <tr key={i}>
              <td>
                <RotuloPPG sigla={e.a} />
              </td>
              <td>
                <RotuloPPG sigla={e.b} />
              </td>
              <td className="num forte">{e.n}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MatrizSection({ edges }: { edges: RedeProgramas["edges"] }) {
  const siglas = Array.from(new Set(edges.flatMap((e) => [e.a, e.b]))).sort();

  const lookup = new Map<string, { n: number | null; suppressed: boolean }>();
  for (const e of edges) {
    lookup.set(`${e.a}|${e.b}`, { n: e.n, suppressed: e.suppressed });
    lookup.set(`${e.b}|${e.a}`, { n: e.n, suppressed: e.suppressed });
  }

  const maxN = Math.max(1, ...edges.filter((e) => !e.suppressed).map((e) => e.n ?? 0));

  return (
    <details className="tabela-detalhe">
      <summary>Ver a matriz completa, 20 × 20</summary>
      <div className="tabela-rolavel">
        <table className="heatmap">
          <thead>
            <tr>
              <th className="heatmap-canto" />
              {siglas.map((s) => (
                <th key={s} className="heatmap-col">
                  <span>{s}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {siglas.map((linha) => (
              <tr key={linha}>
                <th scope="row" className="heatmap-linha">
                  <LogoPPG sigla={linha} tamanho="sm" />
                  <span>{linha}</span>
                </th>
                {siglas.map((coluna) => {
                  if (linha === coluna) return <td key={coluna} className="celula-diagonal" />;
                  const cel = lookup.get(`${linha}|${coluna}`);
                  if (!cel || cel.n === null) {
                    return cel?.suppressed ? (
                      <td key={coluna} className="celula-suprimida" title="Suprimido: n < 5" />
                    ) : (
                      <td key={coluna} title={`${linha} × ${coluna}: 0`} />
                    );
                  }
                  const f = cel.n / maxN;
                  return (
                    <td
                      key={coluna}
                      style={{ background: corSequencial(f), color: tintaSobreSequencial(f) }}
                      title={`${linha} × ${coluna}: ${cel.n} pessoas`}
                    >
                      {cel.n}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
