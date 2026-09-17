"""
Subclassificação de Nível 2 dos projetos de pesquisa por subárea temática.

Pipeline:
1. Tenta ler e parsear arquivos Markdown de resposta da IA externa em `derivados/exportacao_subareas/*.md`
   (procura por blocos `## <Nome da Subárea>` seguidos de `- <id_projeto>` ou `- [ID: <id_projeto>]`).
2. Para projetos não mapeados por respostas externas, aplica clustering semântico automatizado
   por área (nível 1), criando entre 4 e 15 subáreas de nível 2 finas e descritivas baseadas em título e resumo.
3. Escreve `analise/subareas_nivel2.json` (mapeamento `id_projeto` -> `subarea_nivel2`).

Uso:
    python3 -m analise.classificar_subareas_ia [--db sucupira.db] [--clusters derivados/clusters.json] [--out analise/subareas_nivel2.json]

Stdlib + scikit-learn/numpy (para fallback local) se necessário.
"""

import argparse
import json
import re
import sqlite3
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).parent.parent
DEFAULT_DB = REPO_ROOT / "sucupira.db"
DEFAULT_CLUSTERS = REPO_ROOT / "derivados" / "clusters.json"
DEFAULT_EXPORT_DIR = REPO_ROOT / "derivados" / "exportacao_subareas"
DEFAULT_OUT_JSON = REPO_ROOT / "analise" / "subareas_nivel2.json"

STOPWORDS_MINIMAL = {
    "a", "o", "as", "os", "de", "do", "da", "dos", "das", "em", "no", "na", "nos", "nas",
    "para", "por", "com", "uma", "um", "umas", "uns", "sobre", "entre", "como", "que",
    "se", "sua", "seu", "suas", "seus", "ao", "aos", "à", "às", "mais", "menos",
    "pesquisa", "projeto", "estudo", "análise", "trabalho", "música", "musical", "musicais",
    "processos", "práticas", "desenvolvimento", "abordagem", "reflexões", "perspectivas",
    "investigação", "contribuições", "aspectos", "contexto", "campo", "forma", "visando",
}


def parsear_arquivos_exportados(diretorio_export: Path) -> dict[str, str]:
    """Parseia respostas de arquivos .md onde a IA estruturou `## Subárea` + `- ID`."""
    mapa_subareas: dict[str, str] = {}
    if not diretorio_export.exists():
        return mapa_subareas

    for arq in diretorio_export.glob("*.md"):
        if arq.name.startswith("_"):
            continue
        conteudo = arq.read_text(encoding="utf-8")
        subarea_atual = None
        for linha in conteudo.splitlines():
            linha_str = linha.strip()
            if linha_str.startswith("## "):
                nome_sub = linha_str[3:].strip()
                # Ignorar cabeçalhos gerais de instrução ou formato
                if not nome_sub.startswith("<") and not nome_sub.startswith("Nome"):
                    subarea_atual = nome_sub
            elif subarea_atual and (linha_str.startswith("- ") or linha_str.startswith("* ")):
                item = linha_str[2:].strip()
                m = re.search(r"\b(\d{5,8})\b", item)
                if m:
                    id_p = m.group(1)
                    mapa_subareas[id_p] = subarea_atual

    return mapa_subareas


def extrair_rotulo_topico(textos_cluster: list[tuple[str, str]], tema_pai: str) -> str:
    """Gera um nome representativo de subárea para um cluster baseado nas palavras mais frequentes dos títulos e resumos."""
    contagem: dict[str, int] = {}
    for titulo, desc in textos_cluster:
        texto_comb = (titulo + " " + desc).lower()
        palavras = re.findall(r"[a-zà-ú]{4,}", texto_comb)
        for w in palavras:
            if w not in STOPWORDS_MINIMAL:
                contagem[w] = contagem.get(w, 0) + 1

    top_palavras = sorted(contagem.items(), key=lambda x: x[1], reverse=True)[:3]
    if not top_palavras:
        return f"{tema_pai} — Geral"

    # Formatar termos com primeira letra maiúscula
    rotulo = " e ".join([w.capitalize() for w, _ in top_palavras[:2]])
    return rotulo


def clusterizar_fallback_local(
    projetos_grupo: list[tuple[str, str, str]], tema_pai: str
) -> dict[str, str]:
    """Fallback local usando TF-IDF + AgglomerativeClustering do scikit-learn para gerar subáreas de nível 2."""
    n_proj = len(projetos_grupo)
    if n_proj == 0:
        return {}

    n_clusters = 10 if n_proj >= 50 else max(3, n_proj // 5)

    try:
        from sklearn.cluster import AgglomerativeClustering
        from sklearn.feature_extraction.text import TfidfVectorizer

        corpus = [f"{nome} {desc}" for _, nome, desc in projetos_grupo]
        vectorizer = TfidfVectorizer(max_features=500, stop_words="english")
        X = vectorizer.fit_transform(corpus).toarray()

        if X.shape[0] <= n_clusters:
            clustering_labels = list(range(X.shape[0]))
        else:
            clustering = AgglomerativeClustering(n_clusters=n_clusters)
            clustering_labels = clustering.fit_predict(X)

        clusters_textos: dict[int, list[tuple[str, str]]] = {}
        clusters_ids: dict[int, list[str]] = {}
        for idx, (id_p, nome, desc) in enumerate(projetos_grupo):
            c_id = int(clustering_labels[idx])
            clusters_textos.setdefault(c_id, []).append((nome, desc))
            clusters_ids.setdefault(c_id, []).append(id_p)

        res: dict[str, str] = {}
        nombres_usados: set[str] = set()

        for c_id, ids in clusters_ids.items():
            nome_sub = extrair_rotulo_topico(clusters_textos[c_id], tema_pai)
            # Evitar nomes duplicados
            versao = 1
            nome_unico = nome_sub
            while nome_unico in nombres_usados:
                versao += 1
                nome_unico = f"{nome_sub} ({versao})"
            nombres_usados.add(nome_unico)

            for id_p in ids:
                res[id_p] = nome_unico

        return res
    except Exception as e:
        print(f"  [Aviso] Fallback para regras simples em {tema_pai}: {e}", file=sys.stderr)
        return {id_p: f"{tema_pai} — Grupo {(idx % n_clusters) + 1}" for idx, (id_p, _, _) in enumerate(projetos_grupo)}


def gerar_subareas_nivel2(
    caminho_db: Path = DEFAULT_DB,
    caminho_clusters: Path = DEFAULT_CLUSTERS,
    diretorio_export: Path = DEFAULT_EXPORT_DIR,
    caminho_out: Path = DEFAULT_OUT_JSON,
) -> None:
    if not caminho_clusters.exists() or not caminho_db.exists():
        print("ERRO: db ou clusters.json não encontrados.", file=sys.stderr)
        sys.exit(1)

    # 1. Tentar ler do export parseado
    mapa_parseado = parsear_arquivos_exportados(diretorio_export)
    print(f"Lidos {len(mapa_parseado)} mapeamentos a partir de arquivos em {diretorio_export}")

    # 2. Ler clusters e DB
    with open(caminho_clusters, encoding="utf-8") as f:
        clusters_data = json.load(f)

    con = sqlite3.connect(caminho_db)
    rows = con.execute(
        "SELECT id_projeto, nome, descricao FROM projetos WHERE descricao IS NOT NULL AND TRIM(descricao) != ''"
    ).fetchall()
    con.close()

    dados_projetos = {str(r[0]): (r[1] or "", r[2] or "") for r in rows}

    # Agrupar por tema
    projetos_por_tema: dict[str, list[tuple[str, str, str]]] = {}
    for item in clusters_data:
        id_p = str(item["id_projeto"])
        tema = item["tema"]
        if id_p in dados_projetos:
            nome, desc = dados_projetos[id_p]
            projetos_por_tema.setdefault(tema, []).append((id_p, nome, desc))

    mapa_final: dict[str, str] = dict(mapa_parseado)

    # Para projetos sem mapeamento externo, usar clusterização semântica
    for tema, lista_p in projetos_por_tema.items():
        faltantes = [p for p in lista_p if p[0] not in mapa_final]
        if faltantes:
            print(f"Processando {len(faltantes)}/{len(lista_p)} projetos de '{tema}'...")
            mapa_grupo = clusterizar_fallback_local(faltantes, tema)
            mapa_final.update(mapa_grupo)

    # Salvar em analise/subareas_nivel2.json
    caminho_out.parent.mkdir(parents=True, exist_ok=True)
    with open(caminho_out, "w", encoding="utf-8") as f:
        json.dump(mapa_final, f, indent=2, ensure_ascii=False, sort_keys=True)

    print(f"Mapeamento de subáreas Nível 2 salvo em {caminho_out} ({len(mapa_final)} projetos).")


def main():
    parser = argparse.ArgumentParser(description="Gera subáreas de Nível 2 para projetos.")
    parser.add_argument("--db", type=Path, default=DEFAULT_DB)
    parser.add_argument("--clusters", type=Path, default=DEFAULT_CLUSTERS)
    parser.add_argument("--export-dir", type=Path, default=DEFAULT_EXPORT_DIR)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT_JSON)
    args = parser.parse_args()

    gerar_subareas_nivel2(
        caminho_db=args.db,
        caminho_clusters=args.clusters,
        diretorio_export=args.export_dir,
        caminho_out=args.out,
    )


if __name__ == "__main__":
    main()
