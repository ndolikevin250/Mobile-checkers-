const mongoose = require('mongoose');

const friendshipSchema = new mongoose.Schema({
    requester: { type: String, required: true },      // username who sent the request
    recipient: { type: String, required: true },       // username who received the request
    status: {
        type: String,
        enum: ['pending', 'accepted', 'blocked'],
        default: 'pending'
    },
    createdAt: { type: Date, default: Date.now },
    acceptedAt: { type: Date }
});

// Compound index: one friendship record per pair, fast lookups both ways
friendshipSchema.index({ requester: 1, recipient: 1 }, { unique: true });
friendshipSchema.index({ recipient: 1, status: 1 });
friendshipSchema.index({ requester: 1, status: 1 });

const Friendship = mongoose.model('Friendship', friendshipSchema);

module.exports = Friendship;
