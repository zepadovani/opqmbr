"""
Exporta resumos de projetos agrupados por área (nível 1) para subclassificação por IA externa (Gemini).

Pipeline:
1. Lê `id_projeto`, `nome`, `descricao` de `sucupira.db`.
2. Lê `id_projeto` -> `tema` de `derivados/clusters.json`.
3. Agrupa os projetos por área (9 subáreas da ANPPOM).
4. Escreve um arquivo Markdown por área em `derivados/exportacao_subareas/<slug>.md`
   com um prompt pronto para colar em LLM externa e os resumos de cada projeto.
5. Escreve `derivados/exportacao_subareas/_indice.md` com contagens e orientações de uso.

Nota de manuseio de dados (Privacidade):
    O campo `descricao` não é publicado no site público (ver `build_public.py`).
    Este export coloca o resumo completo dos projetos num arquivo local para que
    o usuário possa colá-lo manualmente numa IA externa (Gemini). Trata-se de uma
    decisão do usuário sobre o próprio dado, e não de uma publicação automática.

Uso:
    python3 -m analise.exportar_subareas_ia [--db sucupira.db] [--clusters derivados/clusters.json] [--out-dir derivados/exportacao_subareas]

Stdlib pura (sqlite3, json, pathlib, argparse, re, unicodedata).
"""

import argparse
import json
import re
import sqlite3
import sys
import unicodedata
from pathlib import Path

REPO_ROOT = Path(__file__).parent.parent
DEFAULT_DB = REPO_ROOT / "sucupira.db"
DEFAULT_CLUSTERS = REPO_ROOT / "derivados" / "clusters.json"
DEFAULT_OUT_DIR = REPO_ROOT / "derivados" / "exportacao_subareas"

# Ordem canônica das 9 subáreas (espelha ANPPOM_SUBAREAS em analise/clustering.py)
SUBAREAS_ORDEM = [
    "Composição e Sonologia",
    "Educação Musical",
    "Etnomusicologia",
    "Música Popular",
    "Performance Musical",
    "Musicologia",
    "Teoria e Análise Musical",
    "Musicoterapia",
    "Demais Subáreas e Interfaces da Música",
]


def slug(texto: str) -> str:
    """Reaproveita o comportamento de slug de analise.preparar_logos (remove acento, minúsculas, hífens)."""
    sem_acento = "".join(
        c for c in unicodedata.normalize("NFD", texto) if unicodedata.category(c) != "Mn"
    )
    return re.sub(r"-+", "-", re.sub(r"[^a-z0-9]+", "-", sem_acento.lower())).strip("-")


def exportar_subareas(
    caminho_db: Path = DEFAULT_DB,
    caminho_clusters: Path = DEFAULT_CLUSTERS,
    diretorio_saida: Path = DEFAULT_OUT_DIR,
) -> None:
    if not caminho_clusters.exists():
        print(
            f"ERRO: Arquivo de clusters não encontrado: {caminho_clusters}\n"
            f"      Rode primeiro `python3 -m analise.clustering` para gerar os clusters.",
            file=sys.stderr,
        )
        sys.exit(1)

    if not caminho_db.exists():
        print(
            f"ERRO: Banco de dados SQLite não encontrado: {caminho_db}",
            file=sys.stderr,
        )
        sys.exit(1)

    # 1. Carregar mapeamento id_projeto -> tema de clusters.json
    with open(caminho_clusters, encoding="utf-8") as f:
        clusters_data = json.load(f)

    mapa_tema = {str(item["id_projeto"]): item["tema"] for item in clusters_data}

    # 2. Ler descrições do sucupira.db
    con = sqlite3.connect(caminho_db)
    rows = con.execute(
        "SELECT id_projeto, nome, descricao FROM projetos WHERE descricao IS NOT NULL AND TRIM(descricao) != ''"
    ).fetchall()
    con.close()

    mapa_projetos = {
        str(r[0]): {"nome": (r[1] or "").strip(), "descricao": (r[2] or "").strip()}
        for r in rows
    }

    # 3. Agrupar por tema na ordem de SUBAREAS_ORDEM
    projetos_por_tema: dict[str, list[tuple[str, dict]]] = {t: [] for t in SUBAREAS_ORDEM}

    # Garantir que temas fora da ordem canônica (se houver) também sejam aceitos
    for item in clusters_data:
        id_p = str(item["id_projeto"])
        tema = item["tema"]
        if tema not in projetos_por_tema:
            projetos_por_tema[tema] = []
        if id_p in mapa_projetos:
            projetos_por_tema[tema].append((id_p, mapa_projetos[id_p]))

    diretorio_saida.mkdir(parents=True, exist_ok=True)

    total_exportados = 0
    linhas_indice = [
        "# Exportação de Subáreas por Área para IA Externa\n",
        "Este diretório contém os resumos dos projetos agrupados por área temática de nível 1, ",
        "prontos para serem submetidos ao Gemini para subdivisão em pelo menos 10 subáreas de nível 2.\n",
        "## Resumo dos Arquivos Gerados\n",
    ]

    # 4. Escrever cada arquivo de área
    for tema in list(projetos_por_tema.keys()):
        projetos = projetos_por_tema[tema]
        n_proj = len(projetos)
        total_exportados += n_proj
        nome_arquivo = f"{slug(tema)}.md"
        caminho_arquivo = diretorio_saida / nome_arquivo

        min_sub = 10 if n_proj >= 50 else max(4, n_proj // 5)
        conteudo = [
            f"# {tema} — {n_proj} projetos\n",
            "> Você é um especialista em musicologia e pesquisa acadêmica em música.\n"
            ">\n"
            f"> Abaixo estão {n_proj} projetos de pesquisa em música atualmente classificados na área geral \"{tema}\".\n"
            "> Sua tarefa é analisar o título e o resumo de cada projeto e agrupá-los (clusterizar) por afinidade temática real em subáreas mais específicas.\n"
            ">\n"
            "> ### Regras de Agrupamento:\n"
            f"> 1. Crie pelo menos {min_sub} subáreas temáticas específicas e bem definidas com base nos títulos e resumos.\n"
            "> 2. Nomes das subáreas devem ser claros, descritivos e em português (ex: \"## Composição Assistida por Computador\").\n"
            "> 3. Todo projeto deve ser alocado em EXATAMENTE UMA subárea. Não omita nenhum ID e não duplique IDs.\n"
            ">\n"
            "> ### Formato de Saída (OBRIGATÓRIO PARA REIMPORTAÇÃO):\n"
            "> Responda no formato Markdown estruturado abaixo (sem introduções ou explicações fora do formato):\n"
            ">\n"
            "> ## Nome da Primeira Subárea\n"
            "> - ID_A\n"
            "> - ID_B\n"
            ">\n"
            "> ## Nome da Segunda Subárea\n"
            "> - ID_C\n"
            "> - ID_D\n"
            ">\n"
            "> Não altere nem invente IDs. Use exatamente o identificador fornecido no cabeçalho `### [ID: <id_projeto>]` de cada projeto.\n\n"
            "---\n",
        ]

        for id_p, dados in projetos:
            titulo = dados["nome"]
            desc = dados["descricao"]
            conteudo.append(f"### [ID: {id_p}] {titulo}\n\n{desc}\n\n---")

        caminho_arquivo.write_text("\n".join(conteudo) + "\n", encoding="utf-8")
        linhas_indice.append(f"- [`{nome_arquivo}`]({nome_arquivo}): **{tema}** ({n_proj} projetos)")

    linhas_indice.extend([
        f"\n**Total de projetos exportados:** {total_exportados}\n",
        "## Instruções de Uso\n",
        "1. Abra um dos arquivos `.md` deste diretório.",
        "2. Copie todo o conteúdo do arquivo (incluindo o prompt no topo e os projetos).",
        "3. Cole no Gemini e aguarde a resposta com a lista de IDs agrupados por `## <Nome da subárea>`.",
        "4. Guarde a resposta da IA para o próximo passo (script de reimportação).",
    ])

    (diretorio_saida / "_indice.md").write_text("\n".join(linhas_indice) + "\n", encoding="utf-8")
    print(f"Exportação concluída com sucesso!")
    print(f"  Diretório de saída: {diretorio_saida}")
    print(f"  Arquivos criados: {len(projetos_por_tema)} áreas + _indice.md")
    print(f"  Total de projetos: {total_exportados}")


def main():
    parser = argparse.ArgumentParser(
        description="Exporta projetos por área para subclassificação por IA externa."
    )
    parser.add_argument(
        "--db",
        type=Path,
        default=DEFAULT_DB,
        help=f"Caminho para o banco sucupira.db (padrão: {DEFAULT_DB})",
    )
    parser.add_argument(
        "--clusters",
        type=Path,
        default=DEFAULT_CLUSTERS,
        help=f"Caminho para derivados/clusters.json (padrão: {DEFAULT_CLUSTERS})",
    )
    parser.add_argument(
        "--out-dir",
        type=Path,
        default=DEFAULT_OUT_DIR,
        help=f"Diretório de saída (padrão: {DEFAULT_OUT_DIR})",
    )
    args = parser.parse_args()

    exportar_subareas(
        caminho_db=args.db,
        caminho_clusters=args.clusters,
        diretorio_saida=args.out_dir,
    )


if __name__ == "__main__":
    main()
