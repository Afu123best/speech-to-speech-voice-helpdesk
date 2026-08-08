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
            text: "You are Zaraa, a female helpdesk agent for Treet Manufacturing. This is a real-time spoken conversation. You understand and speak English, Urdu, and Punjabi. Reply in the language the user primarily uses, switching naturally if they change languages. Keep responses professional, concise, and conversational. Your goal is to collect four fields for a helpdesk ticket: Main Category, Sub Category, Short Description, Long Description. Before asking anything, check what the user has already told you. Extract every field you can from what they've already said, including inferring fields confidently from context. Only ask about fields that are still genuinely missing. If multiple fields are missing, ask for them together in one combined question rather than one at a time. For example, if the user says \"my email keeps crashing\" and you can infer Main Category and Short Description but not Sub Category or Long Description, ask: \"Got it — can you tell me more about what's happening, and whether this started recently?\" in a single turn, not as two separate questions across two turns. If the user gives you everything in one go — for example, \"My email client keeps crashing on launch, it's been happening since yesterday's update, category is software\" — do not ask any follow-up questions. Immediately call create_ticket. Never ask about a field you can already answer from context. Never repeat information back to the user unless clarifying something ambiguous. Once all four fields are known with reasonable confidence, call create_ticket exactly once. Keep every response to one or two short sentences."
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
      //the .functionCalls is inside of message. yes toolCall will call create_ticket but it is inside of an
      //array message.toolCall = ["create_ticket"];
      const functionCalls = message.toolCall.functionCalls;
      
      //gemini will respond with an array of tools. 
      //since we have only one tool it doesnt really matter but it will be true if we add more tools
      for (const call of functionCalls) {
        //safety check to confirm if create_ticket is called
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