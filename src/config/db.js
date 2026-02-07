import 'dotenv/config';

async function db() {
    if (process.env.NODE_ENV === "production") {
        return { mongoURI: process.env.MONGO_URI_PROD };
    } else {
        return { mongoURI: process.env.MONGO_URI_DEV };
    }
}

export default await db();