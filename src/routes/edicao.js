/*
 * Edição e exclusão de publicações — restrito ao autor.
 *
 * Os três eixos (melhoria, denúncia e vitrine) compartilham o mesmo fluxo, por
 * isso as rotas são registradas em laço a partir de uma configuração única.
 * Assim uma regra de permissão corrigida vale para todos ao mesmo tempo.
 */
import express from 'express';
import mongoose from 'mongoose';
import multer from 'multer';
import { limitarRequisicoes } from '../config/rate-limit.js';

import '../models/categories.js';
import '../models/denuncias.js';
import '../models/vitrine.js';

import isUser from '../helpers/isUser.js';
import {
    nasceSigilosa,
    TIPOS_OCORRENCIA_PILOTO,
    CATEGORIAS_MELHORIA_PILOTO,
    extrairBairro
} from '../helpers/protocolo.js';
import {
    chamadoSchema,
    denunciaSchema,
    vitrineSchema,
    normalizarMidias,
    normalizarVideo,
    primeiraMensagem
} from '../helpers/validators.js';

const router = express.Router();
const upload = multer();

const limiteEdicao = limitarRequisicoes('edicao', {
    windowMs: 5 * 60 * 1000,
    max: 30,
    message: 'Muitas edições em sequência. Tente novamente em alguns minutos.'
});

const idValido = (id) => mongoose.Types.ObjectId.isValid(id);

function indicesMantidos(entrada) {
    let lista = entrada ?? [];
    if (!Array.isArray(lista)) lista = [lista];

    return lista
        .map((valor) => Number.parseInt(valor, 10))
        .filter((numero) => Number.isInteger(numero));
}

const CATEGORIAS_VITRINE = [
    'Serviços Gerais',
    'Alimentação',
    'Construção Civil',
    'Educação/Aulas',
    'Artesanato',
    'Outros'
];

export const EIXOS_EDITAVEIS = {
    gestao_de_melhorias: {
        chave: 'gestao_de_melhorias',
        model: 'chamados',
        schema: chamadoSchema,
        rotulo: 'Melhoria',
        rotuloLongo: 'Gestão de Melhorias',
        cor: 'primary',
        icone: 'bi-tools',
        temVideo: false,
        temProtocolo: true,
        hub: '/categories/gestao_de_melhorias/hub',
        detalhes: '/categories/gestao_de_melhorias/detalhes',
        campos: (dados, postAtual) => ({
            categoria: dados.categoria || postAtual?.categoria || 'Gestão de Melhorias',
            bairro: dados.bairro || postAtual?.bairro || extrairBairro(dados),
            titulo: dados.titulo,
            descricao: dados.descricao,
            localizacao: dados.localizacao,
            latitude: dados.latitude,
            longitude: dados.longitude
        })
    },
    denuncias_sigilosas: {
        chave: 'denuncias_sigilosas',
        model: 'denuncias',
        schema: denunciaSchema,
        rotulo: 'Denúncia',
        rotuloLongo: 'Denúncias Sigilosas',
        cor: 'danger',
        icone: 'bi-shield-lock-fill',
        temVideo: true,
        temProtocolo: true,
        hub: '/categories/denuncias_sigilosas/hub',
        detalhes: '/categories/denuncias_sigilosas/detalhes',
        campos: (dados, postAtual) => ({
            tipoOcorrencia: dados.tipoOcorrencia,
            bairro: dados.bairro || postAtual?.bairro || extrairBairro(dados),
            titulo: dados.tipoOcorrencia === 'Outro' ? dados.titulo : dados.tipoOcorrencia,
            descricao: dados.descricao,
            localizacao: dados.localizacao,
            latitude: dados.latitude,
            longitude: dados.longitude,
            privada:
                postAtual && postAtual.tipoOcorrencia === dados.tipoOcorrencia && typeof postAtual.privada === 'boolean'
                    ? postAtual.privada
                    : nasceSigilosa(dados.tipoOcorrencia)
        })
    },
    vitrine_do_trabalhador: {
        chave: 'vitrine_do_trabalhador',
        model: 'vitrine',
        schema: vitrineSchema,
        rotulo: 'Anúncio',
        rotuloLongo: 'Vitrine do Trabalhador',
        cor: 'success',
        icone: 'bi-shop',
        temVideo: false,
        temProtocolo: false,
        hub: '/categories/vitrine_do_trabalhador/hub',
        detalhes: '/categories/vitrine_do_trabalhador/detalhes',
        campos: (dados) => ({
            categoria: dados.categoria,
            categoria_especificada: dados.categoria === 'Outros' ? dados.categoria_especificada : null,
            titulo: dados.titulo,
            descricao: dados.descricao,
            produtos: dados.produtos,
            servicos: dados.servicos,
            contato: dados.contato,
            localizacao: dados.localizacao,
            latitude: dados.latitude,
            longitude: dados.longitude
        })
    }
};

function carregarPostDoAutor(eixo) {
    return async (req, res, next) => {
        const { id } = req.params;

        if (!idValido(id)) {
            req.flash('error_msg', 'Publicação não encontrada.');
            return res.redirect(eixo.hub);
        }

        try {
            const doc = await mongoose.model(eixo.model).findById(id).lean();

            if (!doc) {
                req.flash('error_msg', 'Publicação não encontrada.');
                return res.redirect(eixo.hub);
            }

            const autorId = doc.usuario ? String(doc.usuario) : null;

            if (!autorId || autorId !== String(req.user._id)) {
                req.flash('error_msg', 'Somente quem publicou pode editar ou excluir esta postagem.');
                return res.redirect(`${eixo.detalhes}/${id}`);
            }

            req.post = doc;
            next();
        } catch (err) {
            console.error('Erro ao carregar publicação para edição:', err);
            req.flash('error_msg', 'Erro interno ao abrir o editor.');
            res.redirect(eixo.hub);
        }
    };
}

for (const eixo of Object.values(EIXOS_EDITAVEIS)) {
    // --- FORMULÁRIO DE EDIÇÃO ---
    router.get(`/${eixo.chave}/editar/:id`, isUser, carregarPostDoAutor(eixo), (req, res) => {
        res.render('categories/editar', {
            eixo,
            post: req.post,
            imagensAtuais: req.post.imagens || [],
            video: req.post.video || null,
            tiposOcorrencia: TIPOS_OCORRENCIA_PILOTO,
            categoriasMelhoria: CATEGORIAS_MELHORIA_PILOTO,
            categoriasVitrine: CATEGORIAS_VITRINE
        });
    });

    // --- SALVAR EDIÇÃO ---
    router.post(
        `/${eixo.chave}/editar/:id`,
        isUser,
        limiteEdicao,
        upload.none(),
        carregarPostDoAutor(eixo),
        async (req, res) => {
            const destinoEditor = `/categories/${eixo.chave}/editar/${req.params.id}`;
            const validacao = eixo.schema.safeParse(req.body);

            if (!validacao.success) {
                req.flash('error_msg', primeiraMensagem(validacao.error));
                return res.redirect(destinoEditor);
            }

            const jaSalvas = Array.isArray(req.post.imagens) ? req.post.imagens : [];
            const mantidas = indicesMantidos(req.body['imagens_mantidas[]'] || req.body.imagens_mantidas)
                .filter((i) => i >= 0 && i < jaSalvas.length)
                .map((i) => jaSalvas[i]);

            const novas = normalizarMidias(req.body['imagens_urls[]'] || req.body.imagens_urls, 5);
            const imagens = [...mantidas, ...novas].slice(0, 5);

            const atualizacao = {
                ...eixo.campos(validacao.data, req.post),
                imagens,
                editadoEm: new Date()
            };

            if (eixo.temVideo) {
                const manterVideo = req.body.manter_video === '1';
                const videoNovo = normalizarVideo(req.body.video_url);
                atualizacao.video = videoNovo || (manterVideo ? req.post.video || null : null);
            }

            try {
                await mongoose.model(eixo.model).findByIdAndUpdate(req.params.id, atualizacao, {
                    runValidators: true
                });

                req.flash('success_msg', 'Publicação atualizada com sucesso!');
                res.redirect(`${eixo.detalhes}/${req.params.id}`);
            } catch (err) {
                console.error('Erro ao salvar edição:', err);
                req.flash('error_msg', 'Erro ao salvar as alterações.');
                res.redirect(destinoEditor);
            }
        }
    );

    // --- EXCLUSÃO ---
    router.post(
        `/${eixo.chave}/excluir/:id`,
        isUser,
        limiteEdicao,
        carregarPostDoAutor(eixo),
        async (req, res) => {
            try {
                await mongoose.model(eixo.model).findByIdAndDelete(req.params.id);
                req.flash('success_msg', 'Publicação excluída.');
                res.redirect(eixo.hub);
            } catch (err) {
                console.error('Erro ao excluir publicação:', err);
                req.flash('error_msg', 'Erro ao excluir a publicação.');
                res.redirect(`${eixo.detalhes}/${req.params.id}`);
            }
        }
    );
}

export default router;
