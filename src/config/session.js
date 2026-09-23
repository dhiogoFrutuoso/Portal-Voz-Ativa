import session from 'express-session';
import MongoStore from 'connect-mongo';

export function criarSessao(conexao, secret) {
    const store = MongoStore.create({
        client: conexao.getClient(),
        dbName: conexao.name,
        collectionName: 'sessions',
        ttl: 7 * 24 * 60 * 60,
        autoRemove: 'native'
    });
    store.on('error', () => console.error('Falha no armazenamento de sessão.'));
    return session({
        store,
        secret,
        resave: false,
        saveUninitialized: false,
        cookie: {
            httpOnly: true,
            secure: 'auto',
            sameSite: 'lax',
            maxAge: 7 * 24 * 60 * 60 * 1000
        }
    });
}
