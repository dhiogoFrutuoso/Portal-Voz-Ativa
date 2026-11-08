import { governancaPlugin } from '../helpers/governanca.js';
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
    bairro: {
        type: String,
        default: null
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

    // --- MODERAÇÃO PRÉVIA (PILOTO 90 DIAS) ---
    moderacao: {
        status: {
            type: String,
            enum: ['pendente', 'aprovado', 'bloqueado', 'encaminhado'],
            default: 'pendente'
        },
        moderadoPor: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'users',
            default: null
        },
        moderadoPorNome: {
            type: String,
            default: null
        },
        moderadoEm: {
            type: Date,
            default: null
        },
        motivoBloqueio: {
            type: String,
            default: null
        },
        orgaoEncaminhado: {
            type: String,
            default: null
        },
        notaModeracao: {
            type: String,
            default: null
        },
        textoEditadoPelaModeracao: {
            type: Boolean,
            default: false
        },
        trilha: [{
            acao: { type: String, required: true },
            moderador: { type: mongoose.Schema.Types.ObjectId, ref: 'users', default: null },
            moderadorNome: { type: String, default: null },
            detalhe: { type: String, default: null },
            orgao: { type: String, default: null },
            createdAt: { type: Date, default: Date.now }
        }]
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
        },
        editadoEm: { type: Date, default: null }
    }],
    dataCriacao: { 
        type: Date, 
        default: Date.now 
    }
});

DenunciaSchema.plugin(governancaPlugin);
DenunciaSchema.index({ dataCriacao: -1 });
DenunciaSchema.index({ usuario: 1, dataCriacao: -1 });
DenunciaSchema.index({ privada: 1, dataCriacao: -1 });
DenunciaSchema.index({ 'moderacao.status': 1, dataCriacao: -1 });

mongoose.model('denuncias', DenunciaSchema);
// [Melhoria Proativa Adicionada: campos e índices alinhados à governança e preservação de evidências]
