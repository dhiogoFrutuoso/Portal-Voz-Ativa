import mongoose from 'mongoose';

const Schema = mongoose.Schema;

const VitrineSchema = new Schema({
    // 1. CLASSIFICAÇÃO (Com suporte ao "Outros")
    categoria: { 
        type: String, 
        required: true 
    },
    categoria_especificada: { 
        type: String, 
        default: null 
    },

    // 2. IDENTIFICAÇÃO DO ANÚNCIO
    titulo: { 
        type: String, 
        required: true 
    },
    descricao: { 
        type: String, 
        required: true 
    },
    produtos: { 
        type: String 
    },
    servicos: { 
        type: String 
    },

    // 3. CONTATO E LOCALIZAÇÃO
    contato: { 
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

    // 4. MÍDIA
    imagens: [{ 
        type: String 
    }], // Array para as fotos do trabalho/negócio

    // 5. RELACIONAMENTO COM USUÁRIO (Quem está anunciando)
    usuario: { 
        type: Schema.Types.ObjectId, 
        ref: 'users', 
        required: true 
    },

    // 6. INTERAÇÃO SOCIAL (Inspirado no modelo de denúncias)
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
            type: String, 
            required: true 
        },
        createdAt: { 
            type: Date, 
            default: Date.now 
        }
    }],

    // 7. CONTROLE
    status: { 
        type: String, 
        default: "Ativo" 
    },
    dataCriacao: { 
        type: Date, 
        default: Date.now 
    }
});

mongoose.model('vitrine', VitrineSchema);