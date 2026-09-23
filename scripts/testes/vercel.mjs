// Integração real entre duas instâncias HTTP e um MongoDB descartável.
// Nunca carrega o .env do desenvolvedor nem envia mensagens externas.
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { once } from 'node:events';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

process.env.DOTENV_CONFIG_PATH = '__vercel_test_sem_env__';
process.env.NODE_ENV = 'production';
process.env.VERCEL = '1';
process.env.SESSION_SECRET = 'segredo-descartavel-exclusivo-dos-testes-vercel';
process.env.RECAPTCHA_SECRET = 'teste';
process.env.SMTP_USUARIO = '';
process.env.SMTP_SENHA = '';
process.env.RESEND_API_KEY = '';
const mongo = await MongoMemoryServer.create();
process.env.MONGO_URI_PROD = mongo.getUri('vercel-test');
const nativeFetch = globalThis.fetch;
globalThis.fetch = (url, options) => String(url).startsWith('https://www.google.com/recaptcha/')
    ? Promise.resolve(Response.json({ success: true, score: 0.9, action: 'login' })) : nativeFetch(url, options);
const servers = [];
const originalCwd = process.cwd();
try {
    const { conectarBanco } = await import('../../src/config/db.js');
    const connections = await Promise.all(Array.from({ length: 8 }, () => conectarBanco()));
    assert.ok(connections.every((connection) => connection === connections[0]));
    for (const instance of ['a', 'b']) {
        const { default: app } = await import(`../../src/index.js?instance=${instance}`);
        assert.equal(typeof app, 'function');
        const server = app.listen(0, '127.0.0.1');
        servers.push(server);
        await once(server, 'listening');
    }
    // Os templates e estáticos devem funcionar fora da raiz do repositório.
    process.chdir(tmpdir());
    const urls = servers.map((server) => `http://127.0.0.1:${server.address().port}`);
    let cookie = '';
    async function request(instance, route, body) {
        const response = await nativeFetch(urls[instance] + route, {
            method: body ? 'POST' : 'GET', redirect: 'manual',
            headers: { 'x-forwarded-proto': 'https', cookie,
                ...(body ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) },
            ...(body ? { body: new URLSearchParams(body) } : {})
        });
        const setCookie = response.headers.get('set-cookie');
        if (setCookie) cookie = setCookie.split(';')[0];
        return response;
    }
    const token = (html) => {
        const result = html.match(/name="_csrf" value="([^"]+)"/);
        assert.ok(result, 'Token CSRF presente no HTML');
        return result[1];
    };
    const health = await request(0, '/health');
    assert.deepEqual(await health.json(), { status: 'ok' });
    assert.equal(health.headers.get('set-cookie'), null);
    const User = mongoose.model('users');
    const user = await User.create({ name: 'Teste Vercel', email: 'vercel@example.test',
        password: await bcrypt.hash('TesteSeguro123!', 4) });
    const login = await request(0, '/users/login');
    assert.equal(login.status, 200);
    assert.match(login.headers.get('cache-control'), /no-store/);
    assert.match(login.headers.get('set-cookie'), /Secure/);
    const loginToken = token(await login.text());
    const logged = await request(1, '/users/login', { _csrf: loginToken,
        email: user.email, password: 'TesteSeguro123!', 'g-recaptcha-response': 'teste' });
    assert.equal(logged.status, 302);
    assert.equal(logged.headers.get('location'), '/');
    const profile = await request(0, '/users/profile');
    assert.equal(profile.status, 200);
    const html = await profile.text();
    assert.ok(html.includes('Teste Vercel'));
    const edited = await request(1, '/users/profile/edit', {
        _csrf: token(html), name: 'Sessão Compartilhada', email: user.email,
        profession: 'Testes', bio: 'Sessão persistida no MongoDB'
    });
    assert.equal(edited.status, 302);
    assert.equal((await User.findById(user._id)).name, 'Sessão Compartilhada');
    assert.ok(await mongoose.connection.db.collection('sessions').countDocuments() > 0);
    console.log('OK: importação, conexão concorrente, health, templates, login e CSRF entre instâncias.');

    const { MongoRateLimitStore } = await import('../../src/config/rate-limit.js');
    const stores = [new MongoRateLimitStore('teste'), new MongoRateLimitStore('teste')];
    stores.forEach((store) => store.init({ windowMs: 60 * 60 * 1000 }));
    const counts = await Promise.all(Array.from({ length: 20 }, (_, i) => stores[i % 2].increment('ip-teste')));
    assert.deepEqual(counts.map((item) => item.totalHits).sort((a, b) => a - b), Array.from({ length: 20 }, (_, i) => i + 1));
    await stores[0].decrement('ip-teste');
    assert.equal((await stores[1].increment('ip-teste')).totalHits, 20);
    await stores[0].resetKey('ip-teste');
    assert.equal((await stores[1].increment('ip-teste')).totalHits, 1);
    const indexes = await mongoose.connection.db.collection('rate_limits').indexes();
    assert.ok(indexes.some((index) => index.expireAfterSeconds === 0));
    console.log('OK: contadores atômicos compartilhados, decremento, reset e expiração TTL.');

    // Falhas de login retornam 200; mesmo assim devem contar contra força bruta.
    const loginAgain = await request(0, '/users/login');
    const csrf = token(await loginAgain.text());
    for (let i = 0; i < 5; i++) {
        assert.equal((await request(i % 2, '/users/login', { _csrf: csrf })).status, 200);
    }
    assert.equal((await request(1, '/users/login', { _csrf: csrf })).status, 429);
    const tooLarge = await request(0, '/users/login', { texto: 'x'.repeat(1024 * 1024 + 1) });
    assert.equal(tooLarge.status, 413);
    console.log('OK: bloqueio de login entre instâncias e payload excessivo rejeitado.');
} finally {
    process.chdir(originalCwd);
    globalThis.fetch = nativeFetch;
    await Promise.all(servers.map((server) => new Promise((resolve) => {
        server.close(resolve); server.closeAllConnections();
    })));
    await mongoose.disconnect();
    await mongo.stop();
}
