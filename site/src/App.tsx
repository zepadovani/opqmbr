import { Routes, Route, NavLink } from "react-router-dom";
import { lazy, Suspense } from "react";
import "./App.css";

const CampoEmNumeros = lazy(() => import("./rotas/CampoEmNumeros"));
const RegimesProducao = lazy(() => import("./rotas/RegimesProducao"));
const QuemTrabalhaCom = lazy(() => import("./rotas/QuemTrabalhaCom"));
const ConceitoMede = lazy(() => import("./rotas/ConceitoMede"));
const ProjetosFinanciamento = lazy(() => import("./rotas/ProjetosFinanciamento"));
const AtlasProjetos = lazy(() => import("./rotas/AtlasProjetos"));
const AppendicesDados = lazy(() => import("./rotas/AppendicesDados"));

const NAV = [
  { to: "/", label: "O campo em números" },
  { to: "/regimes", label: "Regimes de produção" },
  { to: "/colaboracao", label: "Quem trabalha com quem" },
  { to: "/conceito", label: "O que o conceito mede" },
  { to: "/projetos", label: "Projetos e financiamento" },
  { to: "/atlas", label: "Atlas de projetos" },
  { to: "/dados", label: "Apêndice de dados" },
];

export default function App() {
  return (
    <div className="layout">
      <header className="site-header">
        <div className="site-title">
          <span className="site-title-main">Panorama da Pesquisa em Música no Brasil</span>
          <span className="site-title-sub">20 programas de pós-graduação · 2021–2024</span>
        </div>
        <nav className="site-nav">
          {NAV.map(({ to, label }) => (
            <NavLink key={to} to={to} end={to === "/"} className={({ isActive }) => isActive ? "nav-link active" : "nav-link"}>
              {label}
            </NavLink>
          ))}
        </nav>
      </header>

      <main className="site-main">
        <Suspense fallback={<div className="loading">Carregando…</div>}>
          <Routes>
            <Route path="/" element={<CampoEmNumeros />} />
            <Route path="/regimes" element={<RegimesProducao />} />
            <Route path="/colaboracao" element={<QuemTrabalhaCom />} />
            <Route path="/conceito" element={<ConceitoMede />} />
            <Route path="/projetos" element={<ProjetosFinanciamento />} />
            <Route path="/atlas" element={<AtlasProjetos />} />
            <Route path="/dados" element={<AppendicesDados />} />
          </Routes>
        </Suspense>
      </main>

      <footer className="site-footer">
        <p>
          Dados: Plataforma Sucupira (CAPES) · Avaliação Quadrienal 2025.
          Programas acadêmicos de Música em atividade.
          Mestrados e doutorados profissionais excluídos — ver apêndice.
        </p>
      </footer>
    </div>
  );
}
