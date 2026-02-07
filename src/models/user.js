import mongoose from 'mongoose';

const userSchema = mongoose.Schema({ 
    name: {
        type: String,
        required: true 
    },
    email: {
        type: String,
        required: true,
        unique: true 
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
        default: "/img/guest.jpg" 
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