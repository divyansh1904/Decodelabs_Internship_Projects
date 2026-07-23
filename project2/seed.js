const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const bcrypt = require('bcryptjs');

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

// -------------------- In-Memory Databases --------------------
let users = [];
let appointments = [];
let doctorAvailability = [];

// Helper functions
function findUserByEmail(email) {
  return users.find(u => u.email === email);
}

function findUserById(id) {
  return users.find(u => u.id === id);
}

function generateToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role },
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
  const { name, email, password, role, specialization } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Name, email and password are required' });
  }

  if (findUserByEmail(email)) {
    return res.status(400).json({ error: 'Email already exists' });
  }

  const hashedPassword = await bcrypt.hash(password, 10);
  const newUser = {
    id: Date.now().toString(),
    name,
    email,
    password: hashedPassword,
    role: role || 'patient',
    specialization: role === 'doctor' ? (specialization || 'General Physician') : '',
    created_at: new Date().toISOString()
  };

  users.push(newUser);
  const token = generateToken(newUser);
  const { password: _, ...userWithoutPassword } = newUser;

  res.status(201).json({ token, user: userWithoutPassword });
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const user = findUserByEmail(email);
  if (!user) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = generateToken(user);
  const { password: _, ...userWithoutPassword } = user;

  res.json({ token, user: userWithoutPassword });
});

app.get('/api/auth/me', authenticate, (req, res) => {
  const user = findUserById(req.userId);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  const { password, ...safeUser } = user;
  res.json(safeUser);
});

// -------------------- Doctors Routes --------------------
app.get('/api/doctors', (req, res) => {
  const doctors = users
    .filter(u => u.role === 'doctor')
    .map(({ password, ...doctor }) => doctor);
  res.json(doctors);
});

app.get('/api/doctors/:doctorId/availability', (req, res) => {
  const slots = doctorAvailability.filter(a => a.doctorId === req.params.doctorId);
  res.json(slots);
});

app.get('/api/doctors/:doctorId/available-slots', (req, res) => {
  const { doctorId } = req.params;
  const { date } = req.query;

  const doctor = findUserById(doctorId);
  if (!doctor || doctor.role !== 'doctor') {
    return res.status(404).json({ error: 'Doctor not found' });
  }

  const availability = doctorAvailability.filter(a => a.doctorId === doctorId);
  const dayOfWeek = new Date(date).getDay();

  const daySlots = availability.filter(a => a.day_of_week === dayOfWeek);
  const slots = daySlots.flatMap(slot => generateTimeSlots(slot.start_time, slot.end_time));

  // Filter out already booked slots for this date
  const bookedSlots = appointments
    .filter(a => a.doctor_id === doctorId && a.date === date && a.status === 'scheduled')
    .map(a => a.time);

  const availableSlots = slots.filter(slot => !bookedSlots.includes(slot));

  res.json(availableSlots);
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

  // Remove old slots for this doctor
  doctorAvailability = doctorAvailability.filter(a => a.doctorId !== doctorId);

  // Add new slots
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
  const { doctorId, date, time, symptoms } = req.body;

  if (!doctorId || !date || !time) {
    return res.status(400).json({ error: 'Doctor, date and time are required' });
  }

  const patient = findUserById(req.userId);
  if (!patient || patient.role !== 'patient') {
    return res.status(403).json({ error: 'Only patients can book appointments' });
  }

  const doctor = findUserById(doctorId);
  if (!doctor || doctor.role !== 'doctor') {
    return res.status(404).json({ error: 'Doctor not found' });
  }

  // Check if slot is already booked
  const existingAppointment = appointments.find(
    a => a.doctor_id === doctorId && a.date === date && a.time === time && a.status === 'scheduled'
  );

  if (existingAppointment) {
    return res.status(409).json({ error: 'This time slot is already booked' });
  }

  const meetingId = `meet_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`;

  const newAppointment = {
    id: Date.now(),
    patient_id: patient.id,
    patient_name: patient.name,
    doctor_id: doctor.id,
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
});

app.get('/api/appointments/my-appointments', authenticate, (req, res) => {
  const user = findUserById(req.userId);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  let userAppointments;
  if (user.role === 'patient') {
    userAppointments = appointments.filter(a => a.patient_id === user.id);
  } else {
    userAppointments = appointments.filter(a => a.doctor_id === user.id);
  }

  // Sort by date (most recent first)
  userAppointments.sort((a, b) => new Date(b.date) - new Date(a.date));

  res.json(userAppointments);
});

app.put('/api/appointments/:id/status', authenticate, (req, res) => {
  const { status } = req.body;
  const appointmentId = parseInt(req.params.id);

  const appointment = appointments.find(a => a.id === appointmentId);
  if (!appointment) {
    return res.status(404).json({ error: 'Appointment not found' });
  }

  const user = findUserById(req.userId);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  // Authorization check
  if (user.role === 'patient' && appointment.patient_id !== user.id) {
    return res.status(403).json({ error: 'You can only cancel your own appointments' });
  }

  if (user.role === 'doctor' && appointment.doctor_id !== user.id) {
    return res.status(403).json({ error: 'You can only modify your own appointments' });
  }

  // Validate status transition
  const validStatuses = ['scheduled', 'completed', 'cancelled', 'pending'];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  appointment.status = status;
  res.json(appointment);
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

    // Notify others in the room
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

// -------------------- Enhanced Seed Database Function --------------------
function seedDatabase() {
  console.log('🌱 Seeding database with doctors, patients, and appointments...');

  // Clear existing data
  users = [];
  appointments = [];
  doctorAvailability = [];

  // Doctor data with detailed profiles
  const doctorsList = [
    {
      id: 'doc_001',
      name: 'Dr. Sarah Chen',
      email: 'sarah.chen@example.com',
      password: bcrypt.hashSync('doctor123', 10),
      role: 'doctor',
      specialization: 'Cardiologist',
      experience: 15,
      rating: 4.9,
      about: 'Specialized in interventional cardiology with 15+ years of experience',
      location: 'New York, NY',
      created_at: new Date().toISOString()
    },
    {
      id: 'doc_002',
      name: 'Dr. Michael Rodriguez',
      email: 'michael.rodriguez@example.com',
      password: bcrypt.hashSync('doctor123', 10),
      role: 'doctor',
      specialization: 'Neurologist',
      experience: 12,
      rating: 4.8,
      about: 'Expert in stroke management and neurodegenerative disorders',
      location: 'Los Angeles, CA',
      created_at: new Date().toISOString()
    },
    {
      id: 'doc_003',
      name: 'Dr. Emily Watson',
      email: 'emily.watson@example.com',
      password: bcrypt.hashSync('doctor123', 10),
      role: 'doctor',
      specialization: 'Pediatrician',
      experience: 10,
      rating: 4.9,
      about: 'Dedicated to children\'s health and developmental care',
      location: 'Chicago, IL',
      created_at: new Date().toISOString()
    },
    {
      id: 'doc_004',
      name: 'Dr. James Liu',
      email: 'james.liu@example.com',
      password: bcrypt.hashSync('doctor123', 10),
      role: 'doctor',
      specialization: 'Dermatologist',
      experience: 8,
      rating: 4.7,
      about: 'Specialized in cosmetic and medical dermatology',
      location: 'Houston, TX',
      created_at: new Date().toISOString()
    },
    {
      id: 'doc_005',
      name: 'Dr. Priya Sharma',
      email: 'priya.sharma@example.com',
      password: bcrypt.hashSync('doctor123', 10),
      role: 'doctor',
      specialization: 'Orthopedic Surgeon',
      experience: 14,
      rating: 4.9,
      about: 'Sports medicine and joint replacement specialist',
      location: 'Phoenix, AZ',
      created_at: new Date().toISOString()
    },
    {
      id: 'doc_006',
      name: 'Dr. David Kim',
      email: 'david.kim@example.com',
      password: bcrypt.hashSync('doctor123', 10),
      role: 'doctor',
      specialization: 'Psychiatrist',
      experience: 11,
      rating: 4.8,
      about: 'Mental health expert specializing in anxiety and depression',
      location: 'Philadelphia, PA',
      created_at: new Date().toISOString()
    },
    {
      id: 'doc_007',
      name: 'Dr. Lisa Thompson',
      email: 'lisa.thompson@example.com',
      password: bcrypt.hashSync('doctor123', 10),
      role: 'doctor',
      specialization: 'Ophthalmologist',
      experience: 9,
      rating: 4.8,
      about: 'Comprehensive eye care and laser surgery',
      location: 'San Antonio, TX',
      created_at: new Date().toISOString()
    },
    {
      id: 'doc_008',
      name: 'Dr. Robert Garcia',
      email: 'robert.garcia@example.com',
      password: bcrypt.hashSync('doctor123', 10),
      role: 'doctor',
      specialization: 'Gastroenterologist',
      experience: 13,
      rating: 4.7,
      about: 'Digestive health and endoscopic procedures',
      location: 'San Diego, CA',
      created_at: new Date().toISOString()
    }
  ];

  // Add doctors to database
  doctorsList.forEach(doctor => users.push(doctor));

  // Patient data
  const patientsList = [
    {
      id: 'pat_001',
      name: 'Emma Johnson',
      email: 'emma.johnson@example.com',
      password: bcrypt.hashSync('patient123', 10),
      role: 'patient',
      specialization: '',
      created_at: new Date().toISOString()
    },
    {
      id: 'pat_002',
      name: 'Liam Williams',
      email: 'liam.williams@example.com',
      password: bcrypt.hashSync('patient123', 10),
      role: 'patient',
      specialization: '',
      created_at: new Date().toISOString()
    },
    {
      id: 'pat_003',
      name: 'Sophia Brown',
      email: 'sophia.brown@example.com',
      password: bcrypt.hashSync('patient123', 10),
      role: 'patient',
      specialization: '',
      created_at: new Date().toISOString()
    },
    {
      id: 'pat_004',
      name: 'Oliver Jones',
      email: 'oliver.jones@example.com',
      password: bcrypt.hashSync('patient123', 10),
      role: 'patient',
      specialization: '',
      created_at: new Date().toISOString()
    },
    {
      id: 'pat_005',
      name: 'Isabella Garcia',
      email: 'isabella.garcia@example.com',
      password: bcrypt.hashSync('patient123', 10),
      role: 'patient',
      specialization: '',
      created_at: new Date().toISOString()
    }
  ];

  patientsList.forEach(patient => users.push(patient));

  // Doctor Availability Schedule (for each doctor, multiple days and time slots)
  const availabilitySchedule = [
    // Dr. Sarah Chen - Cardiologist
    { doctorId: 'doc_001', day_of_week: 1, start_time: '09:00', end_time: '17:00' },
    { doctorId: 'doc_001', day_of_week: 2, start_time: '09:00', end_time: '17:00' },
    { doctorId: 'doc_001', day_of_week: 3, start_time: '09:00', end_time: '17:00' },
    { doctorId: 'doc_001', day_of_week: 4, start_time: '09:00', end_time: '17:00' },
    { doctorId: 'doc_001', day_of_week: 5, start_time: '09:00', end_time: '15:00' },
    
    // Dr. Michael Rodriguez - Neurologist
    { doctorId: 'doc_002', day_of_week: 1, start_time: '10:00', end_time: '18:00' },
    { doctorId: 'doc_002', day_of_week: 3, start_time: '10:00', end_time: '18:00' },
    { doctorId: 'doc_002', day_of_week: 5, start_time: '10:00', end_time: '16:00' },
    
    // Dr. Emily Watson - Pediatrician
    { doctorId: 'doc_003', day_of_week: 2, start_time: '08:00', end_time: '16:00' },
    { doctorId: 'doc_003', day_of_week: 4, start_time: '08:00', end_time: '16:00' },
    { doctorId: 'doc_003', day_of_week: 6, start_time: '08:00', end_time: '12:00' },
    
    // Dr. James Liu - Dermatologist
    { doctorId: 'doc_004', day_of_week: 1, start_time: '11:00', end_time: '19:00' },
    { doctorId: 'doc_004', day_of_week: 3, start_time: '11:00', end_time: '19:00' },
    { doctorId: 'doc_004', day_of_week: 5, start_time: '11:00', end_time: '15:00' },
    
    // Dr. Priya Sharma - Orthopedic Surgeon
    { doctorId: 'doc_005', day_of_week: 2, start_time: '09:00', end_time: '17:00' },
    { doctorId: 'doc_005', day_of_week: 4, start_time: '09:00', end_time: '17:00' },
    { doctorId: 'doc_005', day_of_week: 6, start_time: '09:00', end_time: '13:00' },
    
    // Dr. David Kim - Psychiatrist
    { doctorId: 'doc_006', day_of_week: 1, start_time: '12:00', end_time: '20:00' },
    { doctorId: 'doc_006', day_of_week: 3, start_time: '12:00', end_time: '20:00' },
    { doctorId: 'doc_006', day_of_week: 5, start_time: '12:00', end_time: '18:00' },
    
    // Dr. Lisa Thompson - Ophthalmologist
    { doctorId: 'doc_007', day_of_week: 2, start_time: '08:30', end_time: '16:30' },
    { doctorId: 'doc_007', day_of_week: 4, start_time: '08:30', end_time: '16:30' },
    
    // Dr. Robert Garcia - Gastroenterologist
    { doctorId: 'doc_008', day_of_week: 1, start_time: '07:00', end_time: '15:00' },
    { doctorId: 'doc_008', day_of_week: 3, start_time: '07:00', end_time: '15:00' },
    { doctorId: 'doc_008', day_of_week: 5, start_time: '07:00', end_time: '13:00' }
  ];

  doctorAvailability.push(...availabilitySchedule);

  // Generate appointments for the next 30 days
  const today = new Date();
  const appointmentId = 2000;
  let appointmentCounter = appointmentId;

  const symptomsList = [
    'Chest pain and shortness of breath',
    'Severe headache and dizziness',
    'Fever and cough for 3 days',
    'Skin rash on arms and back',
    'Knee pain after running',
    'Anxiety and sleep difficulties',
    'Blurred vision and eye strain',
    'Stomach pain and acid reflux',
    'High blood pressure checkup',
    'Regular pediatric checkup',
    'Follow-up for previous consultation'
  ];

  // Create sample appointments for each patient with different doctors
  for (let i = 0; i < 30; i++) {
    const date = new Date(today);
    date.setDate(today.getDate() + i);
    
    // Skip weekends
    const dayOfWeek = date.getDay();
    if (dayOfWeek === 0 || dayOfWeek === 6) continue;
    
    const dateStr = date.toISOString().split('T')[0];
    
    // Create 2-3 appointments per day
    const numAppointments = Math.floor(Math.random() * 3) + 2;
    
    for (let j = 0; j < numAppointments && j < doctorsList.length; j++) {
      const doctor = doctorsList[j];
      const patient = patientsList[Math.floor(Math.random() * patientsList.length)];
      
      // Check if doctor is available on this day
      const doctorAvail = availabilitySchedule.filter(
        a => a.doctorId === doctor.id && a.day_of_week === dayOfWeek
      );
      
      if (doctorAvail.length === 0) continue;
      
      // Generate random time slot within doctor's availability
      const avail = doctorAvail[0];
      const startHour = parseInt(avail.start_time.split(':')[0]);
      const endHour = parseInt(avail.end_time.split(':')[0]);
      const hour = startHour + Math.floor(Math.random() * (endHour - startHour));
      const minute = Math.random() > 0.5 ? '00' : '30';
      const time = `${hour.toString().padStart(2, '0')}:${minute}`;
      
      // Random status for past appointments
      let status;
      if (date < today) {
        status = Math.random() > 0.7 ? 'completed' : 'cancelled';
      } else {
        status = 'scheduled';
      }
      
      const meetingId = `meet_${dateStr}_${doctor.id}_${Date.now()}_${j}`;
      
      const appointment = {
        id: appointmentCounter++,
        patient_id: patient.id,
        patient_name: patient.name,
        doctor_id: doctor.id,
        doctor_name: doctor.name,
        date: dateStr,
        time: time,
        symptoms: symptomsList[Math.floor(Math.random() * symptomsList.length)],
        status: status,
        meeting_id: meetingId,
        prescription: status === 'completed' ? {
          text: 'Take prescribed medication as directed. Follow up in 2 weeks.',
          notes: 'Rest and avoid strenuous activities',
          date: new Date().toISOString()
        } : null,
        created_at: new Date().toISOString()
      };
      
      appointments.push(appointment);
    }
  }

  // Add some upcoming appointments for the demo patient (patient@example.com)
  const demoPatient = users.find(u => u.email === 'patient@example.com');
  if (demoPatient) {
    for (let i = 0; i < 5; i++) {
      const date = new Date(today);
      date.setDate(today.getDate() + i + 1);
      const dateStr = date.toISOString().split('T')[0];
      const doctor = doctorsList[i % doctorsList.length];
      
      const appointment = {
        id: appointmentCounter++,
        patient_id: demoPatient.id,
        patient_name: demoPatient.name,
        doctor_id: doctor.id,
        doctor_name: doctor.name,
        date: dateStr,
        time: '10:00',
        symptoms: 'Routine checkup and consultation',
        status: 'scheduled',
        meeting_id: `meet_demo_${dateStr}_${doctor.id}`,
        prescription: null,
        created_at: new Date().toISOString()
      };
      
      appointments.push(appointment);
    }
  }

  console.log(`✅ Database seeded successfully!`);
  console.log(`   - ${users.filter(u => u.role === 'doctor').length} doctors`);
  console.log(`   - ${users.filter(u => u.role === 'patient').length} patients`);
  console.log(`   - ${doctorAvailability.length} availability slots`);
  console.log(`   - ${appointments.length} appointments`);
}

// Run seed function
seedDatabase();

// -------------------- Start Server --------------------
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`\n🚀 Server running on http://localhost:${PORT}`);
  console.log(`📋 API endpoints available at http://localhost:${PORT}/api`);
  console.log(`🔌 WebSocket server ready for video calls`);
  console.log(`\n📝 Demo Accounts:`);
  console.log(`   👨‍⚕️ Doctors (any password: doctor123):`);
  doctorsList.forEach(doctor => {
    console.log(`      ${doctor.email}`);
  });
  console.log(`\n   👤 Patients (any password: patient123):`);
  patientsList.forEach(patient => {
    console.log(`      ${patient.email}`);
  });
  console.log(`\n   🎯 Demo User: patient@example.com / pass123`);
  console.log(`   👨‍⚕️ Demo Doctor: doctor@example.com / pass123`);
  console.log(`\n📅 Appointments generated for the next 30 days!`);
});

// Export doctorsList for the startup message
const doctorsList = [
  { email: 'sarah.chen@example.com' },
  { email: 'michael.rodriguez@example.com' },
  { email: 'emily.watson@example.com' },
  { email: 'james.liu@example.com' },
  { email: 'priya.sharma@example.com' },
  { email: 'david.kim@example.com' },
  { email: 'lisa.thompson@example.com' },
  { email: 'robert.garcia@example.com' }
];

const patientsList = [
  { email: 'emma.johnson@example.com' },
  { email: 'liam.williams@example.com' },
  { email: 'sophia.brown@example.com' },
  { email: 'oliver.jones@example.com' },
  { email: 'isabella.garcia@example.com' }
];