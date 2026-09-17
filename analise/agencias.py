"""
Agências de fomento: identificação por prefixo, e a esfera de cada uma.

Por que existe (PLANO §4.1b.3): `projeto_financiador.agencia` vem com o nome da
agência **concatenado ao nome do programa de fomento, sem separador**:

    CONS NAC DE DESENVOLVIMENTO CIENTIFICO E TECNOLOGICOBOLSA de Iniciação…
    FUND COORD DE APERFEICOAMENTO DE PESSOAL DE NIVEL SUPPROGRAMA DE DEMANDA…

Não há como separar em geral — o limite entre os dois campos não é marcado por
nada. O que há é uma lista curta de agências conhecidas, e prefixo basta: são 35
formas distintas nos 595 registros da base. O que não casar vai para "outras",
**contado e exibido**, nunca descartado em silêncio.

A esfera (federal / estadual / própria IES / internacional) é o corte que a base
sustenta sem limpeza nenhuma. "UF da agência" não é: órgão federal não tem UF, e
a FAP identifica o estado pelo próprio nome. A leitura honesta é esfera +
agência, e é isso que o site mostra.

Uso:
    python3 -m analise.agencias              # tabela e autotestes
    python3 -m analise.agencias --conferir   # + o que a base tem e não casou

Stdlib pura.
"""

import unicodedata

FEDERAL = "federal"
ESTADUAL = "estadual"
PROPRIA_IES = "propria_ies"
INTERNACIONAL = "internacional"
OUTRA = "outra"

ESFERAS = (FEDERAL, ESTADUAL, PROPRIA_IES, INTERNACIONAL, OUTRA)

ROTULO_ESFERA = {
    FEDERAL: "Federal",
    ESTADUAL: "Fundação estadual (FAP)",
    PROPRIA_IES: "A própria instituição",
    INTERNACIONAL: "Internacional",
    OUTRA: "Não identificada",
}

# Prefixos normalizados (sem acento, em maiúsculas) → (sigla, esfera).
#
# A ordem importa: o casamento é pelo prefixo **mais longo** que serve, porque
# "FUNDACAO DE AMPARO A PESQUISA DO ESTADO DE SAO PAULO" e "...DE MINAS GERAIS"
# só se distinguem no fim. `identificar` cuida disso; esta lista pode ficar em
# qualquer ordem.
AGENCIAS = [
    # --- Federais ---------------------------------------------------------
    ("FUND COORD DE APERFEICOAMENTO DE PESSOAL DE NIVEL SUP", "CAPES", FEDERAL),
    ("COORDENACAO DE APERFEICOAMENTO DE PESSOAL DE NIVEL SUPERIOR", "CAPES", FEDERAL),
    ("CONS NAC DE DESENVOLVIMENTO CIENTIFICO E TECNOLOGICO", "CNPq", FEDERAL),
    ("CONSELHO NACIONAL DE DESENVOLVIMENTO CIENTIFICO E TECNOLOGICO", "CNPq", FEDERAL),
    ("FUNDO NACIONAL DE DESENVOLVIMENTO DA EDUCACAO", "FNDE", FEDERAL),
    ("FINANCIADORA DE ESTUDOS E PROJETOS", "FINEP", FEDERAL),

    # --- Fundações estaduais de amparo à pesquisa -------------------------
    ("FUNDACAO DE AMPARO A PESQUISA DO ESTADO DE SAO PAULO", "FAPESP", ESTADUAL),
    ("FUNDACAO DE AMPARO A PESQUISA DO ESTADO DE MINAS GERAIS", "FAPEMIG", ESTADUAL),
    ("FUNDACAO CARLOS CHAGAS FILHO DE AMPARO A PESQUISA DO ESTADO DO RIO DE JANEIRO", "FAPERJ", ESTADUAL),
    ("FUNDACAO CARLOS CHAGAS", "FAPERJ", ESTADUAL),  # forma curta, com o programa colado
    ("FUNDACAO DE AMPARO A PESQUISA DO ESTADO DA BAHIA", "FAPESB", ESTADUAL),
    ("FUNDACAO DE AMPARO A PESQUISA E INOVACAO DO ESTADO DE SANTA CATARINA", "FAPESC", ESTADUAL),
    ("FUNDACAO DE AMPARO A PESQUISA E INOVACAO DO ESTADO DE SANTA CATARIANA", "FAPESC", ESTADUAL),  # erro de digitação na fonte
    ("FUNDACAO ARAUCARIA", "Fundação Araucária", ESTADUAL),
    ("FUNDACAO DE AMPARO A PESQUISA DO ESTADO DO PARA", "FAPESPA", ESTADUAL),
    ("FUNDACAO DE AMPARO A PESQUISA DO ESTADO DO RIO GRANDE DO SUL", "FAPERGS", ESTADUAL),
    ("FUNDACAO DE AMPARO A CIENCIA E TECNOLOGIA DO ESTADO DE PERNAMBUCO", "FACEPE", ESTADUAL),
    ("FUNDACAO DE APOIO A PESQUISA DO DISTRITO FEDERAL", "FAPDF", ESTADUAL),
    ("FUNDACAO DE APOIO A PESQUISA DO ESTADO DA PARAIBA", "FAPESQ", ESTADUAL),
    ("FUNDACAO DE APOIO A PESQUISA DO ESTADO DO RIO GRANDE DO NORTE", "FAPERN", ESTADUAL),

    # --- A própria instituição --------------------------------------------
    # Bolsa e edital internos: PIBIC institucional, pró-reitoria, fundo próprio.
    # Ficam juntos porque a pergunta que respondem é a mesma — quanto do fomento
    # é da casa —, e separá-los por IES faria uma tabela de 9 linhas de 1 projeto.
    ("UNIVERSIDADE", "A própria IES", PROPRIA_IES),
    ("FUNDACAO PARA O DESENVOLVIMENTO DA UNESP", "A própria IES", PROPRIA_IES),

    # --- Internacionais ---------------------------------------------------
    ("THE LEVERHULME TRUST", "Leverhulme Trust", INTERNACIONAL),
    ("THE BRITISH ACADEMY", "British Academy", INTERNACIONAL),
    ("BRITISH ACADEMY", "British Academy", INTERNACIONAL),
    ("ALEXANDER VON HUMBOLDT", "Humboldt", INTERNACIONAL),
    ("FUNDACAO PARA A CIENCIA E A TECNOLOGIA", "FCT (Portugal)", INTERNACIONAL),
]


def _norm(texto) -> str:
    nfd = unicodedata.normalize("NFD", str(texto or ""))
    return "".join(c for c in nfd if unicodedata.category(c) != "Mn").upper().strip()


# Prefixo mais longo primeiro: sem isto, "FUNDACAO CARLOS CHAGAS" engoliria a
# forma completa do FAPERJ, e "UNIVERSIDADE" engoliria qualquer coisa que
# começasse assim.
_ORDENADAS = sorted(AGENCIAS, key=lambda t: -len(t[0]))


def identificar(agencia) -> tuple:
    """(sigla, esfera) para um valor bruto do campo `agencia`.

    Desconhecido devolve ("Outra", OUTRA) — nunca levanta erro e nunca some.
    """
    texto = _norm(agencia)
    for prefixo, sigla, esfera in _ORDENADAS:
        if texto.startswith(prefixo):
            return sigla, esfera
    return "Outra", OUTRA


def _autoteste():
    casos = [
        ("CONS NAC DE DESENVOLVIMENTO CIENTIFICO E TECNOLOGICOBOLSA de Iniciação Científica", "CNPq", FEDERAL),
        ("FUND COORD DE APERFEICOAMENTO DE PESSOAL DE NIVEL SUPPROGRAMA DE DEMANDA SOCIAL", "CAPES", FEDERAL),
        ("FUNDAÇÃO DE AMPARO À PESQUISA DO ESTADO DE SÃO PAULOBolsa de Doutorado", "FAPESP", ESTADUAL),
        ("FUNDACAO DE AMPARO A PESQUISA DO ESTADO DE MINAS GERAISAUXILIO FINANCEIRO", "FAPEMIG", ESTADUAL),
        # a forma completa do FAPERJ não pode cair na regra curta antes da hora
        ("FUNDACAO CARLOS CHAGAS FILHO DE AMPARO A PESQUISA DO ESTADO DO RIO DE JANEIROX", "FAPERJ", ESTADUAL),
        ("FUNDACAO CARLOS CHAGASCIENTISTA DO NOSSO ESTADO", "FAPERJ", ESTADUAL),
        ("UNIVERSIDADE FEDERAL DO RIO GRANDE DO NORTEPRÓ-REITORIA DE PESQUISA", "A própria IES", PROPRIA_IES),
        ("THE LEVERHULME TRUSTAUXILIO PESQUISA", "Leverhulme Trust", INTERNACIONAL),
        ("AGENCIA QUE NAO EXISTE", "Outra", OUTRA),
        (None, "Outra", OUTRA),
    ]
    for bruto, sigla_esperada, esfera_esperada in casos:
        sigla, esfera = identificar(bruto)
        assert (sigla, esfera) == (sigla_esperada, esfera_esperada), \
            f"{bruto!r}: esperado {(sigla_esperada, esfera_esperada)}, obtido {(sigla, esfera)}"
    assert {e for _, _, e in AGENCIAS} <= set(ESFERAS)
    assert set(ROTULO_ESFERA) == set(ESFERAS)
    print(f"autoteste: ok ({len(AGENCIAS)} prefixos, {len(set(s for _, s, _ in AGENCIAS))} agências)")


def _conferir(db_path):
    """Mostra a cobertura contra a base e lista o que não casou."""
    import sqlite3
    from collections import Counter

    con = sqlite3.connect(db_path)
    registros = [a for (a,) in con.execute("SELECT agencia FROM projeto_financiador")]
    con.close()

    por_esfera = Counter()
    por_agencia = Counter()
    nao_casados = Counter()
    for bruto in registros:
        sigla, esfera = identificar(bruto)
        por_esfera[esfera] += 1
        por_agencia[sigla] += 1
        if esfera == OUTRA:
            nao_casados[_norm(bruto)[:60]] += 1

    total = len(registros)
    print(f"\n{total} registros de financiamento")
    for e in ESFERAS:
        if por_esfera[e]:
            print(f"  {ROTULO_ESFERA[e]:<26} {por_esfera[e]:>4}  ({por_esfera[e] / total * 100:4.1f}%)")
    print("\n  por agência:")
    for sigla, n in por_agencia.most_common():
        print(f"    {sigla:<20} {n:>4}")

    if nao_casados:
        print(f"\n  NÃO IDENTIFICADAS ({sum(nao_casados.values())} registros):")
        for texto, n in nao_casados.most_common():
            print(f"    {n:>3}  {texto}")
        print("\n  Não é erro fatal: elas aparecem no site como 'não identificada'.")
        print("  Vale acrescentá-las a AGENCIAS se forem recorrentes.")
    else:
        print("\n  toda agência da base foi identificada")
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
    for esfera in ESFERAS[:-1]:
        siglas = sorted({s for _, s, e in AGENCIAS if e == esfera})
        print(f"\n{ROTULO_ESFERA[esfera]}: {', '.join(siglas)}")

    if args.conferir:
        sys.exit(_conferir(args.db))


if __name__ == "__main__":
    main()
