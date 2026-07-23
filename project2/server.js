
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

app.use(cors());
app.use(express.json());

// -------------------- Configuration --------------------
const JWT_SECRET = 'doctime_super_secret_key_2026_change_in_production';

// -------------------- MongoDB Connection --------------------
mongoose.connect('mongodb://127.0.0.1:27017/telemedicine')
  .then(() => console.log('📦 Connected to MongoDB (telemedicine database)'))
  .catch(err => console.error('MongoDB connection error:', err));

// -------------------- Mongoose Schemas --------------------
const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: { type: String, enum: ['patient', 'doctor'], default: 'patient' },
  specialization: { type: String, default: '' }
}, { 
  timestamps: true 
});

const User = mongoose.model('User', userSchema);

// -------------------- In-Memory Databases --------------------
// (Appointments and Availability kept in-memory for now)
let appointments = [];
let doctorAvailability = [];

// Helper functions
function generateToken(user) {
  return jwt.sign(
    { id: user._id, email: user.email, role: user.role },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

// Authentication middleware
function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.id;
    req.userRole = decoded.role;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// -------------------- Auth Routes --------------------
app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, password, role, specialization } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Name, email and password are required' });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ error: 'Email already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = new User({
      name,
      email,
      password: hashedPassword,
      role: role || 'patient',
      specialization: role === 'doctor' ? (specialization || 'General Physician') : ''
    });

    await newUser.save();
    
    const token = generateToken(newUser);
    const userWithoutPassword = newUser.toObject();
    delete userWithoutPassword.password;

    res.status(201).json({ token, user: userWithoutPassword });
  } catch (err) {
    res.status(500).json({ error: 'Server error during registration' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = generateToken(user);
    const userWithoutPassword = user.toObject();
    delete userWithoutPassword.password;

    res.json({ token, user: userWithoutPassword });
  } catch (err) {
    res.status(500).json({ error: 'Server error during login' });
  }
});

app.get('/api/auth/me', authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select('-password');
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: 'Server error fetching user profile' });
  }
});

// -------------------- Doctors Routes --------------------
app.get('/api/doctors', async (req, res) => {
  try {
    const doctors = await User.find({ role: 'doctor' }).select('-password');
    res.json(doctors);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error while fetching doctors' });
  }
});

app.get('/api/doctors/:doctorId/availability', (req, res) => {
  const slots = doctorAvailability.filter(a => a.doctorId === req.params.doctorId);
  res.json(slots);
});

app.get('/api/doctors/:doctorId/available-slots', async (req, res) => {
  try {
    const { doctorId } = req.params;
    const { date } = req.query;

    const doctor = await User.findById(doctorId);
    if (!doctor || doctor.role !== 'doctor') {
      return res.status(404).json({ error: 'Doctor not found' });
    }

    const availability = doctorAvailability.filter(a => a.doctorId === doctorId);
    const dayOfWeek = new Date(date).getDay();

    const daySlots = availability.filter(a => a.day_of_week === dayOfWeek);
    
    // 🚀 Return all generated slots for the doctor's shift (no collision filtering)
    const slots = daySlots.flatMap(slot => generateTimeSlots(slot.start_time, slot.end_time));

    res.json(slots);
  } catch (err) {
    res.status(500).json({ error: 'Server error fetching slots' });
  }
});

function generateTimeSlots(startTime, endTime, intervalMinutes = 30) {
  const slots = [];
  let start = parseTime(startTime);
  const end = parseTime(endTime);

  while (start < end) {
    slots.push(formatTimeSlot(start));
    start = new Date(start.getTime() + intervalMinutes * 60000);
  }
  return slots;
}

function parseTime(timeStr) {
  const [hours, minutes] = timeStr.split(':').map(Number);
  const date = new Date();
  date.setHours(hours, minutes, 0, 0);
  return date;
}

function formatTimeSlot(date) {
  const hours = date.getHours();
  const minutes = date.getMinutes();
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
}

app.post('/api/doctors/availability', authenticate, (req, res) => {
  if (req.userRole !== 'doctor') {
    return res.status(403).json({ error: 'Only doctors can set availability' });
  }

  const { doctorId, availability } = req.body;

  if (req.userId !== doctorId) {
    return res.status(403).json({ error: 'You can only set your own availability' });
  }

  doctorAvailability = doctorAvailability.filter(a => a.doctorId !== doctorId);

  const newSlots = availability.map(slot => ({
    doctorId,
    day_of_week: slot.dayOfWeek,
    start_time: slot.startTime,
    end_time: slot.endTime
  }));

  doctorAvailability.push(...newSlots);
  res.json({ message: 'Availability saved successfully', slots: newSlots });
});

// -------------------- Appointments Routes --------------------
app.post('/api/appointments/book', authenticate, async (req, res) => {
  try {
    const { doctorId, date, time, symptoms } = req.body;

    if (!doctorId || !date || !time) {
      return res.status(400).json({ error: 'Doctor, date and time are required' });
    }

    const patient = await User.findById(req.userId);
    if (!patient || patient.role !== 'patient') {
      return res.status(403).json({ error: 'Only patients can book appointments' });
    }

    const doctor = await User.findById(doctorId);
    if (!doctor || doctor.role !== 'doctor') {
      return res.status(404).json({ error: 'Doctor not found' });
    }

    // 🚀 Existing appointment conflict check has been removed here!
    
    const meetingId = `meet_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`;

    const newAppointment = {
      id: Date.now(),
      patient_id: patient._id.toString(),
      patient_name: patient.name,
      doctor_id: doctor._id.toString(),
      doctor_name: doctor.name,
      date,
      time,
      symptoms: symptoms || '',
      status: 'scheduled',
      meeting_id: meetingId,
      prescription: null,
      created_at: new Date().toISOString()
    };

    appointments.push(newAppointment);
    res.status(201).json(newAppointment);
  } catch (err) {
    res.status(500).json({ error: 'Server error booking appointment' });
  }
});

app.get('/api/appointments/my-appointments', authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    let userAppointments;
    if (user.role === 'patient') {
      userAppointments = appointments.filter(a => a.patient_id === user._id.toString());
    } else {
      userAppointments = appointments.filter(a => a.doctor_id === user._id.toString());
    }

    userAppointments.sort((a, b) => new Date(b.date) - new Date(a.date));
    res.json(userAppointments);
  } catch (err) {
    res.status(500).json({ error: 'Server error fetching appointments' });
  }
});

app.put('/api/appointments/:id/status', authenticate, async (req, res) => {
  try {
    const { status } = req.body;
    const appointmentId = parseInt(req.params.id);

    const appointment = appointments.find(a => a.id === appointmentId);
    if (!appointment) {
      return res.status(404).json({ error: 'Appointment not found' });
    }

    const user = await User.findById(req.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (user.role === 'patient' && appointment.patient_id !== user._id.toString()) {
      return res.status(403).json({ error: 'You can only cancel your own appointments' });
    }

    if (user.role === 'doctor' && appointment.doctor_id !== user._id.toString()) {
      return res.status(403).json({ error: 'You can only modify your own appointments' });
    }

    const validStatuses = ['scheduled', 'completed', 'cancelled', 'pending'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    appointment.status = status;
    res.json(appointment);
  } catch (err) {
    res.status(500).json({ error: 'Server error updating status' });
  }
});

app.post('/api/appointments/:id/prescription', authenticate, (req, res) => {
  if (req.userRole !== 'doctor') {
    return res.status(403).json({ error: 'Only doctors can add prescriptions' });
  }

  const appointmentId = parseInt(req.params.id);
  const appointment = appointments.find(a => a.id === appointmentId);

  if (!appointment) {
    return res.status(404).json({ error: 'Appointment not found' });
  }

  if (appointment.doctor_id !== req.userId) {
    return res.status(403).json({ error: 'You can only add prescriptions for your own patients' });
  }

  const { prescriptionText, notes } = req.body;
  appointment.prescription = {
    text: prescriptionText,
    notes: notes || '',
    date: new Date().toISOString()
  };

  res.json(appointment);
});

// -------------------- Socket.io for Video Call Signaling --------------------
const rooms = new Map();

io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);

  socket.on('join-room', ({ meetingId, userId, userName }) => {
    socket.join(meetingId);
    socket.meetingId = meetingId;
    socket.userId = userId;

    if (!rooms.has(meetingId)) {
      rooms.set(meetingId, new Set());
    }
    rooms.get(meetingId).add(socket.id);

    socket.to(meetingId).emit('user-joined', { userId, userName });
    console.log(`User ${userId} joined room ${meetingId}`);
  });

  socket.on('offer', ({ meetingId, offer }) => {
    socket.to(meetingId).emit('offer', { offer });
  });

  socket.on('answer', ({ meetingId, answer }) => {
    socket.to(meetingId).emit('answer', { answer });
  });

  socket.on('ice-candidate', ({ meetingId, candidate }) => {
    socket.to(meetingId).emit('ice-candidate', { candidate });
  });

  socket.on('chat-message', ({ meetingId, sender, text }) => {
    socket.to(meetingId).emit('chat-message', { sender, text });
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);

    if (socket.meetingId) {
      const room = rooms.get(socket.meetingId);
      if (room) {
        room.delete(socket.id);
        socket.to(socket.meetingId).emit('user-disconnected');
        if (room.size === 0) {
          rooms.delete(socket.meetingId);
        }
      }
    }
  });
});

// -------------------- Seed Demo Data (MongoDB) --------------------
async function seedDemoData() {
  try {
    const userCount = await User.countDocuments();
    
    if (userCount === 0) {
      console.log('🌱 Seeding database with initial users...');
      const demoUsers = [
        {
          name: 'Sarah Rahman',
          email: 'doctor@example.com',
          password: await bcrypt.hash('pass123', 10),
          role: 'doctor',
          specialization: 'Cardiologist'
        },
        {
          name: 'Mark Kumar',
          email: 'mark@example.com',
          password: await bcrypt.hash('pass123', 10),
          role: 'doctor',
          specialization: 'Pediatrician'
        },
        {
          name: 'Emma Patient',
          email: 'patient@example.com',
          password: await bcrypt.hash('pass123', 10),
          role: 'patient',
          specialization: ''
        }
      ];
      
      const createdUsers = await User.insertMany(demoUsers);
      const doc1 = createdUsers[0]._id.toString();
      const doc2 = createdUsers[1]._id.toString();
      const pat1 = createdUsers[2]._id.toString();

      // Seed Availability
      doctorAvailability.push(
        { doctorId: doc1, day_of_week: 1, start_time: '09:00', end_time: '17:00' },
        { doctorId: doc1, day_of_week: 3, start_time: '09:00', end_time: '17:00' },
        { doctorId: doc2, day_of_week: 1, start_time: '10:00', end_time: '18:00' }
      );

      // Seed Appointments
      appointments.push({
        id: 1001,
        patient_id: pat1,
        patient_name: 'Emma Patient',
        doctor_id: doc1,
        doctor_name: 'Sarah Rahman',
        date: new Date(Date.now() + 86400000).toISOString().split('T')[0],
        time: '10:00',
        symptoms: 'Chest discomfort when exercising',
        status: 'scheduled',
        meeting_id: 'meet_demo_123',
        prescription: null,
        created_at: new Date().toISOString()
      });
      
      console.log('✅ Database seeded successfully!');
    }
  } catch (err) {
    console.error('Error seeding data:', err);
  }
}

// Ensure connection is established before seeding
mongoose.connection.once('open', () => {
  seedDemoData();
});

// -------------------- Start Server --------------------
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📋 API endpoints available at http://localhost:${PORT}/api`);
  console.log(`🔌 WebSocket server ready for video calls`);
});
