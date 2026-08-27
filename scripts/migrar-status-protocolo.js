/*
 * Migra os status antigos para os estágios do sistema de protocolo.
 *
 *   Aberto / Em Análise / Pendente  ->  Novo
 *   Concluído / Fechado             ->  Resolvido
 *
 * Uso:
 *   node scripts/migrar-status-protocolo.js           (mostra o que mudaria)
 *   node scripts/migrar-status-protocolo.js --aplicar (grava as mudanças)
 *
 * O código já normaliza status desconhecido na leitura, então a migração é
 * opcional — ela apenas deixa o banco coerente com o que a tela mostra.
 */
import 'dotenv/config';
import mongoose from 'mongoose';

import db from '../src/config/db.js';
import '../src/models/categories.js';
import '../src/models/denuncias.js';
import { LISTA_ESTAGIOS, normalizarStatus } from '../src/helpers/protocolo.js';

const aplicar = process.argv.includes('--aplicar');

async function migrar() {
    await mongoose.connect(db.mongoURI, { serverSelectionTimeoutMS: 30000 });
    console.log(`Conectado (${process.env.NODE_ENV === 'production' ? 'produção' : 'desenvolvimento'}).\n`);

    let totalAlterados = 0;

    for (const nomeModelo of ['chamados', 'denuncias']) {
        const Modelo = mongoose.model(nomeModelo);

        // Só o que está fora da lista de estágios precisa de conversão.
        const desatualizados = await Modelo.find({ status: { $nin: LISTA_ESTAGIOS } })
            .select('_id status')
            .lean();

        if (desatualizados.length === 0) {
            console.log(`${nomeModelo}: nada a migrar.`);
            continue;
        }

        const porStatus = desatualizados.reduce((acc, doc) => {
            const de = doc.status || '(vazio)';
            const para = normalizarStatus(doc.status);
            const chave = `${de} -> ${para}`;
            acc[chave] = (acc[chave] || 0) + 1;
            return acc;
        }, {});

        console.log(`${nomeModelo}: ${desatualizados.length} registro(s)`);
        for (const [conversao, quantidade] of Object.entries(porStatus)) {
            console.log(`   ${quantidade.toString().padStart(4)}x  ${conversao}`);
        }

        if (aplicar) {
            for (const doc of desatualizados) {
                await Modelo.updateOne({ _id: doc._id }, { $set: { status: normalizarStatus(doc.status) } });
            }
            console.log(`   -> gravado.`);
        }

        totalAlterados += desatualizados.length;
    }

    console.log('');
    if (!aplicar && totalAlterados > 0) {
        console.log('Simulação. Rode com --aplicar para gravar as mudanças.');
    } else if (aplicar) {
        console.log(`${totalAlterados} registro(s) migrado(s).`);
    }

    await mongoose.disconnect();
}

migrar().catch((err) => {
    console.error('Falha na migração:', err);
    process.exit(1);
});
