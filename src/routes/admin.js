import express from 'express';
import mongoose from 'mongoose';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

import '../models/denuncias.js';

import isAdmin from '../helpers/isAdmin.js';

const Denuncia = mongoose.model('denuncias');

const router = express.Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

router.get('/', isAdmin, (req, res) => { 
    res.render('admin/index')
});

router.get('/painel', isAdmin, async (req, res) => {
    try {
        const denuncias = await Denuncia.find().sort({ dataCriacao: -1 }).lean();
        
        const denunciasComLike = denuncias.map(denuncia => {
            const curtidasArray = denuncia.curtidas || []; 
            
            return {
                ...denuncia,
                curtidas: curtidasArray, // Garante que o Handlebars receba um array para o .length
                jaCurtiu: req.user ? curtidasArray.some(id => id.toString() === req.user._id.toString()) : false
            };
        });

        res.render('admin/painel', { denuncias: denunciasComLike });
    } catch (err) {
        console.error(err);
        req.flash("error_msg", "Erro ao carregar o painel");
        res.redirect("admin/painel");
    }
});

export default router;