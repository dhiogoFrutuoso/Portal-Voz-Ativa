import { z } from 'zod';

// ---------------------------------------------------------------------------
// Regras de validação e sanitização das entradas do usuário
// ---------------------------------------------------------------------------
// Nada que chega do navegador é confiável: além de checar formato e tamanho,
// removemos tags HTML dos campos livres. O Handlebars já escapa na saída, mas
// evitar que a marcação sequer entre no banco é a segunda camada de defesa.

const removerTags = (texto) =>
    String(texto)
        .replace(/<[^>]*>/g, '')
        .replace(/[\u0000-\u001F\u007F]/g, ' ')
        .trim();

const textoLimpo = (min, max, campo) =>
    z
        .string({ required_error: `${campo} é obrigatório.`, invalid_type_error: `${campo} inválido.` })
        .transform(removerTags)
        .refine((v) => v.length >= min, { message: `${campo} precisa ter ao menos ${min} caractere(s).` })
        .refine((v) => v.length <= max, { message: `${campo} pode ter no máximo ${max} caracteres.` });

// z.preprocess (e não union com z.undefined) porque no Zod 4 uma chave ausente
// no corpo da requisição não satisfaz z.undefined dentro de union.
const textoOpcional = (max, campo) =>
    z.preprocess(
        (v) => (v === undefined || v === null ? '' : removerTags(v)),
        z.string().max(max, { message: `${campo} pode ter no máximo ${max} caracteres.` })
    );

const coordenada = (limite) =>
    z.preprocess(
        (v) => {
            if (v === undefined || v === null || v === '') return null;
            const numero = Number(v);
            return Number.isFinite(numero) ? numero : NaN;
        },
        z
            .number()
            .nullable()
            .refine((v) => v === null || Math.abs(v) <= limite, {
                message: 'Coordenada fora do intervalo válido.'
            })
    );

// --- Cloudinary: só aceitamos URLs da nossa própria conta ---
const CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME || 'dnh7vok3r';
const PREFIXO_CLOUDINARY = `https://res.cloudinary.com/${CLOUD_NAME}/`;

export const urlDeMidiaValida = (url) =>
    typeof url === 'string' && url.startsWith(PREFIXO_CLOUDINARY) && !url.includes('..');

// Filtra as URLs recebidas do formulário, descartando qualquer endereço que não
// tenha saído do nosso Cloudinary (impede que a página exiba mídia arbitrária).
export function normalizarMidias(entrada, maximo = 5) {
    let lista = entrada || [];
    if (typeof lista === 'string') lista = [lista];
    if (!Array.isArray(lista)) return [];

    return lista.filter(urlDeMidiaValida).slice(0, maximo);
}

export function normalizarVideo(url) {
    return urlDeMidiaValida(url) ? url : null;
}

// --- Imagem enviada em base64 (foto de perfil) ---
const MIMES_PERMITIDOS = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
const TAMANHO_MAXIMO_AVATAR = 5 * 1024 * 1024; // 5 MB

// Confere o cabeçalho declarado e a assinatura binária real do arquivo
// (magic numbers), já que a extensão ou o mime informado podem ser forjados.
const ASSINATURAS = [
    [0x89, 0x50, 0x4e, 0x47], // PNG
    [0xff, 0xd8, 0xff], // JPEG
    [0x52, 0x49, 0x46, 0x46] // RIFF (WEBP)
];

export function validarImagemBase64(entrada) {
    if (!entrada || typeof entrada !== 'string' || entrada === '') {
        return { vazio: true };
    }

    if (entrada.startsWith('http')) {
        return urlDeMidiaValida(entrada)
            ? { url: entrada }
            : { erro: 'Endereço de imagem não permitido.' };
    }

    if (entrada.startsWith('/img/')) {
        return { url: entrada };
    }

    const match = /^data:([a-z/+-]+);base64,(.+)$/i.exec(entrada);
    if (!match) {
        return { erro: 'Formato de imagem inválido.' };
    }

    const [, mime, dados] = match;
    if (!MIMES_PERMITIDOS.includes(mime.toLowerCase())) {
        return { erro: 'Use uma imagem PNG, JPEG ou WEBP.' };
    }

    let buffer;
    try {
        buffer = Buffer.from(dados, 'base64');
    } catch {
        return { erro: 'Não foi possível ler a imagem enviada.' };
    }

    if (buffer.length === 0) return { erro: 'Imagem vazia.' };
    if (buffer.length > TAMANHO_MAXIMO_AVATAR) {
        return { erro: 'A imagem excede o limite de 5 MB.' };
    }

    const assinaturaConfere = ASSINATURAS.some((bytes) =>
        bytes.every((byte, i) => buffer[i] === byte)
    );

    if (!assinaturaConfere) {
        return { erro: 'O arquivo enviado não é uma imagem válida.' };
    }

    return { base64: entrada };
}

// --- Esquemas por formulário ---
export const registroSchema = z
    .object({
        name: textoLimpo(2, 80, 'Nome'),
        email: z.string({ required_error: 'E-mail é obrigatório.' }).trim().toLowerCase().email('E-mail inválido.').max(160),
        password: z.string({ required_error: 'Senha é obrigatória.' }).min(8, 'A senha precisa ter ao menos 8 caracteres.').max(128),
        password_2: z.string({ required_error: 'Confirme a senha.' }),
        profession: textoOpcional(60, 'Profissão'),
        bio: textoOpcional(500, 'Bio')
    })
    .refine((d) => d.password === d.password_2, {
        message: 'As senhas não coincidem.',
        path: ['password_2']
    });

export const loginSchema = z.object({
    email: z.string({ required_error: 'E-mail é obrigatório.' }).trim().toLowerCase().email('E-mail inválido.').max(160),
    password: z.string({ required_error: 'Senha é obrigatória.' }).min(1, 'Senha é obrigatória.').max(128)
});

export const perfilSchema = z.object({
    name: textoLimpo(2, 80, 'Nome'),
    profession: textoOpcional(60, 'Profissão'),
    bio: textoOpcional(500, 'Bio')
});

export const trocaDeSenhaSchema = z
    .object({
        oldPassword: z.string({ required_error: 'Informe a senha atual.' }).min(1, 'Informe a senha atual.').max(128),
        newPassword: z.string({ required_error: 'Informe a nova senha.' }).min(8, 'A nova senha precisa ter ao menos 8 caracteres.').max(128),
        newPassword2: z.string({ required_error: 'Confirme a nova senha.' })
    })
    .refine((d) => d.newPassword === d.newPassword2, {
        message: 'A confirmação da nova senha não coincide.',
        path: ['newPassword2']
    });

export const chamadoSchema = z.object({
    titulo: textoLimpo(4, 120, 'Título'),
    descricao: textoLimpo(10, 3000, 'Descrição'),
    localizacao: textoLimpo(3, 200, 'Localização'),
    latitude: coordenada(90),
    longitude: coordenada(180)
});

export const denunciaSchema = z.object({
    tipoOcorrencia: textoLimpo(2, 80, 'Tipo de ocorrência'),
    titulo: textoOpcional(120, 'Título'),
    descricao: textoLimpo(10, 3000, 'Descrição'),
    localizacao: textoLimpo(3, 200, 'Localização'),
    latitude: coordenada(90),
    longitude: coordenada(180)
});

export const vitrineSchema = z.object({
    categoria: textoLimpo(2, 60, 'Categoria'),
    categoria_especificada: textoOpcional(60, 'Categoria especificada'),
    titulo: textoLimpo(4, 120, 'Título'),
    descricao: textoLimpo(10, 3000, 'Descrição'),
    produtos: textoOpcional(1000, 'Produtos'),
    servicos: textoOpcional(1000, 'Serviços'),
    contato: textoLimpo(6, 120, 'Contato'),
    localizacao: textoLimpo(3, 200, 'Localização'),
    latitude: coordenada(90),
    longitude: coordenada(180)
});

export const comentarioSchema = z.object({
    texto: textoLimpo(1, 1000, 'Comentário')
});

// Converte o erro do Zod na primeira mensagem legível para o usuário.
export function primeiraMensagem(erro) {
    return erro?.issues?.[0]?.message || 'Dados inválidos. Verifique os campos e tente novamente.';
}

export function todasAsMensagens(erro) {
    return (erro?.issues || []).map((i) => ({ text: i.message }));
}

// --- Protocolo de atendimento ---
export const LISTA_ESTAGIOS_VALIDOS = ['Novo', 'Em Atendimento', 'Reaberto', 'Resolvido', 'Improcedente'];

export const respostaProtocoloSchema = z.object({
    texto: textoLimpo(2, 2000, 'Mensagem')
});

export const statusProtocoloSchema = z.object({
    status: z.enum(LISTA_ESTAGIOS_VALIDOS, { error: () => 'Estágio de protocolo inválido.' }),
    texto: textoOpcional(2000, 'Mensagem'),
    prazoDias: z.preprocess(
        (v) => {
            if (v === undefined || v === null || v === '') return null;
            const n = Number(v);
            return Number.isInteger(n) ? n : NaN;
        },
        z
            .number()
            .nullable()
            .refine((v) => v === null || (v >= 1 && v <= 365), {
                message: 'O prazo deve ser um número de dias entre 1 e 365.'
            })
    )
});

// Busca: o termo vai virar expressão regular no Mongo, então escapamos tudo que
// tem significado especial — sem isso um ".*" do usuário varreria a coleção.
export const buscaSchema = z.object({
    q: textoOpcional(100, 'Busca')
});

export function escaparRegex(termo) {
    return String(termo).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
