// Copyright (c) 2025 Davide Chen
// SPDX-License-Identifier: MIT

import express from 'express';
import dotenv from 'dotenv';
import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { convertBpmnToDrawio } from './scripts/bpmn-to-drawio.js';

// Load environment variables from .env file
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// __dirname workaround for ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* ─────────── LOADS SYSTEM PROMPT ON STARTUP ─────────── */
const SYSTEM_PROMPT_PATH = path.join(__dirname, 'system_prompt.txt');
let cachedSystemPrompt = '';
try {
  cachedSystemPrompt = fs.readFileSync(SYSTEM_PROMPT_PATH, 'utf-8');
} catch (e) {
  console.warn('Initial system prompt read failed:', e.message);
}

function getSystemPrompt() {
  try {
    return fs.readFileSync(SYSTEM_PROMPT_PATH, 'utf-8');
  } catch (err) {
    return cachedSystemPrompt;
  }
}

// Helper to determine the local LLM URL (handling Docker container networking)
function getLocalBaseUrl() {
  let url = process.env.LOCAL_LLM_URL || 'http://127.0.0.1:8000/v1';
  // Inside Docker container on macOS (OrbStack / Docker Desktop),
  // 127.0.0.1 / localhost must point to host.docker.internal
  if (fs.existsSync('/.dockerenv')) {
    url = url
      .replace('://127.0.0.1', '://host.docker.internal')
      .replace('://localhost', '://host.docker.internal');
  }
  return url.replace(/\/+$/, '');
}

// Detect the active/loaded model on the local LLM server (oMLX, vLLM, Ollama, etc.)
async function getActiveLocalModel(baseUrl, apiKey) {
  // If explicitly configured in env, honor it
  if (process.env.LOCAL_LLM_MODEL) {
    return process.env.LOCAL_LLM_MODEL;
  }

  const headers = {};
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  // 1. Check /models/status (used by oMLX to report currently loaded model)
  try {
    const statusRes = await fetch(`${baseUrl}/models/status`, { headers });
    if (statusRes.ok) {
      const data = await statusRes.json();
      if (Array.isArray(data?.models)) {
        const loadedModel = data.models.find(m => m.loaded === true);
        if (loadedModel?.id) {
          return loadedModel.id;
        }
      }
    }
  } catch (err) {
    // Continue to next probe
  }

  // 2. Fall back to standard OpenAI /models endpoint
  try {
    const modelsRes = await fetch(`${baseUrl}/models`, { headers });
    if (modelsRes.ok) {
      const data = await modelsRes.json();
      if (Array.isArray(data?.data) && data.data.length > 0) {
        return data.data[0].id;
      }
    }
  } catch (err) {
    // Continue to default
  }

  return 'default';
}

// Serve static files (HTML, CSS, JS) from 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

/* ─────────── GET ACTIVE LOCAL MODEL INFO ─────────── */
app.get('/api/active-model', async (req, res) => {
  try {
    const baseUrl = getLocalBaseUrl();
    const apiKey = process.env.LOCAL_LLM_API_KEY || '';
    const model = await getActiveLocalModel(baseUrl, apiKey);
    res.json({
      model,
      configuredUrl: process.env.LOCAL_LLM_URL || 'http://127.0.0.1:8000/v1',
      resolvedUrl: baseUrl
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/* ─────────── BPMN TO DRAW.IO CONVERSION ENDPOINT ─────────── */
app.post('/api/convert-to-drawio', express.text({ type: ['text/xml', 'application/xml', 'text/plain', 'application/octet-stream', 'application/json'], limit: '10mb' }), async (req, res) => {
  try {
    let xml = req.body;
    if (typeof xml === 'object' && xml?.xml) {
      xml = xml.xml;
    }
    if (typeof xml !== 'string' || !xml.trim()) {
      return res.status(400).json({ error: 'No BPMN XML provided in request body.' });
    }
    const drawioXml = await convertBpmnToDrawio(xml);
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="diagram.drawio"');
    res.send(drawioXml);
  } catch (error) {
    console.error('BPMN to Draw.io conversion error:', error);
    res.status(500).json({ error: error.message });
  }
});

/* ─────────── BACKEND PROXY FOR LLM APIs ─────────── */
app.post('/api/process', express.json(), async (req, res) => {
  const userPrompt = req.body.prompt;
  const modelSelected = req.body.model || 'local';
  const reasoner = req.body.reasoner;

  let apiUrl = '';
  let apiKey = '';
  let modelName = '';

  // Decide which provider to use
  if (modelSelected === 'local') {
    const baseUrl = getLocalBaseUrl();
    apiUrl = `${baseUrl}/chat/completions`;
    apiKey = process.env.LOCAL_LLM_API_KEY || '';
    modelName = await getActiveLocalModel(baseUrl, apiKey);
    console.log(`[Local LLM] Using URL: ${apiUrl} | Active Model: ${modelName}`);
  } else if (modelSelected === 'chatgpt') {
    apiUrl = 'https://api.openai.com/v1/chat/completions';
    apiKey = process.env.OPENAI_API_KEY;
    modelName = reasoner ? 'o3-2025-04-16' : 'gpt-4o';
  } else if (modelSelected === 'deepseek') {
    apiUrl = 'https://api.deepseek.com/v1/chat/completions';
    apiKey = process.env.DEEPSEEK_API_KEY;
    modelName = reasoner ? 'deepseek-reasoner' : 'deepseek-chat';
  } else {
    return res.status(400).json({ error: 'Invalid model selected' });
  }

  try {
    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const isReasonerModel = Boolean(reasoner) || modelName.includes('reasoner') || modelName.startsWith('o1') || modelName.startsWith('o3');

    const payload = {
      model: modelName,
      messages: [
        { role: 'system', content: getSystemPrompt() },
        { role: 'user', content: userPrompt }
      ],
      stream: true
    };

    if (modelName === 'o3-2025-04-16' || modelName.startsWith('o1') || modelName.startsWith('o3')) {
      // OpenAI reasoning models use max_completion_tokens and do not support custom temperature
      payload.max_completion_tokens = 16384;
    } else if (modelSelected === 'local') {
      // Local models in oMLX have large context windows (32k - 256k); set max_tokens to 16384
      // so that reasoning tokens + complete BPMN XML generation never get truncated.
      payload.max_tokens = 16384;
      payload.temperature = 0.1;
      payload.enable_thinking = Boolean(reasoner);
      payload.chat_template_kwargs = { thinking: Boolean(reasoner) };
    } else {
      payload.max_tokens = isReasonerModel ? 8192 : 4096;
      // DeepSeek Reasoner does not support custom temperature
      if (modelName !== 'deepseek-reasoner') {
        payload.temperature = 0.1;
      }
    }

    const apiResponse = await fetch(apiUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });

    if (!apiResponse.ok) {
      const errText = await apiResponse.text();
      console.error(`LLM API error (${apiResponse.status}):`, errText);
      return res.status(apiResponse.status).json({
        error: `LLM API returned HTTP ${apiResponse.status}`,
        details: errText
      });
    }

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    apiResponse.body.on('data', (chunk) => {
      res.write(chunk);
    });

    apiResponse.body.on('end', () => {
      res.end();
    });

    apiResponse.body.on('error', (err) => {
      console.error('Stream error:', err);
      res.status(500).json({ error: 'Error while streaming response' });
    });

  } catch (error) {
    console.error('Streaming error:', error);
    res.status(500).json({
      error: 'Streaming API error',
      details: error.message
    });
  }
});

/* ─────────── START THE SERVER ─────────── */
app.listen(PORT, () => {
  console.log(`Server is running at http://localhost:${PORT}`);
});
