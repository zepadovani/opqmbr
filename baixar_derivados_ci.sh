#!/usr/bin/env bash
# Baixa derivados.tar.gz da última release do Forgejo — o subconjunto de
# `derivados/` que `analise/build_public.py` lê para montar o Atlas (§4.2).
# Contraparte de publicar_base.sh, irmã de baixar_base_ci.sh.
#
# Ao contrário do banco, este anexo é OPCIONAL: releases publicadas antes da
# Fase 3, ou de uma base sem Atlas, não o têm. Nesse caso o build do site segue
# sem os JSON do Atlas — `build_public.py` já sabe pular essa seção sozinho
# (imprime "skipped (run analise/clustering.py first)") — e este script sai 0.
# Falha só quando o download foi tentado e deu errado de verdade.
#
# Uso local (útil para depurar o passo da CI):
#   export FORGEJO_TOKEN=xxxxx
#   ./baixar_derivados_ci.sh [tag]

set -euo pipefail

SERVIDOR="${FORGEJO_SERVIDOR:-https://git.pdvn.cc}"
REPO="${FORGEJO_REPO:-padovani/baixarsucupira}"
TAG="${1:-${BASE_RELEASE_TAG:-}}"
DESTINO="${DERIVADOS:-derivados}"

if [ -z "${FORGEJO_TOKEN:-}" ]; then
  echo "FORGEJO_TOKEN não definido — pulando o download dos derivados."
  exit 0
fi

api() { curl -fsSL -H "Authorization: token ${FORGEJO_TOKEN}" "$@"; }

if [ -n "$TAG" ]; then
  URL_RELEASE="${SERVIDOR}/api/v1/repos/${REPO}/releases/tags/${TAG}"
else
  URL_RELEASE="${SERVIDOR}/api/v1/repos/${REPO}/releases?limit=1"
fi

echo "Consultando ${URL_RELEASE} …"
RESPOSTA=$(api "$URL_RELEASE")

URL_ANEXO=$(printf '%s' "$RESPOSTA" | python3 -c '
import json, sys
d = json.load(sys.stdin)
rel = d[0] if isinstance(d, list) else d
for a in rel.get("assets", []):
    if a.get("name", "") == "derivados.tar.gz":
        print(a["browser_download_url"])
        break
')

if [ -z "$URL_ANEXO" ]; then
  echo "Release sem derivados.tar.gz — Atlas sairá incompleto neste build (não é erro)."
  exit 0
fi

echo "Baixando ${URL_ANEXO} …"
mkdir -p "$DESTINO"
api -o /tmp/derivados.tar.gz "$URL_ANEXO"
tar -xzf /tmp/derivados.tar.gz -C "$DESTINO"
rm -f /tmp/derivados.tar.gz
echo "Derivados em ${DESTINO}/: $(ls "$DESTINO" | tr '\n' ' ')"
