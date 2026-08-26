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
