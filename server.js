// Copyright (c) 2025 Davide Chen
// SPDX-License-Identifier: MIT

import express from 'express';
import compression from 'compression';
import dotenv from 'dotenv';
import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { convertBpmnToDrawio } from './scripts/bpmn-to-drawio.js';
import { convertBpmnToD2, renderD2ToSvg } from './scripts/bpmn-to-d2.js';

// Load environment variables from .env file
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Enable gzip compression for all responses (~60-70% smaller payloads)
app.use(compression());

// __dirname workaround for ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* ─────────── LOADS SYSTEM PROMPT ON STARTUP ─────────── */
const SYSTEM_PROMPT_PATH = path.join(__dirname, 'system_prompt.txt');
const SYSTEM_PROMPT_CAMUNDA_PATH = path.join(__dirname, 'system_prompt_camunda.txt');
let cachedSystemPrompt = '';
let cachedCamundaSystemPrompt = '';

try {
  cachedSystemPrompt = fs.readFileSync(SYSTEM_PROMPT_PATH, 'utf-8');
} catch (e) {
  console.warn('Initial system prompt read failed:', e.message);
}

try {
  cachedCamundaSystemPrompt = fs.readFileSync(SYSTEM_PROMPT_CAMUNDA_PATH, 'utf-8');
} catch (e) {
  console.warn('Initial Camunda system prompt read failed:', e.message);
}

function getSystemPrompt(engine = 'standard') {
  const filePath = engine === 'camunda8' ? SYSTEM_PROMPT_CAMUNDA_PATH : SYSTEM_PROMPT_PATH;
  const fallback = engine === 'camunda8' ? cachedCamundaSystemPrompt : cachedSystemPrompt;
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch (err) {
    return fallback;
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

/* ─────────── BPMN TO D2 CONVERSION & RENDER ENDPOINT ─────────── */
app.post('/api/convert-to-d2', express.json({ limit: '10mb' }), async (req, res) => {
  try {
    const xml = req.body?.xml || (typeof req.body === 'string' ? req.body : '');
    if (!xml || !xml.trim()) {
      return res.status(400).json({ error: 'No BPMN XML provided.' });
    }
    const d2Code = await convertBpmnToD2(xml);
    res.json({ d2: d2Code });
  } catch (error) {
    console.error('BPMN to D2 conversion error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/render-d2', express.json({ limit: '10mb' }), async (req, res) => {
  try {
    let { xml, d2: d2Input, theme = '105', layout = 'elk' } = req.body || {};
    let d2Code = d2Input;
    if (!d2Code && xml) {
      d2Code = await convertBpmnToD2(xml);
    }
    if (!d2Code || !d2Code.trim()) {
      return res.status(400).json({ error: 'No D2 code or BPMN XML provided.' });
    }
    const svg = await renderD2ToSvg(d2Code, { theme, layout });
    res.json({ svg, d2: d2Code, d2Installed: Boolean(svg) });
  } catch (error) {
    console.error('D2 render error:', error);
    res.status(500).json({ error: error.message });
  }
});

/* ─────────── BACKEND PROXY FOR LLM APIs ─────────── */
app.post('/api/process', express.json(), async (req, res) => {
  const userPrompt = req.body.prompt;
  const modelSelected = req.body.model || 'local';
  const reasoner = req.body.reasoner;
  const targetEngine = req.body.targetEngine || 'standard';

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
    const effectiveSystemPrompt = getSystemPrompt(targetEngine);
    console.log(`[LLM Request] Target Engine: ${targetEngine} | Model: ${modelName} | Reasoner: ${reasoner}`);

    const payload = {
      model: modelName,
      messages: [
        { role: 'system', content: effectiveSystemPrompt },
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
      // Note: oMLX model max_tokens is also set to 16384 via admin API.
      payload.max_tokens = 16384;
      payload.temperature = 0.1;
      payload.enable_thinking = Boolean(reasoner);
      payload.chat_template_kwargs = { thinking: Boolean(reasoner) };
    } else {
      // Use 16384 for all cloud providers to avoid XML truncation on complex BPMN diagrams
      payload.max_tokens = isReasonerModel ? 16384 : 8192;
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
function printStartupBanner() {
  const isDocker = Boolean(process.env.DOCKER_CONTAINER) ||
                   fs.existsSync('/.dockerenv') ||
                   fs.existsSync('/run/.containerenv');
  const port = PORT;
  const url = `http://localhost:${port}`;

  const reset = '\x1b[0m';
  const bold = '\x1b[1m';
  const cyan = '\x1b[36m';
  const green = '\x1b[32m';
  const yellow = '\x1b[33m';
  const dim = '\x1b[90m';

  const stripAnsi = (str) => str.replace(/\x1b\[[0-9;]*m/g, '');
  const width = 64;
  const line = '─'.repeat(width);
  const padLine = (content, targetWidth) => {
    const visible = stripAnsi(content).length;
    return content + ' '.repeat(Math.max(0, targetWidth - visible));
  };
  const row = (text) => console.log(`${cyan}│${reset} ${padLine(text, width - 2)} ${cyan}│${reset}`);

  console.log(`\n${cyan}┌${line}┐${reset}`);
  row(`${bold}🚀 Text-to-BPMN 2.0${reset} ${isDocker ? `${dim}(Docker Container)${reset}` : ''}`);
  console.log(`${cyan}├${line}┤${reset}`);
  row('');
  row(`${bold}🌐 Aplicación publicada en:${reset}`);
  row(`   ${green}➜  ${bold}${url}${reset}`);
  row('');
  if (isDocker) {
    row(`${bold}📋 Guía de comandos útiles (Docker):${reset}`);
    row('');
    row(`  ${yellow}• Ver logs en directo:${reset}`);
    row(`    ${dim}$${reset} docker compose logs -f    ${dim}(o docker logs -f text-to-bpmn)${reset}`);
    row('');
    row(`  ${yellow}• Reiniciar contenedor:${reset}`);
    row(`    ${dim}$${reset} docker compose restart    ${dim}(o docker restart text-to-bpmn)${reset}`);
    row('');
    row(`  ${yellow}• Detener la aplicación:${reset}`);
    row(`    ${dim}$${reset} docker compose down       ${dim}(o docker stop text-to-bpmn)${reset}`);
    row('');
    row(`  ${yellow}• Terminal interactiva:${reset}`);
    row(`    ${dim}$${reset} docker compose exec text-to-bpmn sh`);
    row('');
    row(`  ${yellow}• Convertir diagramas BPMN a Draw.io:${reset}`);
    row(`    ${dim}$${reset} docker compose exec text-to-bpmn npm run convert:drawio`);
    row('');
    row(`  ${yellow}• Reconstruir imagen (tras cambios en config/deps):${reset}`);
    row(`    ${dim}$${reset} docker compose up --build -d`);
  } else {
    row(`${bold}📋 Guía de comandos útiles:${reset}`);
    row('');
    row(`  ${yellow}• Modo desarrollo (auto-reload):${reset}`);
    row(`    ${dim}$${reset} npm run dev`);
    row('');
    row(`  ${yellow}• Recompilar bundle frontend (Rollup):${reset}`);
    row(`    ${dim}$${reset} npm run build`);
    row('');
    row(`  ${yellow}• Convertir diagramas BPMN a Draw.io:${reset}`);
    row(`    ${dim}$${reset} npm run convert:drawio`);
    row('');
    row(`  ${yellow}• Iniciar con Docker Compose:${reset}`);
    row(`    ${dim}$${reset} docker compose up -d`);
  }
  row('');
  row(`${bold}🔍 Verificación de API:${reset}`);
  row(`   ${dim}➜${reset} ${url}/api/active-model`);
  console.log(`${cyan}└${line}┘${reset}\n`);
}

app.listen(PORT, () => {
  printStartupBanner();
});
