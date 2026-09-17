#!/usr/bin/env bash
# Baixa o sucupira.db da última release do Forgejo, para a CI poder rodar a
# varredura de PII de verdade (docs/PLANO.md §2). Contraparte de publicar_base.sh.
#
# Sai com 0 e sem banco quando não há token: a ausência do scan é reportada pelo
# próprio workflow, não escondida num erro de shell. Sai != 0 só se o download
# foi tentado e falhou — aí é falha real, não configuração ausente.
#
# Uso local (útil para depurar o passo da CI):
#   export FORGEJO_TOKEN=xxxxx
#   ./baixar_base_ci.sh [tag]

set -euo pipefail

SERVIDOR="${FORGEJO_SERVIDOR:-https://git.pdvn.cc}"
REPO="${FORGEJO_REPO:-padovani/baixarsucupira}"
TAG="${1:-${BASE_RELEASE_TAG:-}}"
DESTINO="${BANCO:-sucupira.db}"

if [ -z "${FORGEJO_TOKEN:-}" ]; then
  echo "FORGEJO_TOKEN não definido — pulando o download da base."
  exit 0
fi

api() { curl -fsSL -H "Authorization: token ${FORGEJO_TOKEN}" "$@"; }

if [ -n "$TAG" ]; then
  URL_RELEASE="${SERVIDOR}/api/v1/repos/${REPO}/releases/tags/${TAG}"
else
  # Sem tag explícita, a mais recente. Assim a CI não precisa ser editada a cada
  # publicação da base.
  URL_RELEASE="${SERVIDOR}/api/v1/repos/${REPO}/releases?limit=1"
fi

echo "Consultando ${URL_RELEASE} …"
RESPOSTA=$(api "$URL_RELEASE")

# O JSON pode ser um objeto (busca por tag) ou uma lista (mais recente).
URL_ANEXO=$(printf '%s' "$RESPOSTA" | python3 -c '
import json, sys
d = json.load(sys.stdin)
rel = d[0] if isinstance(d, list) else d
for a in rel.get("assets", []):
    if a.get("name", "").endswith(".db.gz"):
        print(a["browser_download_url"])
        break
')

if [ -z "$URL_ANEXO" ]; then
  echo "erro: a release não tem anexo .db.gz — publicar_base.sh rodou?" >&2
  exit 1
fi

echo "Baixando ${URL_ANEXO} …"
api -o "${DESTINO}.gz" "$URL_ANEXO"
gunzip -f "${DESTINO}.gz"
echo "Base em ${DESTINO} ($(du -h "$DESTINO" | cut -f1))."
