const express = require('express');
const { v4: uuidv4 } = require('uuid');
const Appointment = require('../models/Appointment');
const User = require('../models/User');
const auth = require('../middleware/auth');

const router = express.Router();

// Book appointment
router.post('/book', auth, async (req, res) => {
  const { doctorId, date, time, symptoms } = req.body;
  const patientId = req.user.id;
  
  try {
    // Get doctor info
    const doctor = await User.findById(doctorId);
    if (!doctor || doctor.role !== 'doctor') {
      return res.status(404).json({ error: 'Doctor not found' });
    }
    
    // Get patient info
    const patient = await User.findById(patientId);
    if (!patient) {
      return res.status(404).json({ error: 'Patient not found' });
    }
    
    // Check if appointment already exists for this time slot
    const existingAppointment = await Appointment.findOne({
      doctorId,
      date: new Date(date),
      time,
      status: { $ne: 'cancelled' }
    });
    
    if (existingAppointment) {
      return res.status(400).json({ error: 'This time slot is already booked' });
    }
    
    const meetingId = uuidv4();
    
    // Create appointment
    const appointment = new Appointment({
      patientId,
      doctorId,
      patientName: patient.name,
      doctorName: doctor.name,
      date: new Date(date),
      time,
      symptoms,
      meetingId,
      status: 'scheduled'
    });
    
    await appointment.save();
    
    res.status(201).json({ appointment, meetingId });
  } catch (err) {
    console.error('Booking error:', err);
    res.status(500).json({ error: 'Failed to book appointment' });
  }
});

// Get user's appointments
router.get('/my-appointments', auth, async (req, res) => {
  const userId = req.user.id;
  const role = req.user.role;
  
  try {
    let query = {};
    
    if (role === 'patient') {
      query = { patientId: userId };
    } else {
      query = { doctorId: userId };
    }
    
    const appointments = await Appointment.find(query)
      .sort({ date: -1, time: -1 });
    
    res.json(appointments);
  } catch (err) {
    console.error('Fetch appointments error:', err);
    res.status(500).json({ error: 'Failed to fetch appointments' });
  }
});

// Update appointment status
router.put('/:id/status', auth, async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  
  try {
    const appointment = await Appointment.findByIdAndUpdate(
      id,
      { status },
      { new: true }
    );
    
    if (!appointment) {
      return res.status(404).json({ error: 'Appointment not found' });
    }
    
    res.json({ message: 'Appointment updated successfully', appointment });
  } catch (err) {
    console.error('Update error:', err);
    res.status(500).json({ error: 'Failed to update appointment' });
  }
});

// Get appointment by meeting ID
router.get('/meeting/:meetingId', auth, async (req, res) => {
  const { meetingId } = req.params;
  
  try {
    const appointment = await Appointment.findOne({ meetingId });
    
    if (!appointment) {
      return res.status(404).json({ error: 'Appointment not found' });
    }
    
    res.json(appointment);
  } catch (err) {
    console.error('Fetch meeting error:', err);
    res.status(500).json({ error: 'Failed to fetch meeting details' });
  }
});

// Add prescription to appointment
router.post('/:id/prescription', auth, async (req, res) => {
  const { id } = req.params;
  const { prescription, notes } = req.body;
  
  try {
    const appointment = await Appointment.findByIdAndUpdate(
      id,
      { prescription, notes },
      { new: true }
    );
    
    if (!appointment) {
      return res.status(404).json({ error: 'Appointment not found' });
    }
    
    res.json({ message: 'Prescription added successfully', appointment });
  } catch (err) {
    console.error('Prescription error:', err);
    res.status(500).json({ error: 'Failed to add prescription' });
  }
});

module.exports = router;