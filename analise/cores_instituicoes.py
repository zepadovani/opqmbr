"""
Cor representativa por instituição, extraída do próprio logo.

Uso pretendido: toda vez que o site precisar de uma cor "por instituição"
(hoje só o atlas de projetos, `/atlas`) — pra reconhecer a instituição pela
cor real da marca, em vez de uma paleta arbitrária. Estruturado pra ser
reusado, não é específico do atlas.

Pipeline: ImageMagick redimensiona o logo pra uma grade pequena e despeja
cada pixel como texto (`txt:-`, mesmo binário que `preparar_logos.py` já
exige, só que aqui pra LER em vez de converter). Pixels de fundo/contorno
(quase branco, quase preto, baixa saturação) são descartados; entre os que
sobram, a cor representativa vem por **frequência de matiz** (bucket de
15°), não média de RGB — a média de vermelho com azul dá roxo, que pode não
existir na logo nenhuma vez.

Logo sem pixel colorido o bastante (preto/cinza/monocromático) não fica sem
cor: recebe um matiz determinístico a partir do hash da sigla, marcado em
`fallback: true` no JSON de saída — determinístico pra não mudar a cada
rodada, e marcado pra quem revisar saber que não veio do logo de verdade.

De-colisão: duas instituições com azul institucional parecido empatariam
demais pra distinguir num scatter. Processa em ordem alfabética de sigla —
mesma lógica de "cor segue a entidade" de `site/src/dados/series.ts` — e
afasta em matiz (mantendo saturação/luminosidade) qualquer cor que caia
perto demais de uma já aceita, até abrir `COLISAO_GRAUS`.

Não faz parte do caminho de reprodução da base: precisa do ImageMagick já
exigido por `preparar_logos.py`. Sem dependência Python além da stdlib.

Escreve `site/src/dados/cores_instituicoes.json` (sigla -> {hex, fallback}),
**versionado** — mesma exceção de `logos/*.webp` e `geo/br-uf.json`
(docs/PLANO.md §3.4): a cor de uma marca não muda sozinha, e o build do site
não deveria depender de ImageMagick.

Uso:
    python3 -m analise.cores_instituicoes [--conferir]
"""

import argparse
import colorsys
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).parent.parent
DIR_LOGOS = REPO_ROOT / "logos"
SAIDA = REPO_ROOT / "site" / "src" / "dados" / "cores_instituicoes.json"

GRADE = 48  # lado do redimensionamento antes de ler os pixels
SAT_MIN = 0.18  # abaixo disso é cinza/branco/preto, não "cor da marca"
LUZ_MIN, LUZ_MAX = 0.12, 0.88  # fora disso é sombra/reflexo, não miolo da cor
# 360°/20 instituições = 18° é o teto teórico pra separação uniforme; 14 deixa
# folga pro posicionamento guloso (cada cor resolvida na hora, não um ajuste
# global) ainda assim convergir sem ficar preso perto do teto.
COLISAO_GRAUS = 14


def binario_imagemagick() -> list[str]:
    for nome in ("magick", "convert"):
        caminho = shutil.which(nome)
        if caminho:
            return [caminho]
    print("ERRO: ImageMagick não encontrado (magick/convert). brew install imagemagick", file=sys.stderr)
    sys.exit(1)


def pixels_do_logo(caminho: Path) -> list[tuple[int, int, int]]:
    bin_magick = binario_imagemagick()
    args = bin_magick + [
        str(caminho),
        "-resize", f"{GRADE}x{GRADE}",
        "-background", "white",
        "-alpha", "remove",
        "-alpha", "off",
        "txt:-",
    ]
    saida = subprocess.run(args, capture_output=True, text=True, check=True).stdout
    pixels = []
    # Lê pelo #RRGGBB, não pela tupla decimal ao lado: nela o ImageMagick às
    # vezes imprime um canal como 256 (arredondamento de ponto flutuante
    # perto do branco, ex. "srgb(100.5%,...)" -> 256) — o hex já vem clampeado.
    for m in re.finditer(r"#([0-9A-Fa-f]{6})\b", saida):
        hexcolor = m.group(1)
        pixels.append(tuple(int(hexcolor[i:i + 2], 16) for i in (0, 2, 4)))
    return pixels


def hash_deterministico(texto: str) -> int:
    h = 0
    for c in texto:
        h = (h * 131 + ord(c)) % 360
    return h


def cor_representativa(sigla: str, pixels: list[tuple[int, int, int]]) -> tuple[float, float, float, bool]:
    """Devolve (matiz 0-360, saturação 0-1, luz 0-1, fallback?)."""
    candidatos = []
    for r, g, b in pixels:
        if r == g == b:
            continue  # cinza puro: sat=0, cai fora do filtro mesmo — e em
            # alguns tons colorsys.rgb_to_hls diverge por zero (gh-106498)
        h, l, s = colorsys.rgb_to_hls(r / 255, g / 255, b / 255)
        if s >= SAT_MIN and LUZ_MIN <= l <= LUZ_MAX:
            candidatos.append((h * 360, s, l))

    if not candidatos:
        # Logo monocromático: sem matiz de verdade pra extrair. Determinístico
        # a partir da sigla, não aleatório — a mesma sigla sempre cai na mesma
        # cor entre rodadas, e fica marcado como fallback na saída.
        return (hash_deterministico(sigla), 0.55, 0.42, True)

    # Bucket de 15° por frequência — o matiz mais comum entre os pixels
    # coloridos, não a média (que pode inventar um matiz que não existe).
    baldes: dict[int, list[tuple[float, float, float]]] = {}
    for h, s, l in candidatos:
        baldes.setdefault(int(h // 15), []).append((h, s, l))
    balde_vencedor = max(baldes.values(), key=len)

    matiz = sum(h for h, _, _ in balde_vencedor) / len(balde_vencedor)
    sat = sorted(s for _, s, _ in balde_vencedor)[len(balde_vencedor) // 2]
    luz = sorted(l for _, _, l in balde_vencedor)[len(balde_vencedor) // 2]
    # Clampeados pra faixa legível sobre fundo claro — mantém o matiz real da
    # marca, só evita um amarelo claro demais pra ler ou um azul escuro
    # demais pra distinguir de preto.
    sat = min(max(sat, 0.45), 0.85)
    luz = min(max(luz, 0.32), 0.55)
    return (matiz, sat, luz, False)


def distancia_matiz(a: float, b: float) -> float:
    d = abs(a - b) % 360
    return min(d, 360 - d)


def resolver_colisoes(cores: dict[str, tuple[float, float, float, bool]]) -> dict[str, tuple[float, float, float, bool]]:
    """Ponto mais afastado, não passo fixo. Um passo fixo (ex.: sempre +23°)
    pode ficar preso: com várias cores já aceitas, boa parte do círculo já
    está "proibida" (a 14° de alguma), e uma sequência de passos fixos pode
    não visitar nenhuma posição livre dentro de um número razoável de
    tentativas — foi exatamente o que aconteceu na primeira versão (UNB
    esgotava 30 tentativas e ficava com uma cor que ainda colidia). Escolher
    entre os 360 graus inteiros aquele com a MAIOR distância mínima até
    tudo que já foi aceito sempre termina, e ainda desempata pelo grau mais
    perto do matiz original do logo — só se afasta o necessário."""
    resolvidas: dict[str, tuple[float, float, float, bool]] = {}
    aceitos: list[float] = []
    for sigla in sorted(cores):
        matiz, sat, luz, fallback = cores[sigla]
        if any(distancia_matiz(matiz, m) < COLISAO_GRAUS for m in aceitos):
            matiz = float(max(
                range(360),
                key=lambda h: (
                    min((distancia_matiz(h, m) for m in aceitos), default=360.0),
                    -distancia_matiz(h, matiz),
                ),
            ))
        aceitos.append(matiz)
        resolvidas[sigla] = (matiz, sat, luz, fallback)
    return resolvidas


def hex_de(matiz: float, sat: float, luz: float) -> str:
    r, g, b = colorsys.hls_to_rgb(matiz / 360, luz, sat)
    return "#{:02x}{:02x}{:02x}".format(round(r * 255), round(g * 255), round(b * 255))


def sigla_do_arquivo(caminho: Path) -> str:
    m = re.match(r"^\d+-(.+)$", caminho.stem)
    return m.group(1) if m else caminho.stem


def gerar() -> dict[str, dict]:
    brutas = {}
    for caminho in sorted(DIR_LOGOS.glob("*.png")):
        sigla = sigla_do_arquivo(caminho)
        pixels = pixels_do_logo(caminho)
        brutas[sigla] = cor_representativa(sigla, pixels)

    resolvidas = resolver_colisoes(brutas)

    saida = {}
    for sigla, (matiz, sat, luz, fallback) in sorted(resolvidas.items()):
        entrada = {"hex": hex_de(matiz, sat, luz)}
        if fallback:
            entrada["fallback"] = True
        saida[sigla] = entrada
    return saida


def conferir() -> None:
    if not SAIDA.exists():
        print(f"ERRO: {SAIDA} não existe. Rode sem --conferir pra gerar.", file=sys.stderr)
        sys.exit(1)
    salvas = json.loads(SAIDA.read_text(encoding="utf-8"))
    siglas_logo = {sigla_do_arquivo(p) for p in DIR_LOGOS.glob("*.png")}
    faltando = siglas_logo - set(salvas)
    if faltando:
        print(f"ERRO: sem cor salva para {sorted(faltando)}. Rode sem --conferir.", file=sys.stderr)
        sys.exit(1)

    def hue_de_hex(hexcolor: str) -> float:
        r = int(hexcolor[1:3], 16) / 255
        g = int(hexcolor[3:5], 16) / 255
        b = int(hexcolor[5:7], 16) / 255
        h, _, _ = colorsys.rgb_to_hls(r, g, b)
        return h * 360

    siglas = sorted(salvas)
    for i, a in enumerate(siglas):
        for b in siglas[i + 1:]:
            if distancia_matiz(hue_de_hex(salvas[a]["hex"]), hue_de_hex(salvas[b]["hex"])) < COLISAO_GRAUS:
                print(f"ERRO: {a} e {b} colidem em matiz ({salvas[a]['hex']} / {salvas[b]['hex']}).", file=sys.stderr)
                sys.exit(1)
    print(f"OK — {len(salvas)} instituições, todas com cor e sem colisão de matiz < {COLISAO_GRAUS}°.")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--conferir", action="store_true")
    args = parser.parse_args()

    if args.conferir:
        conferir()
        return

    saida = gerar()
    SAIDA.parent.mkdir(parents=True, exist_ok=True)
    SAIDA.write_text(json.dumps(saida, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    n_fallback = sum(1 for v in saida.values() if v.get("fallback"))
    print(f"Escrito {SAIDA} ({len(saida)} instituições, {n_fallback} em fallback determinístico).")
    for sigla, v in saida.items():
        marca = " (fallback)" if v.get("fallback") else ""
        print(f"  {sigla:<10} {v['hex']}{marca}")


if __name__ == "__main__":
    main()
