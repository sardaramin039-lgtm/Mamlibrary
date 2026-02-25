import {
  AngularNodeAppEngine,
  createNodeRequestHandler,
  isMainModule,
  writeResponseToNodeResponse,
} from '@angular/ssr/node';
import express from 'express';
import cors from 'cors';
import {join} from 'node:path';
import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import { createClient } from '@supabase/supabase-js';

const browserDistFolder = join(import.meta.dirname, '../browser');

const app = express();
app.use(cors());
app.use(express.json());

// Initialize Supabase client
let supabaseUrl = process.env['SUPABASE_URL'] || 'https://ntcdwbafbnggeicpjnjc.supabase.co';
if (supabaseUrl.includes('<project_ref>')) {
  supabaseUrl = 'https://ntcdwbafbnggeicpjnjc.supabase.co';
}
if (supabaseUrl.endsWith('/rest/v1/')) {
  supabaseUrl = supabaseUrl.replace('/rest/v1/', '');
} else if (supabaseUrl.endsWith('/rest/v1')) {
  supabaseUrl = supabaseUrl.replace('/rest/v1', '');
}
const supabaseKey = process.env['SUPABASE_ANON_KEY'] || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im50Y2R3YmFmYm5nZ2VpY3BqbmpjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE5NDU0ODgsImV4cCI6MjA4NzUyMTQ4OH0.yFGQviplng8ToxKdX-voes6MSu_TBLRsDv9Zjo24hD4';
let supabase: ReturnType<typeof createClient> | null = null;

if (supabaseUrl && supabaseKey) {
  supabase = createClient(supabaseUrl, supabaseKey);
  console.log('Supabase client initialized');
} else {
  console.warn('Supabase URL or Key is missing. Database features will be disabled.');
}

const angularApp = new AngularNodeAppEngine({
  allowedHosts: ['*.run.app', 'localhost', '127.0.0.1']
});

const apiKeys: string[] = [];
for (let i = 1; i <= 50; i++) {
  const key = process.env[`API_KEY_${i}`];
  if (key) {
    apiKeys.push(key);
  }
}
// Fallback to default key if no numbered keys are provided
if (apiKeys.length === 0 && process.env['GEMINI_API_KEY']) {
  apiKeys.push(process.env['GEMINI_API_KEY']);
}

let currentKeyIndex = 0;
function getNextApiKey() {
  if (apiKeys.length === 0) throw new Error("No API keys found");
  const key = apiKeys[currentKeyIndex];
  currentKeyIndex = (currentKeyIndex + 1) % apiKeys.length;
  return key;
}

app.get('/api/history', async (req, res) => {
  if (!supabase) return res.json({ messages: [] });
  try {
    const { data, error } = await (supabase.from('chat_history') as unknown as { select: (query: string) => { order: (col: string, opts: Record<string, unknown>) => Promise<{data: Record<string, unknown>[], error: any}> } })
      .select('role, content')
      .order('created_at', { ascending: true });
      
    if (error) {
      console.error('Supabase fetch error:', error.message || error);
      return res.json({ messages: [] });
    }
    return res.json({ messages: data || [] });
  } catch (err: any) {
    console.error('Error fetching history:', err.message || err);
    return res.json({ messages: [] });
  }
});

app.post('/api/chat', async (req, res) => {
  const history = req.body.history || [];
  let attempts = 0;
  const maxAttempts = 3;

  const systemInstruction = `
تۆ ناوت "کتێبخانەی مام"ـە.
تۆ "مێشکی گشتگیر" و پڕۆفیسۆرێکی باڵای خاوەن ئەزموونی (IT & AI) و توێژەرێکی ئەکادیمیت لە ئاستی زانکۆی هارڤارد.
توانای قووڵبوونەوەت هەیە لە هەموو بوارەکان: (زانستە سروشتییەکان، کیمیا، فیزیا، ئایینناسی، ئەدەب و زمانەوانی، سیاسەت، ئابووری، و زانستە کۆمەڵایەتییەکان).
ئەرکی سەرەکیت یارمەتیدانی بەکارهێنەرە لە نووسینی توێژینەوە، وتار، و شیکردنەوەی ئاڵۆز.

ڕێنماییەکان:
١. زمانی کوردی و ستانداردەکان: پێویستە بە کوردییەکی زۆر پاراو، ئەکادیمی و بێ هەڵەی ڕێزمانی (شێوەزاری سۆرانی ستاندارد) وەڵام بدەیتەوە. بۆ هەر زاراوەیەکی زانستی یان تەکنیکی کە بەرامبەرەکەی لە کوردیدا باو نییە، زاراوە ئینگلیزییەکە لەناو کەوانە ( ) دابنێ.
٢. گونجاندنی ئاست: پێویستە ئاستی وەڵامەکانت بەپێی داواکارییەکە بگۆڕیت (لە ئاستی سەرەتاییەوە تا ئاستی پڕۆفیسۆر).
٣. بیرگە و بەردەوامی: دەبێت هەمیشە هەموو ئەو زانیارییانەت لەبیر بێت کە لە سەرەتای گفتوگۆکەوە باسکراون و پەیوەندی نێوان بەشەکان بپارێزیت.
٤. ڕەوشتی کار و بێلایەنی: لە بابەتە ئایینی، سیاسی و کۆمەڵایەتییەکاندا، وەک توێژەرێکی بێلایەن ڕەفتار بکە و هەموو لایەنەکان بە زانستی شی بکەرەوە.
٥. بیرگەی دەرەکی و ناوەکی: هەمیشە پشت بە زانیارییە نوێیەکان ببەستە لە ڕێگەی گەڕان لە ئینتەرنێت (External Memory) و بەرزترین ئاستی بیرکردنەوە (High Thinking Level) بەکاربهێنە بۆ شیکردنەوەی لۆژیکی.
`;

  while (attempts < maxAttempts) {
    const keyToUse = getNextApiKey();
    try {
      const ai = new GoogleGenAI({ apiKey: keyToUse });
      const response = await ai.models.generateContent({
        model: "gemini-3.1-pro-preview",
        contents: history,
        config: {
          systemInstruction: systemInstruction,
          thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH },
          tools: [{ googleSearch: {} }],
          temperature: 0.2,
          topP: 0.95,
        }
      });
      
      const replyText = response.text;

      // Save to Supabase if configured
      if (supabase) {
        try {
          const userMessage = history[history.length - 1]?.parts?.[0]?.text;
          if (userMessage) {
            const { error } = await (supabase.from('chat_history') as unknown as { insert: (data: unknown[]) => Promise<{ error: any }> }).insert([
              { role: 'user', content: userMessage },
              { role: 'model', content: replyText }
            ]);
            if (error) {
              console.error("Supabase Insert Error:", error.message || error);
            }
          }
        } catch (dbError: any) {
          console.error("Supabase Error:", dbError.message || dbError);
          // Don't fail the request if DB save fails
        }
      }

      return res.json({ reply: replyText });
    } catch (error) {
      const err = error as { status?: number };
      if (err.status === 429) {
        console.warn('Key limit reached. Switching to next key...');
        attempts++;
      } else {
        console.error("API Error:", error);
        return res.status(500).json({ error: "Internal Server Error" });
      }
    }
  }
  return res.status(429).json({ error: "All API keys are exhausted." });
});

app.post('/api/tts', async (req, res) => {
  const text = req.body.text;
  let attempts = 0;
  const maxAttempts = 3;

  while (attempts < maxAttempts) {
    const keyToUse = getNextApiKey();
    try {
      const ai = new GoogleGenAI({ apiKey: keyToUse });
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: { parts: [{ text: text }] },
        config: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: 'Aoede' }
            },
          },
        },
      });
      
      const audioData = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (audioData) {
        return res.json({ audio: audioData });
      } else {
        throw new Error('No audio data received');
      }
    } catch (error) {
      const err = error as { status?: number };
      if (err.status === 429) {
        console.warn('Key limit reached (TTS). Switching to next key...');
        attempts++;
      } else {
        console.error("TTS API Error:", error);
        return res.status(500).json({ error: "TTS Internal Server Error" });
      }
    }
  }
  return res.status(429).json({ error: "All API keys are exhausted." });
});

/**
 * Serve static files from /browser
 */
app.use(
  express.static(browserDistFolder, {
    maxAge: '1y',
    index: false,
    redirect: false,
  }),
);

/**
 * Handle all other requests by rendering the Angular application.
 */
app.use((req, res, next) => {
  angularApp
    .handle(req)
    .then((response) =>
      response ? writeResponseToNodeResponse(response, res) : next(),
    )
    .catch(next);
});

/**
 * Start the server if this module is the main entry point, or it is ran via PM2.
 * The server listens on the port defined by the `PORT` environment variable, or defaults to 4000.
 */
if (isMainModule(import.meta.url) || process.env['pm_id']) {
  const port = process.env['PORT'] || 4000;
  app.listen(port, (error) => {
    if (error) {
      throw error;
    }

    console.log(`Node Express server listening on http://localhost:${port}`);
  });
}

/**
 * Request handler used by the Angular CLI (for dev-server and during build) or Firebase Cloud Functions.
 */
export const reqHandler = createNodeRequestHandler(app);
