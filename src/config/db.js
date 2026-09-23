import 'dotenv/config';

// Em produção (Render/Vercel) usamos MONGO_URI_PROD; localmente, MONGO_URI_DEV.
// MONGO_URI é aceita como nome genérico caso o ambiente defina apenas ela.
function resolveMongoURI() {
    const isProduction = process.env.NODE_ENV === "production";
    const uri = isProduction
        ? process.env.MONGO_URI_PROD || process.env.MONGO_URI
        : process.env.MONGO_URI_DEV || process.env.MONGO_URI;

    if (!uri) {
        const esperada = isProduction ? "MONGO_URI_PROD" : "MONGO_URI_DEV";
        throw new Error(
            `Variável de ambiente ${esperada} não definida. Configure-a no .env local ou no painel do Render/Vercel.`
        );
    }

    return { mongoURI: uri };
}

export default resolveMongoURI();

// Uma conexão/promise por instância aquecida; requisições concorrentes aguardam
// a mesma tentativa. Uma falha libera uma nova tentativa na próxima requisição.
let conexaoPendente;
export async function conectarBanco() {
    const { default: mongoose } = await import('mongoose');
    if (mongoose.connection.readyState === 1) return mongoose.connection;
    if (!conexaoPendente) {
        mongoose.set('strictQuery', true);
        conexaoPendente = mongoose.connect(resolveMongoURI().mongoURI, {
            maxPoolSize: 5,
            minPoolSize: 0,
            maxIdleTimeMS: 10000,
            serverSelectionTimeoutMS: 10000,
            connectTimeoutMS: 10000,
            socketTimeoutMS: 20000
        }).then(() => mongoose.connection).finally(() => {
            conexaoPendente = null;
        });
    }
    return conexaoPendente;
}
