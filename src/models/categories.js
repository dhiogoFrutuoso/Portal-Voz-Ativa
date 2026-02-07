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

    imagem: { 
        type: [String],
        default: []
    }, 
    status: {
         type: String, 
         default: 'Aberto' 
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
        createdAt: { type: Date, default: Date.now }
    }]
});

// Registrar o modelo se ele ainda não foi registrado
const Chamado = mongoose.models.chamados || mongoose.model('chamados', ChamadoSchema);

export default Chamado;