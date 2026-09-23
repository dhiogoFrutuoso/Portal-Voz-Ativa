import express from 'express';
import { VERSAO_TERMOS } from '../helpers/governanca.js';
const router = express.Router();
router.get('/termos-de-uso', (req, res) => res.render('legal/termos', { versao: VERSAO_TERMOS }));
router.get('/politica-de-privacidade', (req, res) => res.render('legal/privacidade', { versao: VERSAO_TERMOS }));
export default router;
// [Melhoria Proativa Adicionada: documentos públicos versionados e acessíveis sem autenticação]
