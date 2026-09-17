"""
Classificação do campo `Idioma`, e por que ele é um proxy fraco.

Por que existe (PLANO §4.1b.4): a regra ingênua — "idioma ≠ português, logo
internacional" — erra de três maneiras neste campo, e as três estão nos dados:

1. **`Idioma Nacional` (1.255 registros) não é um idioma**, é uma categoria da
   própria Plataforma, e significa português. Contá-lo como estrangeiro é o
   maior erro isolado possível aqui: são 8% de todos os registros do campo.
2. **`Kaingang` e `Guarani` são línguas brasileiras.** Publicar em Kaingang é
   diversidade linguística nacional, não internacionalização. Classificá-las
   como "estrangeiro" seria errado no dado e no que ele significa.
3. **`Publicação Multilíngue` não diz quais idiomas.** Vira `None`: sai do
   numerador e do denominador, como no campo de país.

E vale a ressalva de fundo, que a tela repete: **publicar em inglês não é
colaborar com estrangeiro**. Este campo só serve ao lado do país de realização,
nunca sozinho.

Uso:
    python3 -m analise.idiomas              # autotestes
    python3 -m analise.idiomas --conferir   # + o que a base tem e não casou

Stdlib pura.
"""

import unicodedata

NACIONAL = "nacional"
INDIGENA = "indigena_brasileira"
ESTRANGEIRO = "estrangeiro"
MULTILINGUE = "multilingue"
DESCONHECIDO = "desconhecido"

CLASSES = (NACIONAL, INDIGENA, ESTRANGEIRO, MULTILINGUE, DESCONHECIDO)

ROTULO_CLASSE = {
    NACIONAL: "Português",
    INDIGENA: "Língua indígena brasileira",
    ESTRANGEIRO: "Idioma estrangeiro",
    MULTILINGUE: "Multilíngue (não diz quais)",
    DESCONHECIDO: "Não identificado",
}

# Valor normalizado (sem acento, maiúsculo) → classe.
CLASSE_POR_IDIOMA = {
    "PORTUGUES": NACIONAL,
    "IDIOMA NACIONAL": NACIONAL,

    # Línguas brasileiras: nacionais, e a distinção importa — ver o docstring.
    "KAINGANG": INDIGENA,
    "GUARANI": INDIGENA,

    "INGLES": ESTRANGEIRO,
    "ESPANHOL": ESTRANGEIRO,
    "FRANCES": ESTRANGEIRO,
    "ALEMAO": ESTRANGEIRO,
    "ITALIANO": ESTRANGEIRO,
    "RUSSO": ESTRANGEIRO,
    "BELO-RUSSO": ESTRANGEIRO,
    "POLONES": ESTRANGEIRO,
    "NORUEGUES": ESTRANGEIRO,
    "MANDARIM": ESTRANGEIRO,
    "MALGAXE": ESTRANGEIRO,
    "BRETAO": ESTRANGEIRO,
    "BASHQUIR": ESTRANGEIRO,
    "ACADIANO": ESTRANGEIRO,
    "IDIOMA ESTRANGEIRO": ESTRANGEIRO,

    "MULTILINGUA": MULTILINGUE,
    "PUBLICACAO MULTILINGUE": MULTILINGUE,
}


def _norm(texto) -> str:
    nfd = unicodedata.normalize("NFD", str(texto or ""))
    return "".join(c for c in nfd if unicodedata.category(c) != "Mn").upper().strip()


def classe_do_idioma(valor) -> str:
    return CLASSE_POR_IDIOMA.get(_norm(valor), DESCONHECIDO)


def e_estrangeiro(valor) -> "bool | None":
    """True para idioma estrangeiro; False para português ou língua brasileira;
    None quando não dá para saber (multilíngue, vazio, valor novo).

    O None sai do denominador — tratá-lo como nacional ou estrangeiro enviesa o
    índice para um dos lados.
    """
    classe = classe_do_idioma(valor)
    if classe == ESTRANGEIRO:
        return True
    if classe in (NACIONAL, INDIGENA):
        return False
    return None


def _autoteste():
    casos = [
        ("PORTUGUES", NACIONAL, False),
        ("Idioma Nacional", NACIONAL, False),       # categoria, não idioma
        ("português", NACIONAL, False),
        ("KAINGANG", INDIGENA, False),              # brasileira, não estrangeira
        ("GUARANI", INDIGENA, False),
        ("INGLES", ESTRANGEIRO, True),
        ("Idioma Estrangeiro", ESTRANGEIRO, True),
        ("MALGAXE", ESTRANGEIRO, True),
        ("Publicação Multilingue", MULTILINGUE, None),
        ("MULTILINGUA", MULTILINGUE, None),
        ("IDIOMA QUE NAO EXISTE", DESCONHECIDO, None),
        ("", DESCONHECIDO, None),
        (None, DESCONHECIDO, None),
    ]
    for bruto, classe_esperada, intl in casos:
        assert classe_do_idioma(bruto) == classe_esperada, \
            f"{bruto!r}: esperado {classe_esperada}, obtido {classe_do_idioma(bruto)}"
        assert e_estrangeiro(bruto) is intl, f"{bruto!r}: estrangeiro esperado {intl}"
    assert set(CLASSE_POR_IDIOMA.values()) <= set(CLASSES)
    assert set(ROTULO_CLASSE) == set(CLASSES)
    print(f"autoteste: ok ({len(CLASSE_POR_IDIOMA)} idiomas classificados)")


def _conferir(db_path):
    import sqlite3
    from collections import Counter

    con = sqlite3.connect(db_path)
    valores = Counter(
        v for (v,) in con.execute("SELECT valor FROM producao_detalhe WHERE item = 'Idioma'")
    )
    con.close()

    total = sum(valores.values())
    por_classe = Counter()
    desconhecidos = Counter()
    for bruto, n in valores.items():
        classe = classe_do_idioma(bruto)
        por_classe[classe] += n
        if classe == DESCONHECIDO:
            desconhecidos[bruto] += n

    print(f"\n{total} registros de idioma, {len(valores)} formas distintas")
    for c in CLASSES:
        if por_classe[c]:
            print(f"  {ROTULO_CLASSE[c]:<28} {por_classe[c]:>6}  ({por_classe[c] / total * 100:4.1f}%)")
    if desconhecidos:
        print("\n  não classificados (saem do índice):")
        for bruto, n in desconhecidos.most_common(20):
            print(f"    {n:>4}  {bruto!r}")
    else:
        print("\n  todo idioma da base está classificado")
    return 0


def main():
    import argparse
    import sys
    from pathlib import Path

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--conferir", action="store_true")
    parser.add_argument("--db", default=str(Path(__file__).parent.parent / "sucupira.db"))
    args = parser.parse_args()

    _autoteste()
    if args.conferir:
        sys.exit(_conferir(args.db))


if __name__ == "__main__":
    main()
