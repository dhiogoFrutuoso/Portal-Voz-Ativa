import { access, cp, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// A Vercel serve public/ na CDN; src/public permanece a fonte única, inclusive
// para npm start e o preview. Não copia .env, código do servidor ou templates.
const origem = fileURLToPath(new URL('../src/public/', import.meta.url));
const destino = fileURLToPath(new URL('../public/', import.meta.url));
// Interrompe o deploy se o script usado por login/cadastro não veio no checkout.
await Promise.all(['recaptcha-v3.js', 'otp.js', 'portal-upload.js', 'upload-guard.js'].map(
    (file) => access(new URL(`../src/public/js/${file}`, import.meta.url))
));
await mkdir(destino, { recursive: true });
await cp(origem, destino, { recursive: true });
console.log('Arquivos públicos preparados para a CDN da Vercel.');
// [Melhoria Proativa Adicionada: build verifica os scripts exigidos pelos formulários antes da publicação]
