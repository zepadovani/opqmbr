// Formatação de número, num lugar só.
//
// O site é em português: separador decimal é vírgula e milhar é ponto. Cada
// gráfico que chamava `toFixed` direto produzia "21.7%" no meio de um texto que
// diz "1.194 produções" — o mesmo número escrito de duas formas na mesma tela.
//
// `toLocaleString("pt-BR")` resolve, mas escrevê-lo à mão em cada componente
// convida a esquecer as opções e a divergir de novo. Estas quatro funções são a
// interface; nenhum componente deveria chamar `toFixed` para texto visível.

const LOCALE = "pt-BR";

/** Inteiro com separador de milhar: 1194 → "1.194". */
export function inteiro(v: number | null | undefined): string {
  return v === null || v === undefined ? "—" : v.toLocaleString(LOCALE);
}

/** Decimal com casas fixas: 0.505 → "0,51". */
export function decimal(v: number | null | undefined, casas = 1): string {
  return v === null || v === undefined
    ? "—"
    : v.toLocaleString(LOCALE, { minimumFractionDigits: casas, maximumFractionDigits: casas });
}

/** Percentual já em escala 0–100: 21.7 → "21,7%". */
export function pct(v: number | null | undefined, casas = 1): string {
  return v === null || v === undefined ? "—" : `${decimal(v, casas)}%`;
}

/** Percentual calculado de uma fração: (198, 843) → "23,5%". */
export function pctDe(
  numerador: number | null | undefined,
  denominador: number | null | undefined,
  casas = 1,
): string {
  if (numerador === null || numerador === undefined) return "—";
  if (!denominador) return "—";
  return pct((numerador / denominador) * 100, casas);
}
