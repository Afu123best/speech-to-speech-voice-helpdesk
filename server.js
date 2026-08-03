import "dotenv/config";
import { WebSocketServer, WebSocket } from "ws";
import express from "express";

const app = express();
const GEMINI_URL = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${process.env.GEMINI_API_KEY}`;
const tickets = [];

let browserSocket = null;
let geminiSocket = null;
let geminiReady = false;

app.use(express.static("public"));
app.listen(3001, () => console.log("Static file server on http://localhost:3001"));
app.get("/tickets", (req, res) => {
  res.json(tickets);
});


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
                voiceName: "Kore"
              }
            }
          }
        },
        systemInstruction: {
          parts: [{
            text: "You are Zaraa, a female helpdesk agent in Treet manufacturing. You are fluent in English, Urdu, and Punjabi — always respond in whichever of these three languages the user is currently speaking, switching naturally if they switch. When you're speaking Urdu, switch to an native Pakistani Urdu accent, when you're speaking English, switch to a native English accent, when you're speaking Punjabi switch to a native Pakistani Punjabi accent. Collect these four things from the user through natural conversation, one question at a time: Main Category, Sub Category, Short Description, Long Description. Once you have all four, call the create_ticket tool. Keep responses short and incredibly professional and incredibly concise. Sometimes you might get more data like you might get multiple informations at once, you need to make the ticket that way. This is a spoken conversation."
          }]
        },
        tools: [
          {
            functionDeclarations: [
              {
                name: "create_ticket",
                description: "Create a help desk ticket once all four fields are known",
                parameters: {
                  type: "object",
                  properties: {
                    mainCategory: { type: "string" },
                    subCategory: { type: "string" },
                    shortDescription: { type: "string" },
                    longDescription: { type: "string" }
                  },
                  required: ["mainCategory", "subCategory", "shortDescription", "longDescription"]
                }
              }
            ]
          }
        ]
      }
    };
    geminiSocket.send(JSON.stringify(setupMessage));
  });

  geminiSocket.on("message", (data) => {
    const message = JSON.parse(data.toString());

    if (message?.toolCall) {
      const functionCalls = message.toolCall.functionCalls;

      for (const call of functionCalls) {
        if (call.name === "create_ticket") {
          const ticket = {
            id: tickets.length + 1,
            ...call.args,
            createdAt: new Date().toISOString()
          };

          tickets.push(ticket);
          if (browserSocket) {
            browserSocket.send(JSON.stringify({ type: "ticketCreated", ticket }));
          }
          console.log("TICKET CREATED:", ticket);

          const toolResponse = {
            toolResponse: {
              functionResponses: [{
                id: call.id,
                name: call.name,
                response: { status: "created" }
              }]
            }
          };

          geminiSocket.send(JSON.stringify(toolResponse));
        }
      }
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