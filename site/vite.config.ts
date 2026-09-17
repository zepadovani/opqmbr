import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Deploy no Caddy (docs/DEPLOY.md, caminhos A/B) serve na raiz do domínio —
  // base "/" por padrão. GitHub Pages (caminho C) serve projeto sob subpath
  // (`.../<repo>/`, inclusive com domínio custom herdado da conta), e o
  // workflow injeta VITE_BASE_PATH para isso. Todo fetch em tempo de execução
  // já usa import.meta.env.BASE_URL (site/src/dados/loaders.ts e afins), então
  // isto é o único lugar que precisa saber da diferença.
  base: process.env.VITE_BASE_PATH || "/",
  build: {
    outDir: "dist",
    sourcemap: false, // never expose sourcemaps in production (they can contain PII via bundle analysis)
  },
});
