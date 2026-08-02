import "dotenv/config";
import { WebSocketServer, WebSocket } from "ws";
import express from "express";

const app = express();
const GEMINI_URL = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${process.env.GEMINI_API_KEY}`;

let browserSocket = null;
let geminiSocket = null;
let geminiReady = false;

app.use(express.static("public"));
app.listen(3001, () => console.log("Static file server on http://localhost:3001"));

function connectToGemini() {
  geminiSocket = new WebSocket(GEMINI_URL);

  geminiSocket.on("open", () => {
    console.log("Connected to Gemini");

    const setupMessage = {
      setup: {
        model: "models/gemini-3.1-flash-live-preview",
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: "Leda"
              }
            }
          }
        }
      }
    };

    geminiSocket.send(JSON.stringify(setupMessage));
  });

  geminiSocket.on("message", (data) => {
    const message = JSON.parse(data.toString());
    
    if (message?.serverContent) {
      console.log("serverContent keys:", Object.keys(message.serverContent));
    }

    if (message?.serverContent?.interrupted && browserSocket) {
      browserSocket.send(JSON.stringify({ type: "interrupted" }));
    }
    
    if (message.setupComplete) {
      geminiReady = true;
      console.log("Gemini session ready");
      return;
    }

    const audioPart = message?.serverContent?.modelTurn?.parts?.[0]?.inlineData;

    if (audioPart && browserSocket) {
      const audioBuffer = Buffer.from(audioPart.data, "base64");
      browserSocket.send(audioBuffer);
    }

  });

  geminiSocket.on("close", (code, reason) => {
    console.log("Gemini connection closed:", code, reason.toString());
    geminiReady = false;
  });

  geminiSocket.on("error", (err) => {
    console.error("Gemini socket error:", err);
  });
}

connectToGemini();

const wss = new WebSocketServer({ port: 3002 });

wss.on("connection", (clientSocket) => {
  console.log("Browser connected");
  browserSocket = clientSocket;

  clientSocket.on("message", (data) => {

    if (!geminiReady) {
      console.log("Gemini not ready yet, dropping audio chunk");
      return;
    }

    const audioMessage = {
      realtimeInput: {
        audio: {
          data: data.toString("base64"),
          mimeType: "audio/pcm;rate=16000"
        }
      }
    };

    geminiSocket.send(JSON.stringify(audioMessage));
  });

  clientSocket.on("close", () => {
    console.log("Browser disconnected");
    browserSocket = null;
  });
});

console.log("Browser-facing relay listening on ws://localhost:3002");