import { useState } from "react";
import { logoUrl } from "../dados/logos";

type Tamanho = "sm" | "md";

/**
 * Logo institucional de um programa, sobre chip branco (as marcas são tinta
 * escura sobre transparente e sumiriam no tema escuro).
 *
 * A sigla acompanha sempre o logo — aqui como `alt`/`title`, e como texto
 * visível no chamador. Se o arquivo faltar (programa novo, logo não recebido),
 * o chip some e sobra só a sigla do chamador: nada quebra.
 */
export default function LogoPPG({
  sigla,
  tamanho = "md",
}: {
  sigla: string;
  tamanho?: Tamanho;
}) {
  const [falhou, setFalhou] = useState(false);
  if (falhou) return null;

  return (
    <span className={`logo-ppg logo-ppg-${tamanho}`}>
      <img
        src={logoUrl(sigla)}
        alt={`Logo ${sigla}`}
        title={sigla}
        loading="lazy"
        decoding="async"
        onError={() => setFalhou(true)}
      />
    </span>
  );
}

/**
 * Logo pequeno + sigla, para rótulos de tabela e legenda. A sigla é o rótulo;
 * o logo é o atalho visual — nunca o contrário (docs/PLANO.md §3.4).
 */
export function RotuloPPG({ sigla }: { sigla: string }) {
  return (
    <span className="rotulo-ppg">
      <LogoPPG sigla={sigla} tamanho="sm" />
      <span>{sigla}</span>
    </span>
  );
}
