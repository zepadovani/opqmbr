"""
Generates site/public/data/*.json — the public data bundle.

Reads sucupira.db + derivados/indices.parquet (or .json fallback).
Applies all suppression rules from privacidade.py.
Writes JSON files that the static Vite site will fetch.

NEVER includes:
  - Real id_pessoa or id_projeto (atlas.json uses a persisted surrogate, see
    build_atlas / derivados/id_map_projetos.json)
  - Nome of any person or thesis title
  - Project title, EXCEPT in atlas.json, and only for projects in a cluster
    with >= LIMIAR_TITULO_PUBLICO members (decision 1, PLANO §5, 2026-08-08)
  - Production title/link, EXCEPT in producoes_projeto.json, which publishes
    ALL of them regardless of cluster size — explicit user decision
    (2026-08-08, PLANO §4.2.5): production is already public elsewhere
    (Sucupira itself, journals, publishers), unlike project title, which is
    withheld specifically to avoid re-identifying a small project's
    coordinator
  - Text excerpts from descricao
  - Funding project↔agency pairs
  - Cells with n < 5 (use suppress_count from privacidade.py)

Usage:
    python3 -m analise.build_public [--db PATH] [--out DIR]
"""

import argparse
import json
import sqlite3
import sqlite3 as _sqlite3
from pathlib import Path

from analise.privacidade import (
    suppress_count,
    safe_percent,
    suppress_row,
    build_id_map,
    SUPPRESSION_THRESHOLD,
)
from analise.agencias import (
    AGENCIAS as AGENCIAS_FOMENTO,
    ESFERAS as ESFERAS_FOMENTO,
    ROTULO_ESFERA as ROTULO_ESFERA_FOMENTO,
    identificar as identificar_agencia,
)
from analise.idiomas import e_estrangeiro as idioma_estrangeiro
from analise.paises import (
    BRASIL as PAIS_BRASIL,
    e_internacional as pais_internacional,
    paises as listar_paises,
)
from analise.nucleo import (
    CLASSES,
    CLASSE_POR_RUBRICA,
    DESCRICAO_CLASSE,
    NUCLEO,
    ROTULO_CLASSE,
    classe_da_rubrica,
    e_administrativo,
)

REPO_ROOT = Path(__file__).parent.parent
DEFAULT_DB = REPO_ROOT / "sucupira.db"
DEFAULT_OUT = REPO_ROOT / "site" / "public" / "data"

ANOS_QUADRIENIO = (2021, 2022, 2023, 2024)
ANOS_TODOS = (2020, 2021, 2022, 2023, 2024, 2025)


def _con(db_path: Path) -> sqlite3.Connection:
    con = sqlite3.connect(db_path)
    con.row_factory = sqlite3.Row
    return con


# Coordenadas das cidades-sede (WGS84, centro do município), para o mapa da rede.
# Tabela à mão, e não geocodificação: são 20 cidades que não mudam de lugar, e
# uma tabela versionada é auditável — um serviço de geocodificação não é. Chave =
# (município, UF), porque nome de cidade se repete entre estados.
COORDENADAS_SEDE = {
    ("Belém", "PA"): (-1.4558, -48.4902),
    ("Belo Horizonte", "MG"): (-19.9167, -43.9345),
    ("Brasília", "DF"): (-15.7939, -47.8828),
    ("Campinas", "SP"): (-22.9099, -47.0626),
    ("Curitiba", "PR"): (-25.4284, -49.2733),
    ("Florianópolis", "SC"): (-27.5954, -48.5480),
    ("Goiânia", "GO"): (-16.6869, -49.2648),
    ("João Pessoa", "PB"): (-7.1195, -34.8450),
    ("Maringá", "PR"): (-23.4205, -51.9331),
    ("Natal", "RN"): (-5.7945, -35.2110),
    ("Paranavaí", "PR"): (-23.0731, -52.4650),
    ("Porto Alegre", "RS"): (-30.0346, -51.2177),
    ("Recife", "PE"): (-8.0476, -34.8770),
    ("Rio de Janeiro", "RJ"): (-22.9068, -43.1729),
    ("Salvador", "BA"): (-12.9777, -38.5016),
    ("São João del Rei", "MG"): (-21.1356, -44.2619),
    ("São Paulo", "SP"): (-23.5505, -46.6333),
    ("Uberlândia", "MG"): (-18.9186, -48.2772),
}


# ---------------------------------------------------------------------------
# 1. Programas — cards de overview (Página 1)
# ---------------------------------------------------------------------------

def build_programas(con) -> list[dict]:
    rows = con.execute("""
        SELECT
            p.id_programa,
            i.sigla,
            i.nome AS nome_ies,
            i.uf,
            i.regiao,
            i.municipio,
            i.categoria_administrativa,
            i.ror_id,
            pn.nota_quadrienio_anterior AS nota_anterior,
            pn.nota_quadrienal_2025 AS nota_2025,
            pn.variacao
        FROM programas p
        JOIN instituicoes i ON i.id_ies = p.id_ies
        LEFT JOIN programa_nota pn ON pn.id_programa = p.id_programa
        ORDER BY i.sigla
    """).fetchall()

    saida = []
    for r in rows:
        d = dict(r)
        # A planilha da CAPES grava a nota como texto, e usa "A" para
        # "sem nota" (programa em implantação, ou primeira avaliação). Publicar
        # isso cru faz o front comparar string com número em silêncio — foi o que
        # produziu "0 programas com nota 7" com a UNICAMP em 7 na tela.
        d["nota_anterior"] = _nota_numerica(d["nota_anterior"])
        d["nota_2025"] = _nota_numerica(d["nota_2025"])
        d["variacao"] = (
            d["nota_2025"] - d["nota_anterior"]
            if d["nota_2025"] is not None and d["nota_anterior"] is not None
            else None
        )
        coord = COORDENADAS_SEDE.get((d["municipio"], d["uf"]))
        if coord is None:
            # Sem coordenada o programa some do mapa em silêncio; melhor gritar.
            print(f"  AVISO: sem coordenada para {d['sigla']} ({d['municipio']}/{d['uf']})")
        d["lat"], d["lon"] = coord if coord else (None, None)
        saida.append(d)
    return saida


def _nota_numerica(valor) -> "int | None":
    """Nota da CAPES como inteiro; None para 'A', vazio ou qualquer não numérico."""
    if valor is None:
        return None
    texto = str(valor).strip()
    return int(texto) if texto.isdigit() else None


# ---------------------------------------------------------------------------
# 2. Produção por programa × ano × tipo (Streamgraph, Página 2)
# ---------------------------------------------------------------------------

def build_producao_por_ano(con) -> list[dict]:
    rows = con.execute("""
        SELECT
            i.sigla,
            pr.ano_base,
            pr.tipo,
            pr.subtipo,
            COUNT(*) n
        FROM producoes pr
        JOIN programas p ON p.id_programa = pr.id_programa
        JOIN instituicoes i ON i.id_ies = p.id_ies
        WHERE pr.ano_base IN (?,?,?,?,?,?)
        GROUP BY i.sigla, pr.ano_base, pr.tipo, pr.subtipo
        ORDER BY i.sigla, pr.ano_base, pr.tipo, pr.subtipo
    """, ANOS_TODOS).fetchall()
    # `classe` vai junto de cada linha para o front poder alternar entre "total
    # registrado" e "núcleo comparável" sem reimplementar a regra do §4.1a — que
    # é versionada em analise/nucleo.py e só existe lá.
    return [dict(r, classe=classe_da_rubrica(r["tipo"], r["subtipo"])) for r in rows]


# ---------------------------------------------------------------------------
# 3. Totais nacionais por ano (Página 1 — headline numbers)
#    Deduplicates by (normalized_title, ano_base) to avoid double-counting.
# ---------------------------------------------------------------------------

def build_totais_nacionais(con) -> list[dict]:
    # Unique (title, year) pairs to deduplicate the 280 duplicate works
    rows = con.execute("""
        SELECT
            pr.ano_base,
            pr.tipo,
            COUNT(DISTINCT lower(trim(pr.nome)) || '|' || pr.ano_base) n_unique,
            COUNT(*) n_bruto
        FROM producoes pr
        WHERE pr.ano_base IN (?,?,?,?,?,?) AND pr.nome IS NOT NULL
        GROUP BY pr.ano_base, pr.tipo
        ORDER BY pr.ano_base, pr.tipo
    """, ANOS_TODOS).fetchall()
    return [dict(r) for r in rows]


# ---------------------------------------------------------------------------
# 4. Índices por programa (cards detalhados + parallel coordinates, Página 8)
#    Loads from derivados/indices.{parquet,json} if available.
# ---------------------------------------------------------------------------

def build_indices(repo_root: Path) -> list[dict] | None:
    parquet = repo_root / "derivados" / "indices.parquet"
    json_f = repo_root / "derivados" / "indices.json"

    if parquet.exists():
        try:
            import pandas as pd
            df = pd.read_parquet(parquet)
            return df.to_dict(orient="records")
        except ImportError:
            pass

    if json_f.exists():
        with open(json_f, encoding="utf-8") as f:
            return json.load(f)

    return None


# ---------------------------------------------------------------------------
# 5. Rede inter-programas via pessoas compartilhadas (Página 5)
#    Public: only the 19×19 matrix of shared-person counts (suppressed < 5).
# ---------------------------------------------------------------------------

def build_rede_programas(con) -> dict:
    # Matrix: sigla_a, sigla_b, n_pessoas
    rows = con.execute("""
        WITH pp AS (
            SELECT DISTINCT a.id_pessoa, pr.id_programa
            FROM autoria a JOIN producoes pr ON pr.id_producao = a.id_producao
            WHERE pr.ano_base IN (?,?,?,?,?,?)
        )
        SELECT i1.sigla sigla_a, i2.sigla sigla_b, COUNT(DISTINCT x.id_pessoa) n
        FROM pp x JOIN pp y ON y.id_pessoa = x.id_pessoa AND y.id_programa > x.id_programa
        JOIN programas g1 ON g1.id_programa = x.id_programa
        JOIN programas g2 ON g2.id_programa = y.id_programa
        JOIN instituicoes i1 ON i1.id_ies = g1.id_ies
        JOIN instituicoes i2 ON i2.id_ies = g2.id_ies
        GROUP BY x.id_programa, y.id_programa
        ORDER BY n DESC
    """, ANOS_TODOS).fetchall()

    edges = []
    for r in rows:
        cell = suppress_count(r["n"])
        edges.append({
            "a": r["sigla_a"],
            "b": r["sigla_b"],
            "n": cell["value"],
            "suppressed": cell["suppressed"],
        })

    # Network aggregate metrics (degree, density) — public
    siglas = list({e["a"] for e in edges} | {e["b"] for e in edges})
    degree = {s: 0 for s in siglas}
    for e in edges:
        if not e["suppressed"]:
            degree[e["a"]] = degree.get(e["a"], 0) + 1
            degree[e["b"]] = degree.get(e["b"], 0) + 1

    n_nodes = len(siglas)
    possible = n_nodes * (n_nodes - 1) / 2
    published_edges = [e for e in edges if not e["suppressed"]]
    density = round(len(published_edges) / possible, 3) if possible else None

    return {
        "edges": edges,
        "aggregate": {
            "n_programs": n_nodes,
            "density": density,
            "degree_distribution": sorted(degree.values()),
        },
    }


# ---------------------------------------------------------------------------
# 5b. Perfil de cada programa: quadro de pessoas, produção por membro e o
#     "raio de colaboração" (Página 5).
#
#     Tudo agregado por programa — nenhuma linha por pessoa sai daqui.
# ---------------------------------------------------------------------------

VINCULOS_INTERNOS = ("Docente", "Discente", "Egresso", "Pós-doc")
VINCULOS_EXTERNOS = ("Participante externo", "Sem vínculo")


def build_perfil_programas(con) -> list[dict]:
    prog = {
        r["id_programa"]: (r["sigla"], r["regiao"], r["uf"])
        for r in con.execute("""
            SELECT p.id_programa, i.sigla, i.regiao, i.uf
            FROM programas p JOIN instituicoes i ON i.id_ies = p.id_ies
        """)
    }

    # Pessoa -> programas em que ela aparece como autora, em qualquer ano. É o
    # único vínculo interinstitucional que a base tem: `producoes.id_programa` é
    # único, então coautoria entre programas não existe por construção.
    programas_da_pessoa: dict[str, set] = {}
    for r in con.execute("""
        SELECT CAST(a.id_pessoa AS TEXT) AS pessoa, pr.id_programa AS prog
        FROM autoria a JOIN producoes pr ON pr.id_producao = a.id_producao
        WHERE a.id_pessoa IS NOT NULL
    """):
        programas_da_pessoa.setdefault(r["pessoa"], set()).add(r["prog"])

    autores_por_producao: dict[tuple, list] = {}
    for r in con.execute("""
        SELECT pr.id_producao, pr.id_programa, CAST(a.id_pessoa AS TEXT) AS pessoa, a.tipo_vinculo
        FROM producoes pr JOIN autoria a ON a.id_producao = pr.id_producao
        WHERE pr.ano_base IN (?,?,?,?)
    """, ANOS_QUADRIENIO):
        autores_por_producao.setdefault((r["id_producao"], r["id_programa"]), []).append(
            (r["pessoa"], r["tipo_vinculo"])
        )

    contagem: dict[str, dict] = {}
    for (_, id_programa), autores in autores_por_producao.items():
        sigla, regiao, uf = prog[id_programa]
        c = contagem.setdefault(sigla, {k: 0 for k in (
            "total", "autoria_unica", "interna", "mesma_uf", "regional", "interregional",
            "com_externo", "docente_discente", "coautoria",
        )})
        c["total"] += 1

        if len(autores) < 2:
            # Autoria única não diz nada sobre colaboração: classificá-la como
            # "interna" inflaria o fechamento de quem simplesmente registra
            # trabalho solo. Fica numa faixa própria, declarada.
            c["autoria_unica"] += 1
        else:
            c["coautoria"] += 1
            outros = set()
            for pessoa, _ in autores:
                if pessoa:
                    outros |= programas_da_pessoa.get(pessoa, set()) - {id_programa}
            # Faixa pelo alcance MAIOR que a obra atinge: quem toca outra região
            # não vira "mesma UF" só porque também tem um parceiro vizinho.
            if any(prog[o][1] != regiao for o in outros):
                c["interregional"] += 1
            elif any(prog[o][2] != uf for o in outros):
                c["regional"] += 1
            elif outros:
                c["mesma_uf"] += 1
            else:
                c["interna"] += 1

        vinculos = {v for _, v in autores}
        if any(v in VINCULOS_EXTERNOS for v in vinculos):
            c["com_externo"] += 1
        if "Docente" in vinculos and ({"Discente", "Egresso"} & vinculos):
            c["docente_discente"] += 1

    pessoas = {}
    for r in con.execute("""
        SELECT i.sigla, a.tipo_vinculo, COUNT(DISTINCT CAST(a.id_pessoa AS TEXT)) AS n
        FROM autoria a
        JOIN producoes pr ON pr.id_producao = a.id_producao
        JOIN programas g ON g.id_programa = pr.id_programa
        JOIN instituicoes i ON i.id_ies = g.id_ies
        WHERE pr.ano_base IN (?,?,?,?)
        GROUP BY i.sigla, a.tipo_vinculo
    """, ANOS_QUADRIENIO):
        pessoas.setdefault(r["sigla"], {})[r["tipo_vinculo"]] = r["n"]

    saida = []
    for sigla, regiao, _uf in sorted(prog.values()):
        c = contagem.get(sigla)
        q = pessoas.get(sigla, {})
        docentes = q.get("Docente", 0)
        discentes = q.get("Discente", 0)
        egressos = q.get("Egresso", 0)
        posdoc = q.get("Pós-doc", 0)
        externos = q.get("Participante externo", 0)
        membros = docentes + discentes + egressos + posdoc

        linha = {
            "sigla": sigla,
            "regiao": regiao,
            "n_docentes": suppress_count(docentes)["value"],
            "n_discentes": suppress_count(discentes)["value"],
            "n_egressos": suppress_count(egressos)["value"],
            "n_posdoc": suppress_count(posdoc)["value"],
            "n_externos": suppress_count(externos)["value"],
            "n_membros": suppress_count(membros)["value"],
        }
        if c is None:
            # Programa sem produção no quadriênio (UFG, em implantação). Zero
            # aqui é o valor certo, mas precisa ser distinguível de "não medido".
            linha.update({k: 0 for k in (
                "producoes", "autoria_unica", "interna", "mesma_uf", "regional",
                "interregional", "com_externo", "docente_discente", "coautoria",
            )})
            linha["sem_producao"] = True
        else:
            linha.update({
                "producoes": c["total"],
                "autoria_unica": c["autoria_unica"],
                "interna": c["interna"],
                "mesma_uf": c["mesma_uf"],
                "regional": c["regional"],
                "interregional": c["interregional"],
                "com_externo": c["com_externo"],
                "docente_discente": c["docente_discente"],
                "coautoria": c["coautoria"],
                "sem_producao": False,
            })
        saida.append(linha)
    return saida


# ---------------------------------------------------------------------------
# 5b-quater. Endogenia por projeto e endogamia acadêmica (§4.1b.5).
#
#   Duas das quatro medidas do capítulo "o quanto cada programa é fechado"
#   (§4.3 Cap. 6). A primeira (por coautoria) já sai de build_perfil_programas
#   — interna / coautoria — e não é recalculada aqui. A quarta (temática, por
#   entropia dos clusters de projeto) depende do clustering da Fase 3, que
#   ainda não existe: fica de fora, e o front avisa disso.
#
#   Privacidade: os numeradores contam PESSOAS, não produções — um valor
#   pequeno aqui aponta para gente específica de um jeito que uma contagem de
#   obras não aponta. Por isso passam por suppress_count como qualquer outra
#   contagem de indivíduos na base, e o percentual acompanha a supressão do
#   numerador: publicar só o percentual seria reconstruir o valor suprimido
#   por conta própria.
# ---------------------------------------------------------------------------

def build_endogenia(con) -> list[dict]:
    prog = {
        r["id_programa"]: r["sigla"]
        for r in con.execute("""
            SELECT p.id_programa, i.sigla
            FROM programas p JOIN instituicoes i ON i.id_ies = p.id_ies
        """)
    }

    # --- por projeto: quanto os membros de projeto do programa NÃO aparecem
    #     em projeto de nenhum outro programa.
    programas_do_membro: dict[str, set] = {}
    membros_do_programa: dict[str, set] = {}
    for r in con.execute("""
        SELECT DISTINCT CAST(m.id_pessoa AS TEXT) AS pessoa, a.id_programa AS prog
        FROM projeto_membro m
        JOIN projeto_ano a ON a.id_projeto = m.id_projeto
        WHERE m.id_pessoa IS NOT NULL AND a.id_programa IS NOT NULL
    """):
        programas_do_membro.setdefault(r["pessoa"], set()).add(r["prog"])
        membros_do_programa.setdefault(r["prog"], set()).add(r["pessoa"])

    endogenia_projeto = {}
    for id_programa, pessoas in membros_do_programa.items():
        total = len(pessoas)
        exclusivos = sum(1 for p in pessoas if len(programas_do_membro[p]) == 1)
        endogenia_projeto[id_programa] = (exclusivos, total)

    # --- endogamia acadêmica: docente que também aparece como Discente ou
    #     Egresso no MESMO programa, em qualquer ano. Proxy, não taxa: só
    #     enxerga quem publicou nas duas fases (§4.3 Cap. 6.3).
    docentes: dict[str, set] = {}
    formados_aqui: dict[str, set] = {}
    for r in con.execute("""
        SELECT DISTINCT CAST(a.id_pessoa AS TEXT) AS pessoa, pr.id_programa AS prog, a.tipo_vinculo AS vinc
        FROM autoria a JOIN producoes pr ON pr.id_producao = a.id_producao
        WHERE a.id_pessoa IS NOT NULL AND a.tipo_vinculo IN ('Docente','Discente','Egresso')
    """):
        (docentes if r["vinc"] == "Docente" else formados_aqui).setdefault(
            r["prog"], set()
        ).add(r["pessoa"])

    endogamia = {}
    for id_programa, pessoas in docentes.items():
        total = len(pessoas)
        formados = len(pessoas & formados_aqui.get(id_programa, set()))
        endogamia[id_programa] = (formados, total)

    def _linha(pares: dict, id_programa) -> tuple:
        num, den = pares.get(id_programa, (0, 0))
        cel = suppress_count(num)
        pct = None if cel["suppressed"] else safe_percent(num, den)
        return cel["value"], cel["suppressed"], den, pct

    saida = []
    for id_programa, sigla in sorted(prog.items(), key=lambda kv: kv[1]):
        proj_n, proj_supr, proj_den, proj_pct = _linha(endogenia_projeto, id_programa)
        aca_n, aca_supr, aca_den, aca_pct = _linha(endogamia, id_programa)
        saida.append({
            "sigla": sigla,
            "membros_projeto_exclusivos": proj_n,
            "membros_projeto_exclusivos_suprimido": proj_supr,
            "membros_projeto_total": proj_den,
            "pct_endogenia_projeto": proj_pct,
            "docentes_formados_no_programa": aca_n,
            "docentes_formados_no_programa_suprimido": aca_supr,
            "docentes_total": aca_den,
            "pct_endogamia_academica": aca_pct,
        })
    return saida


# ---------------------------------------------------------------------------
# 5b-bis. Coautoria docente + discente, por tipo de produção.
#
#   A participação em % responde "que fração da produção passa pela orientação";
#   esta tabela responde "orientação em quê" — e as duas perguntas não são a
#   mesma. Um programa pode ter metade da produção orientada e ela ser toda
#   recital, ou toda artigo.
# ---------------------------------------------------------------------------

def build_coautoria_docente_discente(con) -> list[dict]:
    rows = con.execute("""
        WITH marcadas AS (
            SELECT
                pr.id_producao,
                i.sigla,
                pr.tipo,
                pr.subtipo,
                MAX(CASE WHEN a.tipo_vinculo = 'Docente' THEN 1 ELSE 0 END) tem_docente,
                MAX(CASE WHEN a.tipo_vinculo IN ('Discente','Egresso') THEN 1 ELSE 0 END) tem_discente,
                COUNT(*) n_autores
            FROM producoes pr
            JOIN autoria a ON a.id_producao = pr.id_producao
            JOIN programas g ON g.id_programa = pr.id_programa
            JOIN instituicoes i ON i.id_ies = g.id_ies
            WHERE pr.ano_base IN (?,?,?,?)
            GROUP BY pr.id_producao, i.sigla, pr.tipo, pr.subtipo
        )
        SELECT
            sigla,
            tipo,
            subtipo,
            SUM(CASE WHEN tem_docente = 1 AND tem_discente = 1 THEN 1 ELSE 0 END) n_conjunta,
            SUM(CASE WHEN n_autores > 1 THEN 1 ELSE 0 END) n_coautoria,
            COUNT(*) n_total
        FROM marcadas
        GROUP BY sigla, tipo, subtipo
        HAVING n_total > 0
        ORDER BY sigla, n_conjunta DESC
    """, ANOS_QUADRIENIO).fetchall()
    return [dict(r) for r in rows]


# ---------------------------------------------------------------------------
# 5b-ter. Rede medida em OBRAS, por tipo de produção (cartograma).
#
#   Medida diferente da de `rede_programas` de propósito. Lá a aresta é
#   "pessoas em comum"; aqui é "obras em que os dois programas se tocam" — uma
#   coautoria do programa A que inclui alguém que também atua em B.
#
#   O motivo é prático e está documentado na tela: filtrar pessoas em comum por
#   tipo de produção derruba quase tudo abaixo do limiar de 5 (303 pares viram
#   16). Em obras sobram 333 pares publicáveis, e o filtro por tipo passa a
#   significar alguma coisa. As duas medidas convivem, cada uma rotulada.
#
#   Inclui o laço interno: coautorias em que todos os autores estão ligados só
#   àquele programa. É o que o cartograma desenha como link de volta ao nó.
# ---------------------------------------------------------------------------

N_CATEGORIAS = 8
OUTROS = "OUTROS"


def _categorias_principais(con) -> list[str]:
    """As N maiores por volume nacional no quadriênio, + OUTROS.

    Espelha `categoriasPrincipais()` do front; publicada no JSON para as duas
    pontas não divergirem em silêncio se o volume mudar.
    """
    rows = con.execute("""
        SELECT COALESCE(NULLIF(pr.subtipo, ''), pr.tipo) AS cat, COUNT(*) n
        FROM producoes pr
        WHERE pr.ano_base IN (?,?,?,?)
        GROUP BY cat ORDER BY n DESC
    """, ANOS_QUADRIENIO).fetchall()
    principais = [r["cat"] for r in rows[:N_CATEGORIAS]]
    return principais + [OUTROS] if len(rows) > N_CATEGORIAS else principais


def build_rede_obras_por_tipo(con) -> dict:
    categorias = _categorias_principais(con)

    def categoria(tipo, subtipo) -> str:
        c = subtipo or tipo
        return c if c in categorias else OUTROS

    programas_da_pessoa: dict[str, set] = {}
    for r in con.execute("""
        SELECT CAST(a.id_pessoa AS TEXT) AS pessoa, pr.id_programa AS prog
        FROM autoria a JOIN producoes pr ON pr.id_producao = a.id_producao
        WHERE a.id_pessoa IS NOT NULL
    """):
        programas_da_pessoa.setdefault(r["pessoa"], set()).add(r["prog"])

    sigla_de = {
        r["id_programa"]: r["sigla"]
        for r in con.execute("""
            SELECT p.id_programa, i.sigla FROM programas p
            JOIN instituicoes i ON i.id_ies = p.id_ies
        """)
    }

    autores: dict[tuple, list] = {}
    for r in con.execute("""
        SELECT pr.id_producao, pr.id_programa, pr.tipo, pr.subtipo, CAST(a.id_pessoa AS TEXT) AS pessoa
        FROM producoes pr JOIN autoria a ON a.id_producao = pr.id_producao
        WHERE pr.ano_base IN (?,?,?,?)
    """, ANOS_QUADRIENIO):
        chave = (r["id_producao"], r["id_programa"], categoria(r["tipo"], r["subtipo"]))
        autores.setdefault(chave, []).append(r["pessoa"])

    arestas: dict[tuple, int] = {}
    internas: dict[tuple, int] = {}
    volume: dict[tuple, int] = {}

    for (_, id_programa, cat), pessoas in autores.items():
        volume[(sigla_de[id_programa], cat)] = volume.get((sigla_de[id_programa], cat), 0) + 1
        if len(pessoas) < 2:
            continue
        outros = set()
        for p in pessoas:
            if p:
                outros |= programas_da_pessoa.get(p, set()) - {id_programa}
        if not outros:
            chave = (sigla_de[id_programa], cat)
            internas[chave] = internas.get(chave, 0) + 1
            continue
        for o in outros:
            par = tuple(sorted((sigla_de[id_programa], sigla_de[o])))
            arestas[(par[0], par[1], cat)] = arestas.get((par[0], par[1], cat), 0) + 1

    return {
        "categorias": categorias,
        "arestas": [
            {"a": a, "b": b, "categoria": c, "n": suppress_count(n)["value"],
             "suppressed": suppress_count(n)["suppressed"]}
            for (a, b, c), n in sorted(arestas.items(), key=lambda kv: -kv[1])
        ],
        "internas": [
            {"sigla": s, "categoria": c, "n": suppress_count(n)["value"],
             "suppressed": suppress_count(n)["suppressed"]}
            for (s, c), n in sorted(internas.items(), key=lambda kv: -kv[1])
        ],
        "volume": [
            {"sigla": s, "categoria": c, "n": n}
            for (s, c), n in sorted(volume.items(), key=lambda kv: -kv[1])
        ],
    }


# ---------------------------------------------------------------------------
# 5c. Rede entre regiões — a diagonal (intra-região) é o ponto da figura.
# ---------------------------------------------------------------------------

def build_rede_ufs(con) -> list[dict]:
    """Mesma coisa da matriz de regiões, um nível abaixo.

    A diagonal só tem valor onde há mais de um PPGMus no estado (SP, MG, PR e
    RJ). Nos demais ela é vazia por construção, não por falta de colaboração —
    a tela precisa dizer isso.
    """
    return _rede_por_recorte(con, "uf")


def build_rede_regioes(con) -> list[dict]:
    return _rede_por_recorte(con, "regiao")


def _rede_por_recorte(con, coluna: str) -> list[dict]:
    # `coluna` é escolhida por este módulo, nunca por entrada externa — as duas
    # únicas chamadas passam literais.
    assert coluna in ("uf", "regiao")
    rows = con.execute(f"""
        WITH pp AS (
            SELECT DISTINCT a.id_pessoa, pr.id_programa
            FROM autoria a JOIN producoes pr ON pr.id_producao = a.id_producao
            WHERE pr.ano_base IN (?,?,?,?,?,?)
        )
        SELECT i1.{coluna} AS ra, i2.{coluna} AS rb, COUNT(*) AS n
        FROM pp x
        JOIN pp y ON y.id_pessoa = x.id_pessoa AND y.id_programa > x.id_programa
        JOIN programas g1 ON g1.id_programa = x.id_programa
        JOIN programas g2 ON g2.id_programa = y.id_programa
        JOIN instituicoes i1 ON i1.id_ies = g1.id_ies
        JOIN instituicoes i2 ON i2.id_ies = g2.id_ies
        GROUP BY i1.{coluna}, i2.{coluna}
    """, ANOS_TODOS).fetchall()

    # Soma os dois sentidos: o par (Sul, Sudeste) e (Sudeste, Sul) são a mesma
    # relação, e a query só produz um deles dependendo do id.
    par: dict[tuple, int] = {}
    for r in rows:
        chave = tuple(sorted((r["ra"], r["rb"])))
        par[chave] = par.get(chave, 0) + r["n"]

    return [
        {"a": a, "b": b, "n": suppress_count(n)["value"], "suppressed": suppress_count(n)["suppressed"]}
        for (a, b), n in sorted(par.items(), key=lambda kv: -kv[1])
    ]


# ---------------------------------------------------------------------------
# 5d. Comparabilidade de volume (§4.1a): núcleo comparável, títulos
#     administrativos e índice de granularidade de registro.
#
#     Responde à pergunta que o total bruto não responde: quanto do volume de um
#     programa é obra de pesquisa ou criação, e quanto é registro de atividade.
#     A regra de classificação mora em analise/nucleo.py — aqui só se aplica.
# ---------------------------------------------------------------------------

def _mediana(valores: list[float]) -> "float | None":
    v = sorted(x for x in valores if x is not None)
    if not v:
        return None
    meio = len(v) // 2
    return v[meio] if len(v) % 2 else (v[meio - 1] + v[meio]) / 2


def build_comparabilidade(con) -> dict:
    # Começa com os 20 programas zerados: um programa sem produção no quadriênio
    # (UFG, em implantação) tem de aparecer como zero declarado, não sumir da
    # tabela como se não tivesse sido medido.
    linhas = {
        r["sigla"]: {k: 0 for k in ("total", "administrativos", *CLASSES)}
        for r in con.execute("""
            SELECT i.sigla FROM programas p JOIN instituicoes i ON i.id_ies = p.id_ies
        """)
    }
    for r in con.execute("""
        SELECT i.sigla, pr.tipo, pr.subtipo, pr.nome
        FROM producoes pr
        JOIN programas p ON p.id_programa = pr.id_programa
        JOIN instituicoes i ON i.id_ies = p.id_ies
        WHERE pr.ano_base IN (?,?,?,?)
    """, ANOS_QUADRIENIO):
        c = linhas[r["sigla"]]
        c["total"] += 1
        c[classe_da_rubrica(r["tipo"], r["subtipo"])] += 1
        if e_administrativo(r["nome"], r["tipo"], r["subtipo"]):
            c["administrativos"] += 1

    # Docentes = quem aparece como autor com vínculo Docente no quadriênio. Não é
    # o quadro credenciado: quem não publicou não está aqui, e isso puxa a taxa
    # para cima. Mesmo denominador do heatmap normalizado, de propósito.
    docentes = {
        r["sigla"]: r["n"]
        for r in con.execute("""
            SELECT i.sigla, COUNT(DISTINCT CAST(a.id_pessoa AS TEXT)) n
            FROM autoria a
            JOIN producoes pr ON pr.id_producao = a.id_producao
            JOIN programas g ON g.id_programa = pr.id_programa
            JOIN instituicoes i ON i.id_ies = g.id_ies
            WHERE pr.ano_base IN (?,?,?,?) AND a.tipo_vinculo = 'Docente'
            GROUP BY i.sigla
        """, ANOS_QUADRIENIO)
    }

    programas = []
    for sigla, c in linhas.items():
        n_doc = suppress_count(docentes.get(sigla, 0))["value"]
        por_doc = round(c["total"] / n_doc, 2) if n_doc else None
        por_doc_nucleo = round(c[NUCLEO] / n_doc, 2) if n_doc else None
        programas.append({
            "sigla": sigla,
            "total": c["total"],
            **{f"n_{k}": c[k] for k in CLASSES},
            "administrativos": c["administrativos"],
            "n_docentes": n_doc,
            "pct_nucleo": safe_percent(c[NUCLEO], c["total"]),
            "por_docente": por_doc,
            "por_docente_nucleo": por_doc_nucleo,
        })

    # Índice de granularidade: produções por docente ÷ mediana nacional. Fica ao
    # lado do volume porque é o aviso que falta em toda barra de tamanho —
    # 2,0 significa "registra o dobro por docente", não "produz o dobro".
    mediana_total = _mediana([p["por_docente"] for p in programas])
    mediana_nucleo = _mediana([p["por_docente_nucleo"] for p in programas])
    for p in programas:
        p["granularidade"] = (
            round(p["por_docente"] / mediana_total, 2)
            if p["por_docente"] and mediana_total else None
        )
        p["granularidade_nucleo"] = (
            round(p["por_docente_nucleo"] / mediana_nucleo, 2)
            if p["por_docente_nucleo"] and mediana_nucleo else None
        )

    programas.sort(key=lambda p: -p["total"])

    return {
        "periodo": [ANOS_QUADRIENIO[0], ANOS_QUADRIENIO[-1]],
        "classes": [
            {"chave": c, "rotulo": ROTULO_CLASSE[c], "descricao": DESCRICAO_CLASSE[c]}
            for c in CLASSES
        ],
        "rubricas": [
            {"tipo": t, "subtipo": s, "classe": k}
            for (t, s), k in sorted(CLASSE_POR_RUBRICA.items())
        ],
        "mediana_por_docente": mediana_total,
        "mediana_por_docente_nucleo": mediana_nucleo,
        "programas": programas,
    }


# ---------------------------------------------------------------------------
# 5e. Concentração da produção entre os docentes (§4.1b.1)
#
#     Responde: um programa concentra a produção em poucos docentes? E ele é
#     especializado num tipo só?
#
#     Esta é a medida mais perigosa do ponto de vista de privacidade em todo o
#     site, e o desenho gira em torno disso. Curva de Lorenz com um ponto por
#     pessoa **é** dado individual: num programa de 11 docentes, o último degrau
#     da curva é o maior produtor, com nome recuperável por quem conhece a área.
#     Por isso cada ponto da curva agrega **pelo menos 5 pessoas** (o mesmo k do
#     §3.2), e programa com menos de 10 docentes-autores não ganha curva nenhuma.
#     Máximo, decil superior e lista ordenada não saem daqui em hipótese alguma.
# ---------------------------------------------------------------------------

def _gini(valores: list[int]) -> "float | None":
    """Gini de uma distribuição não negativa. Agregado por construção."""
    v = sorted(valores)
    n = len(v)
    total = sum(v)
    if n == 0 or total == 0:
        return None
    soma_ponderada = sum((i + 1) * x for i, x in enumerate(v))
    return round((2 * soma_ponderada) / (n * total) - (n + 1) / n, 3)


def _quantil(valores_ordenados: list[int], q: float) -> "float | None":
    if not valores_ordenados:
        return None
    pos = q * (len(valores_ordenados) - 1)
    baixo = int(pos)
    alto = min(baixo + 1, len(valores_ordenados) - 1)
    peso = pos - baixo
    return round(valores_ordenados[baixo] * (1 - peso) + valores_ordenados[alto] * peso, 1)


def _lorenz_agregada(valores: list[int]) -> "list[dict] | None":
    """Curva de Lorenz em blocos de no mínimo SUPPRESSION_THRESHOLD pessoas.

    Devolve None quando nem dois blocos cabem: com menos de 10 pessoas, qualquer
    curva publicável seria ou individualizante ou vazia de informação.
    """
    v = sorted(valores)
    n = len(v)
    total = sum(v)
    blocos = n // SUPPRESSION_THRESHOLD
    if blocos < 2 or total == 0:
        return None
    blocos = min(blocos, 10)  # mais que isso não se lê num gráfico pequeno

    pontos = [{"pop": 0.0, "producao": 0.0, "n_pessoas": 0}]
    acumulado = 0
    inicio = 0
    for b in range(blocos):
        fim = round((b + 1) * n / blocos)
        acumulado += sum(v[inicio:fim])
        pontos.append({
            "pop": round(fim / n, 3),
            "producao": round(acumulado / total, 3),
            "n_pessoas": fim - inicio,
        })
        inicio = fim
    return pontos


def build_concentracao(con) -> dict:
    por_programa: dict[str, list[int]] = {}
    for r in con.execute("""
        SELECT i.sigla, COUNT(DISTINCT pr.id_producao) AS n
        FROM autoria a
        JOIN producoes pr ON pr.id_producao = a.id_producao
        JOIN programas g ON g.id_programa = pr.id_programa
        JOIN instituicoes i ON i.id_ies = g.id_ies
        WHERE pr.ano_base IN (?,?,?,?)
          AND a.tipo_vinculo = 'Docente' AND a.id_pessoa IS NOT NULL
        GROUP BY i.sigla, CAST(a.id_pessoa AS TEXT)
    """, ANOS_QUADRIENIO):
        por_programa.setdefault(r["sigla"], []).append(r["n"])

    # Especialização: HHI sobre a participação de cada rubrica no programa.
    # 1/HHI é o "número efetivo de tipos" — quantos tipos o programa teria se
    # publicasse igualmente em todos eles. Não toca em pessoa nenhuma.
    tipos: dict[str, dict[str, int]] = {}
    for r in con.execute("""
        SELECT i.sigla, COALESCE(NULLIF(pr.subtipo, ''), pr.tipo) AS cat, COUNT(*) n
        FROM producoes pr
        JOIN programas g ON g.id_programa = pr.id_programa
        JOIN instituicoes i ON i.id_ies = g.id_ies
        WHERE pr.ano_base IN (?,?,?,?)
        GROUP BY i.sigla, cat
    """, ANOS_QUADRIENIO):
        tipos.setdefault(r["sigla"], {})[r["cat"]] = r["n"]

    saida = []
    for sigla, valores in sorted(por_programa.items()):
        v = sorted(valores)
        n = len(v)
        cats = tipos.get(sigla, {})
        total_cat = sum(cats.values())
        hhi = sum((x / total_cat) ** 2 for x in cats.values()) if total_cat else None

        linha = {
            "sigla": sigla,
            "n_docentes": suppress_count(n)["value"],
            "producoes": sum(v),
            "gini": _gini(v),
            "lorenz": _lorenz_agregada(v),
            "tipos_efetivos": round(1 / hhi, 1) if hhi else None,
            "n_tipos": len(cats),
        }
        # Mediana e IQR só com gente suficiente para o quartil não ser uma
        # pessoa identificável. Máximo e p90 nunca, em nenhum tamanho.
        if n >= 2 * SUPPRESSION_THRESHOLD:
            linha.update({
                "mediana": _quantil(v, 0.5),
                "p25": _quantil(v, 0.25),
                "p75": _quantil(v, 0.75),
            })
        else:
            linha.update({"mediana": None, "p25": None, "p75": None})
        saida.append(linha)

    return {
        "periodo": [ANOS_QUADRIENIO[0], ANOS_QUADRIENIO[-1]],
        "limiar_supressao": SUPPRESSION_THRESHOLD,
        "programas": saida,
    }


# ---------------------------------------------------------------------------
# 5f. Projetos e financiamento (§4.1b.2 e §4.1b.3)
#
#     Duas perguntas de uma vez: quanto da produção está amarrada a um projeto
#     (que é indicador de preenchimento antes de ser de pesquisa), e de onde vem
#     o dinheiro.
#
#     Privacidade (§3.2): agência é agregada **por esfera** dentro do programa e
#     **por agência** no país. O par projeto↔agência não sai daqui, e nome de
#     projeto não existe em lugar nenhum do pacote público.
#
#     Armadilha do modelo: `projetos` NÃO tem id_programa — o vínculo está em
#     `projeto_ano`. SQL ingênuo erra aqui, e erra em silêncio.
# ---------------------------------------------------------------------------

def build_projetos(con) -> dict:
    programa_do_projeto = {}
    for r in con.execute("""
        SELECT DISTINCT pa.id_projeto, i.sigla
        FROM projeto_ano pa
        JOIN programas g ON g.id_programa = pa.id_programa
        JOIN instituicoes i ON i.id_ies = g.id_ies
        WHERE pa.id_programa IS NOT NULL
    """):
        # Um projeto pode aparecer em várias abas do mesmo programa; a primeira
        # sigla basta, porque a coleta é por programa e não há projeto
        # compartilhado entre dois.
        programa_do_projeto.setdefault(r["id_projeto"], r["sigla"])

    esferas_do_projeto: dict[str, set] = {}
    agencias_do_projeto: dict[str, set] = {}
    for r in con.execute("SELECT id_projeto, agencia FROM projeto_financiador"):
        sigla, esfera = identificar_agencia(r["agencia"])
        esferas_do_projeto.setdefault(r["id_projeto"], set()).add(esfera)
        agencias_do_projeto.setdefault(r["id_projeto"], set()).add(sigla)

    producoes_do_projeto: dict[str, int] = {}
    for r in con.execute("""
        SELECT id_projeto, COUNT(*) n FROM producoes
        WHERE id_projeto IS NOT NULL GROUP BY id_projeto
    """):
        producoes_do_projeto[r["id_projeto"]] = r["n"]

    natureza = {
        r["id_projeto"]: r["natureza"]
        for r in con.execute("SELECT id_projeto, natureza FROM projetos")
    }

    # --- por programa ------------------------------------------------------
    por_programa: dict[str, dict] = {}
    for r in con.execute("""
        SELECT i.sigla FROM programas p JOIN instituicoes i ON i.id_ies = p.id_ies
    """):
        por_programa[r["sigla"]] = {
            "sigla": r["sigla"],
            "n_projetos": 0,
            "n_financiados": 0,
            "n_orfaos": 0,
            "producoes_de_projetos": 0,
            **{f"esfera_{e}": 0 for e in ESFERAS_FOMENTO},
        }

    for id_projeto, sigla in programa_do_projeto.items():
        c = por_programa.get(sigla)
        if c is None:
            continue
        c["n_projetos"] += 1
        esferas = esferas_do_projeto.get(id_projeto, set())
        if esferas:
            c["n_financiados"] += 1
            # Projeto com duas agências conta nas duas esferas: são fontes
            # distintas, e somar esferas não é para dar o total de projetos.
            for e in esferas:
                c[f"esfera_{e}"] += 1
        n_prod = producoes_do_projeto.get(id_projeto, 0)
        c["producoes_de_projetos"] += n_prod
        if n_prod == 0:
            c["n_orfaos"] += 1

    # Produção vinculada a projeto, por programa: a taxa é de preenchimento
    # antes de ser de pesquisa, e é assim que a tela a apresenta.
    vinculo = {
        r["sigla"]: (r["com_projeto"], r["total"])
        for r in con.execute("""
            SELECT i.sigla,
                   SUM(CASE WHEN pr.id_projeto IS NOT NULL THEN 1 ELSE 0 END) com_projeto,
                   COUNT(*) total
            FROM producoes pr
            JOIN programas g ON g.id_programa = pr.id_programa
            JOIN instituicoes i ON i.id_ies = g.id_ies
            WHERE pr.ano_base IN (?,?,?,?)
            GROUP BY i.sigla
        """, ANOS_QUADRIENIO)
    }

    saida_programas = []
    for sigla, c in sorted(por_programa.items()):
        com_projeto, total = vinculo.get(sigla, (0, 0))
        linha = dict(c)
        linha["pct_financiados"] = safe_percent(c["n_financiados"], c["n_projetos"])
        linha["pct_orfaos"] = safe_percent(c["n_orfaos"], c["n_projetos"])
        linha["pct_producao_com_projeto"] = safe_percent(com_projeto, total)
        linha["producoes_quadrienio"] = total
        # Contagem por esfera é célula pequena: suprime abaixo do limiar.
        for e in ESFERAS_FOMENTO:
            linha[f"esfera_{e}"] = suppress_count(c[f"esfera_{e}"])["value"]
        saida_programas.append(linha)

    # --- nacional ----------------------------------------------------------
    projetos_por_agencia: dict[str, int] = {}
    for id_projeto, siglas in agencias_do_projeto.items():
        for s in siglas:
            projetos_por_agencia[s] = projetos_por_agencia.get(s, 0) + 1

    esfera_de = {}
    for _, sigla, esfera in AGENCIAS_FOMENTO:
        esfera_de[sigla] = esfera

    # Toda agência identificada aparece, sempre — nunca agrupada num balde
    # anônimo tipo "outras N agências" (isso jogava fora justamente a
    # informação que a lista existe para mostrar: quem financia, mesmo que
    # pouco). O que precisa de supressão é a CONTAGEM: um financiamento único
    # e exótico é quase uma assinatura de quem o recebeu, então agência com
    # menos de 5 projetos mantém o nome e some só o número (mesmo padrão de
    # `suppress_count` usado em qualquer outra contagem de indivíduos/projeto
    # pequena demais no site).
    agencias_publicaveis = [
        {
            "agencia": sigla,
            "esfera": esfera_de.get(sigla, "outra"),
            "n_projetos": suppress_count(n)["value"],
        }
        for sigla, n in sorted(projetos_por_agencia.items(), key=lambda kv: -kv[1])
    ]

    distribuicao = {}
    for id_projeto in programa_do_projeto:
        n = producoes_do_projeto.get(id_projeto, 0)
        faixa = "0" if n == 0 else "1–4" if n < 5 else "5–19" if n < 20 else "20+"
        distribuicao[faixa] = distribuicao.get(faixa, 0) + 1

    naturezas: dict[str, int] = {}
    for id_projeto in programa_do_projeto:
        chave = (natureza.get(id_projeto) or "NÃO INFORMADA").title()
        naturezas[chave] = naturezas.get(chave, 0) + 1

    return {
        "periodo": [ANOS_QUADRIENIO[0], ANOS_QUADRIENIO[-1]],
        "esferas": [{"chave": e, "rotulo": ROTULO_ESFERA_FOMENTO[e]} for e in ESFERAS_FOMENTO],
        "programas": saida_programas,
        "agencias": agencias_publicaveis,
        "distribuicao_producoes": [
            {"faixa": f, "n_projetos": distribuicao.get(f, 0)} for f in ("0", "1–4", "5–19", "20+")
        ],
        "naturezas": [
            {"natureza": k, "n": v} for k, v in sorted(naturezas.items(), key=lambda kv: -kv[1])
        ],
        "n_projetos": len(programa_do_projeto),
        "n_financiados": sum(1 for p in programa_do_projeto if p in agencias_do_projeto),
    }


# ---------------------------------------------------------------------------
# 6. Distribuição de notas: Música vs. ARTES vs. Brasil (Página 8)
# ---------------------------------------------------------------------------

def build_distribuicao_notas(con) -> dict:
    def _dist(where_clause, params=()):
        rows = con.execute(f"""
            SELECT nota_final, COUNT(*) n
            FROM avaliacao_quadrienal_2025
            WHERE nota_final IS NOT NULL AND {where_clause}
            GROUP BY nota_final ORDER BY nota_final
        """, params).fetchall()
        return {str(r["nota_final"]): r["n"] for r in rows}

    return {
        "musica": _dist("area_avaliacao = 'ARTES' AND id_programa IS NOT NULL"),
        "artes": _dist("area_avaliacao = 'ARTES'"),
        "brasil": _dist("1=1"),
    }


# ---------------------------------------------------------------------------
# 7. Internacionalização agregada (Página 1 / Página 8)
# ---------------------------------------------------------------------------

def build_internacionalizacao(con) -> dict:
    """Internacionalização por programa, com os dois campos normalizados.

    O que mudou em 2026-08-06, e por quê: a versão anterior filtrava com
    `lower(valor) NOT IN ('brasil','brazil','')` e `NOT IN ('português', …)`,
    contando como internacional tudo o que não fosse essas palavras — inclusive
    `Online`, `Porto Alegre` e `x` no campo de país e, pior, `Idioma Nacional`,
    que é a categoria da Plataforma para português e responde por 1.255
    registros. As regras agora moram em `analise/paises.py` e
    `analise/idiomas.py`, com autoteste, e "não dá para saber" sai do
    denominador em vez de virar um dos dois lados.
    """
    detalhe: dict[str, dict] = {}
    for r in con.execute("""
        SELECT i.sigla, pr.id_producao, d.item, d.valor
        FROM producoes pr
        JOIN programas g ON g.id_programa = pr.id_programa
        JOIN instituicoes i ON i.id_ies = g.id_ies
        JOIN producao_detalhe d ON d.id_producao = pr.id_producao
        WHERE pr.ano_base IN (?,?,?,?) AND d.item IN ('(PAC) País','Idioma')
    """, ANOS_QUADRIENIO):
        alvo = detalhe.setdefault(r["sigla"], {"pais": {}, "idioma": {}})
        chave = "pais" if r["item"] == "(PAC) País" else "idioma"
        atual = (
            pais_internacional(r["valor"]) if chave == "pais"
            else idioma_estrangeiro(r["valor"])
        )
        # Uma produção pode ter o campo repetido; qualquer sinal de estrangeiro
        # basta para a obra contar como internacional.
        anterior = alvo[chave].get(r["id_producao"])
        alvo[chave][r["id_producao"]] = atual if anterior is None else (anterior or atual)

    totais = {
        r["sigla"]: r["n"]
        for r in con.execute("""
            SELECT i.sigla, COUNT(*) n FROM producoes pr
            JOIN programas g ON g.id_programa = pr.id_programa
            JOIN instituicoes i ON i.id_ies = g.id_ies
            WHERE pr.ano_base IN (?,?,?,?) GROUP BY i.sigla
        """, ANOS_QUADRIENIO)
    }

    programas = []
    for sigla in sorted(totais):
        d = detalhe.get(sigla, {"pais": {}, "idioma": {}})
        com_pais = [v for v in d["pais"].values() if v is not None]
        com_idioma = [v for v in d["idioma"].values() if v is not None]
        programas.append({
            "sigla": sigla,
            "pct_intl_pais": safe_percent(sum(com_pais), len(com_pais)),
            "n_com_pais": len(com_pais),
            "pct_intl_idioma": safe_percent(sum(com_idioma), len(com_idioma)),
            "n_com_idioma": len(com_idioma),
            # Cobertura junto: sem ela, "0% internacional" e "campo vazio" se
            # confundem, e os dois existem na base.
            "cobertura_pais": safe_percent(len(com_pais), totais[sigla]),
            "cobertura_idioma": safe_percent(len(com_idioma), totais[sigla]),
            "n_total": totais[sigla],
        })

    # Ranking nacional de países, sem o Brasil. País com menos de 5 obras vira
    # "outros": um país exótico é quase uma assinatura de quem esteve lá.
    contagem: dict[str, set] = {}
    for r in con.execute("""
        SELECT pr.id_producao, d.valor FROM producoes pr
        JOIN producao_detalhe d ON d.id_producao = pr.id_producao
        WHERE pr.ano_base IN (?,?,?,?) AND d.item = '(PAC) País'
    """, ANOS_QUADRIENIO):
        for pais in listar_paises(r["valor"]):
            contagem.setdefault(pais, set()).add(r["id_producao"])

    ranking = []
    agrupados = n_agrupados = 0
    for pais, obras in sorted(contagem.items(), key=lambda kv: -len(kv[1])):
        if pais == PAIS_BRASIL:
            continue
        if len(obras) < SUPPRESSION_THRESHOLD:
            agrupados += len(obras)
            n_agrupados += 1
            continue
        ranking.append({"pais": pais, "n_obras": len(obras)})
    if agrupados:
        ranking.append({
            "pais": f"Outros {n_agrupados} países",
            "n_obras": agrupados,
            "agrupado": True,
        })

    # Participação externa declarada pelo próprio programa: o sinal mais direto
    # de gente de fora dos 20, e o único que não depende de campo livre.
    externos = [
        dict(r) for r in con.execute("""
            SELECT pr.ano_base, a.tipo_vinculo,
                   COUNT(DISTINCT pr.id_producao) n_obras,
                   COUNT(DISTINCT CAST(a.id_pessoa AS TEXT)) n_pessoas
            FROM autoria a
            JOIN producoes pr ON pr.id_producao = a.id_producao
            WHERE pr.ano_base IN (?,?,?,?)
              AND a.tipo_vinculo IN ('Participante externo','Sem vínculo')
            GROUP BY pr.ano_base, a.tipo_vinculo
            ORDER BY pr.ano_base
        """, ANOS_QUADRIENIO)
    ]

    return {
        "periodo": [ANOS_QUADRIENIO[0], ANOS_QUADRIENIO[-1]],
        "programas": programas,
        "paises": ranking,
        "n_paises_distintos": len([p for p in contagem if p != PAIS_BRASIL]),
        "externos_por_ano": externos,
    }


# ---------------------------------------------------------------------------
# 8. Cobertura da base, falhas e lacunas (§4.1.11 — apêndice de dados)
#
#    Tudo lido do banco e dos CSVs de falha, para o apêndice não virar prosa
#    fixa que envelhece em silêncio quando a base muda.
# ---------------------------------------------------------------------------

def build_cobertura(con, repo_root: Path) -> dict:
    def escalar(sql, params=()):
        return con.execute(sql, params).fetchone()[0]

    tabelas = [
        ("programas", "Programas de pós-graduação"),
        ("instituicoes", "Instituições"),
        ("producoes", "Produções"),
        ("producao_detalhe", "Campos de detalhe de produção"),
        ("autoria", "Vínculos autor↔produção"),
        ("pessoas", "Pessoas"),
        ("projetos", "Projetos de pesquisa"),
        ("projeto_financiador", "Registros de financiamento"),
        ("teses", "Teses e dissertações"),
        ("disciplinas", "Disciplinas"),
    ]
    contagens = [
        {"tabela": t, "rotulo": r, "n": escalar(f"SELECT COUNT(*) FROM {t}")}
        for t, r in tabelas
    ]

    anos = con.execute(
        "SELECT MIN(ano_base), MAX(ano_base) FROM producoes WHERE ano_base IS NOT NULL"
    ).fetchone()

    # Falhas: só o agregado por motivo. Os CSVs têm id de programa e URL com
    # identificador — nada disso sai daqui.
    falhas = []
    for arquivo, rotulo in (
        ("_falhas.csv", "coleção"),
        ("_falhas_producoes.csv", "detalhe de produção"),
    ):
        caminho = repo_root / "sucupira_dados" / "csv" / arquivo
        if not caminho.exists():
            continue
        import csv as _csv

        with open(caminho, encoding="utf-8") as f:
            linhas = list(_csv.DictReader(f))
        por_motivo: dict[str, int] = {}
        for linha in linhas:
            motivo = (linha.get("motivo") or "sem motivo").strip()
            por_motivo[motivo] = por_motivo.get(motivo, 0) + 1
        falhas.append({
            "arquivo": arquivo,
            "etapa": rotulo,
            "n": len(linhas),
            "por_motivo": [
                {"motivo": m, "n": n} for m, n in sorted(por_motivo.items(), key=lambda kv: -kv[1])
            ],
        })

    campos = []
    total_prod = escalar("SELECT COUNT(*) FROM producoes")
    for item, rotulo in (("Idioma", "Idioma"), ("(PAC) País", "País de realização")):
        n = escalar(
            "SELECT COUNT(DISTINCT id_producao) FROM producao_detalhe WHERE item = ?", (item,)
        )
        campos.append({"campo": rotulo, "n": n, "pct": safe_percent(n, total_prod)})
    com_projeto = escalar("SELECT COUNT(*) FROM producoes WHERE id_projeto IS NOT NULL")
    campos.append({
        "campo": "Vínculo com projeto",
        "n": com_projeto,
        "pct": safe_percent(com_projeto, total_prod),
    })

    # Obras reportadas por mais de um programa: risco de dupla contagem em
    # qualquer total nacional, e por isso os totais nacionais são deduplicados.
    duplicadas = escalar("""
        SELECT COUNT(*) FROM (
            SELECT lower(trim(nome)) t, ano_base
            FROM producoes WHERE nome IS NOT NULL
            GROUP BY t, ano_base HAVING COUNT(DISTINCT id_programa) > 1
        )
    """)

    # A lacuna de cobertura, lida da planilha oficial: programas de Música (ou de
    # prática musical) avaliados em 2025 e ausentes da base — todos profissionais.
    fora = [
        dict(r) for r in con.execute("""
            SELECT codigo_programa, nome_programa, sigla_ies, nivel, nota_final
            FROM avaliacao_quadrienal_2025
            WHERE area_avaliacao = 'ARTES' AND na_base = 0
              AND (upper(nome_programa) LIKE '%MÚSIC%' OR upper(nome_programa) LIKE '%MUSIC%')
            ORDER BY sigla_ies
        """)
    ]

    # Recorte comparável em nível nacional, para o apêndice repetir o número que
    # o capítulo de regimes mostra por programa.
    por_classe: dict[str, int] = {c: 0 for c in CLASSES}
    n_admin = 0
    for r in con.execute("SELECT nome, tipo, subtipo FROM producoes WHERE ano_base IN (?,?,?,?)", ANOS_QUADRIENIO):
        por_classe[classe_da_rubrica(r["tipo"], r["subtipo"])] += 1
        if e_administrativo(r["nome"], r["tipo"], r["subtipo"]):
            n_admin += 1

    return {
        "contagens": contagens,
        "anos": {"primeiro": anos[0], "ultimo": anos[1]},
        "falhas": falhas,
        "campos": campos,
        "obras_em_mais_de_um_programa": duplicadas,
        "fora_da_base": fora,
        "quadrienio": {
            "periodo": [ANOS_QUADRIENIO[0], ANOS_QUADRIENIO[-1]],
            "por_classe": [
                {"chave": c, "rotulo": ROTULO_CLASSE[c], "n": por_classe[c]} for c in CLASSES
            ],
            "administrativos": n_admin,
        },
    }


# ---------------------------------------------------------------------------
# 7. Atlas de projetos: clustering por assunto (§4.2.2 / Fase 3).
#
#    Lê derivados/clusters.parquet, escrito por `analise/clustering.py`
#    (venv próprio: sentence-transformers, umap-learn, hdbscan — fora do
#    caminho de reprodução da base). Se o clustering ainda não rodou, o
#    arquivo não existe e esta função devolve None — main() avisa e pula o
#    JSON, do mesmo jeito que já faz para indices.parquet.
#
#    Privacidade (decisão 1, PLANO §5, 2026-08-08): id_projeto real nunca sai
#    daqui — cada projeto ganha um id substituto, persistido em
#    derivados/id_map_projetos.json (fora do git) para ficar estável entre
#    builds. Título do projeto só é publicado para membros de clusters com
#    pelo menos LIMIAR_TITULO_PUBLICO projetos: cluster pequeno + título
#    identifica quase tanto quanto título + coordenador, que é o risco que a
#    decisão original queria evitar.
#
#    Tema de cada cluster é a subárea — as 8 oficiais da ANPPOM (2025) mais
#    "Musicoterapia" destacada da SA-8 como categoria própria (pedido do
#    usuário, 9 no total; ver analise/clustering.py). Atribuída por leitura
#    de título+resumo (humana/LLM, `analise/classificacao_projetos.json`,
#    versionado — zero-shot por embedding fica de fallback) — sem "ruído":
#    todo projeto cai em alguma subárea. As palavras-chave (TF-IDF) continuam
#    automáticas e sem revisão; o JSON carrega um aviso disso para o front
#    repetir.
# ---------------------------------------------------------------------------

LIMIAR_TITULO_PUBLICO = 10


def _carregar_id_map_projetos(repo_root: Path, ids_reais: list) -> dict:
    path = repo_root / "derivados" / "id_map_projetos.json"
    mapa = {}
    if path.exists():
        with open(path, encoding="utf-8") as f:
            mapa = json.load(f)
    faltantes = [i for i in ids_reais if i not in mapa]
    if faltantes:
        mapa.update(build_id_map(faltantes))
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(mapa, f, ensure_ascii=False, indent=2)
    return mapa


def _carregar_clusters(repo_root: Path, nome: str = "clusters") -> "list[dict] | None":
    """build_public.py roda com stdlib pura — tenta parquet (venv de análise
    disponível), cai para o JSON irmão que analise/clustering.py também
    escreve. Mesma estratégia de build_indices. `nome` seleciona a variante
    (`clusters` = ANPPOM, `clusters_hdbscan` = §4.2.5 item 3)."""
    parquet = repo_root / "derivados" / f"{nome}.parquet"
    json_f = repo_root / "derivados" / f"{nome}.json"
    if parquet.exists():
        try:
            import pandas as pd
            return pd.read_parquet(parquet).to_dict(orient="records")
        except ImportError:
            pass
    if json_f.exists():
        with open(json_f, encoding="utf-8") as f:
            return json.load(f)
    return None


def _dados_base_projetos(con) -> dict:
    """Lookups por `id_projeto` real compartilhados por toda variante do
    atlas (ANPPOM, HDBSCAN…) — programa, ano mais recente reportado,
    contagem de produções, título. Extraído de `build_atlas` pra não
    duplicar a mesma SQL em cada método de clusterização."""
    programa_do_projeto = {
        r["id_projeto"]: r["sigla"]
        for r in con.execute("""
            SELECT DISTINCT pa.id_projeto, i.sigla
            FROM projeto_ano pa
            JOIN programas g ON g.id_programa = pa.id_programa
            JOIN instituicoes i ON i.id_ies = g.id_ies
            WHERE pa.id_programa IS NOT NULL
        """)
    }

    # Ano mais recente em que o projeto foi reportado — a base não tem
    # `inicio`/`fim` preenchidos (§Fatos que não são óbvios), então não há
    # "ano de início" para usar aqui.
    ano_do_projeto: dict = {}
    for r in con.execute("SELECT id_projeto, aba FROM projeto_ano"):
        try:
            ano = int(r["aba"])
        except (TypeError, ValueError):
            continue
        atual = ano_do_projeto.get(r["id_projeto"])
        if atual is None or ano > atual:
            ano_do_projeto[r["id_projeto"]] = ano

    producoes_do_projeto = {
        r["id_projeto"]: r["n"]
        for r in con.execute(
            "SELECT id_projeto, COUNT(*) n FROM producoes WHERE id_projeto IS NOT NULL GROUP BY id_projeto"
        )
    }
    nome_do_projeto = {
        r["id_projeto"]: r["nome"] for r in con.execute("SELECT id_projeto, nome FROM projetos")
    }

    return {
        "programa": programa_do_projeto,
        "ano": ano_do_projeto,
        "producoes": producoes_do_projeto,
        "nome": nome_do_projeto,
    }


def build_atlas(con, repo_root: Path, limiar_titulo: int = LIMIAR_TITULO_PUBLICO) -> "dict | None":
    linhas = _carregar_clusters(repo_root)
    if linhas is None:
        return None

    ids_reais = [r["id_projeto"] for r in linhas]
    id_map = _carregar_id_map_projetos(repo_root, ids_reais)

    base = _dados_base_projetos(con)
    programa_do_projeto = base["programa"]
    ano_do_projeto = base["ano"]
    producoes_do_projeto = base["producoes"]
    nome_do_projeto = base["nome"]

    tamanho_cluster: dict = {}
    tema_por_cluster: dict = {}
    subareas_por_cluster: dict[int, list[str]] = {}
    subarea_do_projeto: dict[str, str] = {}

    subareas_json = repo_root / "analise" / "subareas_nivel2.json"
    subareas_map_fallback = {}
    if subareas_json.exists():
        with open(subareas_json, encoding="utf-8") as f:
            subareas_map_fallback = json.load(f)

    for r in linhas:
        c = int(r["cluster"])
        id_proj = str(r["id_projeto"])
        # Prioriza a classificação semântica (leitura de título+resumo, via
        # subareas_nivel2.json) sobre o fallback estatístico antigo gravado em
        # clusters.json (bigramas de unigrama bruto, cacofônicos — "Performance
        # e Graduação", "Composição e Composicional"; ver §4.2.5 item 2).
        sub = subareas_map_fallback.get(id_proj) or r.get("subarea") or ""
        tamanho_cluster[c] = tamanho_cluster.get(c, 0) + 1
        tema_por_cluster.setdefault(c, r.get("tema"))
        if sub:
            subarea_do_projeto[id_proj] = sub
            subareas_por_cluster.setdefault(c, [])
            if sub not in subareas_por_cluster[c]:
                subareas_por_cluster[c].append(sub)

    pontos = []
    for r in linhas:
        id_projeto = r["id_projeto"]
        cluster = int(r["cluster"])
        titulo_publico = tamanho_cluster.get(cluster, 0) >= limiar_titulo
        pontos.append({
            "id": id_map[id_projeto],
            "sigla": programa_do_projeto.get(id_projeto),
            "ano": ano_do_projeto.get(id_projeto),
            "cluster": cluster,
            "subarea": subarea_do_projeto.get(id_projeto),
            "x": round(float(r["x"]), 4),
            "y": round(float(r["y"]), 4),
            "x3d": round(float(r["x3d"]), 4),
            "y3d": round(float(r["y3d"]), 4),
            "z3d": round(float(r["z3d"]), 4),
            "n_producoes": producoes_do_projeto.get(id_projeto, 0),
            "nome": nome_do_projeto.get(id_projeto) if titulo_publico else None,
        })

    clusters = []
    for c, n in sorted(tamanho_cluster.items()):
        subs = subareas_por_cluster.get(c, [])
        clusters.append({
            "cluster": int(c),
            "tema": tema_por_cluster.get(c),
            "n_projetos": int(n),
            "subareas": subs,
            "titulo_publico": n >= limiar_titulo,
        })

    return {
        "limiar_titulo_publico": limiar_titulo,
        "aviso_rotulo": (
            "Tema = subárea de nível 1 (as 8 da ANPPOM mais Musicoterapia). "
            "Subáreas = 2º nível de organização temática, agrupando projetos por afinidade semântica real de títulos e resumos."
        ),
        "clusters": clusters,
        "projetos": pontos,
    }


def _build_atlas_nao_taxonomico(
    con, repo_root: Path, nome_clusters: str, aviso_rotulo: str,
    id_ruido: "int | None" = None, rotulo_ruido: str = "Ruído (sem cluster)",
    limiar_titulo: int = LIMIAR_TITULO_PUBLICO,
) -> "dict | None":
    """Corpo compartilhado pelas variantes do atlas que NÃO vêm da taxonomia
    ANPPOM (§4.2.5 item 3: HDBSCAN, LDA/tópicos — mesmo formato de
    `build_atlas`, o front reaproveita o componente inteiro trocando só a
    fonte). `tema` vem das palavras-chave (TF-IDF ou top-termos do tópico)
    do cluster — não há nome humano, é descoberta, não classificação por
    categoria oficial. Nenhuma tem subárea de 2º nível
    (`subareas_nivel2.json` foi construído sobre os clusters ANPPOM);
    `subareas` aqui carrega as próprias palavras-chave, só pra leitura na
    tabela — o front não usa como filtro por projeto.

    `id_ruido`: o valor de `cluster` que significa "não agrupou com nada"
    (HDBSCAN usa -1; LDA não tem — todo documento cai num tópico por
    construção, então passa `None`). Mantido e rotulado, nunca escondido:
    projeto que não agrupa com nada é achado, não defeito.
    """
    linhas = _carregar_clusters(repo_root, nome=nome_clusters)
    if linhas is None:
        return None

    ids_reais = [r["id_projeto"] for r in linhas]
    id_map = _carregar_id_map_projetos(repo_root, ids_reais)

    base = _dados_base_projetos(con)
    programa_do_projeto = base["programa"]
    ano_do_projeto = base["ano"]
    producoes_do_projeto = base["producoes"]
    nome_do_projeto = base["nome"]

    # As palavras-chave (TF-IDF) vêm do corpus livre dos resumos — mesmo
    # risco de nome de pessoa real embutido no texto que `producoes.nome`
    # tinha (achado rodando `analise.pii_test` a 1ª vez sobre esses
    # arquivos: "john rink" — musicólogo real, citado num resumo, virou
    # termo distintivo de um cluster). Termo que casa com nome real é
    # descartado aqui, não só filtrado na exibição — não pode nem chegar a
    # `derivados/*.json` publicável.
    from analise.pii_test import carregar_reais, compilar_regex_nomes

    db_path = Path(con.execute("PRAGMA database_list").fetchone()[2])
    _, _, nomes_reais = carregar_reais(db_path)
    rx_nomes = compilar_regex_nomes(nomes_reais)

    def sem_nome_real(termo: str) -> bool:
        return not (rx_nomes and rx_nomes.search(termo))

    tamanho_cluster: dict = {}
    palavras_por_cluster: dict = {}
    for r in linhas:
        c = int(r["cluster"])
        tamanho_cluster[c] = tamanho_cluster.get(c, 0) + 1
        if c not in palavras_por_cluster:
            termos_brutos = (r.get("palavras_chave") or "").split(",")
            termos_limpos = [t.strip() for t in termos_brutos if t.strip() and sem_nome_real(t)]
            palavras_por_cluster[c] = ", ".join(termos_limpos)

    def tema_do_cluster(c: int) -> str:
        if id_ruido is not None and c == id_ruido:
            return rotulo_ruido
        termos = [t.strip() for t in palavras_por_cluster.get(c, "").split(",") if t.strip()]
        return " · ".join(t.capitalize() for t in termos[:3]) or f"Cluster {c}"

    pontos = []
    for r in linhas:
        id_projeto = r["id_projeto"]
        cluster = int(r["cluster"])
        titulo_publico = tamanho_cluster.get(cluster, 0) >= limiar_titulo
        pontos.append({
            "id": id_map[id_projeto],
            "sigla": programa_do_projeto.get(id_projeto),
            "ano": ano_do_projeto.get(id_projeto),
            "cluster": cluster,
            "subarea": None,
            "x": round(float(r["x"]), 4),
            "y": round(float(r["y"]), 4),
            "x3d": round(float(r["x3d"]), 4),
            "y3d": round(float(r["y3d"]), 4),
            "z3d": round(float(r["z3d"]), 4),
            "n_producoes": producoes_do_projeto.get(id_projeto, 0),
            "nome": nome_do_projeto.get(id_projeto) if titulo_publico else None,
        })

    clusters = []
    for c, n in sorted(tamanho_cluster.items()):
        e_ruido = id_ruido is not None and c == id_ruido
        termos = [t.strip() for t in palavras_por_cluster.get(c, "").split(",") if t.strip()]
        clusters.append({
            "cluster": int(c),
            "tema": tema_do_cluster(c),
            "n_projetos": int(n),
            "subareas": [] if e_ruido else termos,
            "titulo_publico": n >= limiar_titulo,
        })

    return {
        "limiar_titulo_publico": limiar_titulo,
        "aviso_rotulo": aviso_rotulo,
        "clusters": clusters,
        "projetos": pontos,
    }


def build_atlas_hdbscan(con, repo_root: Path, limiar_titulo: int = LIMIAR_TITULO_PUBLICO) -> "dict | None":
    """HDBSCAN não supervisionado sobre embedding denso — ver
    `clustering.executar_hdbscan` e `_build_atlas_nao_taxonomico`."""
    return _build_atlas_nao_taxonomico(
        con, repo_root, nome_clusters="clusters_hdbscan", id_ruido=-1, limiar_titulo=limiar_titulo,
        aviso_rotulo=(
            "HDBSCAN não supervisionado sobre o espaço de embeddings de alta dimensão — "
            "descoberta de tema, não classificação pela taxonomia oficial da ANPPOM. "
            "\"Tema\" vem das palavras-chave (TF-IDF) mais distintivas do cluster, não de "
            "leitura humana. \"Ruído (sem cluster)\" é resultado legítimo do método (HDBSCAN "
            "não força todo ponto a um grupo) — projeto que não agrupa com nada é achado, "
            "não defeito, e por isso aparece aqui em vez de ser escondido."
        ),
    )


def build_atlas_topicos(con, repo_root: Path, limiar_titulo: int = LIMIAR_TITULO_PUBLICO) -> "dict | None":
    """Modelagem de tópicos (LDA) sobre bag-of-words — ver
    `clustering.executar_topicos` e `_build_atlas_nao_taxonomico`. Sem
    ruído: LDA dá uma distribuição de probabilidade pra todo documento, o
    "cluster" aqui é só o tópico de maior probabilidade (argmax)."""
    return _build_atlas_nao_taxonomico(
        con, repo_root, nome_clusters="clusters_topicos", id_ruido=None, limiar_titulo=limiar_titulo,
        aviso_rotulo=(
            "LDA (Latent Dirichlet Allocation) sobre contagem de palavras (bag-of-words) — "
            "modelagem de tópicos transversais, não classificação pela taxonomia oficial da "
            "ANPPOM nem clusterização por embedding denso (é o 3º método, estruturalmente "
            "diferente dos outros dois: vem de co-ocorrência de palavra, não de posição "
            "semântica). \"Tema\" vem dos termos mais associados ao tópico. Cada projeto tem "
            "uma distribuição de probabilidade sobre todos os tópicos — aqui é mostrado só o "
            "de maior probabilidade; por isso não há \"ruído\": todo projeto sempre tem um "
            "tópico dominante, por construção do método."
        ),
    )


def build_atlas_coautoria(con, repo_root: Path, limiar_titulo: int = LIMIAR_TITULO_PUBLICO) -> "dict | None":
    """Rede de colaboração (Louvain sobre pessoa compartilhada) — ver
    `clustering.executar_coautoria` e `_build_atlas_nao_taxonomico`. O mais
    diferente dos quatro métodos: não olha o texto do projeto pra formar o
    cluster (só pra rotular depois com TF-IDF) — olha quem é membro de qual
    projeto. Posição (x, y) também não vem de redução de embedding, vem do
    próprio layout de força do grafo de colaboração (`spring_layout`):
    proximidade aqui significa "perto na rede", não "conteúdo parecido".
    "Ruído" (`cluster == -1`) é "sem colaboração REGISTRADA" — projeto sem
    nenhuma pessoa em comum com outro do corpus, não um julgamento sobre a
    colaboração real do grupo (a base só capta o que a Plataforma lista
    como vínculo formal)."""
    return _build_atlas_nao_taxonomico(
        con, repo_root, nome_clusters="clusters_coautoria", id_ruido=-1,
        rotulo_ruido="Sem colaboração registrada", limiar_titulo=limiar_titulo,
        aviso_rotulo=(
            "Rede de colaboração — comunidades de Louvain sobre projetos que compartilham "
            "PESSOA (docente, discente ou participante externo em comum), não sobre texto. É o "
            "4º método, o mais diferente dos outros três: ANPPOM/HDBSCAN vêm de embedding "
            "denso, LDA de bag-of-words — os três olham a descrição do projeto; este olha quem "
            "trabalha com quem. \"Tema\" (palavra-chave TF-IDF) é calculado DEPOIS, só pra dar "
            "uma pista de conteúdo — nunca entra na formação do cluster. A posição (x, y) "
            "também não vem de redução de embedding: vem do layout de força do próprio grafo "
            "de colaboração — proximidade aqui é \"perto na rede\", não \"conteúdo parecido\". "
            "\"Sem colaboração registrada\" é projeto sem nenhuma pessoa em comum com outro do "
            "corpus — a base só capta vínculo formal listado na Plataforma, não colaboração "
            "informal."
        ),
    )


def build_producoes_projeto(con, repo_root: Path) -> "dict | None":
    """Produções vinculadas a cada projeto do atlas, para expandir no `/atlas`.

    Decisão explícita do usuário (2026-08-08, PLANO §4.2.5 "melhorias
    futuras"): ao contrário do resto deste módulo, título e link de produção
    saem **sempre**, sem o filtro `titulo_publico`/limiar de cluster que
    protege o título do *projeto*. Justificativa do usuário: produção
    bibliográfica/artística já é registro público em outro lugar (a própria
    Plataforma Sucupira, periódicos, editoras) — a proteção de
    `LIMIAR_TITULO_PUBLICO` é sobre não ajudar a re-identificar o
    *coordenador* de um projeto pequeno, não sobre esconder produção que já
    circula publicamente por conta própria. Chaveado pelo mesmo id substituto
    do atlas (nunca `id_projeto` real).

    Achado rodando `analise.pii_test` pela primeira vez sobre este arquivo:
    170 títulos de produção contêm o nome canônico de uma pessoa real da base
    (ex.: produção sobre/com um docente ou colaborador nomeado no próprio
    título — "MARCELO BRATKE", "LUCIANA NODA"). Isso é diferente do resto do
    guarda-corpo de nome (que protege coordenador via correlação indireta):
    aqui o nome está *literalmente no texto* que sairia público. Sanitizado
    com a mesma detecção de `analise.pii_test.carregar_reais` +
    `compilar_regex_nomes` — título e link somem SÓ para esses casos, mas o
    item continua na lista (tipo/subtipo/ano/classe), pra contagem bater com
    `n_producoes` do atlas em vez de simplesmente desaparecer sem explicação.
    """
    from analise.pii_test import carregar_reais, compilar_regex_nomes

    linhas = _carregar_clusters(repo_root)
    if linhas is None:
        return None
    ids_reais = sorted({str(r["id_projeto"]) for r in linhas})
    id_map = _carregar_id_map_projetos(repo_root, ids_reais)

    db_path = Path(con.execute("PRAGMA database_list").fetchone()[2])
    _, _, nomes_reais = carregar_reais(db_path)
    rx_nomes = compilar_regex_nomes(nomes_reais)

    resultado: dict[str, list] = {}
    n_redigidos = 0
    rows = con.execute("""
        SELECT id_projeto, nome, tipo, subtipo, ano_base, link
        FROM producoes
        WHERE id_projeto IS NOT NULL AND link IS NOT NULL AND TRIM(link) != ''
        ORDER BY ano_base DESC, nome
    """)
    for r in rows:
        id_sub = id_map.get(str(r["id_projeto"]))
        if id_sub is None:
            continue
        nome_prod = r["nome"]
        tem_nome_real = bool(rx_nomes and nome_prod and rx_nomes.search(nome_prod))
        if tem_nome_real:
            n_redigidos += 1
        resultado.setdefault(id_sub, []).append({
            "nome": None if tem_nome_real else nome_prod,
            "tipo": r["tipo"],
            "subtipo": r["subtipo"],
            "ano": r["ano_base"],
            "link": None if tem_nome_real else r["link"],
            "classe": classe_da_rubrica(r["tipo"], r["subtipo"]),
        })
    if n_redigidos:
        print(f"  producoes_projeto: {n_redigidos} títulos com nome de pessoa real redigidos (título/link omitidos)")
    return resultado


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

# A sigla da IES na base vem com o campus junto num caso só. No site ela é
# rótulo de eixo, de bloco de cartograma e de célula de tabela — e "UFPB-JOÃO
# PESSOA" não cabe em nenhum deles. A troca é feita **na saída**, não na base:
# `instituicoes.sigla` continua sendo o que a CAPES publica.
SIGLA_EXIBICAO = {"UFPB-JOÃO PESSOA": "UFPB"}


def _renomear(valor):
    """Aplica SIGLA_EXIBICAO recursivamente — em valores e em chaves de mapa."""
    if isinstance(valor, str):
        return SIGLA_EXIBICAO.get(valor, valor)
    if isinstance(valor, list):
        return [_renomear(v) for v in valor]
    if isinstance(valor, dict):
        return {_renomear(k): _renomear(v) for k, v in valor.items()}
    return valor


def write_json(out_dir: Path, name: str, data):
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / f"{name}.json"
    with open(path, "w", encoding="utf-8") as f:
        json.dump(_renomear(data), f, ensure_ascii=False, separators=(",", ":"))
    size_kb = path.stat().st_size / 1024
    print(f"  {name}.json  ({size_kb:.1f} KB)")


def main():
    parser = argparse.ArgumentParser(description="Generate public data bundle")
    parser.add_argument("--db", default=str(DEFAULT_DB))
    parser.add_argument("--out", default=str(DEFAULT_OUT))
    args = parser.parse_args()

    db = Path(args.db)
    out = Path(args.out)

    if not db.exists():
        raise FileNotFoundError(f"Database not found: {db}. Run montar_base.py first.")

    print(f"Building public data bundle from {db} …")
    con = _con(db)

    write_json(out, "programas", build_programas(con))
    write_json(out, "producao_por_ano", build_producao_por_ano(con))
    write_json(out, "totais_nacionais", build_totais_nacionais(con))
    write_json(out, "rede_programas", build_rede_programas(con))
    write_json(out, "perfil_programas", build_perfil_programas(con))
    write_json(out, "rede_regioes", build_rede_regioes(con))
    write_json(out, "rede_ufs", build_rede_ufs(con))
    write_json(out, "coautoria_docente_discente", build_coautoria_docente_discente(con))
    write_json(out, "rede_obras_por_tipo", build_rede_obras_por_tipo(con))
    write_json(out, "comparabilidade", build_comparabilidade(con))
    write_json(out, "cobertura", build_cobertura(con, REPO_ROOT))
    write_json(out, "concentracao", build_concentracao(con))
    write_json(out, "projetos", build_projetos(con))
    write_json(out, "distribuicao_notas", build_distribuicao_notas(con))
    write_json(out, "internacionalizacao", build_internacionalizacao(con))
    write_json(out, "endogenia", build_endogenia(con))

    # Indices (if available)
    indices = build_indices(REPO_ROOT)
    if indices is not None:
        # Strip any raw ids before publishing
        safe = []
        for row in indices:
            clean = {k: v for k, v in row.items() if k not in ("id_programa",)}
            safe.append(clean)
        write_json(out, "indices", safe)
    else:
        print("  indices.json skipped (run analise/indices.py first)")

    atlas = build_atlas(con, REPO_ROOT)
    if atlas is not None:
        write_json(out, "atlas", atlas)
    else:
        print("  atlas.json skipped (run analise/clustering.py first)")

    atlas_hdbscan = build_atlas_hdbscan(con, REPO_ROOT)
    if atlas_hdbscan is not None:
        write_json(out, "atlas_hdbscan", atlas_hdbscan)
    else:
        print("  atlas_hdbscan.json skipped (run analise/clustering.py --hdbscan first)")

    atlas_topicos = build_atlas_topicos(con, REPO_ROOT)
    if atlas_topicos is not None:
        write_json(out, "atlas_topicos", atlas_topicos)
    else:
        print("  atlas_topicos.json skipped (run analise/clustering.py --topicos first)")

    atlas_coautoria = build_atlas_coautoria(con, REPO_ROOT)
    if atlas_coautoria is not None:
        write_json(out, "atlas_coautoria", atlas_coautoria)
    else:
        print("  atlas_coautoria.json skipped (run analise/clustering.py --coautoria first)")

    producoes_projeto = build_producoes_projeto(con, REPO_ROOT)
    if producoes_projeto is not None:
        write_json(out, "producoes_projeto", producoes_projeto)
    else:
        print("  producoes_projeto.json skipped (run analise/clustering.py first)")

    con.close()
    print("Done. Run the PII test before deploying: python3 -m analise.pii_test")


if __name__ == "__main__":
    main()
