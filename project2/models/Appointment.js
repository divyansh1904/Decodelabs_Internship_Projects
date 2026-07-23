const mongoose = require('mongoose');

const appointmentSchema = new mongoose.Schema({
    patientId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    doctorId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    patientName: {
        type: String,
        required: true
    },
    doctorName: {
        type: String,
        required: true
    },
    date: {
        type: Date,
        required: true
    },
    time: {
        type: String,
        required: true
    },
    status: {
        type: String,
        enum: ['pending', 'scheduled', 'completed', 'cancelled'],
        default: 'pending'
    },
    meetingId: {
        type: String,
        unique: true,
        required: true
    },
    symptoms: {
        type: String,
        default: ''
    },
    prescription: {
        type: String,
        default: ''
    },
    notes: {
        type: String,
        default: ''
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
}, {
    timestamps: true
});

// Remove manual index creation - let mongoose handle via 'unique' and 'ref'

module.exports = mongoose.model('Appointment', appointmentSchema);