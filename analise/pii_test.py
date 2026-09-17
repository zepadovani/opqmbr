"""
Guarda-corpo de PII: varre os artefatos publicáveis atrás de identificadores
reais (`id_pessoa`, `id_projeto`) e de nomes de pessoa.

Sai com código 1 se achar qualquer um. Rode DEPOIS de `npm run build`:

    python3 -m analise.pii_test [--db PATH] [--dist DIR] [--public DIR]

Duas estratégias, porque os dois tipos de arquivo permitem coisas diferentes:

* **JSON** (`site/public/data/`, `site/dist/**.json`): verificação
  **estrutural**. Percorre a árvore e testa só (a) valores de campos cujo nome é
  de identificador e (b) chaves de dicionário. Não casa número solto — o que
  elimina *por construção* o falso positivo em que `"n_docentes": 11` era lido
  como o id de pessoa 11 (o único id com ≤ 3 dígitos na base). Um guard que
  grita sem motivo acaba desligado, e aí não guarda nada.

* **JS/CSS/HTML/map** (bundles, onde não há árvore a percorrer): regex, mas
  exigindo **contexto de chave** (`"id_pessoa":11`), nunca número nu.

Nomes são checados **todos**, por alternação compilada — a versão anterior
amostrava 200 de um `set`, e como o Python randomiza o hash de `str` por
processo, cada execução testava um subconjunto diferente: um vazamento passava
num run e falhava no seguinte. E não há `break`: um vazamento real precisa ser
contado inteiro, não reportado como "1 ocorrência".
"""

import argparse
import json
import re
import sqlite3
import sys
from collections import Counter
from pathlib import Path

REPO_ROOT = Path(__file__).parent.parent
DEFAULT_DB = REPO_ROOT / "sucupira.db"
DEFAULT_DIST = REPO_ROOT / "site" / "dist"
DEFAULT_PUBLIC = REPO_ROOT / "site" / "public" / "data"

# Campos que carregam identificador. Um valor aqui é sempre suspeito; o mesmo
# número em `n_docentes` não é.
CAMPOS_ID_PESSOA = {"id_pessoa", "idpessoa", "pessoa_id", "id_autor", "autor_id"}
CAMPOS_ID_PROJETO = {"id_projeto", "idprojeto", "projeto_id"}
CAMPOS_ID_GENERICO = re.compile(r"(^|_)(id|ids)$|^id_|_id$", re.IGNORECASE)

SUFIXOS_TEXTO = (".js", ".mjs", ".ts", ".jsx", ".tsx", ".html", ".css", ".map", ".txt", ".csv")
SUFIXOS_JSON = (".json",)

# Nomes curtos demais viram falso positivo (sobrenome comum dentro de outra
# palavra). O corte é o mesmo da versão anterior, agora explicado.
MIN_TAMANHO_NOME = 6


class Violacao:
    def __init__(self, arquivo: Path, categoria: str, valor: str, onde: str):
        self.arquivo = arquivo
        self.categoria = categoria
        self.valor = valor
        self.onde = onde

    def __str__(self) -> str:
        return f"{self.categoria} {self.valor!r} em {self.arquivo.name} ({self.onde})"


def carregar_reais(db_path: Path) -> tuple[set[str], set[str], set[str]]:
    """(ids de pessoa, ids de projeto, nomes canônicos) vindos do banco."""
    con = sqlite3.connect(db_path)
    try:
        pessoa_ids = {str(r[0]) for r in con.execute("SELECT id_pessoa FROM pessoas") if r[0] is not None}
        projeto_ids = {str(r[0]) for r in con.execute("SELECT id_projeto FROM projetos") if r[0] is not None}
        nomes = {
            r[0].strip()
            for r in con.execute("SELECT nome_canonico FROM pessoas WHERE nome_canonico IS NOT NULL")
            if r[0] and len(r[0].strip()) >= MIN_TAMANHO_NOME
        }
    finally:
        con.close()
    return pessoa_ids, projeto_ids, nomes


def compilar_regex_nomes(nomes: set[str]) -> "re.Pattern[str] | None":
    """Alternação única com todos os nomes — uma passada por arquivo."""
    if not nomes:
        return None
    # Do mais longo para o mais curto: assim o casamento reporta o nome completo,
    # e não um prefixo que também esteja na lista.
    ordenados = sorted(nomes, key=len, reverse=True)
    return re.compile("|".join(re.escape(n) for n in ordenados), re.IGNORECASE)


def _valores_de_id(no, caminho: str, achados: list[tuple[str, str, str]]) -> None:
    """
    Percorre a árvore JSON acumulando (tipo, valor, caminho) para tudo que
    *pode* ser identificador: valor de campo com nome de id, e chave de dict.
    """
    if isinstance(no, dict):
        for chave, valor in no.items():
            k = str(chave)
            filho = f"{caminho}.{k}" if caminho else k
            kl = k.lower()

            # A própria chave pode ser o id (mapa id -> dado).
            achados.append(("chave", k, caminho or "(raiz)"))

            if isinstance(valor, (str, int)) and not isinstance(valor, bool):
                if kl in CAMPOS_ID_PESSOA:
                    achados.append(("pessoa", str(valor), filho))
                elif kl in CAMPOS_ID_PROJETO:
                    achados.append(("projeto", str(valor), filho))
                elif CAMPOS_ID_GENERICO.search(kl):
                    achados.append(("qualquer", str(valor), filho))

            _valores_de_id(valor, filho, achados)

    elif isinstance(no, list):
        for i, item in enumerate(no):
            _valores_de_id(item, f"{caminho}[{i}]", achados)


def varrer_json(
    path: Path, pessoa_ids: set[str], projeto_ids: set[str], rx_nomes: "re.Pattern[str] | None"
) -> list[Violacao]:
    violacoes: list[Violacao] = []

    texto = path.read_text(encoding="utf-8", errors="replace")
    try:
        dados = json.loads(texto)
    except json.JSONDecodeError as e:
        # Não silenciar: um .json ilegível é um arquivo não verificado.
        return [Violacao(path, "JSON-INVALIDO", str(e), "arquivo inteiro")]

    achados: list[tuple[str, str, str]] = []
    _valores_de_id(dados, "", achados)

    for tipo, valor, onde in achados:
        if tipo in ("pessoa", "chave", "qualquer") and valor in pessoa_ids:
            violacoes.append(Violacao(path, "ID_PESSOA", valor, onde))
        if tipo in ("projeto", "chave", "qualquer") and valor in projeto_ids:
            violacoes.append(Violacao(path, "ID_PROJETO", valor, onde))

    # Nomes: aqui a busca é textual mesmo — um nome não colide com contagem.
    if rx_nomes:
        for m in rx_nomes.finditer(texto):
            violacoes.append(Violacao(path, "NOME", m.group(0), f"offset {m.start()}"))

    return violacoes


def varrer_texto(
    path: Path,
    rx_id_pessoa: "re.Pattern[str] | None",
    rx_id_projeto: "re.Pattern[str] | None",
    rx_nomes: "re.Pattern[str] | None",
) -> list[Violacao]:
    violacoes: list[Violacao] = []
    texto = path.read_text(encoding="utf-8", errors="replace")

    for rx, categoria in ((rx_id_pessoa, "ID_PESSOA"), (rx_id_projeto, "ID_PROJETO")):
        if rx is None:
            continue
        for m in rx.finditer(texto):
            violacoes.append(Violacao(path, categoria, m.group("valor"), f"offset {m.start()}"))

    if rx_nomes:
        for m in rx_nomes.finditer(texto):
            violacoes.append(Violacao(path, "NOME", m.group(0), f"offset {m.start()}"))

    return violacoes


def compilar_regex_ids_com_chave(campos: set[str], ids: set[str]) -> "re.Pattern[str] | None":
    """
    `"id_pessoa":"123"` ou `id_pessoa:123` — nunca `123` solto. É o que permite
    varrer um bundle minificado sem inventar vazamento a cada número.
    """
    if not ids or not campos:
        return None
    alt_campos = "|".join(re.escape(c) for c in sorted(campos))
    alt_ids = "|".join(re.escape(i) for i in sorted(ids, key=len, reverse=True))
    return re.compile(
        rf'["\']?({alt_campos})["\']?\s*[:=]\s*["\']?(?P<valor>{alt_ids})["\'\s,\]}}]',
        re.IGNORECASE,
    )


def arquivos_para_varrer(diretorios: list[Path]) -> tuple[list[Path], list[Path]]:
    jsons: list[Path] = []
    textos: list[Path] = []
    for d in diretorios:
        if not d.exists():
            continue
        for f in sorted(d.rglob("*")):
            if not f.is_file():
                continue
            if f.suffix.lower() in SUFIXOS_JSON:
                jsons.append(f)
            elif f.suffix.lower() in SUFIXOS_TEXTO:
                textos.append(f)
    return jsons, textos


def autoteste() -> int:
    """
    Testa o próprio guard, sem banco: planta PII num diretório temporário e
    exige que apareça; planta agregados parecidos com id e exige que NÃO
    apareça. Roda na CI, onde `sucupira.db` não existe — sem isto, a CI só
    saberia que o scan roda, não que ele detecta.
    """
    import tempfile

    pessoa_ids = {"11", "4231", "99887"}
    projeto_ids = {"5150", "7302"}
    nomes = {"FULANA DE TAL SOBRENOME", "BELTRANO DA SILVA"}
    rx_nomes = compilar_regex_nomes(nomes)
    rx_p = compilar_regex_ids_com_chave(CAMPOS_ID_PESSOA, pessoa_ids)
    rx_j = compilar_regex_ids_com_chave(CAMPOS_ID_PROJETO, projeto_ids)

    casos: list[tuple[str, str, str, bool]] = [
        # (descrição, nome do arquivo, conteúdo, deve_acusar)
        ("id de pessoa em campo de id", "a.json", '[{"id_pessoa": 4231, "n": 3}]', True),
        ("id de pessoa como string", "b.json", '[{"id_pessoa": "4231"}]', True),
        ("id de projeto em campo de id", "c.json", '{"itens": [{"id_projeto": 5150}]}', True),
        ("id como chave de mapa", "d.json", '{"por_pessoa": {"99887": 12}}', True),
        ("nome de pessoa em texto", "e.json", '{"rotulo": "FULANA DE TAL SOBRENOME"}', True),
        ("id de pessoa em campo genérico", "f.json", '[{"membro_id": 4231}]', True),
        # O falso positivo que motivou a reescrita: 11 é o único id de pessoa
        # com ≤ 3 dígitos, e casava com qualquer contagem igual a 11.
        ("contagem igual a um id real", "g.json", '[{"n_docentes": 11, "n_financiados": 11}]', False),
        ("ano e valores nus", "h.json", '{"ano": 5150, "serie": [11, 4231, 99887]}', False),
        ("id substituto (não está na base)", "i.json", '[{"id_pessoa": "s-8f21ac"}]', False),
        ("bundle com id em chave", "j.js", 'const x={id_pessoa:4231};', True),
        ("bundle com número solto", "k.js", 'const largura=4231,altura=11;', False),
        ("bundle com nome", "l.js", 'const t="BELTRANO DA SILVA";', True),
    ]

    falhas = 0
    with tempfile.TemporaryDirectory() as tmp:
        base = Path(tmp)
        for descricao, nome, conteudo, deve in casos:
            f = base / nome
            f.write_text(conteudo, encoding="utf-8")
            if f.suffix == ".json":
                vs = varrer_json(f, pessoa_ids, projeto_ids, rx_nomes)
            else:
                vs = varrer_texto(f, rx_p, rx_j, rx_nomes)
            achou = bool(vs)
            ok = achou == deve
            if not ok:
                falhas += 1
            simbolo = "✓" if ok else "✗"
            esperado = "deve acusar" if deve else "não deve acusar"
            detalhe = f" — achou: {[str(v) for v in vs]}" if not ok else ""
            print(f"  {simbolo} {descricao} ({esperado}){detalhe}")

    if falhas:
        print(f"\n{falhas} caso(s) falharam — o guard não está confiável.")
        return 1
    print(f"\nOK — {len(casos)} casos, detecção e ausência de falso positivo confirmadas.")
    return 0


def main() -> None:
    p = argparse.ArgumentParser(description="Varre os artefatos do site atrás de PII")
    p.add_argument("--db", default=str(DEFAULT_DB))
    p.add_argument("--dist", default=str(DEFAULT_DIST))
    p.add_argument("--public", default=str(DEFAULT_PUBLIC))
    p.add_argument(
        "--exigir-artefatos",
        action="store_true",
        help="falha se o banco ou os artefatos não existirem (use antes de deploy)",
    )
    p.add_argument(
        "--autoteste",
        action="store_true",
        help="testa o próprio guard com PII sintética; não precisa do banco",
    )
    args = p.parse_args()

    if args.autoteste:
        print("Autoteste do guard de PII (sem banco):")
        sys.exit(autoteste())

    db = Path(args.db)
    diretorios = [Path(args.dist), Path(args.public)]

    if not db.exists():
        msg = f"banco não encontrado em {db}"
        if args.exigir_artefatos:
            print(f"ERRO: {msg} — não dá para verificar PII sem ele.", file=sys.stderr)
            sys.exit(2)
        print(f"AVISO: {msg} — varredura de PII PULADA (nada foi verificado).")
        sys.exit(0)

    print(f"Carregando identificadores reais de {db} …")
    pessoa_ids, projeto_ids, nomes = carregar_reais(db)
    print(f"  {len(pessoa_ids)} ids de pessoa, {len(projeto_ids)} ids de projeto, {len(nomes)} nomes.")

    jsons, textos = arquivos_para_varrer(diretorios)
    if not jsons and not textos:
        msg = "nenhum artefato encontrado em " + ", ".join(str(d) for d in diretorios)
        if args.exigir_artefatos:
            print(f"ERRO: {msg} (rodou `npm run build`?)", file=sys.stderr)
            sys.exit(2)
        print(f"AVISO: {msg} — nada varrido.")
        sys.exit(0)

    rx_nomes = compilar_regex_nomes(nomes)
    rx_id_pessoa = compilar_regex_ids_com_chave(CAMPOS_ID_PESSOA, pessoa_ids)
    rx_id_projeto = compilar_regex_ids_com_chave(CAMPOS_ID_PROJETO, projeto_ids)

    print(f"Varrendo {len(jsons)} JSON (estrutural) + {len(textos)} arquivos de texto (regex com chave) …")

    violacoes: list[Violacao] = []
    for f in jsons:
        violacoes.extend(varrer_json(f, pessoa_ids, projeto_ids, rx_nomes))
    for f in textos:
        violacoes.extend(varrer_texto(f, rx_id_pessoa, rx_id_projeto, rx_nomes))

    if not violacoes:
        print("OK — nenhum identificador nem nome real nos artefatos.")
        sys.exit(0)

    print(f"\nVAZAMENTO DE PII — {len(violacoes)} ocorrências:")
    por_arquivo = Counter((v.arquivo.name, v.categoria) for v in violacoes)
    for (arquivo, categoria), n in sorted(por_arquivo.items(), key=lambda kv: -kv[1]):
        exemplos = [v for v in violacoes if v.arquivo.name == arquivo and v.categoria == categoria][:3]
        print(f"  ✗ {arquivo}: {n}× {categoria}")
        for e in exemplos:
            print(f"      {e.valor!r} em {e.onde}")
        if n > len(exemplos):
            print(f"      … e mais {n - len(exemplos)}")

    print("\nCorrija build_public.py: nada real pode chegar a site/public/data/.")
    sys.exit(1)


if __name__ == "__main__":
    main()
