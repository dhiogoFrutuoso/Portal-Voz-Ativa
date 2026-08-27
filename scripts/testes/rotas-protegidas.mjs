/*
 * Confere que as rotas restritas não respondem a quem não está autenticado e
 * que POST sem token CSRF é recusado.
 *
 * Uso: node scripts/testes/rotas-protegidas.mjs   (com o servidor no ar)
 */
const BASE = process.env.BASE_URL || 'http://localhost:8080';
const ID = '69967bf4b070e34173c5c5b8';

const GETS_RESTRITOS = [
    ['/protocolos', '/users/login'],
    [`/protocolos/melhoria/${ID}`, '/users/login'],
    [`/protocolos/denuncia/${ID}`, '/users/login'],
    ['/admin', '/'],
    ['/admin/painel', '/'],
    [`/categories/gestao_de_melhorias/editar/${ID}`, '/users/login'],
    [`/categories/denuncias_sigilosas/editar/${ID}`, '/users/login'],
    [`/categories/vitrine_do_trabalhador/editar/${ID}`, '/users/login'],
    ['/protocolos/buscar?q=teste', '/users/login'],
    ['/admin/painel/buscar?q=teste', '/']
];

const POSTS_RESTRITOS = [
    `/admin/protocolo/melhoria/${ID}/status`,
    `/protocolos/melhoria/${ID}/responder`,
    `/categories/gestao_de_melhorias/editar/${ID}`,
    `/categories/gestao_de_melhorias/excluir/${ID}`,
    `/categories/denuncias_sigilosas/excluir/${ID}`,
    `/categories/vitrine_do_trabalhador/excluir/${ID}`,
    `/protocolos/melhoria/${ID}/mensagem/${ID}/editar`,
    `/protocolos/melhoria/${ID}/mensagem/${ID}/excluir`
];

let falhas = 0;

const registrar = (ok, texto) => {
    console.log(`${ok ? 'ok    ' : 'FALHA '} ${texto}`);
    if (!ok) falhas++;
};

console.log('--- GET restrito sem login (deve redirecionar, nunca renderizar) ---');
for (const [rota, destinoEsperado] of GETS_RESTRITOS) {
    const r = await fetch(BASE + rota, { redirect: 'manual' });
    const destino = r.headers.get('location') || '';
    const ok = r.status === 302 && destino.startsWith(destinoEsperado);
    registrar(ok, `${r.status} ${rota} -> ${destino || '(sem redirect)'}`);
}

console.log('\n--- POST sem sessão e sem token CSRF (deve ser recusado) ---');
for (const rota of POSTS_RESTRITOS) {
    const r = await fetch(BASE + rota, {
        method: 'POST',
        redirect: 'manual',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'status=Resolvido&texto=teste'
    });
    // Sem token válido a requisição nunca pode chegar ao banco: 302 de volta.
    const ok = r.status === 302;
    registrar(ok, `${r.status} POST ${rota} -> ${r.headers.get('location')}`);
}

console.log('\n--- Injeção de operador do Mongo na busca ---');
const injecoes = [
    '/categories/gestao_de_melhorias/hub?q[$ne]=x',
    '/categories/denuncias_sigilosas/hub?q=.*',
    '/categories/vitrine_do_trabalhador/hub?q=' + encodeURIComponent('{"$gt":""}')
];
for (const rota of injecoes) {
    const r = await fetch(BASE + rota, { redirect: 'manual' });
    registrar(r.status === 200, `${r.status} ${rota}`);
}

console.log('\n--- Cabeçalhos de segurança ---');
const cabecalhos = await fetch(BASE + '/');
for (const nome of ['content-security-policy', 'x-frame-options', 'strict-transport-security', 'x-content-type-options']) {
    const valor = cabecalhos.headers.get(nome);
    registrar(Boolean(valor), `${nome}: ${valor ? valor.slice(0, 60) + '...' : 'AUSENTE'}`);
}
registrar(!cabecalhos.headers.get('x-powered-by'), 'x-powered-by oculto');

console.log(falhas === 0 ? '\nTodas as checagens passaram.' : `\n${falhas} falha(s).`);
process.exit(falhas === 0 ? 0 : 1);
