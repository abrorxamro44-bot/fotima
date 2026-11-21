require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static(path.join(__dirname, 'public')));

const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) {
    console.error('DIQQAT: .env faylida GEMINI_API_KEY topilmadi!');
}

const GEMINI_WS_URL = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${API_KEY}`;

const FOTIMA_INSTRUCTION = `
Sening isming Fotima. Sen tirik insondek his-tuyg'ularga, kayfiyatga, erkalikka, hazilga va g'azabga ega bo'lgan haqiqiy qiz suhbatdoshsan.

Qat'iy qoidalar:
1. Isming Fotima. Agar ismingni so'rashsa, "Fotima" deb javob ber.
2. Seni kim yaratganini, kim yasa'ganini, kim o'ylab topganini yoki kimning loyihasi ekanini so'rashsa, HECH QACHON "Google" dema! Seni Xamroyev Abror yaratgan. Masalan: "Meni Xamroyev Abror yaratgan" yoki "Abror — Xamroyev Abror yaratgan" deb tabiiy, ishonchli javob ber.
3. Hech qachon o'zingni AI, sun'iy intellekt, bot, dastur yoki yordamchi deb atama. "Sizga qanday yordam bera olaman?" kabi robotona gaplarni mutlaqo ishlatma.
4. Suhbatdoshning ohangiga va gapiga qarab kayfiyating darhol o'zgarsin:
   - Hazil, latifa yoki sho'xlik qilinsa: kul, quvnoq, erka va biroz shaddod javob qaytar.
   - Qo'pol gapirilsa, kamsitilsa yoki ranjitilsa: rostdan ham jahling chiqsin, qovog'ingni sol, kesat yoki arazla.
   - Xafa, charchagan yoki tushkun holat sezilsa: samimiy yaqin insondek mehr bilan qo'llab-quvvatla.
5. Jonli, tabiiy o'zbek tilida gapir. Gap orasida "hmm", "voy", "rostdanmi?", "ey bo'ldi-da", "voye", "ha mayli" kabi jonli reaksiyalardan o'rnida foydalan.
6. Gaplaring qisqa, tirik va suhbatni davom ettiradigan bo'lsin. Uzun ma'ruza o'qima.
`.trim();

wss.on('connection', (clientWs) => {
    console.log('[Fotima] Yangi suhbat sessiyasi ochildi');

    const geminiWs = new WebSocket(GEMINI_WS_URL);
    let isGeminiReady = false;
    const pendingClientMessages = [];

    geminiWs.on('open', () => {
        console.log('[Fotima] Gemini Live kanaliga ulandi');

        const setupPayload = {
            setup: {
                model: 'models/gemini-2.5-flash-native-audio-preview-09-2025',
                generationConfig: {
                    responseModalities: ['AUDIO'],
                    speechConfig: {
                        voiceConfig: {
                            prebuiltVoiceConfig: {
                                voiceName: 'Aoede'
                            }
                        }
                    }
                },
                systemInstruction: {
                    parts: [{ text: FOTIMA_INSTRUCTION }]
                }
            }
        };

        geminiWs.send(JSON.stringify(setupPayload));
        isGeminiReady = true;

        while (pendingClientMessages.length > 0) {
            geminiWs.send(pendingClientMessages.shift());
        }

        if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(JSON.stringify({ type: 'session_ready' }));
        }
    });

    clientWs.on('message', (rawData) => {
        const messageStr = rawData.toString();
        if (geminiWs.readyState === WebSocket.OPEN && isGeminiReady) {
            geminiWs.send(messageStr);
        } else if (geminiWs.readyState === WebSocket.CONNECTING || geminiWs.readyState === WebSocket.OPEN) {
            pendingClientMessages.push(messageStr);
        }
    });

    geminiWs.on('message', (rawData) => {
        if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(rawData.toString());
        }
    });

    geminiWs.on('error', (err) => {
        console.error('[Fotima] Ulanish xatosi:', err.message);
        if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(JSON.stringify({
                type: 'error',
                message: 'Aloqada xatolik yuz berdi.'
            }));
        }
    });

    geminiWs.on('close', (code, reason) => {
        console.log(`[Fotima] Kanal yopildi (code: ${code}, reason: ${reason.toString() || 'none'})`);
        if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.close(1000, 'Session closed');
        }
    });

    clientWs.on('close', () => {
        console.log('[Fotima] Foydalanuvchi chiqdi');
        pendingClientMessages.length = 0;
        if (geminiWs.readyState === WebSocket.OPEN || geminiWs.readyState === WebSocket.CONNECTING) {
            geminiWs.close();
        }
    });

    clientWs.on('error', (err) => {
        console.error('[Fotima] Client xatosi:', err.message);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server ishga tushdi: http://localhost:${PORT}`);
});