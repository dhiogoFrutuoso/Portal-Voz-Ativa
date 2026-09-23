import express from 'express';
import multer from 'multer';
import { randomUUID, createHmac } from 'node:crypto';
import { v2 as cloudinary } from 'cloudinary';
import { limitarRequisicoes } from '../config/rate-limit.js';
import { tratarArquivo } from '../helpers/upload-seguro.js';
import Media from '../models/media.js';
export const donoMidia = (req) => req.user ? `user:${req.user._id}` : `session:${createHmac('sha256', process.env.JWT_SECRET).update(req.sessionID).digest('hex')}`;
const router = express.Router();
const multipart = multer({ storage: multer.memoryStorage(), limits: { fileSize: 3 * 1024 * 1024, files: 1, fields: 0, parts: 1 } }).single('file');
router.post('/', limitarRequisicoes('uploads', { windowMs: 15 * 60000, max: 20 }), (req, res, next) => {
    multipart(req, res, (error) => error ? res.status(400).json({ error: 'Envie um arquivo de até 3 MB.' }) : next());
}, async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'Arquivo obrigatório.' });
        const file = await tratarArquivo(req.file.buffer);
        const result = await new Promise((resolve, reject) => {
            const stream = cloudinary.uploader.upload_stream({
                cloud_name: process.env.CLOUDINARY_CLOUD_NAME, api_key: process.env.CLOUDINARY_API_KEY,
                api_secret: process.env.CLOUDINARY_API_SECRET, resource_type: file.resource_type,
                public_id: `portal-validado/${randomUUID()}${file.resource_type === 'raw' ? '.pdf' : ''}`,
                timeout: 20000
            }, (error, value) => error ? reject(error) : resolve(value));
            stream.end(file.buffer);
        });
        await Media.create({ url: result.secure_url, owner: donoMidia(req), mime: file.mime });
        res.json({ secure_url: result.secure_url });
    } catch { res.status(400).json({ error: 'Arquivo recusado ou envio indisponível. Use JPEG, PNG, WebP ou PDF sem conteúdo ativo, até 3 MB.' }); }
});
export async function validarMidiasRecebidas(req, res, next) {
    if (req.method !== 'POST') return next();
    const names = ['imagens', 'imagens[]', 'imagens_urls', 'imagens_urls[]', 'novas_imagens', 'novas_imagens[]', 'imagem_url', 'arquivo_url', 'croppedImage', 'video_url'];
    try {
        for (const name of names) {
            const value = req.body?.[name];
            for (const url of (Array.isArray(value) ? value : [value]).filter(Boolean)) {
                if (typeof url !== 'string') return res.status(400).send('Mídia inválida.');
                const record = await Media.findOne({ url, owner: donoMidia(req) }).lean();
                if (!record || (name !== 'arquivo_url' && record.mime === 'application/pdf')) return res.status(400).send('Use o seletor de arquivos para enviar uma mídia válida.');
            }
        }
        next();
    } catch { res.status(503).send('Não foi possível validar a mídia.'); }
}
export default router;
// [Melhoria Proativa Adicionada: multipart abaixo do limite Vercel e rejeição de URLs sem recibo de inspeção]
