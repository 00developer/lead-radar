import type { NextConfig } from 'next';

// Only for local development through an HTTPS tunnel (Cloudflare Tunnel or ngrok), which is how the "Connect Threads account"
// button can be tried before the app is deployed (Threads sign-in refuses plain http://localhost). In production none of this is
// added, so Server Actions stay limited to the app's own address.
const TUNNEL_HOSTS = ['*.trycloudflare.com', '*.ngrok-free.app', '*.ngrok-free.dev', '*.ngrok.app'];
const dev = process.env.NODE_ENV !== 'production';

const config: NextConfig = {
  // The Excel library is large; loading it from node_modules at run time keeps the build fast and the bundle small.
  serverExternalPackages: ['exceljs'],
  ...(dev ? { allowedDevOrigins: TUNNEL_HOSTS, experimental: { serverActions: { allowedOrigins: TUNNEL_HOSTS } } } : {}),
};

export default config;
