import express from 'express';

const router = express.Router();

router.get('/', (req, res) => {
    res.render('project/project', {
        paginaProjeto: true,
        tituloPagina: 'O projeto | Portal Voz Ativa',
        descricaoPagina: 'Conheça o Portal Voz Ativa: participação cidadã, acompanhamento de solicitações e valorização de trabalhadores. Projeto campeão no Ceará de Valores.'
    });
});


export default router;
