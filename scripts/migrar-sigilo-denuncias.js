/*
 * Define o sigilo das denúncias que já existiam antes do campo `privada`.
 *
 * Regra: só foco de incêndio nasce público (é risco coletivo e serve de
 * alerta). Todo o resto passa a ser sigiloso, porque expõe a moral da vítima
 * e a de quem é acusado. A gestão pode rever caso a caso pelo painel.
 *
 * Uso:
 *   node scripts/migrar-sigilo-denuncias.js            (simulação)
 *   node scripts/migrar-sigilo-denuncias.js --aplicar  (grava)
 */
import 'dotenv/config';
import mongoose from 'mongoose';

import db from '../src/config/db.js';
import '../src/models/denuncias.js';
import { nasceSigilosa } from '../src/helpers/protocolo.js';

const aplicar = process.argv.includes('--aplicar');

async function migrar() {
    await mongoose.connect(db.mongoURI, { serverSelectionTimeoutMS: 30000 });
    console.log(`Conectado (${process.env.NODE_ENV === 'production' ? 'produção' : 'desenvolvimento'}).\n`);

    const Denuncia = mongoose.model('denuncias');
    const semDefinicao = await Denuncia.find({ privada: { $exists: false } })
        .select('_id titulo tipoOcorrencia')
        .lean();

    if (semDefinicao.length === 0) {
        console.log('Todas as denúncias já têm o sigilo definido.');
        await mongoose.disconnect();
        return;
    }

    for (const doc of semDefinicao) {
        const privada = nasceSigilosa(doc.tipoOcorrencia);
        console.log(`${privada ? 'sigilosa' : 'pública '}  ${doc.tipoOcorrencia || '(sem tipo)'} — ${doc.titulo}`);

        if (aplicar) {
            await Denuncia.updateOne({ _id: doc._id }, { $set: { privada } });
        }
    }

    console.log('');
    console.log(
        aplicar
            ? `${semDefinicao.length} denúncia(s) atualizada(s).`
            : `${semDefinicao.length} denúncia(s). Simulação — rode com --aplicar para gravar.`
    );

    await mongoose.disconnect();
}

migrar().catch((err) => {
    console.error('Falha na migração:', err);
    process.exit(1);
});
