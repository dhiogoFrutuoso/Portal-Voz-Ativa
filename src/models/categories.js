//models de abrir chamado de gestao de melhorias

import mongoose from "mongoose";

const ChamadoSchema = new mongoose.Schema({
    titulo: { 
        type: String, 
        required: true 
    },
    descricao: {
        type: String, 
        required: true 
    },
    categoria: { 
        type: String, 
        default: 'Gestão de Melhorias' 
    },
    localizacao: { 
        type: String, 
        required: true 
    }, // Nome do endereço por extenso
    
    // --- NOVOS CAMPOS PARA O MAPA ---
    latitude: {
        type: Number,
        required: false // Pode ser opcional caso o GPS falhe, mas o ideal é salvar sempre
    },
    longitude: {
        type: Number,
        required: false
    },
    // ---------------------------------

    imagens: { 
        type: [String],
        default: []
    }, 
    status: {
         type: String,
         default: 'Novo'
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

    dataCriacao: {
         type: Date, 
         default: Date.now 
        },
    curtidas: [{ 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'users' 
    }],
    usuario: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'users'
    },
    comentarios: [{
        texto: String,
        usuario: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'users'
        },
        createdAt: { type: Date, default: Date.now },
        editadoEm: { type: Date, default: null }
    }]
});

// Registrar o modelo se ele ainda não foi registrado
const Chamado = mongoose.models.chamados || mongoose.model('chamados', ChamadoSchema);

export default Chamado;