"""
Gera os derivados web dos logos institucionais.

    logos/NN-SIGLA.png  ->  site/public/logos/<slug>.webp   (altura 96 px, alfa)

Ao contrário do resto de `derivados/` e `site/public/data/`, a saída **é
versionada** (ver docs/PLANO.md §3.4): os logos não mudam, e commitá-los evita que o
build do site — e a CI — precise de ImageMagick instalado. Este script só roda
quando um logo entra ou muda.

Uso:
    python3 -m analise.preparar_logos [--altura 96] [--conferir]

`--conferir` não escreve nada: falha se algum derivado estiver faltando ou se o
PNG de origem mudou desde a geração (comparação por hash, registrada em
`_origem.json`). É o modo que roda na CI e antes de um deploy.

Requer `magick` (ImageMagick 7) ou `convert` (6) no PATH; instale com
`brew install imagemagick`. Nenhuma dependência Python além da stdlib.
"""

import argparse
import hashlib
import json
import re
import shutil
import subprocess
import sys
import unicodedata
from pathlib import Path

REPO_ROOT = Path(__file__).parent.parent
DIR_ORIGEM = REPO_ROOT / "logos"
DIR_DESTINO = REPO_ROOT / "site" / "public" / "logos"
ALTURA_PADRAO = 96

# A sigla do arquivo de logo é a sigla da IES; a sigla do programa em
# `programas.json` às vezes traz o campus junto. Mapeamento explícito das
# divergências — deixar implícito (casar por prefixo) casaria errado no dia em
# que dois programas da mesma IES entrarem na base.
# Vazio hoje: `build_public.py` publica "UFPB" no lugar de "UFPB-JOÃO PESSOA"
# (ver SIGLA_EXIBICAO lá), então a sigla do arquivo já casa com a do site. Se um
# dia duas siglas divergirem de novo, o mapeamento explícito entra aqui — casar
# por prefixo casaria errado no dia em que dois PPGs da mesma IES entrarem.
SIGLA_PROGRAMA: dict[str, str] = {}


def slug(sigla: str) -> str:
    """'UFPB-JOÃO PESSOA' -> 'ufpb-joao-pessoa'. Espelha slugSigla() em logos.ts."""
    sem_acento = "".join(
        c for c in unicodedata.normalize("NFD", sigla) if unicodedata.category(c) != "Mn"
    )
    return re.sub(r"-+", "-", re.sub(r"[^a-z0-9]+", "-", sem_acento.lower())).strip("-")


def binario_imagemagick() -> list[str]:
    for nome in ("magick", "convert"):
        caminho = shutil.which(nome)
        if caminho:
            return [caminho]
    print(
        "ERRO: ImageMagick não encontrado (`magick` ou `convert` no PATH).\n"
        "      brew install imagemagick — ou rode com --conferir, que não converte.",
        file=sys.stderr,
    )
    sys.exit(2)


def origens() -> list[tuple[str, Path]]:
    """Lista [(sigla_do_programa, png)], ordenada pelo prefixo numérico do arquivo."""
    achados = []
    for png in sorted(DIR_ORIGEM.glob("*.png")):
        m = re.match(r"^(\d+)-(.+)$", png.stem)
        if not m:
            print(f"  ignorado (nome fora do padrão NN-SIGLA.png): {png.name}")
            continue
        sigla_ies = m.group(2)
        achados.append((SIGLA_PROGRAMA.get(sigla_ies, sigla_ies), png))
    return achados


def hash_png(png: Path) -> str:
    return hashlib.sha256(png.read_bytes()).hexdigest()[:16]


def escrever_manifesto(pares: list[tuple[str, Path]]) -> None:
    """
    Registra o hash do PNG de origem de cada derivado. É o que permite a
    `--conferir` detectar derivado desatualizado na CI: depois de um `git
    checkout` todos os arquivos têm mtime igual, então comparar data não
    detecta nada — comparar conteúdo detecta.
    """
    manifesto = {
        slug(sigla): {"origem": png.name, "sha256_16": hash_png(png)}
        for sigla, png in pares
    }
    (DIR_DESTINO / "_origem.json").write_text(
        json.dumps(manifesto, indent=2, ensure_ascii=False, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def conferir(pares: list[tuple[str, Path]]) -> int:
    caminho_manifesto = DIR_DESTINO / "_origem.json"
    if not caminho_manifesto.exists():
        print(f"  ✗ manifesto ausente: {caminho_manifesto}")
        print("\nRode: python3 -m analise.preparar_logos")
        return 1

    manifesto = json.loads(caminho_manifesto.read_text(encoding="utf-8"))
    problemas: list[str] = []

    for sigla, png in pares:
        chave = slug(sigla)
        destino = DIR_DESTINO / f"{chave}.webp"
        if not destino.exists():
            problemas.append(f"ausente: {destino.name}")
        elif chave not in manifesto:
            problemas.append(f"fora do manifesto: {destino.name}")
        elif manifesto[chave]["sha256_16"] != hash_png(png):
            problemas.append(f"desatualizado (o PNG {png.name} mudou): {destino.name}")

    orfaos = set(manifesto) - {slug(s) for s, _ in pares}
    problemas += [f"derivado sem PNG de origem: {o}.webp" for o in sorted(orfaos)]

    if problemas:
        for p in problemas:
            print(f"  ✗ {p}")
        print("\nRode: python3 -m analise.preparar_logos")
        return 1

    print(f"OK — {len(pares)} logos derivados presentes e atualizados.")
    return 0


def converter(pares: list[tuple[str, Path]], altura: int) -> int:
    im = binario_imagemagick()
    DIR_DESTINO.mkdir(parents=True, exist_ok=True)
    total_origem = total_destino = 0

    for sigla, png in pares:
        destino = DIR_DESTINO / f"{slug(sigla)}.webp"
        cmd = im + [
            str(png),
            "-resize", f"x{altura * 2}>",   # 2x para telas densas; nunca ampliar
            "-background", "none",
            "-strip",
            "-quality", "88",
            "-define", "webp:method=6",
            str(destino),
        ]
        r = subprocess.run(cmd, capture_output=True, text=True)
        if r.returncode != 0:
            print(f"  ✗ {png.name}: {r.stderr.strip()}", file=sys.stderr)
            return 1
        total_origem += png.stat().st_size
        total_destino += destino.stat().st_size
        print(f"  {png.name:>22} -> {destino.name:<24} {destino.stat().st_size // 1024:>4} KB")

    print(
        f"\n{len(pares)} logos: {total_origem / 1024:.0f} KB -> {total_destino / 1024:.0f} KB "
        f"em {DIR_DESTINO.relative_to(REPO_ROOT)}"
    )
    escrever_manifesto(pares)
    print("Lembre de versionar os .webp e o _origem.json (docs/PLANO.md §3.4).")
    return 0


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--altura", type=int, default=ALTURA_PADRAO, help="altura CSS em px (default: 96)")
    p.add_argument("--conferir", action="store_true", help="só verifica; não escreve")
    args = p.parse_args()

    if not DIR_ORIGEM.exists():
        print(f"ERRO: {DIR_ORIGEM} não existe.", file=sys.stderr)
        sys.exit(2)

    pares = origens()
    if not pares:
        print(f"ERRO: nenhum logo em {DIR_ORIGEM}.", file=sys.stderr)
        sys.exit(2)

    sys.exit(conferir(pares) if args.conferir else converter(pares, args.altura))


if __name__ == "__main__":
    main()
