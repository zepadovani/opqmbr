// Logos institucionais dos PPGs. Os arquivos em public/logos/ são gerados por
// `python3 -m analise.preparar_logos` a partir de logos/*.png e versionados —
// ver docs/PLANO.md §3.4.

/** 'UFPB-JOÃO PESSOA' -> 'ufpb-joao-pessoa'. Espelha slug() em preparar_logos.py. */
export function slugSigla(sigla: string): string {
  return sigla
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function logoUrl(sigla: string): string {
  return `${import.meta.env.BASE_URL}logos/${slugSigla(sigla)}.webp`;
}
