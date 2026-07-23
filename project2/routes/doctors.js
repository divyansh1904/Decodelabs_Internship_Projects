const express = require('express');
const User = require('../models/User');
const Availability = require('../models/Availability');
const Appointment = require('../models/Appointment');
const auth = require('../middleware/auth');

const router = express.Router();

// Get all doctors
router.get('/', async (req, res) => {
  try {
    const doctors = await User.find({ role: 'doctor' })
      .select('name email specialization createdAt')
      .sort('name');
    
    res.json(doctors);
  } catch (err) {
    console.error('Fetch doctors error:', err);
    res.status(500).json({ error: 'Failed to fetch doctors' });
  }
});

// Get doctor by ID
router.get('/:id', async (req, res) => {
  const { id } = req.params;
  
  try {
    const doctor = await User.findOne({ _id: id, role: 'doctor' })
      .select('name email specialization createdAt');
    
    if (!doctor) {
      return res.status(404).json({ error: 'Doctor not found' });
    }
    
    res.json(doctor);
  } catch (err) {
    console.error('Fetch doctor error:', err);
    res.status(500).json({ error: 'Failed to fetch doctor' });
  }
});

// Get doctor availability
router.get('/:id/availability', async (req, res) => {
  const { id } = req.params;
  
  try {
    const availability = await Availability.find({ doctorId: id })
      .sort('dayOfWeek startTime');
    
    res.json(availability);
  } catch (err) {
    console.error('Fetch availability error:', err);
    res.status(500).json({ error: 'Failed to fetch availability' });
  }
});

// Set doctor availability
router.post('/availability', auth, async (req, res) => {
  const { doctorId, availability } = req.body;
  
  if (req.user.role !== 'doctor' || req.user.id !== doctorId) {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  
  try {
    // Delete existing availability
    await Availability.deleteMany({ doctorId });
    
    // Insert new availability
    const availabilityDocs = availability.map(slot => ({
      doctorId,
      dayOfWeek: slot.dayOfWeek,
      startTime: slot.startTime,
      endTime: slot.endTime,
      isAvailable: true
    }));
    
    await Availability.insertMany(availabilityDocs);
    
    res.json({ message: 'Availability updated successfully' });
  } catch (err) {
    console.error('Update availability error:', err);
    res.status(500).json({ error: 'Failed to update availability' });
  }
});

// Get available time slots
router.get('/:id/available-slots', async (req, res) => {
  const { id } = req.params;
  const { date } = req.query;
  
  try {
    const selectedDate = new Date(date);
    const dayOfWeek = selectedDate.getDay();
    
    // Get doctor's availability for the day
    const availability = await Availability.findOne({
      doctorId: id,
      dayOfWeek
    });
    
    if (!availability) {
      return res.json([]);
    }
    
    // Get booked appointments for that date
    const bookedAppointments = await Appointment.find({
      doctorId: id,
      date: {
        $gte: new Date(selectedDate.setHours(0, 0, 0, 0)),
        $lt: new Date(selectedDate.setHours(23, 59, 59, 999))
      },
      status: { $ne: 'cancelled' }
    });
    
    const bookedTimes = bookedAppointments.map(apt => apt.time);
    
    // Generate available time slots (30-minute intervals)
    const slots = [];
    const startTime = availability.startTime;
    const endTime = availability.endTime;
    
    let current = new Date(`2000-01-01 ${startTime}`);
    const end = new Date(`2000-01-01 ${endTime}`);
    
    while (current < end) {
      const timeString = current.toTimeString().slice(0, 5);
      if (!bookedTimes.includes(timeString)) {
        slots.push(timeString);
      }
      current.setMinutes(current.getMinutes() + 30);
    }
    
    res.json(slots);
  } catch (err) {
    console.error('Fetch available slots error:', err);
    res.status(500).json({ error: 'Failed to fetch available slots' });
  }
});

module.exports = router;