"""
Normalização do campo `(PAC) País`, e o que ele pode e não pode medir.

Por que existe (PLANO §4.1b.4): o campo é livre, e o índice de
internacionalização sai errado sem tratá-lo. São 139 formas distintas para umas
50 entidades, e três problemas diferentes convivem nele:

1. **Variação de grafia:** `Brasil`, `Brasil ` (181), `BRASIL` (156), `bRASIL`,
   `BRasil`, `Brazil`, `Brasile`, `BRAIL`, `Nrasil`, `BR`.
2. **Vários países num campo só:** `Brasil e Argentina`, `Uruguai; Chile;
   Argentina`, `FRANÇA/BRASIL`, `França, Espanha e Itália.`.
3. **O que não é país:** `Online`, `Virtual`, `SP`, `Porto Alegre`, `Campinas`,
   `Morges`, `Sucre`, `x`, `Diversos`, `29/01/2023`.

O terceiro é o que mais engana. Uma regra ingênua — "país ≠ Brasil, logo
internacional" — conta `Online` e `Porto Alegre` como exterior e **infla** o
índice. Aqui esses valores devolvem lista vazia e saem do numerador **e do
denominador**: são "não informado", não "nacional".

Decisão declarada: `Inglaterra`, `Escócia`, `Grã-Bretanha` e `UK` viram
**Reino Unido**. Agregar reduz detalhe e evita quatro linhas de 1 registro que
dizem a mesma coisa; quem quiser o detalhe tem o dado bruto na base.

Uso:
    python3 -m analise.paises              # autotestes
    python3 -m analise.paises --conferir   # + o que a base tem e não casou

Stdlib pura.
"""

import re
import unicodedata

# Formas normalizadas (sem acento, maiúsculas) → nome canônico exibido.
# Só precisa entrar aqui o que **difere** do canônico depois de normalizado.
ALIAS = {
    "BRASIL": "Brasil", "BRAZIL": "Brasil", "BRASILE": "Brasil", "BRAIL": "Brasil",
    "NRASIL": "Brasil", "BR": "Brasil",
    "EUA": "Estados Unidos", "USA": "Estados Unidos",
    "ESTADOS UNIDOS DA AMERICA": "Estados Unidos", "ESTADOS UNIDOS": "Estados Unidos",
    "INGLATERRA": "Reino Unido", "ESCOCIA": "Reino Unido",
    "GRA-BRETANHA": "Reino Unido", "GRA BRETANHA": "Reino Unido", "UK": "Reino Unido",
    "HOLANDA": "Países Baixos", "PAISES BAIXOS": "Países Baixos",
    "REPUBLICA TCHECA": "Tchéquia", "REPUBLICA CHECA": "Tchéquia", "TCHEQUIA": "Tchéquia",
    "URUGUAY": "Uruguai", "PARAGUAY": "Paraguai", "MEXICO": "México",
    "SUICA": "Suíça", "ITALIA": "Itália", "AUSTRIA": "Áustria", "RUSSIA": "Rússia",
    "COLOMBIA": "Colômbia", "ALEMANHA": "Alemanha", "ALEMANHA": "Alemanha",
    "PRINCIPADO DE MONACO": "Mônaco", "MONACO": "Mônaco",
    "EMIRADOS ARABES": "Emirados Árabes Unidos",
    "EMIRADOS ARABES UNIDOS": "Emirados Árabes Unidos",
}

# Canônicos que aparecem tal e qual (só perdendo acento na normalização).
CANONICOS = [
    "Argentina", "Austrália", "Azerbaijão", "Bélgica", "Bolívia", "Brunei", "Bulgária",
    "Canadá", "Chile", "China", "Coreia do Sul", "Costa Rica", "Croácia", "Cuba",
    "Dinamarca", "Eslovênia", "Espanha", "Equador", "França", "Grécia", "Hungria",
    "Israel", "Japão", "Luxemburgo", "Noruega", "Nova Zelândia", "Peru", "Polônia",
    "Portugal", "Romênia", "Sérvia", "Suécia", "Tailândia", "Turquia", "Venezuela",
]

# Valores que existem no campo e **não são país**. Devolvem lista vazia, o que os
# tira do numerador e do denominador do índice de internacionalização.
NAO_E_PAIS = {
    "ONLINE", "VIRTUAL", "DIVERSOS", "VARIOS", "X",
    # cidades e siglas de estado lançadas no campo errado
    "SP", "PORTO ALEGRE", "CAMPINAS", "MORGES", "SUCRE",
}

BRASIL = "Brasil"

_SEPARADORES = re.compile(r"[,;/]| E | e |\se\s")
_DATA = re.compile(r"^\d{1,2}/\d{1,2}/\d{2,4}$")


def _norm(texto: str) -> str:
    nfd = unicodedata.normalize("NFD", texto or "")
    sem_acento = "".join(c for c in nfd if unicodedata.category(c) != "Mn")
    return sem_acento.upper().strip().strip(".").strip()


# O nome canônico também casa consigo mesmo: "Uruguai" precisa ser reconhecido,
# e não só o apelido "Uruguay". Sem esta linha, um país só entra na conta pela
# forma errada — que foi exatamente o que o autoteste pegou.
_CANONICO_POR_NORM = {_norm(c): c for c in CANONICOS}
_CANONICO_POR_NORM.update({_norm(v): v for v in ALIAS.values()})
_CANONICO_POR_NORM.update({_norm(k): v for k, v in ALIAS.items()})


def paises(valor) -> list:
    """Lista de países canônicos num valor do campo. Vazia = nenhum país legível.

    Vazia é diferente de "Brasil": um campo com `Online` não diz que a obra
    aconteceu no Brasil, diz que não se sabe onde.
    """
    if valor is None:
        return []
    bruto = str(valor)
    if _DATA.match(bruto.strip()):
        return []
    achados = []
    for parte in _SEPARADORES.split(bruto):
        chave = _norm(parte)
        if not chave or chave in NAO_E_PAIS:
            continue
        canonico = _CANONICO_POR_NORM.get(chave)
        if canonico and canonico not in achados:
            achados.append(canonico)
    return achados


def e_internacional(valor) -> "bool | None":
    """True se há país estrangeiro; False se só Brasil; None se não dá para saber.

    O None é o ponto: ele sai do denominador. Tratá-lo como nacional ou como
    internacional enviesa o índice para um dos lados, e as duas coisas já
    aconteceram em versões anteriores deste projeto.
    """
    lista = paises(valor)
    if not lista:
        return None
    return any(p != BRASIL for p in lista)


def _autoteste():
    casos = [
        ("Brasil", [BRASIL], False),
        ("BRASIL ", [BRASIL], False),
        ("bRASIL", [BRASIL], False),
        ("Brasil.", [BRASIL], False),
        ("Brazil", [BRASIL], False),
        ("BRAIL", [BRASIL], False),
        ("Itália", ["Itália"], True),
        ("ITALIA", ["Itália"], True),
        ("EUA", ["Estados Unidos"], True),
        ("Estados Unidos da América", ["Estados Unidos"], True),
        ("Inglaterra", ["Reino Unido"], True),
        ("Escócia, Grã-Bretanha", ["Reino Unido"], True),
        ("Brasil e Argentina", [BRASIL, "Argentina"], True),
        ("FRANÇA/BRASIL", ["França", BRASIL], True),
        ("Uruguai; Chile; Argentina", ["Uruguai", "Chile", "Argentina"], True),
        ("França, Espanha e Itália.", ["França", "Espanha", "Itália"], True),
        # o que não é país sai da conta, em vez de virar "internacional"
        ("Online", [], None),
        ("Porto Alegre", [], None),
        ("SP", [], None),
        ("x", [], None),
        ("29/01/2023", [], None),
        ("", [], None),
        (None, [], None),
    ]
    for bruto, esperado, intl in casos:
        obtido = paises(bruto)
        assert obtido == esperado, f"{bruto!r}: esperado {esperado}, obtido {obtido}"
        assert e_internacional(bruto) is intl, f"{bruto!r}: internacional esperado {intl}"
    print(f"autoteste: ok ({len(CANONICOS)} canônicos, {len(ALIAS)} apelidos)")


def _conferir(db_path):
    import sqlite3
    from collections import Counter

    con = sqlite3.connect(db_path)
    valores = Counter(
        v for (v,) in con.execute(
            "SELECT valor FROM producao_detalhe WHERE item = '(PAC) País'"
        )
    )
    con.close()

    total = sum(valores.values())
    reconhecidos = Counter()
    sem_pais = Counter()
    for bruto, n in valores.items():
        lista = paises(bruto)
        if lista:
            for p in lista:
                reconhecidos[p] += n
        else:
            sem_pais[bruto] += n

    n_sem = sum(sem_pais.values())
    print(f"\n{total} registros de país, {len(valores)} formas distintas")
    print(f"  reconhecidos: {total - n_sem} ({(total - n_sem) / total * 100:.1f}%)")
    print(f"  sem país legível: {n_sem} ({n_sem / total * 100:.1f}%)")
    print("\n  países mais frequentes:")
    for p, n in reconhecidos.most_common(12):
        print(f"    {p:<22} {n:>5}")
    if sem_pais:
        print("\n  valores sem país legível (saem do índice, não viram 'internacional'):")
        for bruto, n in sem_pais.most_common(20):
            print(f"    {n:>3}  {bruto!r}")
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
