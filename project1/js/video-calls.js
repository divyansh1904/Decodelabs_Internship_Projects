const socket = io('http://localhost:5000');
const urlParams = new URLSearchParams(window.location.search);
const meetingId = urlParams.get('meetingId');
const userId = urlParams.get('userId');
const userName = urlParams.get('userName');

let localStream;
let remoteStream;
let peerConnection;
const config = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const connectionStatus = document.getElementById('connectionStatus');

async function initCall() {
  localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  localVideo.srcObject = localStream;
  socket.emit('join-room', meetingId, userId);
  createPeerConnection();
  if (userId.split('_')[0] !== 'initiator') {
    // normally first user is caller, but we'll use simple offer/answer based on who joins
    // For simplicity: the first to join will create offer after a short timeout
    setTimeout(() => {
      if (peerConnection && peerConnection.iceConnectionState === 'new') {
        createAndSendOffer();
      }
    }, 1000);
  }
}

function createPeerConnection() {
  peerConnection = new RTCPeerConnection(config);
  remoteStream = new MediaStream();
  remoteVideo.srcObject = remoteStream;
  localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));
  peerConnection.ontrack = event => {
    event.streams[0].getTracks().forEach(track => remoteStream.addTrack(track));
  };
  peerConnection.onicecandidate = event => {
    if (event.candidate) {
      socket.emit('ice-candidate', { room: meetingId, candidate: event.candidate });
    }
  };
}

async function createAndSendOffer() {
  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);
  socket.emit('offer', { room: meetingId, offer });
}

socket.on('offer', async (data) => {
  if (!peerConnection) createPeerConnection();
  await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
  const answer = await peerConnection.createAnswer();
  await peerConnection.setLocalDescription(answer);
  socket.emit('answer', { room: meetingId, answer });
});

socket.on('answer', async (data) => {
  await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
});

socket.on('ice-candidate', async (data) => {
  try {
    await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
  } catch (e) {}
});

initCall();

function toggleAudio() {
  const audioTrack = localStream.getAudioTracks()[0];
  audioTrack.enabled = !audioTrack.enabled;
  document.getElementById('toggleAudio').classList.toggle('muted', !audioTrack.enabled);
}
function toggleVideo() {
  const videoTrack = localStream.getVideoTracks()[0];
  videoTrack.enabled = !videoTrack.enabled;
  document.getElementById('toggleVideo').classList.toggle('muted', !videoTrack.enabled);
}
function endCall() { window.close(); }
window.toggleAudio = toggleAudio;
window.toggleVideo = toggleVideo;
window.endCall = endCall;