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
        }
    }],
    editadoEm: {
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