import { cp, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// A Vercel serve public/ na CDN; src/public permanece a fonte única, inclusive
// para npm start e o preview. Não copia .env, código do servidor ou templates.
const origem = fileURLToPath(new URL('../src/public/', import.meta.url));
const destino = fileURLToPath(new URL('../public/', import.meta.url));
await mkdir(destino, { recursive: true });
await cp(origem, destino, { recursive: true });
console.log('Arquivos públicos preparados para a CDN da Vercel.');
