import { useEffect, useState } from "react";
import { loadCobertura } from "../dados/loaders";
import type { Cobertura } from "../dados/tipos";
import { pct, pctDe } from "../dados/formato";

/**
 * Apêndice de dados.
 *
 * Os números vêm de `cobertura.json`, gerado no build a partir do banco e dos
 * CSVs de falha — não são prosa fixa. Um apêndice com contagens digitadas à mão
 * envelhece em silêncio: seria o único lugar do site que continuaria dizendo
 * "19 programas" depois de a UNICAMP entrar na base.
 */
export default function AppendicesDados() {
  const [dados, setDados] = useState<Cobertura | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadCobertura()
      .then(setDados)
      .catch((e: unknown) => setError(String(e)));
  }, []);

  if (error) return <div className="error">Erro ao carregar dados: {error}</div>;
  if (!dados) return <div className="loading">Carregando…</div>;

  const nProgramas = dados.contagens.find((c) => c.tabela === "programas")?.n ?? 0;
  const nProducoes = dados.contagens.find((c) => c.tabela === "producoes")?.n ?? 0;
  const totalFalhas = dados.falhas.reduce((s, f) => s + f.n, 0);
  const nucleo = dados.quadrienio.por_classe.find((c) => c.chave === "nucleo")?.n ?? 0;
  const totalQuadrienio = dados.quadrienio.por_classe.reduce((s, c) => s + c.n, 0);

  const br = (n: number) => n.toLocaleString("pt-BR");

  return (
    <div>
      <h1>Apêndice de dados</h1>
      <p className="page-subtitle">
        Cobertura, limitações conhecidas e ressalvas metodológicas. Os números desta página
        são lidos da própria base a cada build.
      </p>

      <Section title="A ressalva que atravessa o site inteiro">
        <p>
          <strong>
            Boa parte da variação entre programas é prática de preenchimento, não prática de
            pesquisa.
          </strong>{" "}
          A Plataforma registra sob o mesmo rótulo "produção" tanto um artigo em periódico
          quanto um relatório anual de atividades, e programas diferentes usam esse espaço
          de formas muito diferentes. No quadriênio {dados.quadrienio.periodo[0]}–
          {dados.quadrienio.periodo[1]}, das {br(totalQuadrienio)} produções registradas,{" "}
          <strong>{br(nucleo)}</strong> ({pctDe(nucleo, totalQuadrienio, 0)})
          estão no núcleo comparável — artigo, livro, anais, partitura, tradução e produção
          artístico-cultural. O resto é difusão, serviço e gestão, e a proporção varia de
          39% a 83% entre os programas.
        </p>
        <p>
          Além disso, {br(dados.quadrienio.administrativos)} registros do quadriênio são{" "}
          <strong>títulos de rotina administrativa</strong> (relatório anual de atividades,
          parecer ad hoc, participação em comissão) lançados como produção. A regra que os
          identifica é fixa e versionada em <code>analise/nucleo.py</code>.
        </p>
        <p>
          Antes de ler qualquer barra de tamanho deste site, veja o painel "Antes de
          comparar volume" em <a href="/regimes">Regimes de produção</a>.
        </p>
      </Section>

      <Section title="Escopo da base">
        <p>
          {nProgramas} programas <strong>acadêmicos</strong> de pós-graduação em Música
          vinculados à área de avaliação ARTES da CAPES, com dados de{" "}
          {dados.anos.primeiro}–{dados.anos.ultimo}. Coleta via API pública da Plataforma
          Sucupira (sem automação de browser).
        </p>
        <p>
          <strong>Lacuna de cobertura, declarada:</strong> os programas abaixo aparecem na
          Avaliação Quadrienal 2025 com nome de Música ou de prática musical e{" "}
          <strong>não estão na base</strong>. Todos são de modalidade profissional (MP/DP) —
          exclusão defensável, desde que dita em voz alta.
        </p>
        <div className="tabela-rolavel">
          <table className="tabela-dados">
            <thead>
              <tr>
                <th>IES</th>
                <th>Programa</th>
                <th>Nível</th>
                <th className="num">Nota 2025</th>
                <th>Código</th>
              </tr>
            </thead>
            <tbody>
              {dados.fora_da_base.map((p) => (
                <tr key={p.codigo_programa}>
                  <td>{p.sigla_ies}</td>
                  <td>{p.nome_programa}</td>
                  <td>{p.nivel}</td>
                  <td className="num">{p.nota_final}</td>
                  <td>
                    <code>{p.codigo_programa}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Cobertura da coleta">
        <div className="tabela-rolavel">
          <table className="tabela-dados">
            <thead>
              <tr>
                <th>Tabela</th>
                <th className="num">Registros</th>
              </tr>
            </thead>
            <tbody>
              {dados.contagens.map((c) => (
                <tr key={c.tabela}>
                  <td>
                    {c.rotulo} <code className="tabela-nome">({c.tabela})</code>
                  </td>
                  <td className="num">{br(c.n)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Preenchimento dos campos">
        <p>
          Antes de ler um valor baixo como ausência do fenômeno, confira quantas produções
          têm o campo preenchido. Base: {br(nProducoes)} produções.
        </p>
        <div className="tabela-rolavel">
          <table className="tabela-dados">
            <thead>
              <tr>
                <th>Campo</th>
                <th className="num">Produções com o campo</th>
                <th className="num">% da base</th>
              </tr>
            </thead>
            <tbody>
              {dados.campos.map((c) => (
                <tr key={c.campo}>
                  <td>{c.campo}</td>
                  <td className="num">{br(c.n)}</td>
                  <td className="num">{pct(c.pct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>
          O campo <strong>(PAC) País</strong> só existe para produção artístico-cultural, e
          o valor vem sem normalização: "Brasil", "BRASIL", "Brasil." e "-" convivem. O
          índice de internacionalização deste site normaliza antes de contar; qualquer
          contagem ingênua sai errada para mais.
        </p>
        <p>
          O campo <strong>agência</strong> (<code>projeto_financiador</code>) concatena o
          nome da agência ao do programa de fomento sem separador — precisa de limpeza antes
          de virar gráfico, e por isso o corte publicável hoje é por esfera (federal /
          estadual / própria IES).
        </p>
      </Section>

      <Section title="O que não foi possível baixar">
        <p>
          {totalFalhas} requisições falharam de forma permanente. A distinção entre "não
          existe" e "não consegui baixar" é registrada por motivo — sem ela, uma célula
          vazia é ambígua.
        </p>
        {dados.falhas.map((f) => (
          <div key={f.arquivo}>
            <p>
              <strong>{f.etapa}</strong> (<code>sucupira_dados/csv/{f.arquivo}</code>):{" "}
              {f.n} registros.
            </p>
            <ul>
              {f.por_motivo.map((m) => (
                <li key={m.motivo}>
                  {m.motivo}: <strong>{m.n}</strong>
                </li>
              ))}
            </ul>
          </div>
        ))}
        <p>
          Os arquivos de falha não são publicados aqui porque contêm identificadores de
          programa e URLs com parâmetros de consulta. Certos registros derrubam a API com
          HTTP 500 de forma determinística, e o erro derruba a página inteira; o coletor
          subdivide a página até isolar o registro problemático, o que recuperou cerca de
          5.900 produções.
        </p>
      </Section>

      <Section title="Dupla contagem em totais nacionais">
        <p>
          {dados.obras_em_mais_de_um_programa} obras (mesmo título normalizado, mesmo ano)
          foram reportadas por mais de um programa, com identificadores diferentes —
          tipicamente anais de congresso. Consequências:
        </p>
        <ul>
          <li>
            Totais <strong>nacionais</strong> são deduplicados por (título normalizado ×
            ano).
          </li>
          <li>
            Totais <strong>por programa</strong> mantêm os registros originais — cada
            programa registrou legitimamente a sua participação.
          </li>
          <li>A diferença é declarada na legenda de cada gráfico que soma o país.</li>
        </ul>
        <p>
          Pelo mesmo motivo, coautoria <em>entre</em> programas não existe por construção
          nesta base: cada produção pertence a exatamente um programa. A colaboração
          interinstitucional é medida por pessoas que atuam em mais de um programa — outra
          medida, rotulada como tal em <a href="/colaboracao">Quem trabalha com quem</a>.
        </p>
      </Section>

      <Section title="Nota CAPES — proveniência e limites">
        <p>
          A nota exibida vem da planilha oficial da Avaliação Quadrienal 2025 (publicada em
          27/05/2026), tabela <code>avaliacao_quadrienal_2025</code>. Nunca usamos o campo{" "}
          <code>situacao_atual</code> da API: ele coincide hoje, mas é um snapshot vivo, sem
          data nem proveniência.
        </p>
        <p>
          Três programas foram à reconsideração (CTC-ES 241) — <strong>UFSJ, UNB e
          UNIRIO</strong> — e tiveram a nota mantida; isso não existe na API. UFG: programa
          em implantação, nunca avaliado ("A" não é comparável a nota numérica). UEPA:
          primeira avaliação em 2025, sem nota anterior.
        </p>
        <p>
          A nota de 2025 avalia o quadriênio <strong>2021–2024</strong>; a anterior avalia
          2017–2020. Ao correlacionar produção com a nota nova, filtre 2021–2024.
        </p>
      </Section>

      <Section title="Estatística: o que este site não faz">
        <ul>
          <li>
            <strong>Nada de p-valor sobre os 20 programas.</strong> Correlação com nota, com
            região ou com tamanho aparece como coeficiente e gráfico, nunca como
            "significativo": n=20.
          </li>
          <li>
            <strong>Nada de extrapolação de Música para "as Artes".</strong> O recorte é
            censo de uma área, não amostra de nada.
          </li>
          <li>
            Comparações entre programas são <strong>descritivas</strong>. A variação de
            prática de preenchimento é grande o bastante para engolir qualquer efeito
            pequeno.
          </li>
        </ul>
      </Section>

      <Section title="Modelo de privacidade">
        <p>
          Este site exibe apenas dados agregados. Nomes, vínculos individuais e títulos de
          projetos, teses e produções não são publicados.
        </p>
        <p>
          Supressão de células: qualquer contagem com n &lt; 5 vira hachura com o aviso
          "suprimido: n &lt; 5". Não é zero — é dado insuficiente para publicar sem risco de
          identificação. Nenhum ranking de pessoas é publicado, nem anônimo.
        </p>
        <p>
          Justificativa LGPD: os dados são públicos individualmente na Plataforma Sucupira,
          mas agregá-los e republicá-los em formato navegável cria perfis consolidados que a
          plataforma original não oferece. Isso é tratamento de dados pessoais mesmo
          partindo de fonte pública.
        </p>
      </Section>

      <Section title="Logos institucionais">
        <p>
          Os logos são marcas registradas das respectivas instituições, reproduzidos apenas
          para identificação editorial de cada programa. Não há vínculo, patrocínio ou
          endosso. As marcas aparecem na forma original, sem recorte nem recoloração, e a
          sigla acompanha sempre o logo — nenhuma informação depende de reconhecer a imagem.
        </p>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: "2rem" }}>
      <h2>{title}</h2>
      <div style={{ fontSize: "0.9375rem", lineHeight: 1.7 }}>{children}</div>
    </section>
  );
}
