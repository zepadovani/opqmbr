"""
Classificação temática dos 934 projetos por subárea (PLANO §4.2.1/4.2.2).

Pipeline: `projetos.descricao` → embeddings multilíngues (sentence-transformers,
usados só pro UMAP 2D do atlas agora) → classificação por LEITURA HUMANA/LLM de
título+resumo (`classificacao_projetos.json`, versionado — ver
`carregar_classificacao_manual`), não mais por similaridade de embedding.

Histórico de DUAS viradas metodológicas, as duas por achado do usuário:

1. HDBSCAN não supervisionado → zero-shot pelas 8 subáreas da ANPPOM (2025):
   ~33% dos projetos caíam em "ruído" por construção do HDBSCAN, e o maior
   bloco (pedagogia/educação) se espalhava em clusters que eram nuance
   estatística, não tema diferente.
2. Zero-shot por embedding → leitura manual/LLM (2026-08-08): mesmo depois
   de duas rodadas de ajuste fino de glosa e de um refino por protótipo
   bootstrapado (ver `classificar_anppom`, git blame), Performance Musical
   e Composição e Sonologia continuavam trocando visivelmente — "a
   performance na trompa de repertórios..." caía em Composição. Comparar
   vetor de embedding contra um texto curto (a glosa) não captura a
   distinção real quando duas subáreas compartilham vocabulário; ler o
   resumo inteiro e decidir como um humano decidiria, sim. `classificar_anppom`
   (zero-shot) continua no módulo como FALLBACK — só entra se
   `classificacao_projetos.json` não existir ou não cobrir todo o corpus
   atual (a base cresceu desde a última classificação manual).

Taxonomia: as 8 subáreas oficiais da ANPPOM (2025) mais "Musicoterapia"
destacada da SA-8 ("Demais Subáreas e Interfaces") como categoria própria —
pedido do usuário, o campo é grande e distinto o bastante pra não ficar
dissolvido num balde genérico. Portanto **9 categorias**, não 8 — a taxonomia
não é mais estritamente a lista oficial da ANPPOM, é uma adaptação dela.

`clusterizar`/`clusterizar_hierarquico`/`rotular_clusters` (HDBSCAN + TF-IDF)
continuam no módulo — não usados no pipeline padrão, mas são a base pra um
2º nível (subtema DENTRO de cada subárea), ainda não construído.

Não faz parte do caminho de reprodução da base (stdlib pura, CLAUDE.md): tem
venv próprio (`.venv/`, fora do git) com sentence-transformers, umap-learn,
hdbscan, scikit-learn. Não roda automaticamente em `montar_base.py`.

Escreve `derivados/clusters.parquet` — id_projeto (real, NUNCA publicado tal
qual), cluster (índice 0-8 da subárea), tema (nome da subárea), palavras-chave
(TF-IDF por subárea, pista adicional), coordenadas UMAP 2D. `build_public.py`
lê isso, troca id_projeto por um id substituto e aplica a regra de publicação
de título (decisão 1 do PLANO: só para clusters com >= LIMIAR_TITULO_PUBLICO
projetos).

Usage:
    python3 -m analise.clustering [--db PATH] [--out PATH]
"""

import argparse
import json
import re
import sqlite3
from pathlib import Path

REPO_ROOT = Path(__file__).parent.parent
DEFAULT_DB = REPO_ROOT / "sucupira.db"
DEFAULT_OUT = REPO_ROOT / "derivados" / "clusters.parquet"

MODELO_EMBEDDING = "paraphrase-multilingual-MiniLM-L12-v2"
SEMENTE = 42

# Lista curta de stopwords em português para o TF-IDF dos rótulos — não existe
# lista embutida no scikit-learn para o idioma, e importar uma dependência só
# para isso não vale a pena. Cobre artigos, preposições e o vocabulário de
# "resumo de projeto" que apareceria em cluster nenhum por ser comum a todos
# (pesquisa, projeto, objetivo, análise…).
STOPWORDS_PT = {
    "a", "ao", "aos", "as", "às", "com", "como", "da", "das", "de", "dela",
    "delas", "dele", "deles", "do", "dos", "e", "em", "entre", "essa",
    "essas", "esse", "esses", "esta", "está", "estas", "este", "estes",
    "eu", "foi", "for", "há", "isso", "isto", "já", "mais", "mas",
    "me", "mesmo", "meu", "meus", "minha", "minhas", "muito", "na", "nas",
    "nesse", "nessa", "neste", "nesta", "no", "nos", "nossa", "nossas",
    "nosso", "nossos", "num", "numa", "o", "os", "ou", "para", "pela",
    "pelas", "pelo", "pelos", "por", "qual", "quando", "que", "quem",
    "são", "se", "sem", "seu", "seus", "sua", "suas", "também", "te",
    "tem", "ter", "seja", "sendo", "sido", "sobre", "sua", "suas", "só",
    "um", "uma", "umas", "uns", "você", "vocês",
    # vocabulário genérico de resumo acadêmico — comum a quase todo projeto,
    # não distingue assunto
    "pesquisa", "projeto", "objetivo", "objetivos", "trabalho", "estudo",
    "análise", "área", "forma", "processo", "resultados", "presente",
    "visa", "busca", "propõe", "partir", "através", "dentro", "além",
    "modo", "parte", "geral", "brasil", "brasileira", "brasileiro",
    "programa", "linha", "resumo", "atual", "assim", "cada", "outros",
    "outras", "outro", "outra", "tanto", "ainda", "ser", "não", "pode",
    "podem", "torno", "vez", "vezes",
    # vocabulário do próprio recorte temático (Música) — está em todo cluster
    # por definição, então não distingue um do outro
    "música", "músicas", "musical", "musicais", "músico", "músicos",
    # 2ª rodada (achado do usuário, 2026-08-08): plural das palavras acima
    # que passou batido por o tokenizador não lematizar, mais o vocabulário
    # institucional-administrativo que aparece em quase todo resumo de pós-
    # graduação sem dizer nada sobre o assunto do projeto.
    "pós", "graduação", "estudos", "desenvolvimento", "obra", "obras",
    "produção", "produções", "prática", "práticas", "processos",
}

# ~4% das descrições têm resumo bilíngue (abstract em inglês colado ao
# resumo em português). Poucas, mas concentradas: um "the"/"and" repetido
# dezenas de vezes por resumo em inglês é raro no corpus inteiro (alta IDF)
# e concentrado nos poucos clusters que têm esses projetos (alta TF de
# cluster) — o c-TF-IDF rankeava "the" como palavra mais distintiva de um
# cluster de 248 projetos. Mesma lógica do STOPWORDS_PT, outro idioma.
STOPWORDS_EN = {
    "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "in",
    "is", "it", "its", "of", "on", "or", "our", "paper", "project",
    "research", "study", "that", "the", "this", "to", "university", "was",
    "we", "were", "which", "with",
    # vocabulário do recorte temático em inglês — par de "música/musical" já
    # excluído em STOPWORDS_PT
    "music", "musical",
}

STOPWORDS = STOPWORDS_PT | STOPWORDS_EN

_PALAVRA = re.compile(r"[a-zà-úA-ZÀ-Ú]{3,}")


def _tokenizar(texto: str) -> list[str]:
    return [w.lower() for w in _PALAVRA.findall(texto) if w.lower() not in STOPWORDS]


def carregar_descricoes(con) -> list[tuple[str, str]]:
    rows = con.execute(
        "SELECT id_projeto, descricao FROM projetos WHERE descricao IS NOT NULL AND TRIM(descricao) != ''"
    ).fetchall()
    return [(r[0], r[1]) for r in rows]


def gerar_embeddings(textos: list[str], modelo=None):
    from sentence_transformers import SentenceTransformer

    modelo = modelo or SentenceTransformer(MODELO_EMBEDDING)
    return modelo.encode(textos, show_progress_bar=True, normalize_embeddings=True)


# ---------------------------------------------------------------------------
# Classificação pelas subáreas da ANPPOM — primeiro nível, taxonomia oficial
# do campo (não inventada por este script). HDBSCAN sozinho não cobre 100%
# dos projetos por construção (33% caem em "ruído") e reunia coisas que não
# são o mesmo tema (achado do usuário: "pós graduação" liderando dois
# clusters diferentes — bloco de pedagogia/educação sem separação temática
# real no espaço de embeddings). A ANPPOM já resolveu essa divisão para o
# campo; aproveitar em vez de redescobrir com clustering.
#
# Classificação por similaridade de cosseno entre o embedding do projeto e o
# embedding de uma glosa curta de cada subárea (zero-shot, mesmo modelo
# multilíngue dos projetos — sem chamar LLM/API externa, sem chave nova).
# TODO PROJETO É CLASSIFICADO: não existe "ruído" aqui, é sempre o argmax.
# Ainda é atribuição automática, sem revisão humana — não confundir com o
# fato de a taxonomia em si ser oficial.
# ---------------------------------------------------------------------------

ANPPOM_SUBAREAS = [
    ("Composição e Sonologia",
     "Composição musical, criação de obras musicais novas, processos "
     "composicionais, sistemas composicionais, planejamento composicional, "
     "composição contemporânea, técnicas de escrita musical, notação "
     "musical, composição assistida por computador, música eletroacústica, "
     "sonologia, tecnologia sonora, síntese e processamento de áudio, "
     "sistemas interativos, música mediada por tecnologia."),
    ("Educação Musical",
     "Educação musical, ensino e aprendizagem de música, pedagogia musical, "
     "formação de professores de música, licenciatura em música, currículo "
     "escolar de música, práticas pedagógico-musicais na educação básica."),
    ("Etnomusicologia",
     "Etnomusicologia, música e cultura, práticas musicais tradicionais e "
     "populares de comunidades e povos, identidade étnica e racial, música "
     "indígena, música afro-brasileira e diáspora africana, patrimônio "
     "cultural imaterial."),
    ("Música Popular",
     "Música popular brasileira e internacional, música popular urbana, "
     "indústria fonográfica, gêneros da música popular, canção popular, "
     "mídia e música popular, história da música popular."),
    ("Performance Musical",
     "Performance musical, prática interpretativa de obras já existentes, "
     "técnica instrumental, técnica vocal, canto, regência, preparação de "
     "recital e concerto, interpretação de repertório, o instrumentista e "
     "o cantor, gesto corporal na execução musical, ensaio."),
    ("Musicologia",
     "Musicologia histórica, história da música, historiografia musical, "
     "fontes documentais e acervos musicais, arquivos, catalogação e edição "
     "crítica de partituras, recepção e crítica musical, biografia de "
     "compositores, música antiga."),
    ("Teoria e Análise Musical",
     "Teoria musical, análise musical, harmonia, sistemas composicionais, "
     "análise de obras musicais, estruturas e forma musical, teoria da "
     "música."),
    ("Musicoterapia",
     "Uso clínico e terapêutico da música: intervenção musical com "
     "pacientes, reabilitação, saúde mental e física por meio da música, "
     "musicoterapia em contexto hospitalar, educacional especial ou "
     "social, protocolos e avaliação de intervenções musicoterapêuticas."),
    ("Demais Subáreas e Interfaces da Música",
     "Estética musical, cognição musical, psicologia da música fora de "
     "contexto clínico, semiótica musical, mídia e música, saúde do "
     "músico (lesões, ergonomia — não é musicoterapia clínica), "
     "interfaces da música com outras áreas do conhecimento."),
]


def classificar_anppom(embeddings, modelo=None, iteracoes_refino: int = 3, peso_glosa: float = 0.35):
    """Retorna um array de índices (0..len(ANPPOM_SUBAREAS)-1), um por
    projeto — o índice da subárea de maior similaridade de cosseno.

    Duas passadas, não uma só. A 1ª compara cada projeto só contra a GLOSA
    (texto curto, escrito à mão, registro de definição — "termos isolados",
    no sentido de que sou eu quem decide quais palavras representam a
    subárea, não o corpus). Isso classificava mal pares de subárea com
    vocabulário próximo (achado do usuário, 2026-08-08: Performance Musical
    × Composição e Sonologia trocavam muito) — o descompasso de gênero
    textual entre a glosa (definição) e o resumo (prosa acadêmica longa)
    prejudica a similaridade de cosseno mais do que deveria.

    A partir da 2ª passada, o protótipo de cada subárea deixa de ser só a
    glosa: vira uma mistura da glosa com o CENTRO REAL dos resumos que a
    passada anterior classificou ali (`peso_glosa` decide a proporção — a
    glosa nunca some de todo, ou o protótipo pode derivar pra outro lugar
    sem âncora semântica). Isso é "baseado no resumo do projeto", não em
    termos isolados: o protótipo aprende o jeito real que o corpus escreve
    sobre aquele assunto, não só o vocabulário que eu imaginei escrevendo a
    glosa. Sem rótulo humano nenhum — é bootstrapping, não supervisão.

    Para no primeiro pente-fino em que ninguém mais troca de subárea entre
    duas iterações — convergiu, e rodar mais não muda nada.
    """
    import numpy as np
    from sentence_transformers import SentenceTransformer

    modelo = modelo or SentenceTransformer(MODELO_EMBEDDING)
    glosas = [glosa for _, glosa in ANPPOM_SUBAREAS]
    emb_glosas = modelo.encode(glosas, normalize_embeddings=True)

    prototipos = emb_glosas
    labels = np.argmax(embeddings @ prototipos.T, axis=1)

    for i in range(iteracoes_refino):
        novos_prototipos = []
        for k in range(len(ANPPOM_SUBAREAS)):
            membros = embeddings[labels == k]
            if len(membros) == 0:
                novos_prototipos.append(emb_glosas[k])
                continue
            centro_corpus = membros.mean(axis=0)
            centro_corpus = centro_corpus / np.linalg.norm(centro_corpus)
            proto = peso_glosa * emb_glosas[k] + (1 - peso_glosa) * centro_corpus
            novos_prototipos.append(proto / np.linalg.norm(proto))
        prototipos = np.array(novos_prototipos)

        novos_labels = np.argmax(embeddings @ prototipos.T, axis=1)
        trocaram = int((novos_labels != labels).sum())
        print(f"  refino {i + 1}/{iteracoes_refino}: {trocaram} projetos mudaram de subárea")
        labels = novos_labels
        if trocaram == 0:
            break

    return labels


def reduzir(embeddings, n_componentes: int, semente: int = SEMENTE):
    import umap

    return umap.UMAP(
        n_components=n_componentes,
        metric="cosine",
        random_state=semente,
        n_neighbors=15,
        min_dist=0.1 if n_componentes == 2 else 0.0,
    ).fit_transform(embeddings)


def clusterizar(embeddings_reduzidos, min_cluster_size: int):
    import hdbscan

    clusterer = hdbscan.HDBSCAN(
        min_cluster_size=min_cluster_size,
        metric="euclidean",
        cluster_selection_method="eom",
    )
    return clusterer.fit_predict(embeddings_reduzidos)


def clusterizar_hierarquico(embeddings, min_cluster_size: int, tamanho_max: int, semente: int = SEMENTE):
    """HDBSCAN encontra a estrutura de densidade que existe — quando um tema é
    largo demais no espaço de embeddings (ex.: "performance e composição"
    reúne quase um terço do corpus), baixar min_cluster_size pra tentar
    quebrá-lo não funciona: HDBSCAN só descasca satélites pequenos da borda,
    o núcleo denso continua inteiro, e o resto do corpus fragmenta em
    dezenas de clusters minúsculos com rótulo ruim por falta de dado.

    A alternativa é recursiva: clusteriza uma vez com o min_cluster_size
    normal; todo cluster acima de `tamanho_max` é reclusterizado sozinho,
    com sua própria redução UMAP local (não a global — a estrutura interna
    de um tema largo não é a mesma vista de fora). Quem não formar
    subcluster fica com o id do cluster original — não vira ruído global só
    porque já tinha sido considerado coerente na primeira passada.
    """
    import numpy as np

    reduzido = reduzir(embeddings, n_componentes=10, semente=semente)
    labels = clusterizar(reduzido, min_cluster_size)
    labels_final = labels.copy()
    proximo_id = int(labels.max()) + 1 if (labels >= 0).any() else 0

    for c in sorted(set(labels) - {-1}):
        indices = np.where(labels == c)[0]
        if len(indices) <= tamanho_max:
            continue
        sub_reduzido = reduzir(embeddings[indices], n_componentes=10, semente=semente)
        sub_labels = clusterizar(sub_reduzido, max(5, min_cluster_size // 2))
        mapa_id = {sl: proximo_id + i for i, sl in enumerate(sorted(set(sub_labels) - {-1}))}
        proximo_id += len(mapa_id)
        for pos, sl in zip(indices, sub_labels):
            if sl != -1:
                labels_final[pos] = mapa_id[sl]

    return labels_final


def rotular_clusters(ids: list[str], textos: list[str], labels, top_n: int = 8) -> dict[int, list[str]]:
    """TF-IDF por cluster (não por documento): agrupa os textos do cluster
    num documento só, para achar as palavras que o distinguem dos demais
    clusters — não as palavras mais frequentes dentro dele."""
    from sklearn.feature_extraction.text import TfidfVectorizer

    clusters = sorted(set(labels) - {-1})
    if not clusters:
        return {}

    corpus_por_cluster = []
    for c in clusters:
        textos_c = [t for t, l in zip(textos, labels) if l == c]
        corpus_por_cluster.append(" ".join(textos_c))

    # Vocabulário restrito a termos em pelo menos 2 PROJETOS (não só do
    # pseudo-documento do cluster): sem isso, um termo citado uma única vez
    # por um único projeto (nome próprio, sigla de um curso) dominava o
    # ranking — distintivo, mas não representativo do cluster. Bigramas
    # (ngram_range) porque palavra isolada perde contexto — "janeiro" sozinho
    # não diz nada, "rio janeiro" diz. (O "de" some: a fronteira de bigrama é
    # construída sobre o token stream já sem stopword, então "rio de janeiro"
    # vira "rio janeiro" — resultado legível, ainda que não gramatical.)
    vocabulario = TfidfVectorizer(
        tokenizer=_tokenizar, lowercase=False, ngram_range=(1, 2), min_df=2, max_df=0.85
    ).fit(textos).get_feature_names_out()

    vetor = TfidfVectorizer(
        tokenizer=_tokenizar, lowercase=False, ngram_range=(1, 2), vocabulary=vocabulario
    )
    matriz = vetor.fit_transform(corpus_por_cluster)
    vocab = vetor.get_feature_names_out()

    rotulos = {}
    for i, c in enumerate(clusters):
        linha = matriz[i].toarray().ravel()
        ordem = [j for j in linha.argsort()[::-1] if linha[j] > 0]

        escolhidas: list[str] = []
        palavras_usadas: set[str] = set()

        def tentar(j) -> bool:
            termo = vocab[j]
            palavras_termo = set(termo.split())
            if palavras_termo & palavras_usadas:
                return False
            escolhidas.append(termo)
            palavras_usadas.update(palavras_termo)
            return True

        # Bigrama primeiro, até metade das vagas: por pontuação bruta um
        # unigrama como "janeiro" costuma empatar ou passar na frente de
        # "rio janeiro" (o próprio bigrama carrega menos documentos, é mais
        # raro por natureza), e o dedup por palavra descartaria o bigrama
        # depois de aceitar o unigrama que ele contém. Reservar espaço evita
        # isso sem abrir mão dos unigramas fortes que sobrarem.
        max_bigramas = max(1, top_n // 2)
        n_bigramas = 0
        for j in ordem:
            if n_bigramas >= max_bigramas or len(escolhidas) >= top_n:
                break
            if " " in vocab[j] and tentar(j):
                n_bigramas += 1
        for j in ordem:
            if len(escolhidas) >= top_n:
                break
            if " " not in vocab[j]:
                tentar(j)

        rotulos[c] = escolhidas
    return rotulos


CLASSIFICACAO_MANUAL = REPO_ROOT / "analise" / "classificacao_projetos.json"


def carregar_classificacao_manual(ids: list) -> "list[int] | None":
    """`CLASSIFICACAO_MANUAL` é um mapeamento id_projeto -> índice de
    categoria (0..8) feito por leitura humana/LLM de título+resumo, não por
    similaridade de embedding — ver `docs/PLANO.md` §4.2.1 (revisão de
    2026-08-08: o zero-shot embaralhava Performance × Composição mesmo
    depois de duas rodadas de ajuste de glosa; o usuário pediu leitura de
    verdade). Versionado porque NÃO é reproduzível rodando o script de novo
    — exige julgamento, como `nucleo.py`/`agencias.py` exigem a regra
    escrita à mão, só que aqui a "regra" é ler o resumo.

    Devolve None se o arquivo não existe (permite rodar sem ele — cai no
    zero-shot como fallback) ou se faltar id do corpus atual (a base pode
    ter crescido desde a classificação manual; melhor recusar a rodar com
    metade dos projetos usando um método e metade usando outro do que
    silenciosamente misturar as duas fontes)."""
    if not CLASSIFICACAO_MANUAL.exists():
        return None
    import json

    mapa = json.loads(CLASSIFICACAO_MANUAL.read_text(encoding="utf-8"))
    faltando = [i for i in ids if i not in mapa]
    if faltando:
        print(
            f"AVISO: {CLASSIFICACAO_MANUAL.name} não cobre {len(faltando)} projeto(s) "
            f"do corpus atual (ex.: {faltando[:3]}) — caindo no zero-shot por embedding "
            f"pra todo mundo. Reclassifique manualmente e atualize o arquivo.",
        )
        return None
    return [mapa[i] for i in ids]


def executar(db_path: Path, out_path: Path) -> None:
    import pandas as pd
    from sentence_transformers import SentenceTransformer

    con = sqlite3.connect(db_path)
    pares = carregar_descricoes(con)
    con.close()
    ids = [p[0] for p in pares]
    textos = [p[1] for p in pares]
    print(f"{len(ids)} projetos com descrição.")

    print(f"Gerando embeddings ({MODELO_EMBEDDING})…")
    modelo = SentenceTransformer(MODELO_EMBEDDING)
    embeddings = gerar_embeddings(textos, modelo)

    manual = carregar_classificacao_manual(ids)
    if manual is not None:
        print(f"Classificando pelas {len(ANPPOM_SUBAREAS)} subáreas — leitura manual/LLM ({CLASSIFICACAO_MANUAL.name}).")
        import numpy as np
        labels = np.array(manual)
    else:
        print(f"Classificando pelas {len(ANPPOM_SUBAREAS)} subáreas (zero-shot, similaridade de cosseno)…")
        labels = classificar_anppom(embeddings, modelo)

    print("Reduzindo para visualização (UMAP, 2D)…")
    coords_2d = reduzir(embeddings, n_componentes=2)
    print("Reduzindo para visualização (UMAP, 3D — §4.2.5 item 4)…")
    coords_3d = reduzir(embeddings, n_componentes=3)

    print("Extraindo palavras-chave por subárea (TF-IDF — pista adicional, não é o rótulo)…")
    rotulos = rotular_clusters(ids, textos, labels)

    subareas_json = REPO_ROOT / "analise" / "subareas_nivel2.json"
    mapa_subareas = {}
    if subareas_json.exists():
        with open(subareas_json, encoding="utf-8") as f:
            mapa_subareas = json.load(f)

    df = pd.DataFrame({
        "id_projeto": ids,
        "cluster": labels.astype(int),
        "tema": [ANPPOM_SUBAREAS[c][0] for c in labels],
        "subarea": [mapa_subareas.get(str(i), "") for i in ids],
        "x": coords_2d[:, 0],
        "y": coords_2d[:, 1],
        "x3d": coords_3d[:, 0],
        "y3d": coords_3d[:, 1],
        "z3d": coords_3d[:, 2],
        "palavras_chave": [", ".join(rotulos.get(c, [])) for c in labels],
    })

    out_path.parent.mkdir(parents=True, exist_ok=True)
    df.to_parquet(out_path, index=False)
    # build_public.py roda com stdlib pura (sem pandas) — o fallback em JSON
    # é o que permite gerar o pacote público sem o venv de clustering.
    with open(out_path.with_suffix(".json"), "w", encoding="utf-8") as f:
        json.dump(df.to_dict(orient="records"), f, ensure_ascii=False)
    print(f"Escrito {out_path} e {out_path.with_suffix('.json')} ({len(df)} linhas).")

    print("\nProjetos por subárea:")
    for c, n in df["cluster"].value_counts().sort_index().items():
        nome = ANPPOM_SUBAREAS[c][0]
        print(f"  {c}  n={n:<4}  {nome}  ({', '.join(rotulos.get(c, [])[:5])})")


DEFAULT_OUT_HDBSCAN = REPO_ROOT / "derivados" / "clusters_hdbscan.parquet"


def executar_hdbscan(
    db_path: Path, out_path: Path, min_cluster_size: int = 15, tamanho_max: int = 80,
) -> None:
    """Método alternativo de clusterização (§4.2.5 item 3, roteiro de
    melhorias): HDBSCAN puro sobre o espaço de embeddings de alta dimensão,
    sem a taxonomia ANPPOM — descoberta de tema, não classificação por
    categoria oficial. É o mesmo caminho que `executar()` abandonou em
    4.2.1/4.2.2 (ver docstring do módulo: 33% de ruído, blocos largos sem
    separação temática real), reaproveitado aqui como OPÇÃO adicional no
    Atlas, não substituto — o usuário pediu os dois métodos lado a lado,
    seletonáveis, não um vencedor único. Ruído (`cluster == -1`) é mantido e
    rotulado, nunca escondido: projeto que não agrupa com nada é achado, não
    defeito (mesmo princípio do resto do projeto para valor desconhecido).

    `clusterizar_hierarquico` já resolve o problema de bloco largo demais
    (reclusteriza localmente em vez de só baixar `min_cluster_size` global) —
    é o que faltava pra essa via ser publicável como alternativa de verdade.
    """
    import numpy as np
    import pandas as pd
    from sentence_transformers import SentenceTransformer

    con = sqlite3.connect(db_path)
    pares = carregar_descricoes(con)
    con.close()
    ids = [p[0] for p in pares]
    textos = [p[1] for p in pares]
    print(f"{len(ids)} projetos com descrição.")

    print(f"Gerando embeddings ({MODELO_EMBEDDING})…")
    modelo = SentenceTransformer(MODELO_EMBEDDING)
    embeddings = gerar_embeddings(textos, modelo)

    print(f"Clusterizando (HDBSCAN hierárquico, min_cluster_size={min_cluster_size}, tamanho_max={tamanho_max})…")
    labels = clusterizar_hierarquico(embeddings, min_cluster_size=min_cluster_size, tamanho_max=tamanho_max)
    n_ruido = int((labels == -1).sum())
    n_clusters = len(set(labels.tolist()) - {-1})
    print(f"{n_clusters} clusters, {n_ruido} projetos em ruído ({100 * n_ruido // len(ids)}%).")

    print("Reduzindo para visualização (UMAP, 2D)…")
    coords_2d = reduzir(embeddings, n_componentes=2)
    print("Reduzindo para visualização (UMAP, 3D — §4.2.5 item 4)…")
    coords_3d = reduzir(embeddings, n_componentes=3)

    print("Extraindo palavras-chave por cluster (TF-IDF)…")
    rotulos = rotular_clusters(ids, textos, labels)

    df = pd.DataFrame({
        "id_projeto": ids,
        "cluster": labels.astype(int),
        "palavras_chave": [", ".join(rotulos.get(int(c), [])) for c in labels],
        "x": coords_2d[:, 0],
        "y": coords_2d[:, 1],
        "x3d": coords_3d[:, 0],
        "y3d": coords_3d[:, 1],
        "z3d": coords_3d[:, 2],
    })

    out_path.parent.mkdir(parents=True, exist_ok=True)
    df.to_parquet(out_path, index=False)
    with open(out_path.with_suffix(".json"), "w", encoding="utf-8") as f:
        json.dump(df.to_dict(orient="records"), f, ensure_ascii=False)
    print(f"Escrito {out_path} e {out_path.with_suffix('.json')} ({len(df)} linhas).")

    print("\nClusters (ordenados por tamanho):")
    contagem = pd.Series(labels).value_counts()
    for c, n in contagem.items():
        rotulo = "RUÍDO (sem cluster)" if c == -1 else ", ".join(rotulos.get(int(c), [])[:5])
        print(f"  {c:>3}  n={n:<4}  {rotulo}")


DEFAULT_OUT_TOPICOS = REPO_ROOT / "derivados" / "clusters_topicos.parquet"


def executar_topicos(db_path: Path, out_path: Path, n_topicos: int = 15) -> None:
    """3º método alternativo de clusterização (§4.2.5 item 3, roteiro de
    melhorias): LDA (Latent Dirichlet Allocation) sobre bag-of-words —
    mesma ideia de "tema transversal" que BERTopic persegue, mas sem
    dependência nova: `sklearn.decomposition.LatentDirichletAllocation` já
    está no venv de análise (usado em `rotular_clusters`), e LDA é o método
    clássico de modelagem de tópicos — anterior ao BERTopic, mesma família
    de problema. Decisão do usuário (2026-08-08): BERTopic ficaria pra
    depois, se o resultado do LDA não bastar.

    Diferença estrutural dos outros dois métodos, não só de implementação:
    ANPPOM e HDBSCAN vêm de **embedding denso** (posição semântica no
    espaço do sentence-transformer, "hard clustering" — um projeto pertence
    a UM cluster). LDA vem de **contagem de palavra** (bag-of-words) e é
    probabilístico por natureza: cada projeto tem uma distribuição de
    probabilidade sobre os `n_topicos` tópicos, e o "cluster" aqui é só o
    tópico dominante (argmax) — a mistura em si não é publicada (o Atlas
    não tem UI pra "35% tópico A, 20% tópico B"). Sem ruído: todo projeto
    tem uma distribuição, logo sempre tem um argmax — diferente do HDBSCAN,
    aqui "ninguém fica de fora" por construção do método, não por mérito.
    """
    import numpy as np
    import pandas as pd
    from sklearn.decomposition import LatentDirichletAllocation
    from sklearn.feature_extraction.text import CountVectorizer

    con = sqlite3.connect(db_path)
    pares = carregar_descricoes(con)
    con.close()
    ids = [p[0] for p in pares]
    textos = [p[1] for p in pares]
    print(f"{len(ids)} projetos com descrição.")

    print("Vetorizando (bag-of-words, unigrama+bigrama)…")
    vetorizador = CountVectorizer(
        tokenizer=_tokenizar, lowercase=False, ngram_range=(1, 2), min_df=3, max_df=0.6,
    )
    contagens = vetorizador.fit_transform(textos)
    vocabulario = vetorizador.get_feature_names_out()

    print(f"Rodando LDA ({n_topicos} tópicos)…")
    lda = LatentDirichletAllocation(
        n_components=n_topicos, random_state=SEMENTE, learning_method="batch", max_iter=25,
    )
    distribuicao = lda.fit_transform(contagens)  # (n_docs, n_topicos), probabilidade por tópico
    labels = distribuicao.argmax(axis=1)

    rotulos: dict[int, list[str]] = {}
    for k in range(n_topicos):
        top_idx = lda.components_[k].argsort()[::-1][:8]
        rotulos[k] = [vocabulario[i] for i in top_idx]

    print("Reduzindo a distribuição tópico-documento pra visualização (UMAP, 2D)…")
    import umap

    coords_2d = umap.UMAP(
        n_components=2, metric="cosine", random_state=SEMENTE, n_neighbors=15, min_dist=0.1,
    ).fit_transform(distribuicao)
    print("Reduzindo a distribuição tópico-documento pra visualização (UMAP, 3D — §4.2.5 item 4)…")
    coords_3d = umap.UMAP(
        n_components=3, metric="cosine", random_state=SEMENTE, n_neighbors=15, min_dist=0.1,
    ).fit_transform(distribuicao)

    df = pd.DataFrame({
        "id_projeto": ids,
        "cluster": labels.astype(int),
        "palavras_chave": [", ".join(rotulos.get(int(c), [])) for c in labels],
        "x": coords_2d[:, 0],
        "y": coords_2d[:, 1],
        "x3d": coords_3d[:, 0],
        "y3d": coords_3d[:, 1],
        "z3d": coords_3d[:, 2],
    })

    out_path.parent.mkdir(parents=True, exist_ok=True)
    df.to_parquet(out_path, index=False)
    with open(out_path.with_suffix(".json"), "w", encoding="utf-8") as f:
        json.dump(df.to_dict(orient="records"), f, ensure_ascii=False)
    print(f"Escrito {out_path} e {out_path.with_suffix('.json')} ({len(df)} linhas).")

    print("\nTópicos (ordenados por tamanho):")
    contagem = pd.Series(labels).value_counts()
    for c, n in contagem.items():
        print(f"  {c:>3}  n={n:<4}  {', '.join(rotulos.get(int(c), [])[:5])}")


DEFAULT_OUT_COAUTORIA = REPO_ROOT / "derivados" / "clusters_coautoria.parquet"


def executar_coautoria(db_path: Path, out_path: Path, resolution: float = 1.0) -> None:
    """4º e último método alternativo de clusterização (§4.2.5 item 3,
    roteiro de melhorias): rede de colaboração — projetos que compartilham
    PESSOA em `projeto_membro` (docente/discente/participante externo) viram
    vizinhos num grafo, e comunidades de Louvain (`networkx`, sem
    dependência nova) agrupam pela estrutura de colaboração, não por texto.
    Estruturalmente o mais diferente dos outros três: ANPPOM/HDBSCAN vêm de
    embedding denso, LDA de bag-of-words — os três olham só a *descrição* do
    projeto. Este olha *quem trabalha com quem*, ignorando o texto por
    completo (as palavras-chave que acompanham cada comunidade, pra dar uma
    pista de conteúdo, são calculadas depois, nunca entram na formação do
    cluster).

    "Ruído" aqui não é ausência de agrupamento denso (HDBSCAN) nem
    impossível por construção (LDA) — é ausência de colaboração
    REGISTRADA: um projeto sem nenhuma pessoa em comum com outro projeto do
    corpus (`grau(nó) == 0`). Rotulado à parte (`cluster == -1`), pelo
    mesmo princípio dos outros métodos: projeto sem colaboração
    documentada é achado (~13% do corpus, ver stdout), não defeito — e
    "sem colaboração REGISTRADA" não é o mesmo que "sem colaboração":
    a base captura só quem a Plataforma Sucupira lista como membro formal
    do projeto.

    Posição (x, y) também é estruturalmente diferente: não vem de nenhuma
    redução de embedding (não há embedding aqui), vem de
    `spring_layout` — a posição do próprio grafo de colaboração
    (força/mola entre nós conectados). Proximidade geométrica no Atlas,
    portanto, significa "perto na rede de colaboração", não "conteúdo
    parecido" — dito explicitamente no `aviso_rotulo` que o front repete
    (mesmo princípio das notas de UMAP/HDBSCAN). Nós sem colaboração
    (grau 0) não têm posição de rede — espalhados numa margem à parte,
    não poderiam "flutuar no meio" de um layout de força do qual não
    participam.
    """
    import itertools
    import random
    from collections import defaultdict

    import networkx as nx
    import numpy as np
    import pandas as pd

    con = sqlite3.connect(db_path)
    pares = carregar_descricoes(con)
    ids_universo = [p[0] for p in pares]
    universo = set(ids_universo)
    membros = con.execute("SELECT id_pessoa, id_projeto FROM projeto_membro").fetchall()
    con.close()
    print(f"{len(ids_universo)} projetos no universo (mesmo corpus dos outros métodos).")

    por_pessoa: dict = defaultdict(set)
    for pessoa, projeto in membros:
        if projeto in universo:  # só vínculos com projetos do universo (que têm descrição)
            por_pessoa[pessoa].add(projeto)

    pesos: dict = defaultdict(int)
    for projs in por_pessoa.values():
        if len(projs) < 2:
            continue
        for a, b in itertools.combinations(sorted(projs), 2):
            pesos[(a, b)] += 1

    G = nx.Graph()
    G.add_nodes_from(ids_universo)
    for (a, b), w in pesos.items():
        G.add_edge(a, b, weight=w)
    print(f"{G.number_of_edges()} arestas (pares de projeto com >=1 pessoa em comum).")

    isolados = [n for n in G.nodes if G.degree(n) == 0]
    ativos = [n for n in G.nodes if G.degree(n) > 0]
    G_ativo = G.subgraph(ativos).copy()

    print(f"Detectando comunidades (Louvain, resolution={resolution})…")
    comunidades = nx.algorithms.community.louvain_communities(
        G_ativo, weight="weight", resolution=resolution, seed=SEMENTE,
    )
    comunidades = sorted(comunidades, key=len, reverse=True)
    label_por_no: dict = {}
    for i, com in enumerate(comunidades):
        for n in com:
            label_por_no[n] = i
    for n in isolados:
        label_por_no[n] = -1
    print(
        f"{len(comunidades)} comunidades, {len(isolados)} projetos sem colaboração "
        f"registrada ({100 * len(isolados) // len(ids_universo)}%).",
    )

    def espalhar_isolados(pos: dict, dims: int, rng: random.Random) -> None:
        """Isolados não participam do layout de força (não têm aresta) —
        espalhados numa margem à esquerda do layout principal, no eixo 0,
        sem sobrepor os nós ativos; nos demais eixos, distribuídos dentro
        da mesma faixa de valores dos nós ativos."""
        if pos:
            eixos = list(zip(*pos.values()))
            limites = [(min(eixo), max(eixo)) for eixo in eixos]
        else:
            limites = [(0.0, 0.0)] * dims
        largura0 = (limites[0][1] - limites[0][0]) or 1.0
        for n in isolados:
            ponto = [limites[0][0] - largura0 * (0.15 + rng.uniform(0, 0.35))]
            for lo, hi in limites[1:]:
                ponto.append(lo + rng.uniform(0, (hi - lo) or 1.0))
            pos[n] = tuple(ponto)

    print("Calculando layout de rede (spring_layout, 2D — posição = proximidade na colaboração)…")
    pos = nx.spring_layout(G_ativo, weight="weight", seed=SEMENTE)
    espalhar_isolados(pos, dims=2, rng=random.Random(SEMENTE))

    print("Calculando layout de rede (spring_layout, 3D — §4.2.5 item 4)…")
    pos3d = nx.spring_layout(G_ativo, weight="weight", seed=SEMENTE, dim=3)
    espalhar_isolados(pos3d, dims=3, rng=random.Random(SEMENTE + 1))

    print("Extraindo palavras-chave por comunidade (TF-IDF — pista de conteúdo, não a base do cluster)…")
    textos_por_id = dict(pares)
    labels_array = np.array([label_por_no[i] for i in ids_universo])
    textos_lista = [textos_por_id[i] for i in ids_universo]
    rotulos = rotular_clusters(ids_universo, textos_lista, labels_array)

    df = pd.DataFrame({
        "id_projeto": ids_universo,
        "cluster": labels_array.astype(int),
        "palavras_chave": [", ".join(rotulos.get(int(c), [])) for c in labels_array],
        "x": [pos[i][0] for i in ids_universo],
        "y": [pos[i][1] for i in ids_universo],
        "x3d": [pos3d[i][0] for i in ids_universo],
        "y3d": [pos3d[i][1] for i in ids_universo],
        "z3d": [pos3d[i][2] for i in ids_universo],
    })

    out_path.parent.mkdir(parents=True, exist_ok=True)
    df.to_parquet(out_path, index=False)
    with open(out_path.with_suffix(".json"), "w", encoding="utf-8") as f:
        json.dump(df.to_dict(orient="records"), f, ensure_ascii=False)
    print(f"Escrito {out_path} e {out_path.with_suffix('.json')} ({len(df)} linhas).")

    print("\nComunidades (ordenadas por tamanho):")
    contagem = pd.Series(labels_array).value_counts()
    for c, n in contagem.items():
        rotulo = "SEM COLABORAÇÃO REGISTRADA" if c == -1 else ", ".join(rotulos.get(int(c), [])[:5])
        print(f"  {c:>3}  n={n:<4}  {rotulo}")


def main():
    parser = argparse.ArgumentParser(
        description="Classificação de projetos: ANPPOM (§4.2.2), HDBSCAN, LDA/tópicos ou rede de colaboração (§4.2.5 item 3)",
    )
    parser.add_argument("--db", default=str(DEFAULT_DB))
    parser.add_argument("--out", default=None)
    parser.add_argument(
        "--hdbscan", action="store_true",
        help="Roda o método não supervisionado (HDBSCAN) em vez do zero-shot/manual ANPPOM.",
    )
    parser.add_argument(
        "--topicos", action="store_true",
        help="Roda modelagem de tópicos (LDA) em vez do zero-shot/manual ANPPOM.",
    )
    parser.add_argument(
        "--coautoria", action="store_true",
        help="Roda a rede de colaboração (Louvain sobre pessoa compartilhada) em vez do zero-shot/manual ANPPOM.",
    )
    parser.add_argument("--min-cluster-size", type=int, default=15)
    parser.add_argument("--tamanho-max", type=int, default=80)
    parser.add_argument("--n-topicos", type=int, default=15)
    parser.add_argument("--resolution", type=float, default=1.0, help="Resolução do Louvain (--coautoria).")
    args = parser.parse_args()

    if sum([args.hdbscan, args.topicos, args.coautoria]) > 1:
        raise SystemExit("--hdbscan, --topicos e --coautoria são exclusivos — escolha um.")

    db_path = Path(args.db)
    if not db_path.exists():
        raise FileNotFoundError(f"Banco não encontrado: {db_path}")

    if args.hdbscan:
        out_path = Path(args.out) if args.out else DEFAULT_OUT_HDBSCAN
        executar_hdbscan(db_path, out_path, args.min_cluster_size, args.tamanho_max)
    elif args.topicos:
        out_path = Path(args.out) if args.out else DEFAULT_OUT_TOPICOS
        executar_topicos(db_path, out_path, args.n_topicos)
    elif args.coautoria:
        out_path = Path(args.out) if args.out else DEFAULT_OUT_COAUTORIA
        executar_coautoria(db_path, out_path, args.resolution)
    else:
        out_path = Path(args.out) if args.out else DEFAULT_OUT
        executar(db_path, out_path)


if __name__ == "__main__":
    main()
