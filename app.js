const toggleBtn = document.getElementById('toggleBtn');
const btnLabel = document.getElementById('btnLabel');
const statusText = document.getElementById('statusText');
const connPill = document.getElementById('connPill');
const connText = document.getElementById('connText');
const orb = document.getElementById('orb');
const orbOuter = document.querySelector('.orb-ring-outer');
const orbInner = document.querySelector('.orb-ring-inner');

let ws = null;
let audioCtx = null;
let mediaStream = null;
let workletNode = null;
let isSessionActive = false;
let nextPlayTime = 0;

function setConnectionState(state, label) {
  connPill.dataset.state = state;
  connText.textContent = label;
}

function setOrbMode(mode, message) {
  orb.dataset.mode = mode;
  if (message) statusText.textContent = message;
}

function pulseOrb(level) {
  const scale = 1 + Math.min(0.32, level * 0.28);
  const outerScale = 1 + Math.min(0.24, level * 0.22);
  orb.style.transform = `scale(${scale.toFixed(3)})`;
  orbOuter.style.transform = `scale(${outerScale.toFixed(3)})`;
  orbInner.style.transform = `scale(${(1 + level * 0.14).toFixed(3)})`;
}

function resetOrbPulse() {
  orb.style.transform = '';
  orbOuter.style.transform = '';
  orbInner.style.transform = '';
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToInt16Array(base64) {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Int16Array(bytes.buffer);
}

async function playPcm24kChunk(base64Audio) {
  if (!audioCtx || !isSessionActive) return;
  if (audioCtx.state === 'suspended') {
    await audioCtx.resume();
  }

  const int16 = base64ToInt16Array(base64Audio);
  if (int16.length === 0) return;

  const float32 = new Float32Array(int16.length);
  let energy = 0;
  for (let i = 0; i < int16.length; i++) {
    const sample = int16[i] / 32768;
    float32[i] = sample;
    energy += sample * sample;
  }

  const rms = Math.min(1, Math.sqrt(energy / int16.length) * 4);
  setOrbMode('speaking', 'Gapiryapti...');
  pulseOrb(rms);

  const buffer = audioCtx.createBuffer(1, float32.length, 24000);
  buffer.copyToChannel(float32, 0);

  const src = audioCtx.createBufferSource();
  src.buffer = buffer;
  src.connect(audioCtx.destination);

  const now = audioCtx.currentTime;
  const startTime = Math.max(now + 0.02, nextPlayTime);
  src.start(startTime);
  nextPlayTime = startTime + buffer.duration;

  src.onended = () => {
    if (audioCtx && audioCtx.currentTime >= nextPlayTime - 0.03 && isSessionActive) {
      resetOrbPulse();
      setOrbMode('listening', 'Eshityapman...');
    }
  };
}

async function startSession() {
  if (isSessionActive) return;
  isSessionActive = true;
  nextPlayTime = 0;

  toggleBtn.dataset.active = 'true';
  btnLabel.textContent = 'Tugatish';
  setConnectionState('connecting', 'Ulanmoqda...');
  setOrbMode('idle', 'Ulanmoqda...');

  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('Mikrofon faqat HTTPS yoki localhost orqali ishlaydi.');
    }

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    audioCtx = new AudioContextClass({ sampleRate: 24000 });
    await audioCtx.resume();

    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1
      },
      video: false
    });

    await audioCtx.audioWorklet.addModule('pcm-processor.js');
    const source = audioCtx.createMediaStreamSource(mediaStream);
    workletNode = new AudioWorkletNode(audioCtx, 'pcm-processor');

    workletNode.port.onmessage = (event) => {
      if (!isSessionActive) return;
      if (event.data.type === 'rms') {
        if (orb.dataset.mode !== 'speaking') {
          pulseOrb(event.data.value);
        }
      } else if (event.data.type === 'pcm') {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            realtimeInput: {
              mediaChunks: [
                {
                  mimeType: 'audio/pcm;rate=16000',
                  data: arrayBufferToBase64(event.data.buffer)
                }
              ]
            }
          }));
        }
      }
    };

    source.connect(workletNode);

    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${protocol}//${location.host}`);

    ws.onopen = () => {
      setConnectionState('live', 'Jonli');
      setOrbMode('listening', 'Eshityapman...');
    };

    ws.onmessage = async (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'error') {
          setConnectionState('error', 'Xato');
          setOrbMode('idle', data.message || 'Xatolik yuz berdi');
          stopSession();
          return;
        }

        const parts = data?.serverContent?.modelTurn?.parts;
        if (Array.isArray(parts)) {
          for (const part of parts) {
            if (part.inlineData && part.inlineData.data) {
              await playPcm24kChunk(part.inlineData.data);
            }
          }
        }

        if (data?.serverContent?.turnComplete && isSessionActive) {
          resetOrbPulse();
          setOrbMode('listening', 'Eshityapman...');
        }
      } catch (_) {}
    };

    ws.onerror = () => {
      setConnectionState('error', 'Xato');
      setOrbMode('idle', 'Ulanishda xatolik');
    };

    ws.onclose = () => {
      if (isSessionActive) {
        stopSession();
      }
    };
  } catch (err) {
    setConnectionState('error', 'Ruxsat/Xato');
    setOrbMode('idle', err.message || 'Mikrofonga ruxsat berilmadi.');
    stopSession(true);
  }
}

function stopSession(keepMessage = false) {
  isSessionActive = false;
  nextPlayTime = 0;
  resetOrbPulse();

  toggleBtn.dataset.active = 'false';
  btnLabel.textContent = 'Boshlash';
  setConnectionState('idle', 'Tayyor');
  if (!keepMessage) {
    setOrbMode('idle', 'Gaplashish uchun tugmani bosing');
  }

  if (workletNode) {
    workletNode.disconnect();
    workletNode = null;
  }
  if (mediaStream) {
    mediaStream.getTracks().forEach((t) => t.stop());
    mediaStream = null;
  }
  if (audioCtx) {
    audioCtx.close().catch(() => {});
    audioCtx = null;
  }
  if (ws) {
    try { ws.close(); } catch (_) {}
    ws = null;
  }
}

toggleBtn.addEventListener('click', () => {
  if (isSessionActive) {
    stopSession();
  } else {
    startSession();
  }
});