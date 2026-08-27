/*
 * Otimização das imagens enviadas pelos usuários.
 *
 * A mídia sobe direto do navegador para o Cloudinary e o banco guarda só a URL.
 * Em vez de reprocessar arquivo por arquivo, pedimos a conversão na entrega:
 * inserindo `f_auto,q_auto` na URL, o Cloudinary devolve WebP para praticamente
 * todos os navegadores atuais (e AVIF, ainda mais leve, para os que suportam),
 * caindo para o formato original só em navegadores antigos que não abririam
 * WebP de jeito nenhum. A qualidade também passa a ser ajustada automaticamente.
 *
 * A troca é feita no momento de renderizar, então vale igualmente para as fotos
 * que já estavam no banco antes desta mudança.
 */

const CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME || 'dnh7vok3r';
const PREFIXO_IMAGEM = `https://res.cloudinary.com/${CLOUD_NAME}/image/upload/`;
const TRANSFORMACAO = 'f_auto,q_auto';

// Evita reescrever uma URL que já carrega instrução de formato ou qualidade.
const jaOtimizada = (resto) => /(^|,|\/)(f_|q_)/.test(resto.split('/')[0]);

export function otimizarUrlCloudinary(url) {
    if (typeof url !== 'string' || !url.startsWith(PREFIXO_IMAGEM)) {
        return url;
    }

    const resto = url.slice(PREFIXO_IMAGEM.length);

    if (resto === '' || jaOtimizada(resto)) {
        return url;
    }

    return `${PREFIXO_IMAGEM}${TRANSFORMACAO}/${resto}`;
}

// Percorre o contexto de renderização trocando toda URL de imagem do Cloudinary.
// A profundidade é limitada para não percorrer estruturas inesperadas.
function otimizarContexto(valor, profundidade = 0) {
    if (profundidade > 8 || valor === null || valor === undefined) {
        return valor;
    }

    if (typeof valor === 'string') {
        return otimizarUrlCloudinary(valor);
    }

    if (Array.isArray(valor)) {
        return valor.map((item) => otimizarContexto(item, profundidade + 1));
    }

    // Só objetos simples: Date, ObjectId e afins passam intactos.
    if (typeof valor === 'object' && (valor.constructor === Object || valor.constructor === undefined)) {
        const saida = {};
        for (const [chave, conteudo] of Object.entries(valor)) {
            saida[chave] = otimizarContexto(conteudo, profundidade + 1);
        }
        return saida;
    }

    return valor;
}

/*
 * Middleware que envolve o res.render: qualquer view recebe as URLs já
 * otimizadas, sem precisar lembrar de aplicar um helper caso a caso.
 */
export function otimizarMidiaNaRenderizacao(req, res, next) {
    const renderOriginal = res.render.bind(res);

    res.render = (view, opcoes, callback) => {
        if (typeof opcoes === 'function' || opcoes === undefined) {
            // Sem contexto próprio: ainda assim otimizamos o res.locals.
            res.locals = otimizarContexto(res.locals);
            return renderOriginal(view, opcoes, callback);
        }

        res.locals = otimizarContexto(res.locals);
        return renderOriginal(view, otimizarContexto(opcoes), callback);
    };

    next();
}
