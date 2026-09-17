import coresInstituicoes from "./cores_instituicoes.json";

/**
 * Cor por instituição, extraída do logo de cada uma
 * (`analise/cores_instituicoes.py`) — não uma paleta arbitrária. Gerado,
 * versionado (mesma exceção de `logos/*.webp`, docs/PLANO.md §3.4); rodar
 * de novo só quando um logo mudar.
 *
 * Reusa em qualquer gráfico que precise de "cor por instituição" — hoje só
 * o atlas de projetos, mas a função é genérica de propósito.
 */
const TABELA: Record<string, { hex: string; fallback?: boolean }> = coresInstituicoes;

const COR_DESCONHECIDA = "var(--color-text-muted)";

export function corInstituicao(sigla: string): string {
  return TABELA[sigla]?.hex ?? COR_DESCONHECIDA;
}
