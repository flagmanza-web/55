import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import dotenv from 'dotenv';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isProduction = process.env.NODE_ENV === 'production';

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '25mb' }));

  app.use((req, res, next) => {
    const origin = req.headers.origin;
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') {
      return res.sendStatus(204);
    }
    next();
  });

  const createGeminiClient = (apiKey: string) =>
    new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });

  const isTransientGeminiError = (err: any): boolean => {
    const msg = String(err?.message || '');
    const status = err?.status || err?.code;
    return (
      status === 503 ||
      status === 429 ||
      msg.includes('503') ||
      msg.includes('UNAVAILABLE') ||
      msg.includes('high demand') ||
      msg.includes('RESOURCE_EXHAUSTED')
    );
  };

  const isTimeoutError = (err: any): boolean => {
    const msg = String(err?.message || '');
    return (
      err?.name === 'TimeoutError' ||
      err?.name === 'AbortError' ||
      msg.includes('aborted due to timeout')
    );
  };

  const formatGeminiError = (err: any, fallback: string): string => {
    const raw = String(err?.message || '');
    if (isTimeoutError(err)) {
      return 'Сервер ИИ не успел ответить вовремя. Повторите запрос.';
    }
    if (isTransientGeminiError(err)) {
      return 'Сервер ИИ временно перегружен. Повторите запрос через несколько секунд.';
    }
    if (raw.includes('API_KEY_INVALID') || raw.includes('API key not valid')) {
      return 'Неверный ключ Gemini API на сервере.';
    }
    return raw || fallback;
  };

  const generateWithRetry = async (ai: GoogleGenAI, params: Parameters<GoogleGenAI['models']['generateContent']>[0]) => {
    const primaryParams = {
      ...params,
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        ...params.config,
        abortSignal: AbortSignal.timeout(20000),
      },
    };
    try {
      return await ai.models.generateContent(primaryParams);
    } catch (firstErr: any) {
      if (!isTransientGeminiError(firstErr) && !isTimeoutError(firstErr)) {
        throw firstErr;
      }
      const fallbackParams = {
        ...params,
        model: 'gemini-3.1-flash-lite',
        config: {
          ...params.config,
          thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
          abortSignal: AbortSignal.timeout(20000),
        },
      };
      await new Promise((r) => setTimeout(r, 400));
      try {
        return await ai.models.generateContent(fallbackParams);
      } catch (fallbackErr: any) {
        if (isTransientGeminiError(fallbackErr) || isTimeoutError(fallbackErr)) {
          await new Promise((r) => setTimeout(r, 800));
          return await ai.models.generateContent({
            ...fallbackParams,
            config: {
              ...fallbackParams.config,
              abortSignal: AbortSignal.timeout(18000),
            },
          });
        }
        throw fallbackErr;
      }
    }
  };

  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      geminiConfigured: Boolean(process.env.GEMINI_API_KEY),
    });
  });

  // Gemini API Endpoint for Culinary and Business Assistant (supports photo & document attachments)
  app.post('/api/gemini/advisor', async (req, res) => {
    try {
      const { prompt, context, attachments } = req.body;
      const apiKey = process.env.GEMINI_API_KEY;

      if (!apiKey) {
        return res.status(500).json({ error: 'GEMINI_API_KEY is not configured on the server.' });
      }

      const ai = createGeminiClient(apiKey);

      const systemInstruction = `Ты — профессиональный шеф-повар, технолог общественного питания и опытный бизнес-консультант по управлению кулинарным магазином, пекарней и производством готовой еды.
Твоя задача — помогать владельцу и шеф-повару кулинарного магазина оптимизировать рецептуры, рассчитывать технологические карты (ТТК), снижать фудкост (себестоимость), организовывать заготовки на кухне, минимизировать списания (порчу продуктов), анализировать прикрепленные фото, чеки, накладные, PDF-документы, таблицы и увеличивать продажи и прибыль магазина.
Отвечай профессионально, структурировано, с практическими цифрами, советами по ГОСТ/ТУ или современным стандартам общепита, четко и на русском языке.`;

      const parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [];

      if (Array.isArray(attachments)) {
        for (const att of attachments) {
          if (att?.textContent) {
            parts.push({
              text: `\n--- Прикрепленный документ: ${att.name || 'document'} (${att.mimeType || 'text/plain'}) ---\n${att.textContent}\n--- Конец документа ---\n`,
            });
          } else if (att?.dataBase64 && att?.mimeType) {
            parts.push({
              inlineData: {
                mimeType: att.mimeType,
                data: att.dataBase64,
              },
            });
          }
        }
      }

      const userQuery = (prompt || '').trim() || 'Проанализируй прикрепленные файлы для нашего кулинарного магазина.';
      const fullPrompt = `${context ? `Контекст бизнеса/кухни: ${JSON.stringify(context)}\n\n` : ''}Запрос пользователя: ${userQuery}`;
      parts.push({ text: fullPrompt });

      const response = await generateWithRetry(ai, {
        model: 'gemini-4-hydrogen',
        contents: [
          {
            role: 'user',
            parts,
          },
        ],
        config: {
          systemInstruction,
        },
      });

      const text = response.text || 'Не удалось получить ответ от ИИ.';
      res.json({ result: text });
    } catch (error: any) {
      console.error('Gemini API Error:', error);
      res.status(500).json({ error: formatGeminiError(error, 'Ошибка при обращении к ИИ') });
    }
  });

  const parseJsonSafely = <T,>(raw: string, fallback: T): T => {
    const cleaned = raw.replace(/```json/g, '').replace(/```/g, '').trim();
    try {
      return JSON.parse(cleaned) as T;
    } catch {
      return fallback;
    }
  };

  // Endpoint to parse recipe from image/screenshot using Gemini Vision
  app.post('/api/gemini/parse-recipe', async (req, res) => {
    try {
      const { imageBase64, mimeType } = req.body;
      const apiKey = process.env.GEMINI_API_KEY;

      if (!apiKey) {
        return res.status(500).json({ error: 'GEMINI_API_KEY is not configured on the server.' });
      }
      if (!imageBase64) {
        return res.status(400).json({ error: 'Изображение не передано.' });
      }

      const ai = createGeminiClient(apiKey);

      const response = await generateWithRetry(ai, {
        model: 'gemini-4-hydrogen',
        contents: [
          {
            role: 'user',
            parts: [
              {
                inlineData: {
                  mimeType: mimeType || 'image/jpeg',
                  data: imageBase64
                }
              },
              {
                text: `Распознай рецепт, блюдо или технологическую карту с этого изображения/скриншота. Верни результат СТРОГО в виде валидного JSON объекта со следующей структурой:
{
  "name": "Название блюда",
  "category": "Выпечка" | "Горячие блюда" | "Супы" | "Каши" | "Салаты" | "Десерты" | "Напитки",
  "yieldQty": 1,
  "yieldUnit": "кг" | "шт" | "л",
  "prepTimeMin": 45,
  "sellingPrice": 600,
  "shelfLifeHours": 48,
  "steps": ["Шаг 1...", "Шаг 2..."]
}
Если какая-то информация на изображении отсутствует, заполни ее разумными профессиональными данными для кулинарного магазина.`
              }
            ]
          }
        ],
        config: {
          responseMimeType: 'application/json',
        },
      });

      const parsedRecipe = parseJsonSafely(response.text || '{}', {});
      res.json({ recipe: parsedRecipe });
    } catch (error: any) {
      console.error('Gemini Vision Parse Error:', error);
      res.status(500).json({ error: formatGeminiError(error, 'Ошибка распознавания рецепта по фото') });
    }
  });

  // Endpoint to parse supplier receipt/invoice items from image using Gemini Vision
  app.post('/api/gemini/parse-receipt-items', async (req, res) => {
    try {
      const { imageBase64, mimeType } = req.body;
      const apiKey = process.env.GEMINI_API_KEY;

      if (!apiKey) {
        return res.status(500).json({ error: 'GEMINI_API_KEY is not configured on the server.' });
      }
      if (!imageBase64) {
        return res.status(400).json({ error: 'Изображение чека не передано.' });
      }

      const ai = createGeminiClient(apiKey);

      const response = await generateWithRetry(ai, {
        model: 'gemini-4-hydrogen',
        contents: [
          {
            role: 'user',
            parts: [
              {
                inlineData: {
                  mimeType: mimeType || 'image/jpeg',
                  data: imageBase64
                }
              },
              {
                text: `Распознай список товаров, продуктов, цены и количества с этого чека или накладной от поставщика. Верни результат СТРОГО в виде валидного JSON массива объектов со следующей структурой:
[
  {
    "name": "Название товара",
    "unit": "кг" | "г" | "л" | "мл" | "шт",
    "costPerUnit": 150,
    "stockQty": 10,
    "supplier": "Наименование поставщика из чека или ООО Поставщик"
  }
]
Если какие-то данные не указаны явно, оцени их реалистично.`
              }
            ]
          }
        ],
        config: {
          responseMimeType: 'application/json',
        },
      });

      const parsedItems = parseJsonSafely(response.text || '[]', []);
      res.json({ items: Array.isArray(parsedItems) ? parsedItems : [] });
    } catch (error: any) {
      console.error('Gemini Receipt Parse Error:', error);
      res.status(500).json({ error: formatGeminiError(error, 'Ошибка распознавания чека') });
    }
  });

  // Endpoint to parse financial report / expenses / revenue from screenshot using Gemini Vision
  app.post('/api/gemini/parse-financial-report', async (req, res) => {
    try {
      const { imageBase64, mimeType } = req.body;
      const apiKey = process.env.GEMINI_API_KEY;

      if (!apiKey) {
        return res.status(500).json({ error: 'GEMINI_API_KEY is not configured on the server.' });
      }
      if (!imageBase64) {
        return res.status(400).json({ error: 'Изображение отчета не передано.' });
      }

      const ai = createGeminiClient(apiKey);

      const response = await generateWithRetry(ai, {
        model: 'gemini-4-hydrogen',
        contents: [
          {
            role: 'user',
            parts: [
              {
                inlineData: {
                  mimeType: mimeType || 'image/jpeg',
                  data: imageBase64
                }
              },
              {
                text: `Распознай финансовые данные, выручку и расходы из этого отчета или скриншота. Верни результат СТРОГО в виде валидного JSON объекта со следующей структурой:
{
  "revenue": 500000,
  "expenses": [
    {
      "category": "Ингредиенты" | "Аренда" | "Зарплата" | "Коммунальные" | "Упаковка" | "Прочее",
      "amount": 25000,
      "date": "2026-11-18",
      "note": "Описание из отчета"
    }
  ]
}
Если выручка не указана, поставь 0. Все расходы добавь в массив expenses.`
              }
            ]
          }
        ],
        config: {
          responseMimeType: 'application/json',
        },
      });

      const parsedFinancials = parseJsonSafely(response.text || '{}', { revenue: 0, expenses: [] });
      res.json({ financials: parsedFinancials });
    } catch (error: any) {
      console.error('Gemini Financial Parse Error:', error);
      res.status(500).json({ error: formatGeminiError(error, 'Ошибка распознавания финансового отчета по фото') });
    }
  });

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'API route not found' });
  });

  if (isProduction) {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(
      express.static(distPath, {
        setHeaders: (res, filePath) => {
          if (
            filePath.endsWith('sw.js') ||
            filePath.endsWith('manifest.webmanifest') ||
            filePath.endsWith('index.html')
          ) {
            res.setHeader('Cache-Control', 'no-cache');
          }
        },
      })
    );
    app.get('*', (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(distPath, 'index.html'));
    });
  } else {
    const disableHmr = process.env.DISABLE_HMR === 'true';
    if (disableHmr) {
      app.get('/@vite/client', (_req, res) => {
        res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
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

    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        ...(disableHmr ? { hmr: false, ws: false } : {}),
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  const port = Number(process.env.PORT) || 3000;
  app.listen(port, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${port}`);
  });
}

startServer();
