/*
 * Sobe para o Cloudinary as imagens que ficaram gravadas como base64 no banco.
 *
 * Imagem em base64 vai inteira dentro do HTML: pesa em toda visita, não entra em
 * cache do navegador e não passa pela conversão para WebP. Este script envia
 * cada uma ao Cloudinary já convertida e troca o campo pela URL.
 *
 * As rotas atuais só aceitam URL do nosso Cloudinary, então isso é limpeza de
 * dados antigos — não deve haver caso novo.
 *
 * Uso:
 *   node scripts/migrar-imagens-base64.js            (mostra o que mudaria)
 *   node scripts/migrar-imagens-base64.js --aplicar  (envia e grava)
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import { v2 as cloudinary } from 'cloudinary';

import db from '../src/config/db.js';
import '../src/models/categories.js';
import '../src/models/denuncias.js';
import '../src/models/vitrine.js';

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

const aplicar = process.argv.includes('--aplicar');
const ehBase64 = (valor) => typeof valor === 'string' && valor.startsWith('data:image');
const emKb = (texto) => (texto.length / 1024).toFixed(0) + ' KB';

async function enviar(base64, pasta) {
    const resultado = await cloudinary.uploader.upload(base64, {
        folder: pasta,
        resource_type: 'image',
        format: 'webp',
        transformation: [{ width: 1600, crop: 'limit', quality: 'auto' }]
    });
    return resultado.secure_url;
}

async function migrar() {
    if (aplicar && (!process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET)) {
        console.error('CLOUDINARY_API_KEY e CLOUDINARY_API_SECRET são necessárias para enviar as imagens.');
        process.exit(1);
    }

    await mongoose.connect(db.mongoURI, { serverSelectionTimeoutMS: 30000 });
    console.log(`Conectado (${process.env.NODE_ENV === 'production' ? 'produção' : 'desenvolvimento'}).\n`);

    const colecoes = [
        { modelo: 'chamados', pasta: 'img_melhorias' },
        { modelo: 'denuncias', pasta: 'img_denuncias' },
        { modelo: 'vitrine', pasta: 'img_vitrine' }
    ];

    let totalImagens = 0;
    let pesoTotal = 0;

    for (const { modelo, pasta } of colecoes) {
        const Modelo = mongoose.model(modelo);
        const docs = await Modelo.find({ imagens: { $regex: '^data:image' } })
            .select('titulo imagens')
            .lean();

        if (docs.length === 0) {
            console.log(`${modelo}: nada a migrar.`);
            continue;
        }

        console.log(`${modelo}: ${docs.length} publicação(ões)`);

        for (const doc of docs) {
            const novas = [];

            for (const imagem of doc.imagens) {
                if (!ehBase64(imagem)) {
                    novas.push(imagem);
                    continue;
                }

                totalImagens++;
                pesoTotal += imagem.length;
                console.log(`   "${doc.titulo}" — imagem de ${emKb(imagem)}`);

                if (aplicar) {
                    const url = await enviar(imagem, pasta);
                    novas.push(url);
                    console.log(`      -> ${url}`);
                } else {
                    novas.push(imagem);
                }
            }

            if (aplicar) {
                await Modelo.updateOne({ _id: doc._id }, { $set: { imagens: novas } });
            }
        }
    }

    console.log('');
    if (totalImagens === 0) {
        console.log('Nenhuma imagem em base64 no banco.');
    } else if (aplicar) {
        console.log(`${totalImagens} imagem(ns) enviada(s) — ${(pesoTotal / 1024).toFixed(0)} KB saíram do HTML.`);
    } else {
        console.log(`${totalImagens} imagem(ns), ${(pesoTotal / 1024).toFixed(0)} KB embutidos no HTML hoje.`);
        console.log('Simulação. Rode com --aplicar para enviar ao Cloudinary e gravar.');
    }

    await mongoose.disconnect();
}

migrar().catch((err) => {
    console.error('Falha na migração:', err);
    process.exit(1);
});
