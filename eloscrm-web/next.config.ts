import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // empacota em .next/standalone com só os node_modules que o trace encontrou,
  // para a imagem de produção não carregar a árvore de dependências inteira
  output: "standalone",
};

export default nextConfig;
