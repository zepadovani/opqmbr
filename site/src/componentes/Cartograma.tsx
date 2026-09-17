import { useMemo, useRef, useState } from "react";
import { logoUrl } from "../dados/logos";
import type { Programa, RedeObrasPorTipo } from "../dados/tipos";

/**
 * Cartograma de blocos: um quadrado por programa, em posição *esquemática* —
 * aproxima a geografia (Norte em cima, litoral à direita) sem sobrepor nada.
 *
 * Substituiu o mapa geográfico literal, onde oito dos vinte programas caíam
 * dentro do Sudeste e as arestas do eixo Rio–SP–MG viravam um borrão. A grade
 * é declaradamente esquemática, então espaçar é honesto — diferente de mexer
 * numa coordenada que se apresenta como real. Quem quiser a posição verdadeira
 * tem o mapa-localizador ao lado.
 *
 * A medida da aresta aqui é **obras**, não pessoas: ver `rede_obras_por_tipo`
 * em build_public.py para o porquê (filtrar pessoas em comum por tipo de
 * produção derruba quase tudo abaixo do limiar de supressão; obras sobrevive).
 */

// Coluna (oeste→leste) e linha (norte→sul) de cada programa na grade.
const GRADE: Record<string, [number, number]> = {
  UEPA: [2, 0],
  UFRN: [6, 1],
  UFPE: [5, 2],
  UFPB: [6, 2],
  UNB: [3, 3],
  UFBA: [5, 3],
  UFG: [2, 4],
  UFU: [3, 4],
  UFMG: [4, 4],
  UNICAMP: [3, 5],
  UFSJ: [4, 5],
  UFRJ: [5, 5],
  UNIRIO: [6, 5],
  UNESP: [2, 6],
  USP: [3, 6],
  UNESPAR: [1, 7],
  UEM: [2, 7],
  UFPR: [2, 8],
  UDESC: [3, 8],
  UFRGS: [2, 9],
};

const COLS = 7;
const ROWS = 10;
const TILE = 58;
const PAD = 26;

/* O controle mexe só no VÃO entre blocos; o bloco tem tamanho fixo. Na versão
   anterior o passo inteiro crescia e o efeito era zoom, não afastamento. */
const VAO_MIN = 4;
const VAO_MAX = 90;
const VAO_PADRAO = 24;

type TipoLigacao = "interna" | "estado" | "regiao" | "pais";

const LIGACOES: Array<{ chave: TipoLigacao; rotulo: string; cor: string }> = [
  { chave: "interna", rotulo: "Só dentro do programa", cor: "var(--serie-7)" },
  { chave: "estado", rotulo: "Mesmo estado", cor: "var(--serie-8)" },
  { chave: "regiao", rotulo: "Mesma região", cor: "var(--serie-4)" },
  { chave: "pais", rotulo: "Outra região", cor: "var(--serie-1)" },
];

const COR_LIGACAO = Object.fromEntries(LIGACOES.map((l) => [l.chave, l.cor])) as Record<
  TipoLigacao,
  string
>;

const COR_REGIAO: Record<string, string> = {
  Norte: "var(--serie-3)",
  Nordeste: "var(--serie-2)",
  "Centro-Oeste": "var(--serie-4)",
  Sudeste: "var(--serie-1)",
  Sul: "var(--serie-7)",
};

type Pos = { x: number; y: number };

export default function Cartograma({
  programas,
  rede,
  destaque,
  onDestaque,
}: {
  programas: Programa[];
  rede: RedeObrasPorTipo;
  destaque: string | null;
  onDestaque: (sigla: string | null) => void;
}) {
  const [vao, setVao] = useState(VAO_PADRAO);
  const [ligacoesAtivas, setLigacoesAtivas] = useState<Set<TipoLigacao>>(
    () => new Set(LIGACOES.map((l) => l.chave)),
  );
  const [categoriasAtivas, setCategoriasAtivas] = useState<Set<string>>(
    () => new Set(rede.categorias),
  );
  const [deslocamento, setDeslocamento] = useState<Record<string, Pos>>({});
  const [arrastando, setArrastando] = useState<string | null>(null);
  const [arestaSobre, setArestaSobre] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const arrasteRef = useRef<{ sigla: string; x0: number; y0: number; base: Pos } | null>(null);

  const passo = TILE + vao;
  const W = COLS * passo + 2 * PAD;
  const H = ROWS * passo + 2 * PAD;

  const porSigla = useMemo(() => new Map(programas.map((p) => [p.sigla, p])), [programas]);

  const centro = (sigla: string): Pos | null => {
    const g = GRADE[sigla];
    if (!g) return null;
    const d = deslocamento[sigla] ?? { x: 0, y: 0 };
    return {
      x: PAD + g[0] * passo + TILE / 2 + d.x,
      y: PAD + g[1] * passo + TILE / 2 + d.y,
    };
  };

  /** Classifica a ligação pelo nível geográfico mais próximo que ela cruza. */
  function classificar(a: string, b: string): TipoLigacao {
    if (a === b) return "interna";
    const pa = porSigla.get(a);
    const pb = porSigla.get(b);
    if (!pa || !pb) return "pais";
    if (pa.uf === pb.uf) return "estado";
    if (pa.regiao === pb.regiao) return "regiao";
    return "pais";
  }

  /* Somar categorias é exato porque cada produção pertence a exatamente uma:
     não há dupla contagem. Foi o que tornou o filtro por tipo viável. */
  const arestas = useMemo(() => {
    const soma = new Map<string, { a: string; b: string; n: number; parciais: number }>();
    for (const e of rede.arestas) {
      if (!categoriasAtivas.has(e.categoria)) continue;
      const chave = `${e.a}|${e.b}`;
      const atual = soma.get(chave) ?? { a: e.a, b: e.b, n: 0, parciais: 0 };
      if (e.suppressed || e.n === null) atual.parciais += 1;
      else atual.n += e.n;
      soma.set(chave, atual);
    }
    return [...soma.values()]
      .filter((e) => e.n > 0 && GRADE[e.a] && GRADE[e.b])
      .map((e) => ({ ...e, tipo: classificar(e.a, e.b) }))
      .filter((e) => ligacoesAtivas.has(e.tipo))
      .sort((x, y) => x.n - y.n);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rede, categoriasAtivas, ligacoesAtivas, porSigla]);

  const lacos = useMemo(() => {
    if (!ligacoesAtivas.has("interna")) return [];
    const soma = new Map<string, number>();
    for (const i of rede.internas) {
      if (!categoriasAtivas.has(i.categoria) || i.suppressed || i.n === null) continue;
      soma.set(i.sigla, (soma.get(i.sigla) ?? 0) + i.n);
    }
    return [...soma.entries()]
      .filter(([sigla]) => GRADE[sigla])
      .map(([sigla, n]) => ({ sigla, n }));
  }, [rede, categoriasAtivas, ligacoesAtivas]);

  const volume = useMemo(() => {
    const m = new Map<string, number>();
    for (const v of rede.volume) {
      if (!categoriasAtivas.has(v.categoria)) continue;
      m.set(v.sigla, (m.get(v.sigla) ?? 0) + v.n);
    }
    return m;
  }, [rede, categoriasAtivas]);

  const maxN = Math.max(1, ...arestas.map((e) => e.n), ...lacos.map((l) => l.n));
  const maxVol = Math.max(1, ...volume.values());
  const parciais = arestas.reduce((s, e) => s + e.parciais, 0);

  const parceiros = useMemo(() => {
    if (!destaque) return null;
    const s = new Set<string>([destaque]);
    for (const e of arestas) {
      if (e.a === destaque) s.add(e.b);
      if (e.b === destaque) s.add(e.a);
    }
    return s;
  }, [destaque, arestas]);

  const aceso = (sigla: string) => !parceiros || parceiros.has(sigla);

  /* ------------------------------------------------------------ arraste */

  function escala(): number {
    const rect = svgRef.current?.getBoundingClientRect();
    return rect && rect.width > 0 ? W / rect.width : 1;
  }

  function iniciarArraste(ev: React.PointerEvent, sigla: string) {
    ev.preventDefault();
    (ev.currentTarget as Element).setPointerCapture?.(ev.pointerId);
    arrasteRef.current = {
      sigla,
      x0: ev.clientX,
      y0: ev.clientY,
      base: deslocamento[sigla] ?? { x: 0, y: 0 },
    };
    setArrastando(sigla);
  }

  function moverArraste(ev: React.PointerEvent) {
    const a = arrasteRef.current;
    if (!a) return;
    const k = escala();
    const g = GRADE[a.sigla];
    const baseX = PAD + g[0] * passo + TILE / 2;
    const baseY = PAD + g[1] * passo + TILE / 2;
    // Limita ao quadro: um bloco arrastado para fora era recortado pelo viewBox
    // e sumia, sem jeito de trazer de volta a não ser recolocando tudo.
    const limitar = (v: number, base: number, tamanho: number) =>
      Math.min(tamanho - TILE / 2 - 2, Math.max(TILE / 2 + 2, base + v)) - base;
    setDeslocamento((d) => ({
      ...d,
      [a.sigla]: {
        x: limitar(a.base.x + (ev.clientX - a.x0) * k, baseX, W),
        y: limitar(a.base.y + (ev.clientY - a.y0) * k, baseY, H),
      },
    }));
  }

  function terminarArraste(ev: React.PointerEvent, sigla: string) {
    const a = arrasteRef.current;
    arrasteRef.current = null;
    setArrastando(null);
    // Movimento curto é clique, não arraste: sem isto, selecionar um programa
    // vira uma loteria de dois pixels.
    if (a && Math.hypot(ev.clientX - a.x0, ev.clientY - a.y0) < 4) {
      onDestaque(destaque === sigla ? null : sigla);
    }
  }

  function alternar<T>(conjunto: Set<T>, valor: T): Set<T> {
    const novo = new Set(conjunto);
    if (novo.has(valor)) novo.delete(valor);
    else novo.add(valor);
    return novo;
  }

  const posicoesMexidas = Object.keys(deslocamento).length > 0;

  return (
    <div>
      <div className="chart-controles">
        <label className="controle-slider">
          Afastamento
          <input
            type="range"
            min={VAO_MIN}
            max={VAO_MAX}
            step={2}
            value={vao}
            onChange={(e) => setVao(Number(e.target.value))}
            aria-label="Afastamento entre os blocos"
          />
        </label>
        {posicoesMexidas && (
          <button type="button" className="chip" onClick={() => setDeslocamento({})}>
            Recolocar na grade
          </button>
        )}
        {destaque && (
          <button type="button" className="chip ativo" onClick={() => onDestaque(null)}>
            {destaque} — mostrar todos
          </button>
        )}
      </div>

      <fieldset className="filtro-grupo">
        <legend>Tipos de ligação</legend>
        {LIGACOES.map((l) => {
          const ativo = ligacoesAtivas.has(l.chave);
          return (
            <label key={l.chave} className={ativo ? "filtro-item ativo" : "filtro-item"}>
              <input
                type="checkbox"
                checked={ativo}
                onChange={() => setLigacoesAtivas((s) => alternar(s, l.chave))}
              />
              <span className="legenda-marca" style={{ background: l.cor }} />
              {l.rotulo}
            </label>
          );
        })}
      </fieldset>

      <fieldset className="filtro-grupo">
        <legend>
          Tipos de produção
          <button
            type="button"
            className="link-botao"
            onClick={() =>
              setCategoriasAtivas(
                categoriasAtivas.size === rede.categorias.length
                  ? new Set()
                  : new Set(rede.categorias),
              )
            }
          >
            {categoriasAtivas.size === rede.categorias.length ? "limpar" : "todos"}
          </button>
        </legend>
        {rede.categorias.map((c) => {
          const ativo = categoriasAtivas.has(c);
          return (
            <label key={c} className={ativo ? "filtro-item ativo" : "filtro-item"}>
              <input
                type="checkbox"
                checked={ativo}
                onChange={() => setCategoriasAtivas((s) => alternar(s, c))}
              />
              {c === "OUTROS" ? "Outros tipos" : c}
            </label>
          );
        })}
      </fieldset>

      <div className="tabela-rolavel">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          width={W}
          height={H}
          className={arrastando ? "cartograma arrastando" : "cartograma"}
          role="img"
          aria-label="Cartograma esquemático dos 20 programas e suas ligações"
          onPointerMove={moverArraste}
        >
          <g>
            {arestas.map((e) => {
              const a = centro(e.a)!;
              const b = centro(e.b)!;
              const dx = b.x - a.x;
              const dy = b.y - a.y;
              const cx = (a.x + b.x) / 2 - dy * 0.12;
              const cy = (a.y + b.y) / 2 + dx * 0.12;
              const chave = `${e.a}|${e.b}`;
              const forte = !destaque || e.a === destaque || e.b === destaque;
              const sobre = arestaSobre === chave;
              const d = `M${a.x},${a.y} Q${cx},${cy} ${b.x},${b.y}`;
              const largura = 1.5 + (e.n / maxN) * 9;
              return (
                <g key={chave} className="carto-aresta">
                  {/* Casing da cor do fundo: onde duas curvas se cruzam, a de
                      cima abre uma fresta na de baixo em vez de fundir. */}
                  <path
                    d={d}
                    fill="none"
                    stroke="var(--color-bg)"
                    strokeWidth={largura + 3}
                    strokeLinecap="round"
                    opacity={forte ? 0.9 : 0.05}
                  />
                  <path
                    d={d}
                    fill="none"
                    stroke={COR_LIGACAO[e.tipo]}
                    strokeWidth={sobre ? largura + 2 : largura}
                    strokeLinecap="round"
                    opacity={sobre ? 1 : forte ? 0.5 + (e.n / maxN) * 0.35 : 0.05}
                  />
                  <path
                    d={d}
                    fill="none"
                    stroke="transparent"
                    strokeWidth={Math.max(14, largura + 8)}
                    onMouseEnter={() => setArestaSobre(chave)}
                    onMouseLeave={() => setArestaSobre(null)}
                  >
                    <title>
                      {`${e.a} × ${e.b}: ${e.n} obras${e.parciais > 0 ? ` (+${e.parciais} tipo(s) com contagem suprimida)` : ""}`}
                    </title>
                  </path>
                </g>
              );
            })}
          </g>

          {/* Laços: a colaboração que não sai do programa volta ao próprio nó. */}
          <g>
            {lacos.map(({ sigla, n }) => {
              const c = centro(sigla)!;
              const forte = !destaque || destaque === sigla;
              const r = 10 + (n / maxN) * 14;
              const largura = 1.5 + (n / maxN) * 9;
              const ox = c.x + TILE / 2 - 6;
              const oy = c.y - TILE / 2 + 2;
              const d = `M${ox - 8},${oy} A${r},${r} 0 1 1 ${ox + 2},${oy + 10}`;
              return (
                <g key={`laco-${sigla}`} className="carto-aresta">
                  <path
                    d={d}
                    fill="none"
                    stroke="var(--color-bg)"
                    strokeWidth={largura + 3}
                    opacity={forte ? 0.9 : 0.05}
                  />
                  <path
                    d={d}
                    fill="none"
                    stroke={COR_LIGACAO.interna}
                    strokeWidth={largura}
                    strokeLinecap="round"
                    opacity={forte ? 0.85 : 0.05}
                  />
                  <path d={d} fill="none" stroke="transparent" strokeWidth={14}>
                    <title>{`${sigla}: ${n} obras em coautoria que não saem do programa`}</title>
                  </path>
                </g>
              );
            })}
          </g>

          <g>
            {Object.keys(GRADE).map((sigla) => {
              const p = porSigla.get(sigla);
              const c = centro(sigla)!;
              const vol = volume.get(sigla) ?? 0;
              const x = c.x - TILE / 2;
              const y = c.y - TILE / 2;
              const alturaBarra = (vol / maxVol) * (TILE - 6);
              return (
                <g
                  key={sigla}
                  className={arrastando === sigla ? "carto-tile arrastando" : "carto-tile"}
                  opacity={aceso(sigla) ? 1 : 0.25}
                  onPointerDown={(ev) => iniciarArraste(ev, sigla)}
                  onPointerUp={(ev) => terminarArraste(ev, sigla)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(ev) => {
                    if (ev.key === "Enter" || ev.key === " ") {
                      ev.preventDefault();
                      onDestaque(destaque === sigla ? null : sigla);
                    }
                  }}
                >
                  <rect
                    x={x}
                    y={y}
                    width={TILE}
                    height={TILE}
                    rx={5}
                    fill="var(--color-surface)"
                    stroke={destaque === sigla ? "var(--color-text)" : "var(--color-border)"}
                    strokeWidth={destaque === sigla ? 2 : 1}
                  />
                  {/* Barra de volume rente à base: comparar altura de barra é
                      mais preciso que comparar área de círculo. */}
                  <rect
                    x={x + 3}
                    y={y + TILE - 3 - alturaBarra}
                    width={5}
                    height={alturaBarra}
                    rx={2}
                    fill={COR_REGIAO[p?.regiao ?? ""] ?? "var(--color-text-muted)"}
                  />
                  <image
                    href={logoUrl(sigla)}
                    x={x + 12}
                    y={y + 7}
                    width={TILE - 18}
                    height={22}
                    preserveAspectRatio="xMidYMid meet"
                  />
                  <text
                    x={c.x + 3}
                    y={y + TILE - 10}
                    textAnchor="middle"
                    className="carto-sigla"
                    fontSize={sigla.length > 6 ? 9 : 11}
                  >
                    {sigla}
                  </text>
                  <title>
                    {`${sigla} — ${p?.municipio ?? ""}/${p?.uf ?? ""}\n${vol.toLocaleString("pt-BR")} obras nos tipos selecionados\nArraste para reposicionar`}
                  </title>
                </g>
              );
            })}
          </g>
        </svg>
      </div>

      <div className="legenda">
        {LIGACOES.filter((l) => ligacoesAtivas.has(l.chave)).map((l) => (
          <span key={l.chave} className="legenda-item">
            <span className="legenda-marca" style={{ background: l.cor }} />
            {l.rotulo}
          </span>
        ))}
        <span className="legenda-item">
          Espessura = obras · barra à esquerda do bloco = volume nos tipos selecionados
        </span>
      </div>

      <p className="chart-nota">
        <strong>A ligação é medida em obras</strong>: coautorias de um programa que incluem
        alguém que também atua no outro. Não é "obra assinada por dois PPGs" — isso não
        existe na base, porque cada produção pertence a exatamente um programa, e o mesmo
        trabalho reportado por dois entra como dois registros. O laço roxo de volta ao
        próprio bloco é a coautoria que <em>não sai</em> do programa.
        {parciais > 0 && (
          <>
            {" "}
            Nesta seleção, <strong>{parciais}</strong> combinação(ões) de par × tipo ficaram
            abaixo do limiar de 5 pessoas e não entram na soma — as linhas mostradas são um
            piso, não o total.
          </>
        )}
      </p>

      <p className="chart-nota">
        <strong>Posições esquemáticas</strong>, não geográficas: a grade preserva a ordem
        norte→sul e oeste→leste. Arraste qualquer bloco para desembaraçar a parte que você
        estiver olhando, e use o afastamento para abrir a grade inteira — nada disso muda
        dado. Onde cada programa fica de verdade está no mapa-localizador.
      </p>
    </div>
  );
}
