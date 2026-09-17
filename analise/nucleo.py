"""
Núcleo comparável: a classificação versionada dos tipos de produção.

Por que existe (PLANO §4.1a): o total bruto de produções **não é comparável**
entre programas. A UNESP registra 3.270 produções no quadriênio contra 1.194 da
USP com quadro docente do mesmo tamanho — e é a que menos publica artigo em
periódico entre os quatro grandes. A diferença é política de preenchimento:
relatório de pesquisa, parecer ad hoc, serviço técnico, curso de curta duração,
organização de evento. Qualquer gráfico de volume que some tudo compara coisas
diferentes.

A resposta deste módulo é uma **regra explícita, versionada e auditável**: cada
rubrica (tipo, subtipo) da Plataforma cai em uma de quatro classes, e o site
oferece o "núcleo comparável" **ao lado** do total, nunca no lugar dele. A
distância entre os dois é a medida de política de registro.

A classificação é do *tipo de item*, não de quem registra mais. `PARTITURA
MUSICAL` fica no núcleo porque é obra de criação, ainda que a UNESP registre 2,2×
a participação dos demais; `ORGANIZAÇÃO DE EVENTO` fica fora porque é atividade,
ainda que todo programa registre alguma.

Uso:
    python3 -m analise.nucleo              # imprime a tabela e os autotestes
    python3 -m analise.nucleo --conferir   # + confere contra sucupira.db

Stdlib pura, como o resto do caminho de reprodução da base.
"""

import re
import unicodedata

# ---------------------------------------------------------------------------
# As quatro classes
# ---------------------------------------------------------------------------

NUCLEO = "nucleo"
DIFUSAO = "difusao"
TECNICA = "tecnica"
INDEFINIDO = "indefinido"

CLASSES = (NUCLEO, DIFUSAO, TECNICA, INDEFINIDO)

ROTULO_CLASSE = {
    NUCLEO: "Núcleo comparável",
    DIFUSAO: "Difusão e ensino",
    TECNICA: "Técnica, serviço e gestão",
    INDEFINIDO: "Rubrica indefinida",
}

DESCRICAO_CLASSE = {
    NUCLEO: (
        "Obra de pesquisa ou de criação artística com resultado externo: artigo, "
        "livro, trabalho em anais, partitura, tradução e produção artístico-cultural. "
        "É o recorte que todos os 20 programas registram de forma parecida."
    ),
    DIFUSAO: (
        "Comunicação e ensino: apresentação de trabalho, curso de curta duração, "
        "programa de rádio ou TV, artigo em jornal, material didático. Atividade "
        "real, mas registrada com critério muito desigual entre programas."
    ),
    TECNICA: (
        "Produto técnico, serviço e gestão: serviços técnicos, organização de evento, "
        "editoria, relatório de pesquisa, desenvolvimento de produto ou aplicativo. "
        "É onde mora a maior parte da diferença de preenchimento."
    ),
    INDEFINIDO: (
        "Rubricas 'OUTRO' da própria Plataforma. Ficam fora do núcleo não por "
        "julgamento de valor, e sim porque não se sabe o que são."
    ),
}

# ---------------------------------------------------------------------------
# A tabela. Chave = (tipo, subtipo) exatamente como a Plataforma publica.
#
# Cobre as 27 rubricas presentes na base em 2026-08-06. Rubrica nova cai em
# INDEFINIDO e é denunciada por --conferir; nunca entra no núcleo em silêncio.
# ---------------------------------------------------------------------------

CLASSE_POR_RUBRICA = {
    # --- BIBLIOGRÁFICA -----------------------------------------------------
    ("BIBLIOGRÁFICA", "ARTIGO EM PERIÓDICO"): NUCLEO,
    ("BIBLIOGRÁFICA", "LIVRO"): NUCLEO,  # inclui capítulo: a API não os separa
    ("BIBLIOGRÁFICA", "TRABALHO EM ANAIS"): NUCLEO,
    ("BIBLIOGRÁFICA", "PARTITURA MUSICAL"): NUCLEO,
    ("BIBLIOGRÁFICA", "TRADUÇÃO"): NUCLEO,
    # Jornal e revista de circulação geral é divulgação, não publicação avaliada.
    ("BIBLIOGRÁFICA", "ARTIGO EM JORNAL OU REVISTA"): DIFUSAO,
    ("BIBLIOGRÁFICA", "OUTRO"): INDEFINIDO,
    ("BIBLIOGRÁFICA", "OUTRO (BIBLIOGRÁFICA)"): INDEFINIDO,

    # --- ARTÍSTICO-CULTURAL ------------------------------------------------
    # A área é Música: performance e composição são o resultado de pesquisa,
    # não subproduto dele. O núcleo seria enviesado contra os programas de
    # performance se as excluísse.
    ("ARTÍSTICO-CULTURAL", "MÚSICA"): NUCLEO,
    ("ARTÍSTICO-CULTURAL", "ARTES CÊNICAS"): NUCLEO,
    ("ARTÍSTICO-CULTURAL", "ARTES VISUAIS"): NUCLEO,
    ("ARTÍSTICO-CULTURAL", "OUTRA PRODUÇÃO CULTURAL"): NUCLEO,

    # --- TÉCNICA -----------------------------------------------------------
    ("TÉCNICA", "APRESENTAÇÃO DE TRABALHO"): DIFUSAO,
    ("TÉCNICA", "CURSO DE CURTA DURAÇÃO"): DIFUSAO,
    ("TÉCNICA", "PROGRAMA DE RÁDIO OU TV"): DIFUSAO,
    ("TÉCNICA", "DESENVOLVIMENTO DE MATERIAL DIDÁTICO E INSTRUCIONAL"): DIFUSAO,
    ("TÉCNICA", "SERVIÇOS TÉCNICOS"): TECNICA,
    ("TÉCNICA", "ORGANIZAÇÃO DE EVENTO"): TECNICA,
    ("TÉCNICA", "EDITORIA"): TECNICA,
    ("TÉCNICA", "RELATÓRIO DE PESQUISA"): TECNICA,
    ("TÉCNICA", "DESENVOLVIMENTO DE APLICATIVO"): TECNICA,
    ("TÉCNICA", "DESENVOLVIMENTO DE PRODUTO"): TECNICA,
    ("TÉCNICA", "DESENVOLVIMENTO DE TÉCNICA"): TECNICA,
    ("TÉCNICA", "MANUTENÇÃO DE OBRA ARTÍSTICA"): TECNICA,
    ("TÉCNICA", "PATENTE"): TECNICA,
    ("TÉCNICA", "OUTRO"): INDEFINIDO,
    ("TÉCNICA", "OUTRO (TÉCNICA)"): INDEFINIDO,
}


def classe_da_rubrica(tipo, subtipo) -> str:
    """Classe de uma rubrica. Rubrica desconhecida é INDEFINIDO, nunca núcleo."""
    chave = ((tipo or "").strip().upper(), (subtipo or "").strip().upper())
    return CLASSE_POR_RUBRICA.get(chave, INDEFINIDO)


def no_nucleo(tipo, subtipo) -> bool:
    return classe_da_rubrica(tipo, subtipo) == NUCLEO


# ---------------------------------------------------------------------------
# Títulos administrativos recorrentes
#
# Segundo eixo do §4.1a, e independente da classe: são itens de rotina — um
# registro por pessoa por ano — lançados como produção. `RELATÓRIO ANUAL DE
# ATIVIDADES` aparece 27 vezes na UNESP; `PARECER AD HOC …`, dezenas de vezes em
# metade dos programas.
#
# A regra é deliberadamente **estreita**: só marca o que é inequivocamente
# rotina administrativa, e só fora do núcleo (um livro chamado "Pareceres" não
# vira administrativo). Falso negativo aqui custa pouco; falso positivo custa a
# credibilidade do número.
# ---------------------------------------------------------------------------

PADROES_ADMINISTRATIVOS = [
    # (nome da regra, regex sobre o título sem acento, em minúsculas)
    ("relatório de atividades", r"^relatorio\s+(anual|de\s+atividades|cientifico|de\s+pesquisa|final|parcial|tecnico)"),
    ("parecer / parecerista", r"^(parecer|pareceres|parecerista|emissao\s+de\s+parecer)"),
    ("parecer ad hoc", r"\bad[\s-]?hoc\b"),
    ("membro de comissão ou comitê", r"^(membro|participacao)\s+(de|do|da|em)\s+(comissao|comite|conselho|banca)"),
]

_PADROES_COMPILADOS = [(nome, re.compile(rx)) for nome, rx in PADROES_ADMINISTRATIVOS]


def _sem_acento(texto: str) -> str:
    nfd = unicodedata.normalize("NFD", texto)
    return "".join(c for c in nfd if unicodedata.category(c) != "Mn")


def regra_administrativa(nome, tipo=None, subtipo=None) -> "str | None":
    """Nome da regra que marca o título como administrativo, ou None.

    `tipo`/`subtipo`, quando informados, protegem o núcleo: obra de pesquisa não
    é marcada mesmo que o título case com um padrão.
    """
    if not nome:
        return None
    if tipo is not None and no_nucleo(tipo, subtipo):
        return None
    texto = _sem_acento(str(nome).strip().lower())
    for regra, rx in _PADROES_COMPILADOS:
        if rx.search(texto):
            return regra
    return None


def e_administrativo(nome, tipo=None, subtipo=None) -> bool:
    return regra_administrativa(nome, tipo, subtipo) is not None


# ---------------------------------------------------------------------------
# Autoteste e conferência contra a base
# ---------------------------------------------------------------------------

def _autoteste():
    casos_classe = [
        (("BIBLIOGRÁFICA", "ARTIGO EM PERIÓDICO"), NUCLEO),
        (("ARTÍSTICO-CULTURAL", "MÚSICA"), NUCLEO),
        (("TÉCNICA", "RELATÓRIO DE PESQUISA"), TECNICA),
        (("TÉCNICA", "APRESENTAÇÃO DE TRABALHO"), DIFUSAO),
        (("BIBLIOGRÁFICA", "OUTRO"), INDEFINIDO),
        # rubrica que não existe: cai fora do núcleo, não dentro
        (("TÉCNICA", "RUBRICA QUE NÃO EXISTE"), INDEFINIDO),
        # tolerância a caixa e espaço, porque a API não é consistente
        (("bibliográfica", " livro "), NUCLEO),
    ]
    for (tipo, subtipo), esperado in casos_classe:
        obtido = classe_da_rubrica(tipo, subtipo)
        assert obtido == esperado, f"{tipo}/{subtipo}: esperado {esperado}, obtido {obtido}"

    casos_admin = [
        ("RELATÓRIO ANUAL DE ATIVIDADES", "TÉCNICA", "RELATÓRIO DE PESQUISA", True),
        ("Parecer ad hoc FAPESP", "TÉCNICA", "SERVIÇOS TÉCNICOS", True),
        ("Parecerista da revista Opus", "TÉCNICA", "EDITORIA", True),
        ("Membro de comissão científica do congresso", "TÉCNICA", "OUTRO", True),
        # o padrão 'relat' não pode pegar 'relationship'
        ("Relationship between aggression and behavior", "TÉCNICA", "OUTRO", False),
        # o núcleo é protegido: obra com título parecido não é administrativa
        ("Pareceres sobre a música brasileira", "BIBLIOGRÁFICA", "LIVRO", False),
        ("Recital de piano", "ARTÍSTICO-CULTURAL", "MÚSICA", False),
        (None, "TÉCNICA", "OUTRO", False),
    ]
    for nome, tipo, subtipo, esperado in casos_admin:
        obtido = e_administrativo(nome, tipo, subtipo)
        assert obtido == esperado, f"{nome!r}: esperado {esperado}, obtido {obtido}"

    assert set(CLASSE_POR_RUBRICA.values()) <= set(CLASSES)
    assert set(ROTULO_CLASSE) == set(CLASSES) == set(DESCRICAO_CLASSE)
    print("autoteste: ok (%d rubricas classificadas)" % len(CLASSE_POR_RUBRICA))


def _conferir(db_path):
    """Confere a tabela contra a base: rubrica presente e não classificada é erro."""
    import sqlite3

    con = sqlite3.connect(db_path)
    rubricas = con.execute("""
        SELECT tipo, subtipo, COUNT(*) FROM producoes GROUP BY tipo, subtipo
    """).fetchall()

    faltando = [
        (t, s, n) for t, s, n in rubricas
        if (( (t or "").strip().upper(), (s or "").strip().upper() ) not in CLASSE_POR_RUBRICA)
    ]

    total = sum(n for _, _, n in rubricas)
    por_classe = {c: 0 for c in CLASSES}
    for t, s, n in rubricas:
        por_classe[classe_da_rubrica(t, s)] += n

    def br(n: int) -> str:
        return f"{n:,}".replace(",", ".")

    print(f"\nBase: {br(total)} produções em {len(rubricas)} rubricas")
    for c in CLASSES:
        print(f"  {ROTULO_CLASSE[c]:<28} {br(por_classe[c]):>7}  ({por_classe[c] / total * 100:4.1f}%)")

    n_admin = 0
    for nome, tipo, subtipo in con.execute("SELECT nome, tipo, subtipo FROM producoes"):
        if e_administrativo(nome, tipo, subtipo):
            n_admin += 1
    print(f"  títulos administrativos marcados: {n_admin}")
    con.close()

    if faltando:
        print("\nERRO: rubricas na base e ausentes da tabela (caíram em INDEFINIDO):")
        for t, s, n in faltando:
            print(f"  {t!r} / {s!r}  ({n})")
        return 1
    print("\nconferência: ok — toda rubrica da base está classificada")
    return 0


def main():
    import argparse
    import sys
    from pathlib import Path

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--conferir", action="store_true", help="confere contra sucupira.db")
    parser.add_argument("--db", default=str(Path(__file__).parent.parent / "sucupira.db"))
    args = parser.parse_args()

    _autoteste()
    for c in CLASSES:
        rubricas = [s or t for (t, s), k in CLASSE_POR_RUBRICA.items() if k == c]
        print(f"\n{ROTULO_CLASSE[c]}:")
        for r in sorted(rubricas):
            print(f"  · {r}")

    if args.conferir:
        sys.exit(_conferir(args.db))


if __name__ == "__main__":
    main()
