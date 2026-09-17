import { useEffect, useState } from "react";
import LogoPPG from "../componentes/LogoPPG";
import { loadProgramas, loadTotaisNacionais } from "../dados/loaders";
import type { Programa, TotalNacional } from "../dados/tipos";

export default function CampoEmNumeros() {
  const [programas, setProgramas] = useState<Programa[] | null>(null);
  const [totais, setTotais] = useState<TotalNacional[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([loadProgramas(), loadTotaisNacionais()])
      .then(([p, t]) => {
        setProgramas(p);
        setTotais(t);
      })
      .catch((e: unknown) => setError(String(e)));
  }, []);

  if (error) return <div className="error">Erro ao carregar dados: {error}</div>;
  if (!programas || !totais) return <div className="loading">Carregando…</div>;

  return (
    <div>
      <h1>O campo em números</h1>
      <p className="page-subtitle">
        20 programas acadêmicos de pós-graduação em Música avaliados pela CAPES (quadriênio 2021–2024).
        Mestrados e doutorados profissionais excluídos — ver{" "}
        <a href="/dados">apêndice de dados</a>.
      </p>

      <HeadlineStats programas={programas} totais={totais} />

      <h2>Programas</h2>
      <p className="page-subtitle">
        Nota anterior = Quadriênio 2017–2020 · Nota 2025 = Quadriênio 2021–2024 (publicada em maio/2026).
      </p>
      <div className="cards-grid">
        {programas
          .slice()
          .sort((a, b) => a.sigla.localeCompare(b.sigla))
          .map((p) => (
            <ProgramaCard key={p.sigla} programa={p} />
          ))}
      </div>

      <NotesSection />
    </div>
  );
}

function HeadlineStats({ programas, totais }: { programas: Programa[]; totais: TotalNacional[] }) {
  // Total productions 2021–2024, deduplicated
  const anos = [2021, 2022, 2023, 2024];
  const totalProd = totais
    .filter((t) => anos.includes(t.ano_base))
    .reduce((s, t) => s + t.n_unique, 0);

  const queSubiram = programas.filter((p) => (p.variacao ?? 0) > 0).length;
  const nota7 = programas.filter((p) => p.nota_2025 === 7).length;

  return (
    <div className="headline-stats">
      <StatCard value={programas.length} label="programas na base" />
      <StatCard value={totalProd.toLocaleString("pt-BR")} label="produções 2021–2024 (deduplicadas)" />
      <StatCard value={queSubiram} label="programas que subiram de nota em 2025" />
      <StatCard value={nota7} label="programas com nota 7 (máximo em ARTES)" />
    </div>
  );
}

function StatCard({ value, label }: { value: string | number; label: string }) {
  return (
    <div className="stat-card">
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

function NotaBadge({ nota }: { nota: number | null }) {
  if (nota === null) {
    return <span className="nota-badge nota-A">A</span>;
  }
  return <span className={`nota-badge nota-${nota}`}>{nota}</span>;
}

function ProgramaCard({ programa: p }: { programa: Programa }) {
  const variacao = p.variacao;

  return (
    <div className="card">
      <div className="card-cabecalho">
        <LogoPPG sigla={p.sigla} />
        <div>
          <div className="card-sigla">{p.sigla}</div>
          <div className="card-nome">{p.nome_ies}</div>
        </div>
      </div>
      <div className="card-meta">
        <span>{p.municipio} — {p.uf}</span>
        <span>{p.regiao}</span>
      </div>
      <div className="card-nota">
        <NotaBadge nota={p.nota_anterior} />
        <span style={{ color: "var(--color-text-muted)", fontSize: "0.75rem" }}>→</span>
        <NotaBadge nota={p.nota_2025} />
        {variacao !== null && variacao > 0 && (
          <span className="variacao-up">+{variacao}</span>
        )}
        {variacao !== null && variacao === 0 && (
          <span className="variacao-zero">sem alteração</span>
        )}
      </div>
    </div>
  );
}

function NotesSection() {
  return (
    <details style={{ marginTop: "2rem", fontSize: "0.875rem", color: "var(--color-text-muted)" }}>
      <summary style={{ cursor: "pointer", fontWeight: 500, color: "var(--color-text)" }}>
        Notas metodológicas
      </summary>
      <ul style={{ marginTop: "0.75rem", lineHeight: 1.8 }}>
        <li>
          A nota de 2025 avalia o quadriênio <strong>2021–2024</strong>; a nota anterior avalia
          2017–2020. Ao correlacionar produção com a nota nova, filtre apenas 2021–2024.
        </li>
        <li>
          Três programas foram à reconsideração (CTC-ES 241) — UFSJ, UNB, UNIRIO — e tiveram
          a nota mantida.
        </li>
        <li>
          UFG: programa novo, ainda sem nota (aparece como "A" — aguardando primeira avaliação).
          UEPA: primeira nota em 2025 (sem anterior).
        </li>
        <li>
          Totais nacionais de produção são deduplicados por (título normalizado × ano) para
          evitar dupla contagem dos ~280 trabalhos reportados por mais de um programa.
          Contagens por programa mantêm os registros originais — o registro é legítimo do
          ponto de vista de cada programa.
        </li>
      </ul>
    </details>
  );
}
