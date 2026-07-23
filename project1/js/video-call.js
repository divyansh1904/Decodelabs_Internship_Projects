const express = require('express');
const Appointment = require('../models/Appointment');
const auth = require('../middleware/auth');

const router = express.Router();

// Validate if video call can be started
router.get('/validate/:meetingId', auth, async (req, res) => {
    const { meetingId } = req.params;
    const userId = req.user.id;
    
    try {
        const appointment = await Appointment.findOne({ meetingId });
        
        if (!appointment) {
            return res.status(404).json({ error: 'Appointment not found' });
        }
        
        // Check if user is authorized (patient or doctor in this appointment)
        const isAuthorized = (appointment.patientId.toString() === userId || 
                              appointment.doctorId.toString() === userId);
        
        if (!isAuthorized) {
            return res.status(403).json({ error: 'Unauthorized access' });
        }
        
        const now = new Date();
        const appointmentDateTime = new Date(appointment.date);
        const [hours, minutes] = appointment.time.split(':');
        appointmentDateTime.setHours(parseInt(hours), parseInt(minutes), 0);
        
        const timeDiff = (appointmentDateTime - now) / (1000 * 60); // difference in minutes
        const canStart = timeDiff <= 15 && timeDiff >= -30; // Can start 15 min before and up to 30 min after
        
        res.json({
            canStart,
            timeDiff: Math.round(timeDiff),
            appointmentTime: appointmentDateTime,
            appointmentDate: appointment.date,
            appointmentTimeStr: appointment.time,
            status: appointment.status,
            message: canStart ? 
                'Video call is available now' : 
                (timeDiff > 15 ? `Video call will be available in ${Math.round(timeDiff)} minutes` :
                 timeDiff < -30 ? 'This appointment time has passed' :
                 'Video call is only available 15 minutes before and 30 minutes after appointment time')
        });
    } catch (error) {
        console.error('Validation error:', error);
        res.status(500).json({ error: 'Failed to validate appointment' });
    }
});

// Get upcoming appointments for reminders
router.get('/upcoming/:userId', auth, async (req, res) => {
    const { userId } = req.params;
    const role = req.user.role;
    
    try {
        const now = new Date();
        const query = {
            status: 'scheduled',
            date: { $gte: now }
        };
        
        if (role === 'patient') {
            query.patientId = userId;
        } else {
            query.doctorId = userId;
        }
        
        const appointments = await Appointment.find(query)
            .sort({ date: 1, time: 1 })
            .limit(5);
        
        // Calculate time until each appointment
        const appointmentsWithCountdown = appointments.map(apt => {
            const aptDateTime = new Date(apt.date);
            const [hours, minutes] = apt.time.split(':');
            aptDateTime.setHours(parseInt(hours), parseInt(minutes), 0);
            const minutesUntil = Math.round((aptDateTime - now) / (1000 * 60));
            
            return {
                ...apt.toObject(),
                minutesUntil,
                canJoin: minutesUntil <= 15 && minutesUntil >= -30
            };
        });
        
        res.json(appointmentsWithCountdown);
    } catch (error) {
        console.error('Error fetching upcoming appointments:', error);
        res.status(500).json({ error: 'Failed to fetch upcoming appointments' });
    }
});

module.exports = router;