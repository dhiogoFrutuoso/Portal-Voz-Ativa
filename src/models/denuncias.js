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
        default: "Em Análise" 
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