import { createHash } from 'node:crypto';
import mongoose from 'mongoose';
import rateLimit from 'express-rate-limit';

// Janelas fixas compartilhadas por todas as instâncias. TTL é executado pelo
// MongoDB, sem temporizadores de limpeza que dependam de um servidor permanente.
export class MongoRateLimitStore {
    constructor(prefix) { this.prefix = prefix; }
    init({ windowMs }) { this.windowMs = windowMs; }
    async collection() {
        const db = mongoose.connection.db;
        if (!db) throw new Error('Banco indisponível para limitar requisições.');
        if (this.db !== db) {
            this.db = db;
            this.indexReady = db.collection('rate_limits').createIndex(
                { expiresAt: 1 }, { expireAfterSeconds: 0 }
            ).catch((error) => { this.db = null; throw error; });
        }
        await this.indexReady;
        return db.collection('rate_limits');
    }
    window(key) {
        const bucket = Math.floor(Date.now() / this.windowMs);
        const hash = createHash('sha256').update(key).digest('hex');
        return {
            id: `${this.prefix}:${hash}:${bucket}`,
            resetTime: new Date((bucket + 1) * this.windowMs)
        };
    }
    async increment(key) {
        const collection = await this.collection();
        const { id, resetTime } = this.window(key);
        const update = {
            $inc: { totalHits: 1 },
            $setOnInsert: { expiresAt: resetTime }
        };
        let result;
        try {
            result = await collection.findOneAndUpdate({ _id: id }, update, {
                upsert: true, returnDocument: 'after'
            });
        } catch (error) {
            // Duas instâncias podem tentar criar a primeira entrada juntas.
            if (error.code !== 11000) throw error;
            result = await collection.findOneAndUpdate({ _id: id }, update, { returnDocument: 'after' });
        }
        return { totalHits: result.value.totalHits, resetTime };
    }
    async decrement(key) {
        const collection = await this.collection();
        await collection.updateOne({ _id: this.window(key).id, totalHits: { $gt: 0 } }, { $inc: { totalHits: -1 } });
    }
    async resetKey(key) {
        const collection = await this.collection();
        await collection.deleteOne({ _id: this.window(key).id });
    }
}

export const limitarRequisicoes = (prefix, options) => rateLimit({
    ...options,
    standardHeaders: true,
    legacyHeaders: false,
    store: new MongoRateLimitStore(prefix)
});
