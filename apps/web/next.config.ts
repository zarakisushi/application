import type { NextConfig } from 'next';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Monorepo: o .env fica na raiz e vale para todos os pacotes (variáveis já definidas têm prioridade).
const rootEnv = resolve(process.cwd(), '../../.env');
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
  // Ninguém incorpora o site em iframe (clickjacking) e formulários só enviam para o próprio site.
  { key: 'Content-Security-Policy', value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'" },
];

const nextConfig: NextConfig = {
  transpilePackages: ['@zaraki/core', '@zaraki/db', '@zaraki/integrations'],
  poweredByHeader: false,
  // Indicador do Next (só em desenvolvimento) no canto direito, longe do rodapé do menu lateral.
  devIndicators: { position: 'bottom-right' },
  // Envio de fotos e PDFs pelo painel (até 4 MB por arquivo, validado em server/uploads.ts). O padrão do
  // Next é 1 MB, pouco para uma foto de celular; fotos grandes ainda são reduzidas no navegador antes.
  experimental: { serverActions: { bodySizeLimit: '5mb' } },
  images: {
    formats: ['image/avif', 'image/webp'],
    // Fotos do cardápio enviadas pelo painel (Vercel Blob).
    remotePatterns: [{ protocol: 'https', hostname: '*.public.blob.vercel-storage.com' }],
  },
  async headers() {
    return [
      { source: '/:path*', headers: securityHeaders },
      { source: '/admin/:path*', headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }] },
      { source: '/api/:path*', headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }] },
    ];
  },
};

export default nextConfig;
