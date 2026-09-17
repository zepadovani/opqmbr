"""
Computes programa_indices: one row per program, ~15 metrics.

Reads sucupira.db (must exist; run montar_base.py + importar_quadrienal.py first).
Writes derivados/indices.parquet (requires pandas + pyarrow).

Usage:
    python3 -m analise.indices [--db PATH] [--out PATH]

Metrics produced (columns in programa_indices):
  id_programa, sigla, nome_ies, uf, regiao
  n_docentes               — distinct Docente authors 2021–2024
  n_producoes              — total productions 2021–2024
  n_teses                  — total theses 2021–2024
  n_projetos               — distinct projects reported in any aba

  # Produção per capita (by docente, 2021–2024)
  prod_per_docente         — total productions / docentes
  artigos_per_docente      — ARTIGO EM PERIÓDICO / docentes
  musica_per_docente       — MÚSICA / docentes
  anais_per_docente        — TRABALHO EM ANAIS / docentes

  # Internacionalização
  pct_intl_pais            — productions with (PAC) País ≠ Brasil / total ARTÍSTICO-CULTURAL
  pct_intl_idioma          — productions with Idioma ≠ Português / total with Idioma
  pct_intl_either          — union of country ≠ Brasil or language ≠ Português

  # Colaboração e abertura
  pct_externo              — Participante externo / total unique persons in autoria
  pct_discente             — Discente / total unique persons in autoria
  endogenia_coautoria      — internal coauthorships / total coauthorships
    (internal = both authors from the same program; proxy via tipo_vinculo)

  # Projetos
  taxa_orfaos              — projects with zero productions / total projects
  n_financiados            — projects with at least one financiador

  # Nota CAPES
  nota_anterior            — nota do quadriênio anterior
  nota_2025                — nota_quadrienal_2025 (from programa_nota view)
  variacao_nota            — nota_2025 - nota_anterior
"""

import argparse
import os
import sqlite3
from pathlib import Path

REPO_ROOT = Path(__file__).parent.parent
DEFAULT_DB = REPO_ROOT / "sucupira.db"
DEFAULT_OUT = REPO_ROOT / "derivados" / "indices.parquet"

# Only consider productions 2021–2024 (the evaluated quadrennium)
ANOS_QUADRIENIO = (2021, 2022, 2023, 2024)


def compute(db_path: Path) -> list[dict]:
    con = sqlite3.connect(db_path)
    con.row_factory = sqlite3.Row

    rows = con.execute("""
        SELECT
            p.id_programa,
            i.sigla,
            i.nome  AS nome_ies,
            i.uf,
            i.regiao
        FROM programas p
        JOIN instituicoes i ON i.id_ies = p.id_ies
        ORDER BY i.sigla
    """).fetchall()

    result = []
    for row in rows:
        pid = row["id_programa"]
        entry = dict(row)
        _add_producao_metrics(con, pid, entry)
        _add_intl_metrics(con, pid, entry)
        _add_colaboracao_metrics(con, pid, entry)
        _add_projeto_metrics(con, pid, entry)
        _add_nota_metrics(con, pid, entry)
        result.append(entry)

    con.close()
    return result


def _add_producao_metrics(con, pid, entry):
    # docentes: distinct persons with tipo_vinculo='Docente' in 2021–2024
    r = con.execute("""
        SELECT COUNT(DISTINCT a.id_pessoa) n
        FROM autoria a
        JOIN producoes pr ON pr.id_producao = a.id_producao
        WHERE pr.id_programa = ? AND pr.ano_base IN (?,?,?,?)
          AND a.tipo_vinculo = 'Docente'
    """, (pid, *ANOS_QUADRIENIO)).fetchone()
    n_doc = r["n"] or 0
    entry["n_docentes"] = n_doc

    r = con.execute("""
        SELECT COUNT(*) n FROM producoes
        WHERE id_programa = ? AND ano_base IN (?,?,?,?)
    """, (pid, *ANOS_QUADRIENIO)).fetchone()
    n_prod = r["n"] or 0
    entry["n_producoes"] = n_prod

    r = con.execute("""
        SELECT COUNT(*) n FROM teses
        WHERE id_programa = ? AND ano_base IN (?,?,?,?)
    """, (pid, *ANOS_QUADRIENIO)).fetchone()
    entry["n_teses"] = r["n"] or 0

    def _per_docente(count):
        if n_doc == 0:
            return None
        return round(count / n_doc, 2)

    entry["prod_per_docente"] = _per_docente(n_prod)

    for subtipo, key in [
        ("ARTIGO EM PERIÓDICO", "artigos_per_docente"),
        ("MÚSICA", "musica_per_docente"),
        ("TRABALHO EM ANAIS", "anais_per_docente"),
    ]:
        r = con.execute("""
            SELECT COUNT(*) n FROM producoes
            WHERE id_programa = ? AND ano_base IN (?,?,?,?) AND subtipo = ?
        """, (pid, *ANOS_QUADRIENIO, subtipo)).fetchone()
        entry[key] = _per_docente(r["n"] or 0)


def _add_intl_metrics(con, pid, entry):
    # (PAC) País ≠ Brasil  for ARTÍSTICO-CULTURAL
    r_total = con.execute("""
        SELECT COUNT(DISTINCT pr.id_producao) n
        FROM producoes pr
        WHERE pr.id_programa = ? AND pr.tipo = 'ARTÍSTICO-CULTURAL'
          AND pr.ano_base IN (?,?,?,?)
    """, (pid, *ANOS_QUADRIENIO)).fetchone()
    n_ac = r_total["n"] or 0

    r_pais = con.execute("""
        SELECT COUNT(DISTINCT pr.id_producao) n
        FROM producoes pr
        JOIN producao_detalhe d ON d.id_producao = pr.id_producao
        WHERE pr.id_programa = ? AND pr.tipo = 'ARTÍSTICO-CULTURAL'
          AND pr.ano_base IN (?,?,?,?)
          AND d.item = '(PAC) País'
          AND lower(trim(d.valor)) NOT IN ('brasil', 'brazil', '')
    """, (pid, *ANOS_QUADRIENIO)).fetchone()
    n_pais_intl = r_pais["n"] or 0

    # Idioma ≠ Português  for all productions
    r_idioma_total = con.execute("""
        SELECT COUNT(DISTINCT pr.id_producao) n
        FROM producoes pr
        JOIN producao_detalhe d ON d.id_producao = pr.id_producao
        WHERE pr.id_programa = ? AND pr.ano_base IN (?,?,?,?)
          AND d.item = 'Idioma'
    """, (pid, *ANOS_QUADRIENIO)).fetchone()
    n_idioma_total = r_idioma_total["n"] or 0

    r_idioma_intl = con.execute("""
        SELECT COUNT(DISTINCT pr.id_producao) n
        FROM producoes pr
        JOIN producao_detalhe d ON d.id_producao = pr.id_producao
        WHERE pr.id_programa = ? AND pr.ano_base IN (?,?,?,?)
          AND d.item = 'Idioma'
          AND lower(trim(d.valor)) NOT IN ('português', 'portugues', '')
    """, (pid, *ANOS_QUADRIENIO)).fetchone()
    n_idioma_intl = r_idioma_intl["n"] or 0

    entry["pct_intl_pais"] = round(100 * n_pais_intl / n_ac, 1) if n_ac else None
    entry["pct_intl_idioma"] = (
        round(100 * n_idioma_intl / n_idioma_total, 1) if n_idioma_total else None
    )


def _add_colaboracao_metrics(con, pid, entry):
    r = con.execute("""
        SELECT
            COUNT(DISTINCT CASE WHEN a.tipo_vinculo = 'Participante externo' THEN a.id_pessoa END) n_ext,
            COUNT(DISTINCT CASE WHEN a.tipo_vinculo = 'Discente' THEN a.id_pessoa END) n_disc,
            COUNT(DISTINCT a.id_pessoa) n_total
        FROM autoria a
        JOIN producoes pr ON pr.id_producao = a.id_producao
        WHERE pr.id_programa = ? AND pr.ano_base IN (?,?,?,?)
    """, (pid, *ANOS_QUADRIENIO)).fetchone()

    n_total = r["n_total"] or 0
    entry["pct_externo"] = (
        round(100 * r["n_ext"] / n_total, 1) if n_total else None
    )
    entry["pct_discente"] = (
        round(100 * r["n_disc"] / n_total, 1) if n_total else None
    )

    # Endogenia de coautoria: pairs where both authors share the same tipo_vinculo != externo
    # Proxy: count of coauthorship pairs where both are Docente or Discente (internal)
    # vs. pairs where one is Participante externo (external)
    r2 = con.execute("""
        SELECT
            SUM(CASE WHEN a1.tipo_vinculo != 'Participante externo'
                      AND a2.tipo_vinculo != 'Participante externo' THEN 1 ELSE 0 END) n_interno,
            COUNT(*) n_total_pairs
        FROM autoria a1
        JOIN autoria a2 ON a2.id_producao = a1.id_producao AND a2.id_pessoa > a1.id_pessoa
        JOIN producoes pr ON pr.id_producao = a1.id_producao
        WHERE pr.id_programa = ? AND pr.ano_base IN (?,?,?,?)
    """, (pid, *ANOS_QUADRIENIO)).fetchone()

    n_pairs = r2["n_total_pairs"] or 0
    entry["endogenia_coautoria"] = (
        round(100 * r2["n_interno"] / n_pairs, 1) if n_pairs else None
    )


def _add_projeto_metrics(con, pid, entry):
    r = con.execute("""
        SELECT COUNT(DISTINCT pa.id_projeto) n
        FROM projeto_ano pa
        WHERE pa.id_programa = ?
    """, (pid,)).fetchone()
    n_proj = r["n"] or 0
    entry["n_projetos"] = n_proj

    # Orphans: projects with zero linked productions
    r_orfaos = con.execute("""
        SELECT COUNT(DISTINCT pa.id_projeto) n
        FROM projeto_ano pa
        LEFT JOIN producoes pr ON pr.id_projeto = pa.id_projeto
        WHERE pa.id_programa = ? AND pr.id_producao IS NULL
    """, (pid,)).fetchone()
    n_orf = r_orfaos["n"] or 0
    entry["taxa_orfaos"] = round(100 * n_orf / n_proj, 1) if n_proj else None

    r_fin = con.execute("""
        SELECT COUNT(DISTINCT pa.id_projeto) n
        FROM projeto_ano pa
        JOIN projeto_financiador pf ON pf.id_projeto = pa.id_projeto
        WHERE pa.id_programa = ?
    """, (pid,)).fetchone()
    entry["n_financiados"] = r_fin["n"] or 0


def _nota_numerica(valor):
    """Nota da CAPES como inteiro; None para 'A', vazio ou qualquer não numérico.

    A planilha grava a nota como texto e usa "A" para "sem nota" (programa em
    implantação ou primeira avaliação). Deixar isso passar cru faz o consumidor
    comparar string com número em silêncio — foi o que já produziu "0 programas
    com nota 7" no site, com dois programas nota 7 na tela.
    """
    if valor is None:
        return None
    texto = str(valor).strip()
    return int(texto) if texto.isdigit() else None


def _add_nota_metrics(con, pid, entry):
    r = con.execute("""
        SELECT nota_quadrienio_anterior, nota_quadrienal_2025, variacao
        FROM programa_nota WHERE id_programa = ?
    """, (pid,)).fetchone()
    if r:
        entry["nota_anterior"] = _nota_numerica(r["nota_quadrienio_anterior"])
        entry["nota_2025"] = _nota_numerica(r["nota_quadrienal_2025"])
        entry["variacao_nota"] = (
            entry["nota_2025"] - entry["nota_anterior"]
            if entry["nota_2025"] is not None and entry["nota_anterior"] is not None
            else None
        )
    else:
        entry["nota_anterior"] = None
        entry["nota_2025"] = None
        entry["variacao_nota"] = None


def main():
    parser = argparse.ArgumentParser(description="Compute programa_indices")
    parser.add_argument("--db", default=str(DEFAULT_DB), help="Path to sucupira.db")
    parser.add_argument("--out", default=str(DEFAULT_OUT), help="Output parquet path")
    args = parser.parse_args()

    db = Path(args.db)
    if not db.exists():
        raise FileNotFoundError(f"Database not found: {db}")

    print(f"Reading from {db} …")
    data = compute(db)
    print(f"Computed indices for {len(data)} programs.")

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)

    try:
        import pandas as pd
        df = pd.DataFrame(data)
        df.to_parquet(out, index=False)
        print(f"Saved to {out}")
    except ImportError:
        import json
        json_out = out.with_suffix(".json")
        with open(json_out, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        print(f"pandas not available; saved JSON to {json_out}")


if __name__ == "__main__":
    main()
