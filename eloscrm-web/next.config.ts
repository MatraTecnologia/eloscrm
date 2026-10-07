import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // empacota em .next/standalone com só os node_modules que o trace encontrou,
  // para a imagem de produção não carregar a árvore de dependências inteira
  output: 'standalone',
  allowedDevOrigins: ['289c-177-220-177-40.ngrok-free.app'],
  // Em dev, o túnel do web também atende a API para manter a sessão no mesmo domínio.
  rewrites: async () => process.env.NODE_ENV === 'development' ? [
    { source: '/api/auth/:path*', destination: 'http://127.0.0.1:3333/api/auth/:path*' },
    { source: '/v1/:path*', destination: 'http://127.0.0.1:3333/v1/:path*' },
  ] : [],
}

export default nextConfig
