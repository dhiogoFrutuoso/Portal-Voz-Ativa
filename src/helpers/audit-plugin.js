import { requestContext, origem } from './request-context.js';
import AuditLog from '../models/audit-log.js';
export function auditPlugin(schema) {
    for (const op of ['findOneAndUpdate', 'updateOne', 'findOneAndDelete', 'deleteOne']) {
        schema.pre(op, async function () {
            const req = requestContext.getStore()?.req;
            if (!req?.user?.areAdmin || req.method === 'GET') return;
            const session = await this.model.db.startSession();
            session.startTransaction();
            this.setOptions({ session });
            this._audit = { session, req, previous: null };
            this._audit.previous = await this.model.findOne(this.getFilter()).session(session).lean();
        });
        schema.post(op, async function () {
            const state = this._audit;
            if (!state) return;
            try {
                if (state.previous) {
                    const current = await this.model.findById(state.previous._id).session(state.session).lean();
                    await AuditLog.create([{ adminId: state.req.user._id,
                        action: `${state.req.method} ${state.req.path}`,
                        targetCollection: this.model.collection.name, targetId: state.previous._id,
                        previousState: state.previous, newState: current,
                        ...origem(state.req) }], { session: state.session });
                }
                await state.session.commitTransaction();
            } catch (error) { await state.session.abortTransaction(); throw error; }
            finally { await state.session.endSession(); this._audit = null; }
        });
        schema.post(op, function (error, result, next) {
            const state = this._audit;
            if (!state) return next(error);
            state.session.abortTransaction().finally(() => state.session.endSession()).then(() => next(error), () => next(error));
        });
    }
}
// [Melhoria Proativa Adicionada: alteração administrativa e evidência são confirmadas na mesma transação]
