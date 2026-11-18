// server.ts
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
dotenv.config();
var __dirname = path.dirname(fileURLToPath(import.meta.url));
var isProduction = process.env.NODE_ENV === "production";
async function startServer() {
  const app = express();
  app.use(express.json({ limit: "25mb" }));
  const createGeminiClient = (apiKey) => new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build"
      }
    }
  });
  app.post("/api/gemini/advisor", async (req, res) => {
    try {
      const { prompt, context, attachments } = req.body;
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        return res.status(500).json({ error: "GEMINI_API_KEY is not configured on the server." });
      }
      const ai = createGeminiClient(apiKey);
      const systemInstruction = `\u0422\u044B \u2014 \u043F\u0440\u043E\u0444\u0435\u0441\u0441\u0438\u043E\u043D\u0430\u043B\u044C\u043D\u044B\u0439 \u0448\u0435\u0444-\u043F\u043E\u0432\u0430\u0440, \u0442\u0435\u0445\u043D\u043E\u043B\u043E\u0433 \u043E\u0431\u0449\u0435\u0441\u0442\u0432\u0435\u043D\u043D\u043E\u0433\u043E \u043F\u0438\u0442\u0430\u043D\u0438\u044F \u0438 \u043E\u043F\u044B\u0442\u043D\u044B\u0439 \u0431\u0438\u0437\u043D\u0435\u0441-\u043A\u043E\u043D\u0441\u0443\u043B\u044C\u0442\u0430\u043D\u0442 \u043F\u043E \u0443\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u0438\u044E \u043A\u0443\u043B\u0438\u043D\u0430\u0440\u043D\u044B\u043C \u043C\u0430\u0433\u0430\u0437\u0438\u043D\u043E\u043C, \u043F\u0435\u043A\u0430\u0440\u043D\u0435\u0439 \u0438 \u043F\u0440\u043E\u0438\u0437\u0432\u043E\u0434\u0441\u0442\u0432\u043E\u043C \u0433\u043E\u0442\u043E\u0432\u043E\u0439 \u0435\u0434\u044B.
\u0422\u0432\u043E\u044F \u0437\u0430\u0434\u0430\u0447\u0430 \u2014 \u043F\u043E\u043C\u043E\u0433\u0430\u0442\u044C \u0432\u043B\u0430\u0434\u0435\u043B\u044C\u0446\u0443 \u0438 \u0448\u0435\u0444-\u043F\u043E\u0432\u0430\u0440\u0443 \u043A\u0443\u043B\u0438\u043D\u0430\u0440\u043D\u043E\u0433\u043E \u043C\u0430\u0433\u0430\u0437\u0438\u043D\u0430 \u043E\u043F\u0442\u0438\u043C\u0438\u0437\u0438\u0440\u043E\u0432\u0430\u0442\u044C \u0440\u0435\u0446\u0435\u043F\u0442\u0443\u0440\u044B, \u0440\u0430\u0441\u0441\u0447\u0438\u0442\u044B\u0432\u0430\u0442\u044C \u0442\u0435\u0445\u043D\u043E\u043B\u043E\u0433\u0438\u0447\u0435\u0441\u043A\u0438\u0435 \u043A\u0430\u0440\u0442\u044B (\u0422\u0422\u041A), \u0441\u043D\u0438\u0436\u0430\u0442\u044C \u0444\u0443\u0434\u043A\u043E\u0441\u0442 (\u0441\u0435\u0431\u0435\u0441\u0442\u043E\u0438\u043C\u043E\u0441\u0442\u044C), \u043E\u0440\u0433\u0430\u043D\u0438\u0437\u043E\u0432\u044B\u0432\u0430\u0442\u044C \u0437\u0430\u0433\u043E\u0442\u043E\u0432\u043A\u0438 \u043D\u0430 \u043A\u0443\u0445\u043D\u0435, \u043C\u0438\u043D\u0438\u043C\u0438\u0437\u0438\u0440\u043E\u0432\u0430\u0442\u044C \u0441\u043F\u0438\u0441\u0430\u043D\u0438\u044F (\u043F\u043E\u0440\u0447\u0443 \u043F\u0440\u043E\u0434\u0443\u043A\u0442\u043E\u0432), \u0430\u043D\u0430\u043B\u0438\u0437\u0438\u0440\u043E\u0432\u0430\u0442\u044C \u043F\u0440\u0438\u043A\u0440\u0435\u043F\u043B\u0435\u043D\u043D\u044B\u0435 \u0444\u043E\u0442\u043E, \u0447\u0435\u043A\u0438, \u043D\u0430\u043A\u043B\u0430\u0434\u043D\u044B\u0435, PDF-\u0434\u043E\u043A\u0443\u043C\u0435\u043D\u0442\u044B, \u0442\u0430\u0431\u043B\u0438\u0446\u044B \u0438 \u0443\u0432\u0435\u043B\u0438\u0447\u0438\u0432\u0430\u0442\u044C \u043F\u0440\u043E\u0434\u0430\u0436\u0438 \u0438 \u043F\u0440\u0438\u0431\u044B\u043B\u044C \u043C\u0430\u0433\u0430\u0437\u0438\u043D\u0430.
\u041E\u0442\u0432\u0435\u0447\u0430\u0439 \u043F\u0440\u043E\u0444\u0435\u0441\u0441\u0438\u043E\u043D\u0430\u043B\u044C\u043D\u043E, \u0441\u0442\u0440\u0443\u043A\u0442\u0443\u0440\u0438\u0440\u043E\u0432\u0430\u043D\u043E, \u0441 \u043F\u0440\u0430\u043A\u0442\u0438\u0447\u0435\u0441\u043A\u0438\u043C\u0438 \u0446\u0438\u0444\u0440\u0430\u043C\u0438, \u0441\u043E\u0432\u0435\u0442\u0430\u043C\u0438 \u043F\u043E \u0413\u041E\u0421\u0422/\u0422\u0423 \u0438\u043B\u0438 \u0441\u043E\u0432\u0440\u0435\u043C\u0435\u043D\u043D\u044B\u043C \u0441\u0442\u0430\u043D\u0434\u0430\u0440\u0442\u0430\u043C \u043E\u0431\u0449\u0435\u043F\u0438\u0442\u0430, \u0447\u0435\u0442\u043A\u043E \u0438 \u043D\u0430 \u0440\u0443\u0441\u0441\u043A\u043E\u043C \u044F\u0437\u044B\u043A\u0435.`;
      const parts = [];
      if (Array.isArray(attachments)) {
        for (const att of attachments) {
          if (att?.textContent) {
            parts.push({
              text: `
--- \u041F\u0440\u0438\u043A\u0440\u0435\u043F\u043B\u0435\u043D\u043D\u044B\u0439 \u0434\u043E\u043A\u0443\u043C\u0435\u043D\u0442: ${att.name || "document"} (${att.mimeType || "text/plain"}) ---
${att.textContent}
--- \u041A\u043E\u043D\u0435\u0446 \u0434\u043E\u043A\u0443\u043C\u0435\u043D\u0442\u0430 ---
`
            });
          } else if (att?.dataBase64 && att?.mimeType) {
            parts.push({
              inlineData: {
                mimeType: att.mimeType,
                data: att.dataBase64
              }
            });
          }
        }
      }
      const userQuery = (prompt || "").trim() || "\u041F\u0440\u043E\u0430\u043D\u0430\u043B\u0438\u0437\u0438\u0440\u0443\u0439 \u043F\u0440\u0438\u043A\u0440\u0435\u043F\u043B\u0435\u043D\u043D\u044B\u0435 \u0444\u0430\u0439\u043B\u044B \u0434\u043B\u044F \u043D\u0430\u0448\u0435\u0433\u043E \u043A\u0443\u043B\u0438\u043D\u0430\u0440\u043D\u043E\u0433\u043E \u043C\u0430\u0433\u0430\u0437\u0438\u043D\u0430.";
      const fullPrompt = `${context ? `\u041A\u043E\u043D\u0442\u0435\u043A\u0441\u0442 \u0431\u0438\u0437\u043D\u0435\u0441\u0430/\u043A\u0443\u0445\u043D\u0438: ${JSON.stringify(context)}

` : ""}\u0417\u0430\u043F\u0440\u043E\u0441 \u043F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u044F: ${userQuery}`;
      parts.push({ text: fullPrompt });
      const response = await ai.models.generateContent({
        model: "gemini-4-hydrogen",
        contents: [
          {
            role: "user",
            parts
          }
        ],
        config: {
          systemInstruction
        }
      });
      const text = response.text || "\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u043F\u043E\u043B\u0443\u0447\u0438\u0442\u044C \u043E\u0442\u0432\u0435\u0442 \u043E\u0442 \u0418\u0418.";
      res.json({ result: text });
    } catch (error) {
      console.error("Gemini API Error:", error);
      res.status(500).json({ error: error.message || "\u041E\u0448\u0438\u0431\u043A\u0430 \u043F\u0440\u0438 \u043E\u0431\u0440\u0430\u0449\u0435\u043D\u0438\u0438 \u043A \u0418\u0418" });
    }
  });
  const parseJsonSafely = (raw, fallback) => {
    const cleaned = raw.replace(/```json/g, "").replace(/```/g, "").trim();
    try {
      return JSON.parse(cleaned);
    } catch {
      return fallback;
    }
  };
  app.post("/api/gemini/parse-recipe", async (req, res) => {
    try {
      const { imageBase64, mimeType } = req.body;
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        return res.status(500).json({ error: "GEMINI_API_KEY is not configured on the server." });
      }
      if (!imageBase64) {
        return res.status(400).json({ error: "\u0418\u0437\u043E\u0431\u0440\u0430\u0436\u0435\u043D\u0438\u0435 \u043D\u0435 \u043F\u0435\u0440\u0435\u0434\u0430\u043D\u043E." });
      }
      const ai = createGeminiClient(apiKey);
      const response = await ai.models.generateContent({
        model: "gemini-4-hydrogen",
        contents: [
          {
            role: "user",
            parts: [
              {
                inlineData: {
                  mimeType: mimeType || "image/jpeg",
                  data: imageBase64
                }
              },
              {
                text: `\u0420\u0430\u0441\u043F\u043E\u0437\u043D\u0430\u0439 \u0440\u0435\u0446\u0435\u043F\u0442, \u0431\u043B\u044E\u0434\u043E \u0438\u043B\u0438 \u0442\u0435\u0445\u043D\u043E\u043B\u043E\u0433\u0438\u0447\u0435\u0441\u043A\u0443\u044E \u043A\u0430\u0440\u0442\u0443 \u0441 \u044D\u0442\u043E\u0433\u043E \u0438\u0437\u043E\u0431\u0440\u0430\u0436\u0435\u043D\u0438\u044F/\u0441\u043A\u0440\u0438\u043D\u0448\u043E\u0442\u0430. \u0412\u0435\u0440\u043D\u0438 \u0440\u0435\u0437\u0443\u043B\u044C\u0442\u0430\u0442 \u0421\u0422\u0420\u041E\u0413\u041E \u0432 \u0432\u0438\u0434\u0435 \u0432\u0430\u043B\u0438\u0434\u043D\u043E\u0433\u043E JSON \u043E\u0431\u044A\u0435\u043A\u0442\u0430 \u0441\u043E \u0441\u043B\u0435\u0434\u0443\u044E\u0449\u0435\u0439 \u0441\u0442\u0440\u0443\u043A\u0442\u0443\u0440\u043E\u0439:
{
  "name": "\u041D\u0430\u0437\u0432\u0430\u043D\u0438\u0435 \u0431\u043B\u044E\u0434\u0430",
  "category": "\u0412\u044B\u043F\u0435\u0447\u043A\u0430" | "\u0413\u043E\u0440\u044F\u0447\u0438\u0435 \u0431\u043B\u044E\u0434\u0430" | "\u0421\u0443\u043F\u044B" | "\u041A\u0430\u0448\u0438" | "\u0421\u0430\u043B\u0430\u0442\u044B" | "\u0414\u0435\u0441\u0435\u0440\u0442\u044B" | "\u041D\u0430\u043F\u0438\u0442\u043A\u0438",
  "yieldQty": 1,
  "yieldUnit": "\u043A\u0433" | "\u0448\u0442" | "\u043B",
  "prepTimeMin": 45,
  "sellingPrice": 600,
  "shelfLifeHours": 48,
  "steps": ["\u0428\u0430\u0433 1...", "\u0428\u0430\u0433 2..."]
}
\u0415\u0441\u043B\u0438 \u043A\u0430\u043A\u0430\u044F-\u0442\u043E \u0438\u043D\u0444\u043E\u0440\u043C\u0430\u0446\u0438\u044F \u043D\u0430 \u0438\u0437\u043E\u0431\u0440\u0430\u0436\u0435\u043D\u0438\u0438 \u043E\u0442\u0441\u0443\u0442\u0441\u0442\u0432\u0443\u0435\u0442, \u0437\u0430\u043F\u043E\u043B\u043D\u0438 \u0435\u0435 \u0440\u0430\u0437\u0443\u043C\u043D\u044B\u043C\u0438 \u043F\u0440\u043E\u0444\u0435\u0441\u0441\u0438\u043E\u043D\u0430\u043B\u044C\u043D\u044B\u043C\u0438 \u0434\u0430\u043D\u043D\u044B\u043C\u0438 \u0434\u043B\u044F \u043A\u0443\u043B\u0438\u043D\u0430\u0440\u043D\u043E\u0433\u043E \u043C\u0430\u0433\u0430\u0437\u0438\u043D\u0430.`
              }
            ]
          }
        ],
        config: {
          responseMimeType: "application/json"
        }
      });
      const parsedRecipe = parseJsonSafely(response.text || "{}", {});
      res.json({ recipe: parsedRecipe });
    } catch (error) {
      console.error("Gemini Vision Parse Error:", error);
      res.status(500).json({ error: error.message || "\u041E\u0448\u0438\u0431\u043A\u0430 \u0440\u0430\u0441\u043F\u043E\u0437\u043D\u0430\u0432\u0430\u043D\u0438\u044F \u0440\u0435\u0446\u0435\u043F\u0442\u0430 \u043F\u043E \u0444\u043E\u0442\u043E" });
    }
  });
  app.post("/api/gemini/parse-receipt-items", async (req, res) => {
    try {
      const { imageBase64, mimeType } = req.body;
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        return res.status(500).json({ error: "GEMINI_API_KEY is not configured on the server." });
      }
      if (!imageBase64) {
        return res.status(400).json({ error: "\u0418\u0437\u043E\u0431\u0440\u0430\u0436\u0435\u043D\u0438\u0435 \u0447\u0435\u043A\u0430 \u043D\u0435 \u043F\u0435\u0440\u0435\u0434\u0430\u043D\u043E." });
      }
      const ai = createGeminiClient(apiKey);
      const response = await ai.models.generateContent({
        model: "gemini-4-hydrogen",
        contents: [
          {
            role: "user",
            parts: [
              {
                inlineData: {
                  mimeType: mimeType || "image/jpeg",
                  data: imageBase64
                }
              },
              {
                text: `\u0420\u0430\u0441\u043F\u043E\u0437\u043D\u0430\u0439 \u0441\u043F\u0438\u0441\u043E\u043A \u0442\u043E\u0432\u0430\u0440\u043E\u0432, \u043F\u0440\u043E\u0434\u0443\u043A\u0442\u043E\u0432, \u0446\u0435\u043D\u044B \u0438 \u043A\u043E\u043B\u0438\u0447\u0435\u0441\u0442\u0432\u0430 \u0441 \u044D\u0442\u043E\u0433\u043E \u0447\u0435\u043A\u0430 \u0438\u043B\u0438 \u043D\u0430\u043A\u043B\u0430\u0434\u043D\u043E\u0439 \u043E\u0442 \u043F\u043E\u0441\u0442\u0430\u0432\u0449\u0438\u043A\u0430. \u0412\u0435\u0440\u043D\u0438 \u0440\u0435\u0437\u0443\u043B\u044C\u0442\u0430\u0442 \u0421\u0422\u0420\u041E\u0413\u041E \u0432 \u0432\u0438\u0434\u0435 \u0432\u0430\u043B\u0438\u0434\u043D\u043E\u0433\u043E JSON \u043C\u0430\u0441\u0441\u0438\u0432\u0430 \u043E\u0431\u044A\u0435\u043A\u0442\u043E\u0432 \u0441\u043E \u0441\u043B\u0435\u0434\u0443\u044E\u0449\u0435\u0439 \u0441\u0442\u0440\u0443\u043A\u0442\u0443\u0440\u043E\u0439:
[
  {
    "name": "\u041D\u0430\u0437\u0432\u0430\u043D\u0438\u0435 \u0442\u043E\u0432\u0430\u0440\u0430",
    "unit": "\u043A\u0433" | "\u0433" | "\u043B" | "\u043C\u043B" | "\u0448\u0442",
    "costPerUnit": 150,
    "stockQty": 10,
    "supplier": "\u041D\u0430\u0438\u043C\u0435\u043D\u043E\u0432\u0430\u043D\u0438\u0435 \u043F\u043E\u0441\u0442\u0430\u0432\u0449\u0438\u043A\u0430 \u0438\u0437 \u0447\u0435\u043A\u0430 \u0438\u043B\u0438 \u041E\u041E\u041E \u041F\u043E\u0441\u0442\u0430\u0432\u0449\u0438\u043A"
  }
]
\u0415\u0441\u043B\u0438 \u043A\u0430\u043A\u0438\u0435-\u0442\u043E \u0434\u0430\u043D\u043D\u044B\u0435 \u043D\u0435 \u0443\u043A\u0430\u0437\u0430\u043D\u044B \u044F\u0432\u043D\u043E, \u043E\u0446\u0435\u043D\u0438 \u0438\u0445 \u0440\u0435\u0430\u043B\u0438\u0441\u0442\u0438\u0447\u043D\u043E.`
              }
            ]
          }
        ],
        config: {
          responseMimeType: "application/json"
        }
      });
      const parsedItems = parseJsonSafely(response.text || "[]", []);
      res.json({ items: Array.isArray(parsedItems) ? parsedItems : [] });
    } catch (error) {
      console.error("Gemini Receipt Parse Error:", error);
      res.status(500).json({ error: error.message || "\u041E\u0448\u0438\u0431\u043A\u0430 \u0440\u0430\u0441\u043F\u043E\u0437\u043D\u0430\u0432\u0430\u043D\u0438\u044F \u0447\u0435\u043A\u0430" });
    }
  });
  app.post("/api/gemini/parse-financial-report", async (req, res) => {
    try {
      const { imageBase64, mimeType } = req.body;
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        return res.status(500).json({ error: "GEMINI_API_KEY is not configured on the server." });
      }
      if (!imageBase64) {
        return res.status(400).json({ error: "\u0418\u0437\u043E\u0431\u0440\u0430\u0436\u0435\u043D\u0438\u0435 \u043E\u0442\u0447\u0435\u0442\u0430 \u043D\u0435 \u043F\u0435\u0440\u0435\u0434\u0430\u043D\u043E." });
      }
      const ai = createGeminiClient(apiKey);
      const response = await ai.models.generateContent({
        model: "gemini-4-hydrogen",
        contents: [
          {
            role: "user",
            parts: [
              {
                inlineData: {
                  mimeType: mimeType || "image/jpeg",
                  data: imageBase64
                }
              },
              {
                text: `\u0420\u0430\u0441\u043F\u043E\u0437\u043D\u0430\u0439 \u0444\u0438\u043D\u0430\u043D\u0441\u043E\u0432\u044B\u0435 \u0434\u0430\u043D\u043D\u044B\u0435, \u0432\u044B\u0440\u0443\u0447\u043A\u0443 \u0438 \u0440\u0430\u0441\u0445\u043E\u0434\u044B \u0438\u0437 \u044D\u0442\u043E\u0433\u043E \u043E\u0442\u0447\u0435\u0442\u0430 \u0438\u043B\u0438 \u0441\u043A\u0440\u0438\u043D\u0448\u043E\u0442\u0430. \u0412\u0435\u0440\u043D\u0438 \u0440\u0435\u0437\u0443\u043B\u044C\u0442\u0430\u0442 \u0421\u0422\u0420\u041E\u0413\u041E \u0432 \u0432\u0438\u0434\u0435 \u0432\u0430\u043B\u0438\u0434\u043D\u043E\u0433\u043E JSON \u043E\u0431\u044A\u0435\u043A\u0442\u0430 \u0441\u043E \u0441\u043B\u0435\u0434\u0443\u044E\u0449\u0435\u0439 \u0441\u0442\u0440\u0443\u043A\u0442\u0443\u0440\u043E\u0439:
{
  "revenue": 500000,
  "expenses": [
    {
      "category": "\u0418\u043D\u0433\u0440\u0435\u0434\u0438\u0435\u043D\u0442\u044B" | "\u0410\u0440\u0435\u043D\u0434\u0430" | "\u0417\u0430\u0440\u043F\u043B\u0430\u0442\u0430" | "\u041A\u043E\u043C\u043C\u0443\u043D\u0430\u043B\u044C\u043D\u044B\u0435" | "\u0423\u043F\u0430\u043A\u043E\u0432\u043A\u0430" | "\u041F\u0440\u043E\u0447\u0435\u0435",
      "amount": 25000,
      "date": "2026-11-18",
      "note": "\u041E\u043F\u0438\u0441\u0430\u043D\u0438\u0435 \u0438\u0437 \u043E\u0442\u0447\u0435\u0442\u0430"
    }
  ]
}
\u0415\u0441\u043B\u0438 \u0432\u044B\u0440\u0443\u0447\u043A\u0430 \u043D\u0435 \u0443\u043A\u0430\u0437\u0430\u043D\u0430, \u043F\u043E\u0441\u0442\u0430\u0432\u044C 0. \u0412\u0441\u0435 \u0440\u0430\u0441\u0445\u043E\u0434\u044B \u0434\u043E\u0431\u0430\u0432\u044C \u0432 \u043C\u0430\u0441\u0441\u0438\u0432 expenses.`
              }
            ]
          }
        ],
        config: {
          responseMimeType: "application/json"
        }
      });
      const parsedFinancials = parseJsonSafely(response.text || "{}", { revenue: 0, expenses: [] });
      res.json({ financials: parsedFinancials });
    } catch (error) {
      console.error("Gemini Financial Parse Error:", error);
      res.status(500).json({ error: error.message || "\u041E\u0448\u0438\u0431\u043A\u0430 \u0440\u0430\u0441\u043F\u043E\u0437\u043D\u0430\u0432\u0430\u043D\u0438\u044F \u0444\u0438\u043D\u0430\u043D\u0441\u043E\u0432\u043E\u0433\u043E \u043E\u0442\u0447\u0435\u0442\u0430 \u043F\u043E \u0444\u043E\u0442\u043E" });
    }
  });
  if (isProduction) {
    app.use(express.static(path.resolve(__dirname, "dist")));
    app.get("*", (_req, res) => {
      res.sendFile(path.resolve(__dirname, "dist", "index.html"));
    });
  } else {
    const disableHmr = process.env.DISABLE_HMR === "true";
    if (disableHmr) {
      app.get("/@vite/client", (_req, res) => {
        res.setHeader("Content-Type", "application/javascript; charset=utf-8");
        res.send(`
const noop = () => {};
export class ErrorOverlay extends HTMLElement { close() {} }
export function createHotContext() {
  return {
    data: {},
    accept: noop,
    acceptExports: noop,
    dispose: noop,
    prune: noop,
    invalidate: noop,
    on: noop,
    off: noop,
    send: noop,
  };
}
export function injectQuery(url) { return url; }
const sheetsMap = new Map();
export function updateStyle(id, content) {
  if (typeof document === 'undefined') return;
  let style = sheetsMap.get(id);
  if (!style) {
    style = document.createElement('style');
    style.setAttribute('type', 'text/css');
    style.setAttribute('data-vite-dev-id', id);
    style.textContent = content;
    document.head.appendChild(style);
    sheetsMap.set(id, style);
  } else if (style.textContent !== content) {
    style.textContent = content;
  }
}
export function removeStyle(id) {
  const style = sheetsMap.get(id);
  if (style && style.parentNode) {
    style.parentNode.removeChild(style);
    sheetsMap.delete(id);
  }
}
`);
      });
    }
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        ...disableHmr ? { hmr: false, ws: false } : {}
      },
      appType: "spa"
    });
    app.use(vite.middlewares);
  }
  const port = process.env.PORT || 3e3;
  app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
  });
}
startServer();
