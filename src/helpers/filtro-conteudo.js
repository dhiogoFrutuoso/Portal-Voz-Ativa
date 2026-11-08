/*
 * Filtro de civilidade e moderação automática de conteúdo textual (Piloto 90 dias).
 *
 * Bloqueia termos de baixo calão, xingamentos explícitos e ataques pessoais
 * diretos no momento do envio, orientando o cidadão a reescrever o relato com
 * civilidade e foco objetivo no problema urbano ou infração.
 */

// Termos explícitos de baixo calão e ofensas diretas (comparados por palavra inteira
// após normalização de acentos para evitar falsos positivos em palavras comuns).
const TERMOS_BAIXO_CALAO = [
    'arrombado',
    'arrombada',
    'babaca',
    'bosta',
    'buceta',
    'cacete',
    'canalha',
    'caralho',
    'corno',
    'corna',
    'cretino',
    'cretina',
    'cuzao',
    'cuzona',
    'desgracado',
    'desgracada',
    'escroto',
    'escrota',
    'estupido',
    'estupida',
    'fdp',
    'foda',
    'foder',
    'fodido',
    'fodida',
    'idiota',
    'imbecil',
    'imundo',
    'imunda',
    'ladrao',
    'ladra',
    'ladrão',
    'merda',
    'otario',
    'otaria',
    'palhaco',
    'palhaca',
    'pilantra',
    'piranha',
    'porra',
    'puta',
    'puto',
    'putaria',
    'pqp',
    'retardado',
    'retardada',
    'safado',
    'safada',
    'vagabundo',
    'vagabunda',
    'verme',
    'viado',
    'viadinho',
    'vsf',
    'vtnc',
    'xoxota'
];

// Padrões de ataque pessoal direto ou imputação difamatória nominal
const PADROES_ATAQUE_PESSOAL = [
    /\b(filho|filha)\s+da\s+puta\b/i,
    /\bvai\s+(tomar\s+no\s+cu|se\s+foder|se\s+fuder|pro\s+inferno)\b/i,
    /\b(prefeito|secretario|vereador|vizinho|morador|fulano)\s+(e\s+um\s+)?(ladrao|vagabundo|corrupto|bandido|pilantra|safado)\b/i,
    /\b(todo\s+mundo\s+sabe\s+que\s+o|aquele\s+bandido\s+do|aquela\s+vagabunda\s+da)\b/i
];

export const MENSAGEM_REESCRITA_CIVILIDADE =
    'Seu relato contém termos de baixo calão, xingamentos ou ataques pessoais. Por favor, reescreva o texto com civilidade e foco objetivo no fato antes de salvar.';

function normalizarParaAnalise(texto) {
    return String(texto || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[@4]/g, 'a')
        .replace(/[3]/g, 'e')
        .replace(/[1!]/g, 'i')
        .replace(/[0]/g, 'o')
        .replace(/[$5]/g, 's');
}

const REGEX_TERMOS = new RegExp(
    `\\b(${TERMOS_BAIXO_CALAO.map((t) => normalizarParaAnalise(t)).join('|')})\\b`,
    'i'
);

/**
 * Analisa se um texto contém termos ofensivos ou ataques pessoais.
 * Retorna `{ aprovado: true }` ou `{ aprovado: false, motivo, termo }`.
 */
export function analisarCivilidade(texto) {
    if (!texto || typeof texto !== 'string') {
        return { aprovado: true };
    }

    const normalizado = normalizarParaAnalise(texto);

    const matchTermo = REGEX_TERMOS.exec(normalizado);
    if (matchTermo) {
        return {
            aprovado: false,
            termo: matchTermo[1],
            motivo: MENSAGEM_REESCRITA_CIVILIDADE
        };
    }

    for (const padrao of PADROES_ATAQUE_PESSOAL) {
        if (padrao.test(normalizado)) {
            return {
                aprovado: false,
                motivo: MENSAGEM_REESCRITA_CIVILIDADE
            };
        }
    }

    return { aprovado: true };
}

export function contemConteudoImproprio(texto) {
    return !analisarCivilidade(texto).aprovado;
}
