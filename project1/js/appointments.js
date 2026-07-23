// ── APPOINTMENTS.JS ───────────────────────────────────

let currentBookingDoctor = null;

const getApiUrl = () => typeof API_URL !== 'undefined' ? API_URL : 'http://localhost:5000/api';
const safeGetToken = () => typeof getToken === 'function' ? getToken() : localStorage.getItem('dt_token');
const safeGetUser = () => typeof getUser === 'function' ? getUser() : JSON.parse(localStorage.getItem('dt_user') || 'null');
const safeShowToast = (msg, type) => typeof showToast === 'function' ? showToast(msg, type) : alert(msg);

async function openBookingModal(doctorId, doctorName, spec) {
  const user = safeGetUser();
  
  if (!user) {
    safeShowToast('Please sign in to book an appointment', 'error');
    if (typeof openModal === 'function') openModal('login');
    return;
  }
  
  currentBookingDoctor = { id: doctorId, name: doctorName, spec };

  const bkDoctor = document.getElementById('bk-doctor');
  const bkDate = document.getElementById('bk-date');
  const bkTime = document.getElementById('bk-time');
  const bkSymptoms = document.getElementById('bk-symptoms');
  
  if (bkDoctor) bkDoctor.value = `Dr. ${doctorName} — ${spec}`;
  if (bkDate) bkDate.value = '';
  if (bkTime) bkTime.innerHTML = '<option value="">Select a date first</option>';
  if (bkSymptoms) bkSymptoms.value = '';

  if (bkDate) {
    const today = new Date();
    bkDate.min = today.toISOString().split('T')[0];
    const maxDate = new Date();
    maxDate.setMonth(maxDate.getMonth() + 1);
    bkDate.max = maxDate.toISOString().split('T')[0];
    
    // Listen for the user picking a date
    bkDate.onchange = () => {
      const selectedDate = bkDate.value;
      if (selectedDate) {
        loadSlotsLocal(); // Instantly load slots!
      }
    };
  }

  if (typeof openModal === 'function') openModal('book');
}

// 🚀 FOOLPROOF FIX: Generate slots instantly on the frontend
function loadSlotsLocal() {
  const sel = document.getElementById('bk-time');
  if (!sel) return;
  
  sel.innerHTML = '<option value="">Select a time</option>';
  
  // Generate times from 09:00 to 16:30 (9 AM to 5 PM)
  let hour = 9;
  let min = 0;
  
  while (hour < 17) {
    const timeStr = `${hour.toString().padStart(2, '0')}:${min.toString().padStart(2, '0')}`;
    
    // Format for display (e.g., "09:00 AM")
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour > 12 ? hour - 12 : hour;
    const displayTime = `${displayHour}:${min.toString().padStart(2, '0')} ${ampm}`;
    
    sel.innerHTML += `<option value="${timeStr}">${displayTime}</option>`;
    
    min += 30;
    if (min === 60) {
      hour++;
      min = 0;
    }
  }
}

async function submitBooking(event) {
  if (event) event.preventDefault();
  
  if (!currentBookingDoctor) {
    safeShowToast('Please select a doctor first', 'error');
    return;
  }
  
  const date = document.getElementById('bk-date')?.value;
  const time = document.getElementById('bk-time')?.value;
  const symptoms = document.getElementById('bk-symptoms')?.value || '';

  if (!date || !time) {
    safeShowToast('Please select both date and time', 'error');
    return;
  }

  const token = safeGetToken();
  if (!token) {
    safeShowToast('Please login to book appointment', 'error');
    if (typeof openModal === 'function') openModal('login');
    return;
  }

  const submitBtn = document.querySelector('#modal-book button[type="submit"]');
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Booking...';
  }

  try {
    const response = await fetch(`${getApiUrl()}/appointments/book`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        doctorId: currentBookingDoctor.id,
        date: date,
        time: time,
        symptoms: symptoms
      })
    });

    if (response.ok) {
      safeShowToast('Appointment booked successfully!', 'success');
      if (typeof closeModal === 'function') closeModal('book');
      currentBookingDoctor = null;
      
      if (typeof window.loadAppointments === 'function') {
        window.loadAppointments();
      }
      
      setTimeout(() => {
        if (window.location.pathname.includes('doctors.html')) {
          window.location.href = 'dashboard.html';
        }
      }, 1500);
    } else {
      const error = await response.json();
      safeShowToast(error.error || 'Booking failed', 'error');
    }
  } catch (error) {
    safeShowToast('Network error - make sure backend is running', 'error');
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Confirm Booking';
    }
  }
}

async function cancelAppointment(id) {
  if (!confirm('Are you sure you want to cancel this appointment?')) return;
  
  const token = safeGetToken();
  
  try {
    const response = await fetch(`${getApiUrl()}/appointments/${id}/status`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ status: 'cancelled' })
    });
    
    if (response.ok) {
      safeShowToast('Appointment cancelled successfully', 'success');
      if (typeof window.loadAppointments === 'function') {
        window.loadAppointments();
      } else {
        setTimeout(() => location.reload(), 1000);
      }
    }
  } catch (error) {
    safeShowToast('Network error', 'error');
  }
}

window.openBookingModal = openBookingModal;
window.submitBooking = submitBooking;
window.cancelAppointment = cancelAppointment;