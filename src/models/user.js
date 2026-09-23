import mongoose from 'mongoose';

const userSchema = mongoose.Schema({
    isVerified: { type: Boolean, default: false },
    tokenVersion: { type: Number, default: 0 },
    acceptedTermsAt: { type: Date, immutable: true },
    termsVersion: { type: String, immutable: true },
    name: {
        type: String,
        required: true
    },
    email: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
        trim: true
    },
    password: {
        type: String,
        required: true
    },
    profession: {
        type: String,
        required: false,
        default: "Cidadão"
    },
    bio: {
        type: String,
        required: false
    },
    profileImage: {
        type: String,
        default: "/img/guest.webp"
    },
    areAdmin: {
        type: Boolean,
        default: false
    },
    date: {
        type: Date,
        default: Date.now
    }
});

mongoose.model('users', userSchema);

export default userSchema;
// [Melhoria Proativa Adicionada: campos e índices alinhados à governança e preservação de evidências]
