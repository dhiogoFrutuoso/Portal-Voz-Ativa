import assert from 'node:assert/strict';
import { verificarRecaptcha } from '../../src/helpers/recaptcha.js';

const fetchOriginal = globalThis.fetch;
const secretOriginal = process.env.RECAPTCHA_SECRET;
process.env.RECAPTCHA_SECRET = 'segredo-de-teste';
let data;
let calls = 0;
globalThis.fetch = async (url, options) => {
    calls++;
    assert.equal(url, 'https://www.google.com/recaptcha/api/siteverify');
    assert.equal(options.body.get('response'), 'token');
    return Response.json(data);
};
try {
    for (const action of ['login', 'register']) {
        data = { success: true, action, score: 0.5 };
        assert.equal(await verificarRecaptcha('token', action), true);
        for (const invalid of [
            { ...data, score: 0.49 }, { ...data, score: '0.9' },
            { ...data, score: undefined }, { ...data, action: 'outra' },
            { ...data, success: false }, { ...data, score: 2 }
        ]) {
            const valid = data; data = invalid;
            assert.equal(await verificarRecaptcha('token', action), false);
            data = valid;
        }
    }
    const before = calls;
    assert.equal(await verificarRecaptcha('', 'login'), false);
    assert.equal(await verificarRecaptcha(['token'], 'login'), false);
    process.env.RECAPTCHA_SECRET = '';
    assert.equal(await verificarRecaptcha('token', 'login'), false);
    assert.equal(calls, before);
    process.env.RECAPTCHA_SECRET = 'segredo-de-teste';
    globalThis.fetch = async () => new Response('', { status: 503 });
    assert.equal(await verificarRecaptcha('token', 'login'), false);
    globalThis.fetch = async () => { throw new Error('Rede indisponível'); };
    await assert.rejects(verificarRecaptcha('token', 'login'));
    console.log('OK: reCAPTCHA v3 valida login/cadastro e rejeita ação, score, token e resposta inválidos.');
} finally {
    globalThis.fetch = fetchOriginal;
    if (secretOriginal === undefined) delete process.env.RECAPTCHA_SECRET;
    else process.env.RECAPTCHA_SECRET = secretOriginal;
}
