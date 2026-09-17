import { useEffect, useMemo, useState } from "react";
import type { Programa } from "../dados/tipos";

/**
 * Mapa-localizador: onde cada programa fica de verdade. Sem arestas — a rede é
 * lida no cartograma, que tem espaço para desenhá-la. A divisão de trabalho é
 * essa: geografia aqui, topologia lá. Tentar as duas no mesmo desenho foi o que
 * produziu o emaranhado do Sudeste.
 */

const LAT_REF = (-15 * Math.PI) / 180;
const K = Math.cos(LAT_REF);

const W = 300;
const H = 320;
const PAD = 10;

type Geo = {
  features: Array<{
    properties: { uf: string };
    geometry:
      | { type: "Polygon"; coordinates: number[][][] }
      | { type: "MultiPolygon"; coordinates: number[][][][] };
  }>;
};

const COR_REGIAO: Record<string, string> = {
  Norte: "var(--serie-3)",
  Nordeste: "var(--serie-2)",
  "Centro-Oeste": "var(--serie-4)",
  Sudeste: "var(--serie-1)",
  Sul: "var(--serie-7)",
};

export default function MapaLocalizador({
  programas,
  destaque,
  onDestaque,
}: {
  programas: Programa[];
  destaque: string | null;
  onDestaque: (sigla: string | null) => void;
}) {
  const [geo, setGeo] = useState<Geo | null>(null);
  const [erro, setErro] = useState(false);

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}geo/br-uf.json`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(setGeo)
      .catch(() => setErro(true));
  }, []);

  const comCoordenada = useMemo(
    () => programas.filter((p) => p.lat !== null && p.lon !== null),
    [programas],
  );

  const projecao = useMemo(() => {
    let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
    const considerar = (lon: number, lat: number) => {
      minLon = Math.min(minLon, lon);
      maxLon = Math.max(maxLon, lon);
      minLat = Math.min(minLat, lat);
      maxLat = Math.max(maxLat, lat);
    };
    if (geo) {
      for (const f of geo.features) {
        const poligonos =
          f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
        for (const poly of poligonos) for (const anel of poly) for (const [lon, lat] of anel) considerar(lon, lat);
      }
    } else {
      for (const p of comCoordenada) considerar(p.lon as number, p.lat as number);
    }
    const larguraGraus = (maxLon - minLon) * K;
    const alturaGraus = maxLat - minLat;
    const escala = Math.min((W - 2 * PAD) / larguraGraus, (H - 2 * PAD) / alturaGraus);
    return {
      x: (lon: number) => (W - larguraGraus * escala) / 2 + (lon - minLon) * K * escala,
      y: (lat: number) => (H - alturaGraus * escala) / 2 + (maxLat - lat) * escala,
    };
  }, [geo, comCoordenada]);

  function caminhoUF(f: Geo["features"][number]): string {
    const poligonos =
      f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
    return poligonos
      .flatMap((poly) =>
        poly.map(
          (anel) =>
            anel
              .map(([lon, lat], i) => `${i === 0 ? "M" : "L"}${projecao.x(lon).toFixed(1)},${projecao.y(lat).toFixed(1)}`)
              .join(" ") + " Z",
        ),
      )
      .join(" ");
  }

  return (
    <figure className="localizador">
      <figcaption>Onde ficam</figcaption>
      {erro && (
        <p className="chart-nota">
          Malha das UFs ausente — rode <code>python3 baixar_malha_ibge.py</code>.
        </p>
      )}
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Localização geográfica dos 20 programas">
        {geo?.features.map((f) => (
          <path key={f.properties.uf} d={caminhoUF(f)} className="mapa-uf" />
        ))}
        {comCoordenada.map((p) => {
          const x = projecao.x(p.lon as number);
          const y = projecao.y(p.lat as number);
          const sel = destaque === p.sigla;
          return (
            <circle
              key={p.sigla}
              cx={x}
              cy={y}
              r={sel ? 6 : 4}
              fill={COR_REGIAO[p.regiao] ?? "var(--color-text-muted)"}
              stroke={sel ? "var(--color-text)" : "var(--color-surface)"}
              strokeWidth={sel ? 2 : 1}
              opacity={destaque && !sel ? 0.35 : 1}
              className="localizador-ponto"
              onClick={() => onDestaque(sel ? null : p.sigla)}
            >
              <title>{`${p.sigla} — ${p.municipio}/${p.uf}`}</title>
            </circle>
          );
        })}
      </svg>
      <p className="chart-nota">
        Programas na mesma cidade (USP e UNESP; UFRJ e UNIRIO) coincidem num único ponto.
        Contorno: IBGE.
      </p>
    </figure>
  );
}
