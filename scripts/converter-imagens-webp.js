/*
 * Converte as imagens estáticas de src/public/img para WebP.
 *
 * Uso: node scripts/converter-imagens-webp.js
 *
 * Os arquivos originais são mantidos: só o que estiver referenciado nas views
 * passa a apontar para o .webp. Rode de novo sempre que adicionar uma imagem
 * nova em src/public/img — é idempotente, reconverte tudo.
 */
import sharp from 'sharp';
import { readdir, stat, unlink } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PASTA = path.join(__dirname, '..', 'src', 'public', 'img');
const EXTENSOES = ['.png', '.jpg', '.jpeg'];

const emKb = (bytes) => (bytes / 1024).toFixed(1).replace('.', ',') + ' KB';

async function converter() {
    const arquivos = await readdir(PASTA);
    const originais = arquivos.filter((a) => EXTENSOES.includes(path.extname(a).toLowerCase()));

    let totalAntes = 0;
    let totalDepois = 0;
    const convertidas = [];

    for (const arquivo of originais) {
        const origem = path.join(PASTA, arquivo);
        const destino = path.join(PASTA, path.basename(arquivo, path.extname(arquivo)) + '.webp');

        // quality 80 + effort 6: bom equilíbrio entre peso e nitidez para
        // ilustrações e fotos usadas no portal.
        await sharp(origem).webp({ quality: 80, effort: 6 }).toFile(destino);

        const antes = (await stat(origem)).size;
        const depois = (await stat(destino)).size;

        // Imagem já muito otimizada pode ficar maior em WebP. Nesse caso
        // descartamos a conversão e a view segue apontando para o original.
        if (depois >= antes) {
            await unlink(destino);
            totalAntes += antes;
            totalDepois += antes;
            console.log(`${arquivo.padEnd(30)} ${emKb(antes).padStart(10)} -> original mantido (WebP ficaria maior)`);
            continue;
        }

        totalAntes += antes;
        totalDepois += depois;
        convertidas.push(arquivo);

        const reducao = (100 - (depois / antes) * 100).toFixed(0);
        console.log(
            `${arquivo.padEnd(30)} ${emKb(antes).padStart(10)} -> ${emKb(depois).padStart(10)}  (-${reducao}%)`
        );
    }

    const reducaoTotal = (100 - (totalDepois / totalAntes) * 100).toFixed(1);
    console.log('-'.repeat(64));
    console.log(
        `${String(convertidas.length + '/' + originais.length + ' convertidas').padEnd(30)} ${emKb(totalAntes).padStart(10)} -> ${emKb(totalDepois).padStart(10)}  (-${reducaoTotal}%)`
    );
}

converter().catch((err) => {
    console.error('Falha na conversão:', err);
    process.exit(1);
});
