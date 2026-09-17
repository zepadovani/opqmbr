import { useEffect, useState } from "react";
import { RotuloPPG } from "../componentes/LogoPPG";
import { loadProjetos } from "../dados/loaders";
import type { EsferaFomento, Projetos, ProjetosPrograma } from "../dados/tipos";
import { pct, pctDe } from "../dados/formato";

/**
 * Projetos e financiamento (PLANO §4.1b.2 e §4.1b.3).
 *
 * Duas perguntas: quanto da produção está amarrada a um projeto — indicador de
 * preenchimento antes de ser de pesquisa — e de onde vem o dinheiro.
 *
 * O corte por **esfera** (federal / estadual / própria IES / internacional) é o
 * que a base sustenta sem limpeza. O par projeto↔agência não é publicado (§3.2),
 * e nome de projeto não existe em nenhum JSON público.
 */
export default function ProjetosFinanciamento() {
  const [dados, setDados] = useState<Projetos | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadProjetos()
      .then(setDados)
      .catch((e: unknown) => setError(String(e)));
  }, []);

  if (error) return <div className="error">Erro ao carregar dados: {error}</div>;
  if (!dados) return <div className="loading">Carregando…</div>;

  const pctFinanciados = (dados.n_financiados / dados.n_projetos) * 100;
  const orfaos = dados.distribuicao_producoes.find((f) => f.faixa === "0")?.n_projetos ?? 0;

  return (
    <div>
      <h1>Projetos e financiamento</h1>
      <p className="page-subtitle">
        Os {dados.n_projetos} projetos de pesquisa declarados pelos programas: quantos têm
        financiamento registrado, de que esfera ele vem, e quanto da produção está de fato
        amarrada a um projeto.
      </p>

      <div className="headline-stats">
        <Stat valor={dados.n_projetos.toLocaleString("pt-BR")} rotulo="projetos declarados" />
        <Stat
          valor={`${pct(pctFinanciados, 0)}`}
          rotulo={`com financiador registrado (${dados.n_financiados})`}
        />
        <Stat valor={orfaos.toLocaleString("pt-BR")} rotulo="projetos sem nenhuma produção vinculada" />
        <Stat
          valor={String(dados.agencias.filter((a) => a.n_projetos !== null).length)}
          rotulo="agências com 5+ projetos"
        />
      </div>

      <h2>De onde vem o financiamento</h2>
      <p className="chart-nota">
        <strong>CAPES e CNPq respondem por quase tudo.</strong> A leitura possível aqui é
        por <em>esfera</em> e por agência, não por valor: a Plataforma registra quem
        financia, nunca quanto.
      </p>
      <Agencias dados={dados} />

      <h2>Cada programa e as suas fontes</h2>
      <TabelaProgramas dados={dados} />

      <h2>Projetos silenciosos e projetos produtivos</h2>
      <p className="chart-nota">
        Quantas produções cada projeto tem vinculadas. A cauda é pesada — poucos projetos
        concentram muita produção — e o primeiro grupo merece cuidado na leitura.
      </p>
      <Distribuicao dados={dados} />

      <h2>Natureza declarada</h2>
      <div className="tabela-rolavel">
        <table className="tabela-dados">
          <thead>
            <tr>
              <th>Natureza</th>
              <th className="num">Projetos</th>
              <th className="num">%</th>
            </tr>
          </thead>
          <tbody>
            {dados.naturezas.map((n) => (
              <tr key={n.natureza}>
                <td>{n.natureza}</td>
                <td className="num">{n.n.toLocaleString("pt-BR")}</td>
                <td className="num">{pctDe(n.n, dados.n_projetos)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>O que este capítulo não mede</h2>
      <ul style={{ fontSize: "0.875rem", lineHeight: 1.8, color: "var(--color-text-muted)" }}>
        <li>
          <strong>Valor.</strong> A Plataforma registra a agência, não a quantia. "Mais
          projetos financiados" não é "mais dinheiro" — uma bolsa de iniciação científica e
          um auxílio temático contam igual aqui.
        </li>
        <li>
          <strong>Qual projeto recebeu de quem.</strong> O par projeto↔agência não é
          publicado: com o nome do projeto, ele apontaria para o coordenador. O que sai é
          o agregado por programa e por agência.
        </li>
        <li>
          <strong>Financiamento que não foi declarado.</strong> Projeto sem financiador na
          base pode ser projeto sem financiamento ou campo não preenchido, e não há como
          distinguir os dois.
        </li>
        <li>
          <strong>A soma por agência é maior que o total.</strong> Um projeto com duas
          agências conta nas duas — são fontes distintas, e somá-las não daria o número de
          projetos.
        </li>
      </ul>
    </div>
  );
}

function Stat({ valor, rotulo }: { valor: string; rotulo: string }) {
  return (
    <div className="stat-card">
      <div className="stat-value">{valor}</div>
      <div className="stat-label">{rotulo}</div>
    </div>
  );
}

/* A esfera é ordinal na leitura — de "longe" (federal) a "de casa" (a própria
   IES) —, então rampa sequencial em vez de quatro matizes independentes. */
const COR_ESFERA: Record<EsferaFomento, string> = {
  federal: "var(--seq-600)",
  estadual: "var(--seq-400)",
  propria_ies: "var(--seq-200)",
  internacional: "var(--serie-2)",
  outra: "var(--color-suppressed)",
};

function Agencias({ dados }: { dados: Projetos }) {
  const max = Math.max(...dados.agencias.map((a) => a.n_projetos ?? 0));
  const rotulo = new Map(dados.esferas.map((e) => [e.chave, e.rotulo]));

  return (
    <div>
      <div className="barras-empilhadas">
        {dados.agencias.map((a) => (
          <div key={a.agencia} className="barra-linha">
            <span className="barra-rotulo">{a.agencia}</span>
            <span className="barra-trilho">
              <span
                className="barra-segmento"
                style={{
                  width: a.n_projetos === null ? "3px" : `${(a.n_projetos / max) * 100}%`,
                  background: a.n_projetos === null ? "var(--color-suppressed)" : COR_ESFERA[a.esfera],
                }}
                title={
                  a.n_projetos === null
                    ? `${a.agencia} — ${rotulo.get(a.esfera) ?? a.esfera}: menos de 5 projetos, nº suprimido`
                    : `${a.agencia} — ${rotulo.get(a.esfera) ?? a.esfera}: ${a.n_projetos} projetos`
                }
              />
            </span>
            <span className="barra-valor">
              <span className="forte">{a.n_projetos ?? "—"}</span>
            </span>
          </div>
        ))}
      </div>
      <div className="legenda">
        {dados.esferas
          .filter((e) => e.chave !== "outra")
          .map((e) => (
            <span key={e.chave} className="legenda-item">
              <span className="legenda-marca" style={{ background: COR_ESFERA[e.chave] }} />
              {e.rotulo}
            </span>
          ))}
      </div>
      <p className="chart-nota">
        Toda agência identificada aparece pelo nome — nenhuma some numa categoria "outras".
        O que é suprimido é só a contagem: agência com menos de 5 projetos mostra "—" em vez
        do número, porque um financiamento único e exótico é quase uma assinatura de quem o
        recebeu.
      </p>
      <p className="chart-nota">
        O nome da agência vem <strong>colado</strong> ao do programa de fomento, sem
        separador (<code>CONS NAC DE DESENVOLVIMENTO…BOLSA de Iniciação Científica</code>).
        A identificação é por prefixo, contra uma lista versionada em{" "}
        <code>analise/agencias.py</code>; os 595 registros da base foram todos
        identificados, e o que não casar no futuro aparece como "Não identificada" em vez
        de sumir.
      </p>
    </div>
  );
}

type ChaveOrdem = "n_projetos" | "pct_financiados" | "pct_orfaos" | "pct_producao_com_projeto";

const COLUNAS: Array<{ chave: ChaveOrdem; rotulo: string; dica: string }> = [
  { chave: "n_projetos", rotulo: "Projetos", dica: "Projetos declarados pelo programa, em qualquer ano" },
  { chave: "pct_financiados", rotulo: "% com fomento", dica: "Projetos com ao menos uma agência registrada" },
  { chave: "pct_orfaos", rotulo: "% órfãos", dica: "Projetos sem nenhuma produção vinculada" },
  {
    chave: "pct_producao_com_projeto",
    rotulo: "% da produção com projeto",
    dica: "Produções do quadriênio que apontam para algum projeto — indicador de preenchimento",
  },
];

function TabelaProgramas({ dados }: { dados: Projetos }) {
  const [ordem, setOrdem] = useState<ChaveOrdem>("pct_financiados");
  const [desc, setDesc] = useState(true);

  const linhas = dados.programas
    .filter((p) => p.n_projetos > 0)
    .sort((a, b) => {
      const d = (b[ordem] ?? -1) - (a[ordem] ?? -1);
      return desc ? d : -d;
    });

  const semProjeto = dados.programas.filter((p) => p.n_projetos === 0).map((p) => p.sigla);

  return (
    <div>
      <div className="chart-controles">
        <label>
          Ordenar por{" "}
          <select value={ordem} onChange={(e) => setOrdem(e.target.value as ChaveOrdem)}>
            {COLUNAS.map((c) => (
              <option key={c.chave} value={c.chave}>
                {c.rotulo}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="chip ativo" onClick={() => setDesc((d) => !d)}>
          {desc ? "▼ maior primeiro" : "▲ menor primeiro"}
        </button>
      </div>

      <div className="tabela-rolavel">
        <table className="tabela-dados">
          <thead>
            <tr>
              <th>Programa</th>
              {COLUNAS.map((c) => (
                <th key={c.chave} className="num" title={c.dica}>
                  {c.rotulo}
                </th>
              ))}
              {dados.esferas
                .filter((e) => e.chave !== "outra")
                .map((e) => (
                  <th key={e.chave} className="num" title={`Projetos com fomento ${e.rotulo}`}>
                    {e.rotulo}
                  </th>
                ))}
            </tr>
          </thead>
          <tbody>
            {linhas.map((p) => (
              <tr key={p.sigla}>
                <td>
                  <RotuloPPG sigla={p.sigla} />
                </td>
                <td className="num forte">{p.n_projetos}</td>
                <td className="num">{pct(p.pct_financiados, 0)}</td>
                <td className="num">{pct(p.pct_orfaos, 0)}</td>
                <td className="num">{pct(p.pct_producao_com_projeto, 0)}</td>
                {dados.esferas
                  .filter((e) => e.chave !== "outra")
                  .map((e) => {
                    const v = p[`esfera_${e.chave}` as keyof ProjetosPrograma] as number | null;
                    return v === null ? (
                      <td
                        key={e.chave}
                        className="num celula-suprimida"
                        title="suprimido: menos de 5 projetos"
                      />
                    ) : (
                      <td key={e.chave} className="num">
                        {v}
                      </td>
                    );
                  })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="chart-nota">
        Célula hachurada = menos de 5 projetos naquela esfera, suprimida pela regra do
        n &lt; 5. Não é zero.
        {semProjeto.length > 0 && ` Sem projeto declarado: ${semProjeto.join(", ")}.`} As
        colunas de esfera não somam a coluna de projetos: um projeto com duas agências
        aparece nas duas esferas.
      </p>
      <p className="chart-nota">
        <strong>"% da produção com projeto" é indicador de preenchimento.</strong> Ele diz
        quanto do que o programa registrou aponta para um projeto — não diz que a pesquisa
        restante foi feita sem projeto.
      </p>
    </div>
  );
}

function Distribuicao({ dados }: { dados: Projetos }) {
  const total = dados.distribuicao_producoes.reduce((s, f) => s + f.n_projetos, 0);
  const max = Math.max(...dados.distribuicao_producoes.map((f) => f.n_projetos));

  const NOTA: Record<string, string> = {
    "0": "Órfãos: nenhuma produção aponta para eles",
    "1–4": "Poucas produções vinculadas",
    "5–19": "Faixa mais comum",
    "20+": "Concentram a maior parte da produção vinculada",
  };

  return (
    <div>
      <div className="barras-empilhadas">
        {dados.distribuicao_producoes.map((f) => (
          <div key={f.faixa} className="barra-linha">
            <span className="barra-rotulo">{f.faixa} produções</span>
            <span className="barra-trilho">
              <span
                className="barra-segmento"
                style={{
                  width: `${(f.n_projetos / max) * 100}%`,
                  background: f.faixa === "0" ? "var(--color-suppressed)" : "var(--seq-500)",
                }}
                title={`${f.n_projetos} projetos (${pctDe(f.n_projetos, total)}) — ${NOTA[f.faixa]}`}
              />
            </span>
            <span className="barra-valor">
              <span className="forte">{f.n_projetos}</span>
              <span>{pctDe(f.n_projetos, total, 0)}</span>
            </span>
          </div>
        ))}
      </div>
      <p className="chart-nota">
        <strong>Projeto órfão não é projeto fracassado.</strong> Pode ser projeto recém-
        começado, projeto cuja produção foi registrada sem o vínculo, ou projeto que de
        fato não gerou registro. A base não distingue os três, e a taxa varia demais entre
        programas para ser lida como produtividade.
      </p>
    </div>
  );
}
