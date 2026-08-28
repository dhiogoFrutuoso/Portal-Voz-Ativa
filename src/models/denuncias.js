//model de abrir denuncia de denuncias

import mongoose from 'mongoose';

const Schema = mongoose.Schema;

const DenunciaSchema = new Schema({
    tipoOcorrencia: { 
        type: String, 
        required: true 
    },
    titulo: { 
        type: String, 
        required: true 
    },
    descricao: { 
        type: String, 
        required: true 
    },
    localizacao: { 
        type: String, 
        required: true 
    },
    latitude: { 
        type: Number 
    },
    longitude: { 
        type: Number 
    },
    imagens: [{ 
        type: String 
    }], // Array para até 3 fotos
    video: { 
        type: String 
    },      // Nome do arquivo de vídeo
    status: {
        type: String,
        default: "Novo"
    },
    /*
     * Sigilo da denúncia.
     *
     * Denúncia costuma envolver a moral da vítima e a do acusado, então o
     * padrão é ficar restrita ao autor e à gestão. A exceção são os focos de
     * incêndio: são risco coletivo e ajudam mais sendo vistos por todos.
     * A gestão pode rever caso a caso.
     */
    privada: {
        type: Boolean,
        default: true
    },

    // --- PROTOCOLO DE ATENDIMENTO ---
    // Estágios: Novo, Em Atendimento, Reaberto, Resolvido, Improcedente
    // (ver src/helpers/protocolo.js).
    prazoDias: {
        type: Number,
        min: 1,
        max: 365
    },
    prazoAjustado: {
        type: Boolean,
        default: false
    },
    historico: [{
        autor: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'users'
        },
        papel: {
            type: String,
            enum: ['cidadao', 'admin'],
            required: true
        },
        texto: {
            type: String,
            required: true
        },
        imagem: {
            type: String,
            default: null
        },
        statusAnterior: { type: String, default: null },
        statusNovo: { type: String, default: null },
        createdAt: {
            type: Date,
            default: Date.now
        },
        editadaEm: {
            type: Date,
            default: null
        }
    }],
    /*
     * Recurso do cidadão contra o arquivamento.
     *
     * Só existe quando a gestão marca o protocolo como Improcedente, e só
     * pode haver UM por protocolo — é a chance de o cidadão argumentar que a
     * demanda é pertinente, com um anexo para embasar.
     */
    recurso: {
        texto: { type: String },
        arquivo: { type: String, default: null },
        nomeArquivo: { type: String, default: null },
        criadoEm: { type: Date },
        decisao: {
            type: String,
            enum: ['pendente', 'pertinente', 'improcedente'],
            default: 'pendente'
        },
        respostaTexto: { type: String, default: null },
        respondidoPor: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'users',
            default: null
        },
        respondidoEm: { type: Date, default: null }
    },
    editadoEm: {
        type: Date,
        default: null
    },
    // Marcas de leitura: alimentam o aviso de "nova resposta" nas listagens.
    vistoPeloAutorEm: {
        type: Date,
        default: null
    },
    vistoPelaGestaoEm: {
        type: Date,
        default: null
    },

    usuario: { 
        type: Schema.Types.ObjectId, 
        ref: 'users', 
        required: true 
    },
    curtidas: [{ 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'users' 
    }],
    comentarios: [{
        usuario: { 
            type: mongoose.Schema.Types.ObjectId, 
            ref: 'users' 
        },
        texto: { 
            type: String, required: true 
        },
        createdAt: { 
            type: Date, default: Date.now 
        }
    }],
    dataCriacao: { 
        type: Date, 
        default: Date.now 
    }
});

mongoose.model('denuncias', DenunciaSchema);