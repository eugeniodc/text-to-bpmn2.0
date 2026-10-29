// Copyright (c) 2025 Davide Chen
// SPDX-License-Identifier: MIT

import { layoutBpmnWithElk } from './elk-layout.js';
import BpmnModeler from 'bpmn-js/lib/Modeler';
import lintModule   from 'bpmn-js-bpmnlint';
import lintConfig   from '../.bpmnlintrc';   // grazie al plug-in Rollup
import { marked } from 'marked';

/* ───────────  MODELER + LINTER ─────────── */
const modeler = new BpmnModeler({
  container: '#canvas',

  additionalModules: [ lintModule ],
  linting: { bpmnlint: lintConfig }
});

// Expose modeler on window for debugging & inspection
window.modeler = modeler;

// active linting panel right away
modeler.get('linting').toggle();

const chatLog = document.getElementById('chat-log');
const chatInput = document.getElementById('chat-message');
const sidebar = document.getElementById('sidebar');
const fullscreenLabel = document.getElementById('fullscreen-label');
const fileDrop = document.getElementById('file-drop-area');
const fileInput = document.getElementById('file-input');

// For Expand || Collapse button
let isFullscreen = false;
function toggleFullscreen() {
  isFullscreen = !isFullscreen;
  sidebar.style.marginLeft = isFullscreen ? '-35%' : '0';
  fullscreenLabel.textContent = isFullscreen ? 'Collapse' : 'Expand';
}

/* ─────────── ENGINE SELECTION & BADGE ─────────── */
const engineSelect = document.getElementById('target-engine-select');
const engineBadge = document.getElementById('engine-badge');

function updateEngineBadge() {
  if (!engineBadge) return;
  const isCamunda = engineSelect ? engineSelect.value === 'camunda8' : true;
  engineBadge.textContent = isCamunda ? '⚡ Camunda 8' : '📄 Estándar';
  engineBadge.className = `engine-badge ${isCamunda ? 'camunda' : 'standard'}`;
  if (engineSelect) {
    if (isCamunda) {
      engineSelect.style.borderColor = '#ea580c';
      engineSelect.style.color = '#c2410c';
    } else {
      engineSelect.style.borderColor = '#0284c7';
      engineSelect.style.color = '#0369a1';
    }
  }
}

if (engineSelect) {
  engineSelect.addEventListener('change', updateEngineBadge);
  updateEngineBadge();
}


/* ──── LOAD DEFAULT BPMN DIAGRAM FROM EXTERNAL FILE ───── */

let colorsEnabled = true;
const defaultDiagramURL = '../diagram/default.bpmn';

fetch(defaultDiagramURL)
  .then(response => {
    if (!response.ok) {
      throw new Error('Failed to load BPMN file');
    }
    return response.text();
  })
  .then(xml => modeler.importXML(xml))
  .then(() => {
    console.log('✅ BPMN diagram loaded successfully');
    if (colorsEnabled) applyBpmnColors();
    fitView();
  })
  .catch(error => {
    console.error('❌ Error loading BPMN diagram:', error);
  });

// Auto resize chat input field
function autoResize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 160) + 'px';
}


/* ────  CHAT HISTORY LAYOUT  ───── */

function sendMSG() {
  const text = chatInput.value.trim();
  if (!text) return;

  // 1. Show user message
  const userMessage = document.createElement('div');
  userMessage.className = 'chat-msg user';
  userMessage.innerHTML = `<div class="msg-header">User</div><div class="msg-content">${text}</div>`;  chatLog.appendChild(userMessage);
  chatLog.scrollTop = chatLog.scrollHeight;

  // 2. Reset textarea
  chatInput.value = '';
  chatInput.style.height = 'auto';

  // 3. Send the prompt
  sendPrompt(text);
}
    
chatInput.addEventListener('input', () => autoResize(chatInput));
chatInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMSG();
  }
});

/* ─────────── SENDING PROMPT TO SERVER ─────────── */

async function callModelAPI(prompt, onDataChunk) {
  const model = document.getElementById('global-model-select').value;
  const reasoner = document.getElementById('model-status').innerText.trim().toLowerCase() === 'on';
  const targetEngine = document.getElementById('target-engine-select')?.value || 'camunda8';

  const response = await fetch('/api/process', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, model, reasoner, targetEngine })
  });

  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let pendingBuffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    pendingBuffer += decoder.decode(value, { stream: true });
    let lines = pendingBuffer.split('\n');
    pendingBuffer = lines.pop(); // salva l’ultima riga incompleta per dopo

    for (let line of lines) {
      line = line.trim();
      if (!line.startsWith('data:')) continue;

      const jsonStr = line.substring(5).trim();
      if (jsonStr.trim().startsWith('[DONE')) break;

      try {
        const parsed = JSON.parse(jsonStr);
        const delta = parsed?.choices?.[0]?.delta;

        // Read the chunk from the model, cleanly separating reasoning_content and standard content
        const reasoningChunk = typeof delta?.reasoning_content === 'string' ? delta.reasoning_content : '';
        const contentChunk = typeof delta?.content === 'string' ? delta.content : '';

        if (reasoningChunk !== '' || contentChunk !== '') {
          onDataChunk({ reasoning: reasoningChunk, content: contentChunk }); 
        }
      } catch (e) {
        console.warn('JSON incomplete or broken chunk, retrying...', e);
        pendingBuffer = 'data: ' + jsonStr + '\n' + pendingBuffer;
        break;
      }
    }
  }
} 

/* ─────────── MESSAGE HANDLING ─────────── */

// Creates and shows the "typing…" indicator. 
function showTypingIndicator() {
  const indicator = document.createElement('div');
  indicator.className = 'chat-msg bot';
  indicator.innerHTML =
    '<div class="typing-indicator"><span></span><span></span><span></span></div>';
  chatLog.appendChild(indicator);
  chatLog.scrollTop = chatLog.scrollHeight;
  return indicator;
}

// Creates the bot message wrapper (before adding content).
function createBotMessage() {
  const el = document.createElement('div');
  el.className = 'chat-msg bot';
  chatLog.appendChild(el);
  chatLog.scrollTop = chatLog.scrollHeight;
  return el;
}

/* ─────────── STREAM HANDLING ─────────── */

// Maintains shared state during chunked response
function initStreamContext() {
  return {
    botMessage: null,
    streamEl: null,
    reasoningEl: null,
    contentEl: null,
    reasoningRaw: '',
    contentRaw: '',
    fullRaw: ''
  };
}

// Initial rendering and progressive chunk appending
function handleStreamChunk(chunkData, ctx) {
  let reasoningPart = '';
  let contentPart = '';
  if (typeof chunkData === 'string') {
    contentPart = chunkData;
  } else if (chunkData) {
    reasoningPart = chunkData.reasoning || '';
    contentPart = chunkData.content || '';
  }

  // 1st chunk: removes the indicator and prepares the containers
  if (!ctx.botMessage) {
    if (ctx.typingIndicator && ctx.typingIndicator.parentNode) {
      chatLog.removeChild(ctx.typingIndicator);
    }
    ctx.botMessage = createBotMessage();

    const header = document.createElement('div');
    header.className = 'msg-header';
    header.innerText = 'System';
    ctx.botMessage.appendChild(header);

    if (modelStatus.textContent === 'On') {
      const reasoningBlock = document.createElement('div');
      reasoningBlock.className = 'reasoning-block';

      const title = document.createElement('strong');
      title.textContent = '🤔 Reasoning...';

      ctx.reasoningEl = document.createElement('div');
      ctx.reasoningEl.className = 'reasoning-text';
      ctx.reasoningEl.style.whiteSpace = 'pre-wrap';

      reasoningBlock.appendChild(title);
      reasoningBlock.appendChild(ctx.reasoningEl);
      ctx.botMessage.appendChild(reasoningBlock);

      ctx.contentEl = document.createElement('div');
      ctx.contentEl.className = 'msg-content';
      ctx.contentEl.style.whiteSpace = 'pre-wrap';
      ctx.botMessage.appendChild(ctx.contentEl);
    } else {
      ctx.contentEl = document.createElement('div');
      ctx.contentEl.className = 'msg-content';
      ctx.contentEl.style.whiteSpace = 'pre-wrap';
      ctx.botMessage.appendChild(ctx.contentEl);
    }
  }

  if (reasoningPart) {
    ctx.reasoningRaw += reasoningPart;
    if (ctx.reasoningEl) {
      ctx.reasoningEl.textContent += reasoningPart;
    }
  }

  if (contentPart) {
    ctx.contentRaw += contentPart;
    if (ctx.contentEl) {
      ctx.contentEl.textContent += contentPart;
    }
  }

  ctx.fullRaw += (reasoningPart + contentPart);
  chatLog.scrollTop = chatLog.scrollHeight;
}

/* ─────────── FINAL RENDERING ─────────── */

// Splits reasoning and XML output (if present)
function splitReasoningOutput(raw) {
  // Strip <think>...</think> if present
  const thinkMatch = raw.match(/<think>([\s\S]*?)<\/think>/i);
  if (thinkMatch) {
    return {
      reasoning: thinkMatch[1].trim(),
      output: raw.replace(/<think>[\s\S]*?<\/think>/i, '').trim()
    };
  }

  const xmlStart = raw.search(/```xml|<\?xml|<(?:bpmn:)?definitions/i);
  return xmlStart !== -1
    ? { reasoning: raw.slice(0, xmlStart).trim(), output: raw.slice(xmlStart).trim() }
    : { reasoning: raw.trim(), output: '' };
}

// Converts the XML part into a highlighted Markdown block
function formatXml(xml) {
  return marked.parse('```xml\n' + xml + '\n```');
}

// Rendering the final message output
function finalizeBotMessage(ctx, startTime) {
  const { botMessage, reasoningRaw, contentRaw, fullRaw } = ctx;

  if (!botMessage) return;

  botMessage.innerHTML = ''; 

  if (modelStatus.textContent === 'On') {
    let reasoning = reasoningRaw;
    let output = contentRaw;

    if (!reasoning && !output && fullRaw) {
      const split = splitReasoningOutput(fullRaw);
      reasoning = split.reasoning;
      output = split.output;
    } else if (!output && fullRaw) {
      output = fullRaw;
    }

    if (reasoning) {
      const block = document.createElement('div');
      block.className = 'reasoning-block';

      const title = document.createElement('strong');
      title.textContent = '🤔 Reasoning...';

      const text = document.createElement('div');
      text.className = 'reasoning-text';
      text.textContent = reasoning;

      block.appendChild(title);
      block.appendChild(text);
      botMessage.appendChild(block);
    }

    if (output) {
      const outBlock = document.createElement('div');
      outBlock.className = 'output-block';
      outBlock.innerHTML = formatXml(output);
      botMessage.appendChild(outBlock);
      hljs.highlightAll();
    }
  } else {
    const header = document.createElement('div');
    header.className = 'msg-header';
    header.innerText = 'System';

    const content = document.createElement('div');
    content.className = 'msg-content';
    content.innerHTML = marked.parse(contentRaw || fullRaw);

    botMessage.appendChild(header);
    botMessage.appendChild(content);
    hljs.highlightAll();
  }

  botMessage.appendChild(buildReplyInfo(startTime));
}

// Compute the response time and displays it
function buildReplyInfo(startTime) {
  const elapsed = Math.floor((Date.now() - startTime) / 1000);
  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;
  const timeStr = minutes ? `${minutes} min ${seconds} sec` : `${seconds} seconds`;

  const info = document.createElement('div');
  info.className = 'reply-time';
  info.textContent = `Replied in ${timeStr}`;
  return info;
}

/* ─────────── BPMN XML PROCESSING & ENRICHMENT ─────────── */

// Complete auto-layout and diagram enrichment pipeline powered by ELK (Eclipse Layout Kernel):
async function layoutAndEnrichDiagram(inputXml) {
  if (!inputXml) return inputXml;
  return await layoutBpmnWithElk(inputXml);
}

// Imports BPMN if present and shows the outcome to the user
async function tryImportBpmn(xml) {
  if (!xml) {
    addMsg('No valid BPMN XML found in the response ❌. Please try again with more details.', 'bot');
    return;
  }

  // Normalize broken / typo prefixes (e.g. <bn:flowNodeRef>, <bp:tag>, <bpm:tag>, <bpmn2:tag>)
  let cleanXml = xml.replace(/<\/?(?:bn|bpm|bpmn2|bp):([a-zA-Z0-9_-]+)/gi, (match, tag) => {
    return match.startsWith('</') ? `</bpmn:${tag}` : `<bpmn:${tag}`;
  });

  // Normalize untyped tags without prefix
  cleanXml = cleanXml.replace(/<(flowNodeRef|laneSet|lane|sequenceFlow|exclusiveGateway|parallelGateway|inclusiveGateway|complexGateway|eventBasedGateway|task|userTask|serviceTask|sendTask|receiveTask|manualTask|businessRuleTask|scriptTask|callActivity|subProcess|startEvent|endEvent|intermediateCatchEvent|intermediateThrowEvent|boundaryEvent|dataObjectReference|dataStoreReference|textAnnotation|association)\b/gi, '<bpmn:$1')
                     .replace(/<\/(flowNodeRef|laneSet|lane|sequenceFlow|exclusiveGateway|parallelGateway|inclusiveGateway|complexGateway|eventBasedGateway|task|userTask|serviceTask|sendTask|receiveTask|manualTask|businessRuleTask|scriptTask|callActivity|subProcess|startEvent|endEvent|intermediateCatchEvent|intermediateThrowEvent|boundaryEvent|dataObjectReference|dataStoreReference|textAnnotation|association)>/gi, '</bpmn:$1>');

  // Normalize <bpmn:dataAssociation> directly under process into valid <bpmn:association>
  cleanXml = cleanXml.replace(/<bpmn:dataAssociation\b/gi, '<bpmn:association')
                    .replace(/<\/bpmn:dataAssociation>/gi, '</bpmn:association>');

  // Ensure standard namespaces exist
  if (!cleanXml.includes('xmlns:bpmn=')) {
    cleanXml = cleanXml.replace(
      /(<(?:\w+:)?definitions)/i,
      '$1 xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI"'
    );
  }

  // Ensure alias namespaces exist to prevent parser crashes on any residual prefixes
  if (!cleanXml.includes('xmlns:bn=')) {
    cleanXml = cleanXml.replace(/(<(?:\w+:)?definitions\b[^>]*)/i, '$1 xmlns:bn="http://www.omg.org/spec/BPMN/20100524/MODEL"');
  }
  if (!cleanXml.includes('xmlns:bpmn2=')) {
    cleanXml = cleanXml.replace(/(<(?:\w+:)?definitions\b[^>]*)/i, '$1 xmlns:bpmn2="http://www.omg.org/spec/BPMN/20100524/MODEL"');
  }

  try {
    let layouted = await layoutAndEnrichDiagram(cleanXml);
    await modeler.importXML(layouted);
    if (colorsEnabled) applyBpmnColors();
    fitView();
    addMsg('Diagram generated and auto-arranged successfully ✅', 'bot');
  } catch (err) {
    console.warn('Direct importXML failed, attempting auto-layout fallback with clean semantic model:', err);
    try {
      // Strip any broken or truncated BPMNDiagram block and let auto-layout regenerate clean layout
      const semanticOnly = cleanXml.replace(/<bpmndi:BPMNDiagram[\s\S]*?<\/bpmndi:BPMNDiagram>/gi, '');
      let layouted = await layoutAndEnrichDiagram(semanticOnly);
      await modeler.importXML(layouted);
      if (colorsEnabled) applyBpmnColors();
      fitView();
      addMsg('Diagram generated and auto-arranged successfully ✅', 'bot');
    } catch (layoutErr) {
      console.error('❌ Error during importXML and auto-layout:', layoutErr);
      addMsg(`Generated BPMN contains errors ⚠️: ${err.message || layoutErr.message || 'Invalid syntax'}`, 'bot');
    }
  }
}

/* ─────────── MAIN PIPELINE FUNCTION ─────────── */

async function sendPrompt(customText = null) {
  const isCustom = customText !== null;
  const txt = isCustom ? customText.trim() : chatInput.value.trim();
  if (!txt) return;

  const startTime = Date.now();

  // reset input field
  if (!isCustom) {
    chatInput.value = '';
    autoResize(chatInput);
  }

  // Shared state of the streaming
  const ctx = initStreamContext();
  ctx.typingIndicator = showTypingIndicator();

  try {
    await callModelAPI(txt, chunk => handleStreamChunk(chunk, ctx));

    // final parsing finale and rendering
    finalizeBotMessage(ctx, startTime);

    // Prefer extracting from contentRaw (pure model response without thinking), fall back to fullRaw
    const xmlResponse = extractXmlFromResponse(ctx.contentRaw) || extractXmlFromResponse(ctx.fullRaw);
    await tryImportBpmn(xmlResponse);
  } catch (error) {
    console.error('API Error:', error);
    chatLog.removeChild(ctx.typingIndicator);
    addMsg(`Error: ${error.message}`, 'bot');
  }
}

// Auto-repair missing closing tags if XML was cut off near the end
function repairTruncatedXml(xml) {
  if (!xml) return xml;
  let repaired = xml.trim();

  // If opening tag is incomplete at end, strip trailing partial tag
  repaired = repaired.replace(/<[^>]*$/, '').trim();

  // If definitions opened but not closed
  if (/<(?:\w+:)?definitions/i.test(repaired) && !/<\/(?:\w+:)?definitions>/i.test(repaired)) {
    if (/<(?:\w+:)?process/i.test(repaired) && !/<\/(?:\w+:)?process>/i.test(repaired)) {
      repaired += '\n  </bpmn:process>';
    }
    repaired += '\n</bpmn:definitions>';
  }
  return repaired;
}

function extractXmlFromResponse(content) {
  if (!content) return null;

  // Strip <think>...</think> tags if present from local reasoning models
  let cleanContent = content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

  // 1. Check for fenced code block ```xml ... ``` or ```bpmn ... ``` or ``` ... ```
  const codeBlockMatches = [...cleanContent.matchAll(/```(?:xml|bpmn)?\s*([\s\S]*?)(?:```|$)/gi)];
  for (let i = codeBlockMatches.length - 1; i >= 0; i--) {
    let block = codeBlockMatches[i][1].trim();
    if (/<(?:\w+:)?definitions/i.test(block)) {
      return repairTruncatedXml(block);
    }
  }

  // 2. Direct regex match for complete definitions block (take the last one)
  const bpmnMatches = [...cleanContent.matchAll(/<bpmn:definitions[\s\S]*?<\/bpmn:definitions>/gi)];
  if (bpmnMatches.length > 0) {
    return bpmnMatches[bpmnMatches.length - 1][0].trim();
  }

  const defMatches = [...cleanContent.matchAll(/<(?:bpmn2:)?definitions[\s\S]*?<\/(?:bpmn2:)?definitions>/gi)];
  if (defMatches.length > 0) {
    return defMatches[defMatches.length - 1][0].trim();
  }

  // 3. Fallback: match from the last opening definitions tag
  const lastStartIdx = cleanContent.lastIndexOf('<bpmn:definitions');
  const genericStartIdx = lastStartIdx !== -1 ? lastStartIdx : cleanContent.search(/<(?:\w+:)?definitions/i);
  if (genericStartIdx !== -1) {
    let extracted = cleanContent.slice(genericStartIdx).trim();
    extracted = extracted.replace(/```+\s*$/, '').trim();
    return repairTruncatedXml(extracted);
  }

  // 4. Fallback: if only <bpmn:process> was provided without definitions wrapper
  if (/<(?:\w+:)?process/i.test(cleanContent)) {
    const processMatch = cleanContent.match(/<(?:\w+:)?process[\s\S]*?<\/(?:\w+:)?process>/i)
      || cleanContent.match(/<(?:\w+:)?process[\s\S]*$/i);
    if (processMatch) {
      let proc = repairTruncatedXml(processMatch[0].trim());
      if (!/<\/(?:\w+:)?process>/i.test(proc)) proc += '\n</bpmn:process>';
      return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
                  xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
                  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
                  xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
                  id="Definitions_1"
                  targetNamespace="http://bpmn.io/schema/bpmn">
  ${proc}
</bpmn:definitions>`;
    }
  }

  return null;
}

function addBotMessage(text) {
  const msg = document.createElement('div');
  msg.className = 'chat-msg bot';

  // SYSTEM HEADER
  const header = document.createElement('div');
  header.className = 'msg-header';
  header.innerText = 'System';
  msg.appendChild(header);

  // CONTENT (markdown)
  const content = document.createElement('div');
  content.className = 'msg-content';
  content.innerHTML = marked.parse(text);
  msg.appendChild(content);

  chatLog.appendChild(msg);
  chatLog.scrollTop = chatLog.scrollHeight;

  hljs.highlightAll();
}


/* ─────────── EXPORTING & IMPORTING BUTTONS HANDLERS ─────────── */

async function loadBpmnXml(xmlContent, fileName = 'diagram.bpmn') {
  if (!xmlContent || !xmlContent.trim()) {
    addBotMessage('❌ El archivo seleccionado está vacío.');
    return false;
  }

  let cleanXml = xmlContent.trim();

  // Basic check for XML / BPMN definition
  if (!cleanXml.includes('<') || (!cleanXml.includes('definitions') && !cleanXml.includes('process'))) {
    addBotMessage(`⚠️ El archivo **${fileName}** no parece una definición BPMN XML válida.`);
    return false;
  }

  // Normalize broken / typo prefixes (e.g. <bn:flowNodeRef>, <bp:tag>, <bpm:tag>, <bpmn2:tag>)
  cleanXml = cleanXml.replace(/<\/?(?:bn|bpm|bpmn2|bp):([a-zA-Z0-9_-]+)/gi, (match, tag) => {
    return match.startsWith('</') ? `</bpmn:${tag}` : `<bpmn:${tag}`;
  });

  // Ensure standard BPMN namespaces exist if omitted
  if (!cleanXml.includes('xmlns:bpmn=')) {
    cleanXml = cleanXml.replace(
      /(<(?:\w+:)?definitions)/i,
      '$1 xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI"'
    );
  }
  if (!cleanXml.includes('xmlns:bn=')) {
    cleanXml = cleanXml.replace(/(<(?:\w+:)?definitions\b[^>]*)/i, '$1 xmlns:bn="http://www.omg.org/spec/BPMN/20100524/MODEL"');
  }
  if (!cleanXml.includes('xmlns:bpmn2=')) {
    cleanXml = cleanXml.replace(/(<(?:\w+:)?definitions\b[^>]*)/i, '$1 xmlns:bpmn2="http://www.omg.org/spec/BPMN/20100524/MODEL"');
  }

  const hasDiagram = cleanXml.includes('bpmndi:BPMNDiagram') && cleanXml.includes('bpmndi:BPMNPlane');

  try {
    if (hasDiagram) {
      // Direct import preserves existing diagram layout and coordinates
      await modeler.importXML(cleanXml);
      if (colorsEnabled) applyBpmnColors();
      fitView();
      addBotMessage(`📁 **${fileName}** cargado con éxito en el lienzo BPMN ✅`);
      return true;
    }

    // Diagram has no DI coordinates, apply auto-layout
    const layouted = await layoutAndEnrichDiagram(cleanXml);
    await modeler.importXML(layouted);
    if (colorsEnabled) applyBpmnColors();
    fitView();
    addBotMessage(`📁 **${fileName}** cargado y diagramado automáticamente con éxito ✅`);
    return true;
  } catch (directErr) {
    console.warn('Direct importXML failed, attempting auto-layout fallback:', directErr);
    try {
      const layouted = await layoutAndEnrichDiagram(cleanXml);
      await modeler.importXML(layouted);
      if (colorsEnabled) applyBpmnColors();
      fitView();
      addBotMessage(`📁 **${fileName}** cargado con auto-organización ✅`);
      return true;
    } catch (layoutErr) {
      console.error('Failed to import BPMN XML:', layoutErr);
      addBotMessage(`❌ Error al cargar **${fileName}**: ${directErr.message || layoutErr.message || 'Formato BPMN inválido'}`);
      return false;
    }
  }
}

// Expose on window for debugging & inspection
window.loadBpmnXml = loadBpmnXml;

// BPMN file input in toolbar
const importBPMNBtn = document.getElementById('importBPMN');
const bpmnFileInput = document.getElementById('bpmn-file-input');

if (importBPMNBtn && bpmnFileInput) {
  importBPMNBtn.addEventListener('click', () => {
    bpmnFileInput.click();
  });

  bpmnFileInput.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (ev) => {
      const xml = ev.target.result;
      await loadBpmnXml(xml, file.name);
      bpmnFileInput.value = '';
    };
    reader.onerror = () => {
      addBotMessage(`❌ Error al leer el archivo **${file.name}**.`);
      bpmnFileInput.value = '';
    };
    reader.readAsText(file);
  });
}

// Attach file button in chat input footer
const attachFileBtn = document.getElementById('attach-file-btn');
if (attachFileBtn && fileInput) {
  attachFileBtn.addEventListener('click', () => {
    fileInput.click();
  });
}

const exportSVGBtn = document.getElementById('exportSVG');
if (exportSVGBtn) exportSVGBtn.addEventListener('click', exportSVG);

const exportXMLBtn = document.getElementById('exportXML');
if (exportXMLBtn) exportXMLBtn.addEventListener('click', exportXML);

const exportDrawioBtn = document.getElementById('exportDrawio');
if (exportDrawioBtn) exportDrawioBtn.addEventListener('click', exportDrawio);

function exportXML() {
  const isCamunda = document.getElementById('target-engine-select')?.value === 'camunda8';
  const fileName = isCamunda ? 'diagram-camunda8.bpmn' : 'diagram.bpmn';
  modeler.saveXML({ format: true }).then(({ xml }) => download(fileName, xml));
}
function exportSVG() {
  modeler.saveSVG().then(({ svg }) => download('diagram.svg', svg));
}

function escapeXml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function getDrawioStyle(el) {
  const type = el.type || el.businessObject?.$type || '';
  const bo = el.businessObject || {};

  // Pools & Lanes (Swimlanes in Draw.io)
  if (type === 'bpmn:Participant') {
    return 'swimlane;html=1;horizontal=0;whiteSpace=wrap;startSize=30;collapsible=0;fillColor=#f8f9fa;strokeColor=#333333;strokeWidth=1.5;fontFamily=Helvetica;fontSize=12;fontStyle=1;verticalAlign=middle;align=center;';
  }
  if (type === 'bpmn:Lane') {
    return 'swimlane;html=1;horizontal=0;whiteSpace=wrap;startSize=30;collapsible=0;fillColor=none;strokeColor=#757575;strokeWidth=1;fontFamily=Helvetica;fontSize=11;fontStyle=1;verticalAlign=middle;align=center;';
  }

  // Task & Activity Styles
  const baseTask = 'shape=mxgraph.bpmn.task;whiteSpace=wrap;html=1;rounded=1;arcSize=14;strokeColor=#1565c0;fillColor=#e3f2fd;strokeWidth=2;align=center;fontFamily=Helvetica;fontSize=12;';
  if (type === 'bpmn:Task') return baseTask;
  if (type === 'bpmn:UserTask') return baseTask + 'taskMarker=user;';
  if (type === 'bpmn:ServiceTask') return baseTask + 'taskMarker=service;';
  if (type === 'bpmn:SendTask') return baseTask + 'taskMarker=send;';
  if (type === 'bpmn:ReceiveTask') return baseTask + 'taskMarker=receive;';
  if (type === 'bpmn:ManualTask') return baseTask + 'taskMarker=manual;';
  if (type === 'bpmn:BusinessRuleTask') return baseTask + 'taskMarker=businessRule;';
  if (type === 'bpmn:ScriptTask') return baseTask + 'taskMarker=script;';
  if (type === 'bpmn:CallActivity') return baseTask + 'strokeWidth=4;';

  // Events
  if (type === 'bpmn:StartEvent') {
    let symbol = 'general';
    if (bo.eventDefinitions?.some(d => d.$type === 'bpmn:TimerEventDefinition')) symbol = 'timer';
    if (bo.eventDefinitions?.some(d => d.$type === 'bpmn:MessageEventDefinition')) symbol = 'message';
    if (bo.eventDefinitions?.some(d => d.$type === 'bpmn:SignalEventDefinition')) symbol = 'signal';
    return `shape=mxgraph.bpmn.shape;html=1;verticalLabelPosition=bottom;labelBackgroundColor=none;verticalAlign=top;align=center;perimeter=ellipsePerimeter;outlineConnect=0;aspect=fixed;outline=standard;symbol=${symbol};strokeColor=#2e7d32;fillColor=#e8f5e9;strokeWidth=2;fontFamily=Helvetica;fontSize=11;`;
  }

  if (type === 'bpmn:EndEvent') {
    let symbol = 'general';
    if (bo.eventDefinitions?.some(d => d.$type === 'bpmn:TerminateEventDefinition')) symbol = 'terminate';
    if (bo.eventDefinitions?.some(d => d.$type === 'bpmn:MessageEventDefinition')) symbol = 'message';
    if (bo.eventDefinitions?.some(d => d.$type === 'bpmn:ErrorEventDefinition')) symbol = 'error';
    if (bo.eventDefinitions?.some(d => d.$type === 'bpmn:SignalEventDefinition')) symbol = 'signal';
    return `shape=mxgraph.bpmn.shape;html=1;verticalLabelPosition=bottom;labelBackgroundColor=none;verticalAlign=top;align=center;perimeter=ellipsePerimeter;outlineConnect=0;aspect=fixed;outline=end;symbol=${symbol};strokeColor=#c62828;fillColor=#ffebee;strokeWidth=3;fontFamily=Helvetica;fontSize=11;`;
  }

  if (type === 'bpmn:IntermediateCatchEvent' || type === 'bpmn:IntermediateThrowEvent' || type === 'bpmn:BoundaryEvent') {
    let symbol = 'general';
    if (bo.eventDefinitions?.some(d => d.$type === 'bpmn:TimerEventDefinition')) symbol = 'timer';
    if (bo.eventDefinitions?.some(d => d.$type === 'bpmn:MessageEventDefinition')) symbol = 'message';
    if (bo.eventDefinitions?.some(d => d.$type === 'bpmn:SignalEventDefinition')) symbol = 'signal';
    if (bo.eventDefinitions?.some(d => d.$type === 'bpmn:ErrorEventDefinition')) symbol = 'error';
    const outline = type === 'bpmn:IntermediateThrowEvent' ? 'throwing' : 'catching';
    return `shape=mxgraph.bpmn.shape;html=1;verticalLabelPosition=bottom;labelBackgroundColor=none;verticalAlign=top;align=center;perimeter=ellipsePerimeter;outlineConnect=0;aspect=fixed;outline=${outline};symbol=${symbol};strokeColor=#ef6c00;fillColor=#fff3e0;strokeWidth=2;fontFamily=Helvetica;fontSize=11;`;
  }

  // Gateways
  const baseGateway = 'shape=mxgraph.bpmn.shape;html=1;verticalLabelPosition=bottom;labelBackgroundColor=none;verticalAlign=top;align=center;perimeter=rhombusPerimeter;background=gateway;outline=none;strokeColor=#f57f17;fillColor=#fff9c4;strokeWidth=2;fontFamily=Helvetica;fontSize=11;';
  if (type === 'bpmn:ExclusiveGateway') return baseGateway + 'symbol=exclusiveGw;';
  if (type === 'bpmn:ParallelGateway') return baseGateway + 'symbol=parallelGw;';
  if (type === 'bpmn:InclusiveGateway') return baseGateway + 'symbol=inclusiveGw;';
  if (type === 'bpmn:EventBasedGateway' || type === 'bpmn:ComplexGateway') return baseGateway + 'symbol=complexGw;';

  // SubProcesses
  if (type === 'bpmn:SubProcess') {
    return 'shape=mxgraph.bpmn.subProcess;whiteSpace=wrap;html=1;rounded=1;arcSize=14;strokeColor=#6a1b9a;fillColor=#f3e5f5;strokeWidth=2;align=center;fontFamily=Helvetica;fontSize=12;';
  }

  // Artifacts & Data (with verticalLabelPosition=bottom to place long labels outside cleanly)
  if (type === 'bpmn:DataObjectReference' || type === 'bpmn:DataObject') {
    return 'shape=mxgraph.bpmn.data;dataObjectType=general;whiteSpace=wrap;html=1;verticalLabelPosition=bottom;labelBackgroundColor=none;verticalAlign=top;align=center;strokeColor=#00695c;fillColor=#e0f2f1;strokeWidth=1.5;fontFamily=Helvetica;fontSize=11;';
  }
  if (type === 'bpmn:DataStoreReference' || type === 'bpmn:DataStore') {
    return 'shape=mxgraph.bpmn.data;dataObjectType=database;whiteSpace=wrap;html=1;verticalLabelPosition=bottom;labelBackgroundColor=none;verticalAlign=top;align=center;strokeColor=#00695c;fillColor=#e0f2f1;strokeWidth=1.5;fontFamily=Helvetica;fontSize=11;';
  }
  if (type === 'bpmn:TextAnnotation') {
    return 'shape=callout;whiteSpace=wrap;html=1;perimeter=calloutPerimeter;size=20;position=0.5;strokeColor=#666666;fillColor=#f9f9f9;align=left;fontFamily=Helvetica;fontSize=11;';
  }

  return 'rounded=1;whiteSpace=wrap;html=1;strokeColor=#333333;fillColor=#ffffff;strokeWidth=1.5;fontFamily=Helvetica;fontSize=12;';
}

function getDrawioEdgeStyle(el) {
  const type = el.type || el.businessObject?.$type || '';
  if (type.includes('Association')) {
    return 'edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;dashed=1;dashPattern=2 3;endArrow=open;endFill=0;strokeColor=#00695c;strokeWidth=1.5;fontFamily=Helvetica;fontSize=11;labelBackgroundColor=#ffffff;';
  }
  if (type === 'bpmn:MessageFlow') {
    return 'edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;dashed=1;startArrow=oval;startFill=0;endArrow=block;endFill=0;strokeColor=#424242;strokeWidth=1.5;fontFamily=Helvetica;fontSize=11;labelBackgroundColor=#ffffff;';
  }
  return 'edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;endArrow=block;endFill=1;strokeColor=#424242;strokeWidth=1.5;fontFamily=Helvetica;fontSize=11;labelBackgroundColor=#ffffff;';
}

function exportDrawio() {
  try {
    const elementRegistry = modeler.get('elementRegistry');
    if (!elementRegistry) return;

    let maxX = 800;
    let maxY = 600;
    let cellsXml = '';

    const pools = [];
    const lanes = [];
    const flowNodes = [];
    const edges = [];

    elementRegistry.forEach(el => {
      if (!el || el.type === 'label' || el.type === 'bpmn:Process' || el.type === 'root' || el.type === 'bpmn:Collaboration') return;

      const isEdge = Array.isArray(el.waypoints) ||
        el.type === 'bpmn:SequenceFlow' ||
        el.type === 'bpmn:MessageFlow' ||
        el.type.includes('Association');

      if (isEdge) {
        edges.push(el);
      } else if (el.type === 'bpmn:Participant') {
        pools.push(el);
      } else if (el.type === 'bpmn:Lane') {
        lanes.push(el);
      } else if (typeof el.x === 'number' && typeof el.width === 'number') {
        flowNodes.push(el);
      }
    });

    // 1. Render Pools first (bottom-most background in z-order)
    for (const el of pools) {
      const id = el.id;
      const name = el.businessObject?.name || el.businessObject?.text || '';
      const style = getDrawioStyle(el);
      const x = Math.round(el.x);
      const y = Math.round(el.y);
      const width = Math.round(el.width);
      const height = Math.round(el.height);

      if (x + width > maxX) maxX = x + width;
      if (y + height > maxY) maxY = y + height;

      cellsXml += `        <mxCell id="${escapeXml(id)}" value="${escapeXml(name)}" style="${escapeXml(style)}" vertex="1" parent="1">\n`;
      cellsXml += `          <mxGeometry x="${x}" y="${y}" width="${width}" height="${height}" as="geometry" />\n`;
      cellsXml += `        </mxCell>\n`;
    }

    // 2. Render Lanes second (above pool, transparent body so tasks are visible)
    for (const el of lanes) {
      const id = el.id;
      const name = el.businessObject?.name || el.businessObject?.text || '';
      const style = getDrawioStyle(el);
      const x = Math.round(el.x);
      const y = Math.round(el.y);
      const width = Math.round(el.width);
      const height = Math.round(el.height);

      if (x + width > maxX) maxX = x + width;
      if (y + height > maxY) maxY = y + height;

      cellsXml += `        <mxCell id="${escapeXml(id)}" value="${escapeXml(name)}" style="${escapeXml(style)}" vertex="1" parent="1">\n`;
      cellsXml += `          <mxGeometry x="${x}" y="${y}" width="${width}" height="${height}" as="geometry" />\n`;
      cellsXml += `        </mxCell>\n`;
    }

    // 3. Render Flow Nodes (Tasks, Gateways, Events, DataObjects, etc.)
    for (const el of flowNodes) {
      const id = el.id;
      const name = el.businessObject?.name || el.businessObject?.text || '';
      const style = getDrawioStyle(el);
      const x = Math.round(el.x);
      const y = Math.round(el.y);
      const width = Math.round(el.width);
      const height = Math.round(el.height);

      if (x + width > maxX) maxX = x + width;
      if (y + height > maxY) maxY = y + height;

      cellsXml += `        <mxCell id="${escapeXml(id)}" value="${escapeXml(name)}" style="${escapeXml(style)}" vertex="1" parent="1">\n`;
      cellsXml += `          <mxGeometry x="${x}" y="${y}" width="${width}" height="${height}" as="geometry" />\n`;
      cellsXml += `        </mxCell>\n`;
    }

    // 4. Render Edges (Sequence Flows, Message Flows, Data Associations)
    for (const el of edges) {
      const id = el.id;
      const name = el.businessObject?.name || '';
      const sourceId = el.source?.id || el.businessObject?.sourceRef?.id || '';
      const targetId = el.target?.id || el.businessObject?.targetRef?.id || '';
      const style = getDrawioEdgeStyle(el);

      cellsXml += `        <mxCell id="${escapeXml(id)}" value="${escapeXml(name)}" style="${escapeXml(style)}" edge="1" parent="1"`;
      if (sourceId) cellsXml += ` source="${escapeXml(sourceId)}"`;
      if (targetId) cellsXml += ` target="${escapeXml(targetId)}"`;
      cellsXml += `>\n`;
      cellsXml += `          <mxGeometry relative="1" as="geometry">\n`;

      const waypoints = el.waypoints || [];
      if (waypoints.length > 0) {
        if (!sourceId) {
          cellsXml += `            <mxPoint x="${Math.round(waypoints[0].x)}" y="${Math.round(waypoints[0].y)}" as="sourcePoint" />\n`;
        }
        if (!targetId) {
          cellsXml += `            <mxPoint x="${Math.round(waypoints[waypoints.length - 1].x)}" y="${Math.round(waypoints[waypoints.length - 1].y)}" as="targetPoint" />\n`;
        }
        if (waypoints.length > 2) {
          cellsXml += `            <Array as="points">\n`;
          for (let i = 1; i < waypoints.length - 1; i++) {
            const pt = waypoints[i];
            if (pt.x > maxX) maxX = pt.x;
            if (pt.y > maxY) maxY = pt.y;
            cellsXml += `              <mxPoint x="${Math.round(pt.x)}" y="${Math.round(pt.y)}" />\n`;
          }
          cellsXml += `            </Array>\n`;
        }
      }

      cellsXml += `          </mxGeometry>\n`;
      cellsXml += `        </mxCell>\n`;
    }

    const pageWidth = Math.max(1200, Math.round(maxX + 100));
    const pageHeight = Math.max(800, Math.round(maxY + 100));

    const drawioXml = `<?xml version="1.0" encoding="UTF-8"?>
<mxfile host="app.diagrams.net" modified="${new Date().toISOString()}" agent="Text-to-BPMN" version="24.0.0" type="device">
  <diagram id="diagram_1" name="Page-1">
    <mxGraphModel dx="${pageWidth}" dy="${pageHeight}" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="${pageWidth}" pageHeight="${pageHeight}" math="0" shadow="0">
      <root>
        <mxCell id="0" />
        <mxCell id="1" parent="0" />
${cellsXml}      </root>
    </mxGraphModel>
  </diagram>
</mxfile>
`;

    download('diagram.drawio', drawioXml);
    addBotMessage('✅ Diagram exported successfully as Draw.io format (`diagram.drawio`)');
  } catch (err) {
    console.error('Failed to export Draw.io file:', err);
    addBotMessage('❌ Failed to export Draw.io diagram: ' + err.message);
  }
}
function fitView() {
  try {
    const canvas = modeler.get('canvas');
    const vb = canvas.viewbox();
    const inner = vb.inner;
    const outer = vb.outer;

    if (!inner || !outer || inner.width <= 0 || inner.height <= 0) {
      canvas.zoom('fit-viewport', 'auto');
      return;
    }

    // Account for 115px floating palette on the left and balanced 30px margins
    const palettePaddingLeft = 130;
    const margin = 25;
    const availWidth = Math.max(100, outer.width - palettePaddingLeft - margin);
    const availHeight = Math.max(100, outer.height - (margin * 2));

    const scale = Math.min(1.2, availWidth / inner.width, availHeight / inner.height);

    canvas.viewbox({
      x: inner.x - (palettePaddingLeft / scale),
      y: inner.y - ((outer.height / scale - inner.height) / 2),
      width: outer.width / scale,
      height: outer.height / scale
    });
  } catch (e) {
    console.warn('fitView error:', e);
    try {
      modeler.get('canvas').zoom('fit-viewport', 'auto');
    } catch (_) {}
  }
}

function download(filename, data) {
  const blob = new Blob([data], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}


/* ─────────── ZOOMING BUTTONS HANDLERS ─────────── */

const zoomInBtn = document.getElementById('zoom-in');
const zoomOutBtn = document.getElementById('zoom-out');
const zoomResetBtn = document.getElementById('zoom-reset');

zoomInBtn.addEventListener('click', () => {
  changeZoom(1.2); // Zoom in by +20%
});

zoomOutBtn.addEventListener('click', () => {
  changeZoom(0.8); // Zoom out by -20%
});

zoomResetBtn.addEventListener('click', () => {
  fitView();
});

function changeZoom(factor) {
  const canvas = modeler.get('canvas');
  const currentZoom = canvas.zoom();
  const newZoom = currentZoom * factor;

  // limit min/max zoom
  if (newZoom < 0.2 || newZoom > 4) return;

  canvas.zoom(newZoom);
}


/* ─────────── AUTO LAYOUT HANDLER ─────────── */

const autoLayoutBtn = document.getElementById('autoLayout');
autoLayoutBtn.addEventListener('click', autoLayout);

async function autoLayout() {
  try {
    const { xml } = await modeler.saveXML({ format: true });
    const layoutedXml = await layoutAndEnrichDiagram(xml);
    await modeler.importXML(layoutedXml);
    if (colorsEnabled) applyBpmnColors();
    fitView();

    addBotMessage('✅ Auto-layout applied to current diagram');
  } catch (error) {
    console.error('Auto-layout error:', error);
    addBotMessage('❌ Failed to auto-layout diagram: ' + error.message);
  }
}

/* ─────────── FIX ISSUES (WARNINGS & ERRORS) ─────────── */

let currentLintIssues = [];

const fixBtn = document.getElementById('fixBPMN');
const lintBadge = document.getElementById('lint-badge');
const fixModal = document.getElementById('fix-modal');
const fixModalClose = document.getElementById('fix-modal-close');
const fixModalCancel = document.getElementById('btn-fix-cancel');
const fixModalIssuesList = document.getElementById('fix-modal-issues-list');
const fixModalSummary = document.getElementById('fix-modal-summary');
const btnFixAi = document.getElementById('btn-fix-ai');
const btnFixQuick = document.getElementById('btn-fix-quick');

function updateLintBadge() {
  if (!lintBadge || !fixBtn) return;
  const count = currentLintIssues.length;
  if (count === 0) {
    lintBadge.style.display = 'none';
    fixBtn.classList.remove('has-issues');
    fixBtn.title = 'No hay problemas detectados en el diagrama';
  } else {
    lintBadge.style.display = 'inline-flex';
    lintBadge.textContent = count;
    const errors = currentLintIssues.filter(i => i.category === 'error').length;
    const warnings = currentLintIssues.filter(i => i.category === 'warn').length;
    fixBtn.classList.add('has-issues');
    if (errors > 0) {
      lintBadge.className = 'lint-badge error';
      fixBtn.title = `Corregir ${errors} error(es) y ${warnings} warning(s)`;
    } else {
      lintBadge.className = 'lint-badge warning';
      fixBtn.title = `Corregir ${warnings} advertencia(s)`;
    }
  }
}

// Subscribe to bpmnlint results
modeler.get('eventBus').on('linting.completed', event => {
  currentLintIssues = [];
  const issuesMap = event.issues || {};
  for (const elementId of Object.keys(issuesMap)) {
    const list = issuesMap[elementId];
    if (Array.isArray(list)) {
      for (const item of list) {
        currentLintIssues.push({
          id: elementId,
          rule: item.rule || '',
          category: item.category || 'warn',
          message: item.message || ''
        });
      }
    }
  }
  updateLintBadge();
});

if (fixBtn) {
  fixBtn.addEventListener('click', () => {
    if (currentLintIssues.length === 0) {
      addBotMessage('✨ No se han detectado errores ni advertencias (warnings) en el diagrama. ¡El modelo cumple todas las reglas de BPMN 2.0!');
      return;
    }
    openFixModal();
  });
}

function openFixModal() {
  if (!fixModal) return;
  const errors = currentLintIssues.filter(i => i.category === 'error').length;
  const warnings = currentLintIssues.filter(i => i.category === 'warn').length;

  if (fixModalSummary) {
    fixModalSummary.textContent = `Se han detectado ${currentLintIssues.length} problema(s) (${errors} error(es), ${warnings} advertencia(s)):`;
  }

  if (fixModalIssuesList) {
    fixModalIssuesList.innerHTML = currentLintIssues.map(issue => `
      <div class="fix-issue-item ${issue.category === 'error' ? 'error' : 'warn'}">
        <span class="fix-issue-badge ${issue.category === 'error' ? 'error' : 'warn'}">
          ${issue.category === 'error' ? 'ERROR' : 'WARN'}
        </span>
        <div class="fix-issue-details">
          <span class="fix-issue-element">${issue.id}</span>
          <span class="fix-issue-rule">(${issue.rule})</span>
          <div class="fix-issue-message">${issue.message}</div>
        </div>
      </div>
    `).join('');
  }

  const hasFakeJoin = currentLintIssues.some(i => i.rule === 'fake-join');
  if (btnFixQuick) {
    btnFixQuick.style.display = hasFakeJoin ? 'inline-flex' : 'none';
  }

  fixModal.style.display = 'flex';
}

function closeFixModal() {
  if (fixModal) fixModal.style.display = 'none';
}

if (fixModalClose) fixModalClose.addEventListener('click', closeFixModal);
if (fixModalCancel) fixModalCancel.addEventListener('click', closeFixModal);
if (fixModal) {
  fixModal.addEventListener('click', e => {
    if (e.target === fixModal) closeFixModal();
  });
}

// AI Fix Handler
if (btnFixAi) {
  btnFixAi.addEventListener('click', async () => {
    closeFixModal();

    if (isFullscreen) {
      toggleFullscreen();
    }

    try {
      const { xml } = await modeler.saveXML({ format: true });
      const issuesList = currentLintIssues.map(i =>
        `- Elemento "${i.id}" [${i.category.toUpperCase()} - regla "${i.rule}"]: ${i.message}`
      ).join('\n');

      const repairPrompt = `Por favor, repara y corrige los siguientes errores y advertencias de BPMN 2.0 detectados en el diagrama actual:

${issuesList}

BPMN XML actual:
\`\`\`xml
${xml}
\`\`\`

Instrucciones de corrección:
1. Corrige TODOS los problemas listados respetando estrictamente el estándar BPMN 2.0.
2. Si hay advertencias de 'fake-join' (flujos entrantes que no se unen), inserta una compuerta exclusiva (XOR) de unión justo antes de la actividad para canalizar todos los flujos entrantes a través de dicha compuerta.
3. Si faltan eventos de inicio o fin, añádelos y conéctalos coherentemente con los flujos.
4. Si hay elementos desconectados o compuertas superfluas, corrígelos o enlázalos de forma limpia.
5. Mantén la lógica de negocio, nombres de tareas y piscinas/calles existentes.
6. Devuelve el código XML de BPMN 2.0 completo y corregido.`;

      // Show user message in chat
      const userMessage = document.createElement('div');
      userMessage.className = 'chat-msg user';
      userMessage.innerHTML = `<div class="msg-header">User</div><div class="msg-content">🛠️ <em>Reparar con IA: Corregir ${currentLintIssues.length} problema(s) de BPMN 2.0 detectados en el diagrama</em></div>`;
      chatLog.appendChild(userMessage);
      chatLog.scrollTop = chatLog.scrollHeight;

      sendPrompt(repairPrompt);
    } catch (err) {
      console.error('Error getting XML for AI repair:', err);
      addBotMessage('❌ Error al preparar la reparación con IA: ' + err.message);
    }
  });
}

// Quick Algorithmic Fix Handler (resolves fake-join directly without waiting for LLM)
if (btnFixQuick) {
  btnFixQuick.addEventListener('click', async () => {
    closeFixModal();
    try {
      const { xml } = await modeler.saveXML({ format: true });
      const result = fixFakeJoinsAlgorithmic(xml);
      if (result.fixedCount > 0) {
        let layouted = await layoutAndEnrichDiagram(result.fixedXml);
        await modeler.importXML(layouted);
        if (colorsEnabled) applyBpmnColors();
        fitView();
        addBotMessage(`⚡ Se han corregido automáticamente ${result.fixedCount} advertencia(s) de 'fake-join' insertando las compuertas exclusivas de unión correspondientes.`);
      } else {
        addBotMessage('ℹ️ No se detectaron problemas de estructura directa (fake-join) corregibles algorítmicamente.');
      }
    } catch (err) {
      console.error('Quick fix error:', err);
      addBotMessage('❌ Error durante la reparación rápida: ' + err.message);
    }
  });
}

function fixFakeJoinsAlgorithmic(xmlString) {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(xmlString, 'text/xml');

  if (xmlDoc.getElementsByTagName('parsererror').length > 0) {
    throw new Error('Error al parsear XML del diagrama');
  }

  const sequenceFlows = Array.from(xmlDoc.getElementsByTagNameNS('*', 'sequenceFlow'));
  const targetMap = new Map();
  for (const sf of sequenceFlows) {
    const targetRef = sf.getAttribute('targetRef');
    if (targetRef) {
      if (!targetMap.has(targetRef)) targetMap.set(targetRef, []);
      targetMap.get(targetRef).push(sf);
    }
  }

  let fixedCount = 0;

  for (const [targetId, flows] of targetMap.entries()) {
    if (flows.length <= 1) continue;

    const targetElem = xmlDoc.getElementById(targetId) ||
                       xmlDoc.querySelector(`[id="${targetId}"]`);
    if (!targetElem) continue;

    const tagName = targetElem.localName || targetElem.tagName;
    if (!/task|callActivity|subProcess/i.test(tagName)) continue;

    fixedCount++;
    const gwId = 'Gateway_join_' + targetId;
    const newFlowId = 'Flow_join_' + targetId;

    const gw = xmlDoc.createElementNS('http://www.omg.org/spec/BPMN/20100524/MODEL', 'bpmn:exclusiveGateway');
    gw.setAttribute('id', gwId);
    gw.setAttribute('name', 'Unión');

    for (const flow of flows) {
      flow.setAttribute('targetRef', gwId);
      const inc = xmlDoc.createElementNS('http://www.omg.org/spec/BPMN/20100524/MODEL', 'bpmn:incoming');
      inc.textContent = flow.getAttribute('id');
      gw.appendChild(inc);
    }

    const out = xmlDoc.createElementNS('http://www.omg.org/spec/BPMN/20100524/MODEL', 'bpmn:outgoing');
    out.textContent = newFlowId;
    gw.appendChild(out);

    const newSf = xmlDoc.createElementNS('http://www.omg.org/spec/BPMN/20100524/MODEL', 'bpmn:sequenceFlow');
    newSf.setAttribute('id', newFlowId);
    newSf.setAttribute('sourceRef', gwId);
    newSf.setAttribute('targetRef', targetId);

    targetElem.parentNode.insertBefore(gw, targetElem);
    targetElem.parentNode.insertBefore(newSf, targetElem);

    const oldIncomings = Array.from(targetElem.getElementsByTagNameNS('*', 'incoming'));
    for (const oldInc of oldIncomings) {
      oldInc.parentNode.removeChild(oldInc);
    }
    const newInc = xmlDoc.createElementNS('http://www.omg.org/spec/BPMN/20100524/MODEL', 'bpmn:incoming');
    newInc.textContent = newFlowId;
    targetElem.insertBefore(newInc, targetElem.firstChild);

    const lanes = Array.from(xmlDoc.getElementsByTagNameNS('*', 'lane'));
    for (const lane of lanes) {
      const flowNodeRefs = Array.from(lane.getElementsByTagNameNS('*', 'flowNodeRef'));
      const hasTarget = flowNodeRefs.some(fn => fn.textContent.trim() === targetId);
      if (hasTarget) {
        const newFnRef = xmlDoc.createElementNS('http://www.omg.org/spec/BPMN/20100524/MODEL', 'bpmn:flowNodeRef');
        newFnRef.textContent = gwId;
        lane.appendChild(newFnRef);
        break;
      }
    }
  }

  // Strip old diagram section so ELK regenerates fresh layout
  const diagrams = Array.from(xmlDoc.getElementsByTagNameNS('*', 'BPMNDiagram'));
  for (const d of diagrams) {
    d.parentNode.removeChild(d);
  }

  const serializer = new XMLSerializer();
  return {
    fixedXml: serializer.serializeToString(xmlDoc),
    fixedCount
  };
}

/* ─────────── D2 MODERN GRAPHICAL VIEW ─────────── */
const btnViewD2 = document.getElementById('btn-view-d2');
const d2Modal = document.getElementById('d2-modal');
const d2ModalClose = document.getElementById('d2-modal-close');
const d2ThemeSelect = document.getElementById('d2-theme-select');
const d2LayoutSelect = document.getElementById('d2-layout-select');
const d2SvgContainer = document.getElementById('d2-svg-container');
const d2Loading = document.getElementById('d2-loading');
const btnD2CopyCode = document.getElementById('btn-d2-copy-code');
const btnD2DownloadSvg = document.getElementById('btn-d2-download-svg');
const btnD2DownloadCode = document.getElementById('btn-d2-download-code');

let currentD2Code = '';
let currentD2Svg = '';

async function loadAndRenderD2(xml) {
  if (!d2Modal || !d2SvgContainer) return;
  const theme = d2ThemeSelect ? d2ThemeSelect.value : '105';
  const layout = d2LayoutSelect ? d2LayoutSelect.value : 'elk';

  if (d2Loading) d2Loading.style.display = 'flex';
  d2SvgContainer.style.display = 'none';

  try {
    const res = await fetch('/api/render-d2', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ xml, theme, layout })
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || `HTTP ${res.status}`);
    }

    const data = await res.json();
    currentD2Svg = data.svg || '';
    currentD2Code = data.d2 || '';

    if (d2Loading) d2Loading.style.display = 'none';
    d2SvgContainer.style.display = 'flex';

    if (currentD2Svg) {
      d2SvgContainer.innerHTML = currentD2Svg;
    } else {
      const encodedCode = encodeURIComponent(currentD2Code);
      d2SvgContainer.innerHTML = `
        <div style="width: 100%; max-width: 900px; background: #1e293b; border: 1px solid #334155; border-radius: 10px; padding: 20px; color: #f1f5f9;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; border-bottom: 1px solid #334155; padding-bottom: 10px;">
            <span style="font-weight: 600; font-size: 15px; color: #818cf8;"><i class="fa-solid fa-code"></i> Código D2 Generado</span>
            <a href="https://play.d2lang.com/?script=${encodedCode}" target="_blank" rel="noopener noreferrer" class="btn-d2-action" style="color: #818cf8; text-decoration: none;">
              <i class="fa-solid fa-arrow-up-right-from-square"></i> Abrir en D2 Playground
            </a>
          </div>
          <pre style="background: #0f172a; padding: 15px; border-radius: 8px; overflow-x: auto; max-height: 400px; font-family: monospace; font-size: 13px; line-height: 1.5; color: #38bdf8;"><code>${escapeXml(currentD2Code)}</code></pre>
          <div style="margin-top: 15px; font-size: 12px; color: #94a3b8; display: flex; align-items: center; gap: 8px;">
            <i class="fa-solid fa-circle-info" style="color: #38bdf8;"></i>
            Código D2 listo. Para compilar el SVG directamente en el contenedor Docker, reinicia con <code>docker compose up --build -d</code>.
          </div>
        </div>
      `;
    }
  } catch (err) {
    console.error('Error rendering D2:', err);
    if (d2Loading) d2Loading.style.display = 'none';
    d2SvgContainer.style.display = 'flex';
    d2SvgContainer.innerHTML = `<div style="color: #ef4444; padding: 20px; font-weight: 500;"><i class="fa-solid fa-triangle-exclamation"></i> Error al generar vista D2: ${err.message}</div>`;
  }
}

async function openD2Modal() {
  if (!d2Modal) return;
  d2Modal.style.display = 'flex';

  try {
    const { xml } = await modeler.saveXML({ format: true });
    await loadAndRenderD2(xml);
  } catch (err) {
    console.error('Error opening D2 modal:', err);
  }
}

function closeD2Modal() {
  if (d2Modal) d2Modal.style.display = 'none';
}

if (btnViewD2) btnViewD2.addEventListener('click', openD2Modal);
if (d2ModalClose) d2ModalClose.addEventListener('click', closeD2Modal);
if (d2Modal) {
  d2Modal.addEventListener('click', e => {
    if (e.target === d2Modal) closeD2Modal();
  });
}

if (d2ThemeSelect) {
  d2ThemeSelect.addEventListener('change', async () => {
    try {
      const { xml } = await modeler.saveXML({ format: true });
      await loadAndRenderD2(xml);
    } catch (e) {
      console.error(e);
    }
  });
}

if (d2LayoutSelect) {
  d2LayoutSelect.addEventListener('change', async () => {
    try {
      const { xml } = await modeler.saveXML({ format: true });
      await loadAndRenderD2(xml);
    } catch (e) {
      console.error(e);
    }
  });
}

if (btnD2CopyCode) {
  btnD2CopyCode.addEventListener('click', () => {
    if (!currentD2Code) return;
    navigator.clipboard.writeText(currentD2Code).then(() => {
      const origText = btnD2CopyCode.innerHTML;
      btnD2CopyCode.innerHTML = '<i class="fa-solid fa-check"></i> ¡Copiado!';
      setTimeout(() => { btnD2CopyCode.innerHTML = origText; }, 2000);
    });
  });
}

if (btnD2DownloadSvg) {
  btnD2DownloadSvg.addEventListener('click', () => {
    if (!currentD2Svg) return;
    download('diagram-d2.svg', currentD2Svg);
  });
}

if (btnD2DownloadCode) {
  btnD2DownloadCode.addEventListener('click', () => {
    if (!currentD2Code) return;
    download('diagram.d2', currentD2Code);
  });
}

// Colors button in diagram toolbar
const toggleColorsBtn = document.getElementById('toggleColors');
if (toggleColorsBtn) {
  toggleColorsBtn.addEventListener('click', () => {
    colorsEnabled = !colorsEnabled;
    toggleColorsBtn.classList.toggle('active', colorsEnabled);
    if (colorsEnabled) {
      applyBpmnColors();
      addBotMessage('🎨 BPMN standard colors activated');
    } else {
      clearBpmnColors();
      addBotMessage('⚪ BPMN colors deactivated (monochrome)');
    }
  });
}

// Fullscreen toggle button
const fullscreenBtn = document.getElementById('toggleFullscreen');
fullscreenBtn.addEventListener('click', toggleFullscreen);


// Send button click
const sendBtn = document.getElementById('send-btn');
sendBtn.addEventListener('click', sendMSG);

// reasoner toggle
const modelToggle = document.getElementById('model-toggle');
let modelStatus = document.getElementById('model-status');


modelToggle.addEventListener('click', () => {
  const isReasonerOn = modelStatus.textContent.trim().toLowerCase() === 'on';

  const newStatus = isReasonerOn ? 'Off' : 'On';
  modelStatus.textContent = newStatus;
  modelToggle.classList.toggle('active', newStatus === 'On');
});


// Template popup
const templateLink = document.getElementById('template-link');
const templatePopup = document.getElementById('template-popup');

templateLink.addEventListener('click', e => {
  e.preventDefault();
  templatePopup.classList.toggle('visible');
});
document.addEventListener('click', e => {
  if (!templatePopup.contains(e.target) && !templateLink.contains(e.target)) {
    templatePopup.classList.remove('visible');
  }
});

/* ─────────── DRAG & DROP HANDLERS ─────────── */

// Prevent default behavior on the window
['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
  window.addEventListener(eventName, e => {
    e.preventDefault();
    e.stopPropagation();
  }, { passive: false });
});

// Canvas Drag & Drop behavior for BPMN/XML diagrams
const canvasEl = document.getElementById('canvas');
if (canvasEl) {
  ['dragenter', 'dragover'].forEach(ev => {
    canvasEl.addEventListener(ev, e => {
      e.preventDefault();
      e.stopPropagation();
      canvasEl.classList.add('dragover');
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    });
  });

  ['dragleave', 'dragend'].forEach(ev => {
    canvasEl.addEventListener(ev, e => {
      e.preventDefault();
      e.stopPropagation();
      canvasEl.classList.remove('dragover');
    });
  });

  canvasEl.addEventListener('drop', async e => {
    e.preventDefault();
    e.stopPropagation();
    canvasEl.classList.remove('dragover');

    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) return;

    const file = files[0];
    const fileName = file.name.toLowerCase();

    if (fileName.endsWith('.bpmn') || fileName.endsWith('.xml')) {
      const reader = new FileReader();
      reader.onload = async ev => {
        const xml = ev.target.result;
        await loadBpmnXml(xml, file.name);
      };
      reader.onerror = () => {
        addBotMessage(`❌ Error al leer el archivo **${file.name}**.`);
      };
      reader.readAsText(file);
    } else {
      // Forward images, PDFs, txt to general handleFiles
      handleFiles(files);
    }
  });
}

// Sidebar Drop Area behavior
['dragenter', 'dragover'].forEach(ev => fileDrop.addEventListener(ev, e => {
  e.preventDefault();
  fileDrop.classList.add('dragover');
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
}));

['dragleave', 'dragend'].forEach(ev => fileDrop.addEventListener(ev, e => {
  e.preventDefault();
  fileDrop.classList.remove('dragover');
}));

fileDrop.addEventListener('click', () => fileInput.click());

fileDrop.addEventListener('drop', e => {
  e.preventDefault();
  fileDrop.classList.remove('dragover');
  handleFiles(e.dataTransfer.files);
});

fileInput.addEventListener('change', e => {
  handleFiles(e.target.files);
  fileInput.value = '';
});


/* ─────────── FILE INPUT HANDLER ─────────── */

function handleFiles(list) {
  if (!list || list.length === 0) return;

  [...list].forEach(file => {
    const reader = new FileReader();
    const fileName = file.name.toLowerCase();

    // 1. BPMN and XML diagrams
    if (fileName.endsWith('.bpmn') || fileName.endsWith('.xml') || file.type === 'application/xml' || file.type === 'text/xml') {
      reader.onload = async function(e) {
        const textContent = e.target.result;
        if (textContent.includes('<definitions') || textContent.includes('<bpmn:definitions') || textContent.includes('<bpmn2:definitions') || fileName.endsWith('.bpmn')) {
          addMsg(`📁 <b>${file.name} (${Math.round(file.size / 1024)} KB)</b> cargado en el visor BPMN.`, 'user');
          await loadBpmnXml(textContent, file.name);
        } else {
          // General XML text
          addMsg(`📎 <b>${file.name} (${Math.round(file.size / 1024)} KB) añadido.</b> <br><br> 📄 <b>Contenido del archivo:</b><br><div style="background:#f8f9fa;border:1px solid #ddd;border-radius:8px;padding:10px;font-family:monospace;font-size:0.9rem;"><em>${escapeXml(textContent).replace(/\n/g, '<br>')}</em></div>`, 'user');
          sendPrompt(textContent);
        }
      };
      reader.readAsText(file);
    } else if (file.type.startsWith('text/') || fileName.endsWith('.txt') || fileName.endsWith('.md') || fileName.endsWith('.json') || fileName.endsWith('.csv')) {
      // Text files (.txt, .md, .json, etc.)
      reader.onload = function(e) {
        const textContent = e.target.result;
        addMsg(`📎 <b>${file.name} (${Math.round(file.size / 1024)} KB) añadido.</b> <br><br> 📄 <b>El archivo contiene el siguiente texto:</b><br><div style="background:#f8f9fa;border:1px solid #ddd;border-radius:8px;padding:10px;font-family:monospace;font-size:0.9rem;"><em>${escapeXml(textContent).replace(/\n/g, '<br>')}</em></div>`, 'user');
        sendPrompt(textContent);
      };
      reader.readAsText(file);
    } else if (file.type.startsWith('image/')) {
      // Images (.jpg, .png, etc.)
      reader.onload = function(e) {
        const imgSrc = e.target.result;

        const messageContainer = document.createElement('div');
        messageContainer.className = 'chat-msg user';
        messageContainer.innerHTML = `
          <strong>🖼️ ${file.name} (${Math.round(file.size / 1024)} KB) añadido.</strong><br>
          <img src="${imgSrc}" style="max-width:50%;border-radius:8px;margin-top:8px;"><br><br>
          <em>📄 Procesamiento OCR:</em><br>
          <div class="typing-indicator"><span></span><span></span><span></span></div>
        `;
        chatLog.appendChild(messageContainer);
        chatLog.scrollTop = chatLog.scrollHeight;

        Tesseract.recognize(
          imgSrc,
          'eng+ita+spa',
          { logger: m => console.log(m) }
        ).then(({ data: { text } }) => {
          const recognizedText = text.trim();
          const formattedText = recognizedText ? recognizedText : 'No se detectó texto.';

          messageContainer.innerHTML = `
            <strong>🖼️ ${file.name} (${Math.round(file.size / 1024)} KB) añadido.</strong><br>
            <img src="${imgSrc}" style="max-width:50%;border-radius:8px;margin-top:8px;"><br><br>
            <b>📄 Texto reconocido por OCR:</b><br><div style="background:#f8f9fa;border:1px solid #ddd;border-radius:8px;padding:10px;font-family:monospace;font-size:0.9rem;">
            <em>${formattedText}</em></div>`;

          if (recognizedText) {
            sendPrompt(recognizedText);
          }
        }).catch(error => {
          console.error('OCR error:', error);
          messageContainer.innerHTML += `<br><span style="color:red;">❌ Error al leer texto de la imagen.</span>`;
        });
      };
      reader.readAsDataURL(file);
    } else if (file.type === 'application/pdf' || fileName.endsWith('.pdf')) {
      reader.onload = async function(e) {
        const typedarray = new Uint8Array(e.target.result);

        try {
          const pdf = await pdfjsLib.getDocument(typedarray).promise;
          let fullText = '';

          for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
            const page = await pdf.getPage(pageNum);
            const content = await page.getTextContent();
            const strings = content.items.map(item => item.str);
            fullText += strings.join(' ') + '\n\n';
          }

          addMsg(`<strong><i class="fa-solid fa-file-pdf"></i> ${file.name} (${Math.round(file.size / 1024)} KB) añadido.</strong><br><br><b><em>Texto extraído del PDF:</em></b><br><div style="background:#f8f9fa;border:1px solid #ddd;border-radius:8px;padding:10px;font-family:monospace;font-size:0.9rem;"><em>${fullText.replace(/\n/g, '<br>')}</em></div>`, 'user');

          if (fullText.trim()) {
            sendPrompt(fullText);
          } else {
            addMsg('❌ No se encontró texto en el PDF.', 'bot');
          }
        } catch (pdfErr) {
          console.error('PDF error:', pdfErr);
          addMsg(`❌ Error al procesar el archivo PDF **${file.name}**: ${pdfErr.message}`, 'bot');
        }
      };
      reader.readAsArrayBuffer(file);
    } else {
      addMsg(`📎 <b>${file.name} (${Math.round(file.size / 1024)} KB)</b> añadido (formato no soportado). Formatos admitidos: .bpmn, .xml, .pdf, .txt, .md e imágenes.`, 'user');
    }
  });
}

function addMsg(m, w) {
      const d = document.createElement('div');
      d.className = 'chat-msg ' + w;

      // support Markdown e safe parsing 
      d.innerHTML = `<div class="msg-header">${w === 'user' ? 'User' : 'System'}</div><div class="msg-content">${marked.parse(m)}</div>`;  
      hljs.highlightAll();

      chatLog.appendChild(d);
      chatLog.scrollTop = chatLog.scrollHeight;
    }

// Automatically detect active local model on load
fetch('/api/active-model')
  .then(res => res.json())
  .then(data => {
    const opt = document.querySelector('#global-model-select option[value="local"]');
    if (opt && data.model) {
      opt.textContent = `Local: ${data.model}`;
      opt.title = `URL: ${data.configuredUrl} (${data.model})`;
    }
  })
  .catch(err => {
    console.warn('Could not detect active local model:', err);
    const opt = document.querySelector('#global-model-select option[value="local"]');
    if (opt) opt.textContent = 'Local LLM (127.0.0.1:8000)';
  });

/* ─────────── BPMN STANDARD COLOR PALETTE ─────────── */

function applyBpmnColors() {
  try {
    const modeling = modeler.get('modeling');
    const elementRegistry = modeler.get('elementRegistry');
    if (!modeling || !elementRegistry) return;

    // Modern Camunda / Figma harmonic palette
    const colorRules = {
      // Start Events: Emerald Mint
      'bpmn:StartEvent': { stroke: '#059669', fill: '#ecfdf5' },
      // End Events: Soft Ruby / Rose
      'bpmn:EndEvent': { stroke: '#e11d48', fill: '#fff1f2' },
      // Intermediate / Boundary Events: Warm Amber
      'bpmn:IntermediateCatchEvent': { stroke: '#d97706', fill: '#fffbeb' },
      'bpmn:IntermediateThrowEvent': { stroke: '#d97706', fill: '#fffbeb' },
      'bpmn:BoundaryEvent': { stroke: '#d97706', fill: '#fffbeb' },
      // Gateways: Golden Amber
      'bpmn:ExclusiveGateway': { stroke: '#ca8a04', fill: '#fef9c3' },
      'bpmn:ParallelGateway': { stroke: '#ca8a04', fill: '#fef9c3' },
      'bpmn:InclusiveGateway': { stroke: '#ca8a04', fill: '#fef9c3' },
      'bpmn:ComplexGateway': { stroke: '#ca8a04', fill: '#fef9c3' },
      'bpmn:EventBasedGateway': { stroke: '#ca8a04', fill: '#fef9c3' },
      // Tasks / Activities: Modern Tech Blue & Indigo
      'bpmn:Task': { stroke: '#2563eb', fill: '#eff6ff' },
      'bpmn:UserTask': { stroke: '#0284c7', fill: '#f0f9ff' },
      'bpmn:ServiceTask': { stroke: '#7c3aed', fill: '#f5f3ff' },
      'bpmn:SendTask': { stroke: '#2563eb', fill: '#eff6ff' },
      'bpmn:ReceiveTask': { stroke: '#0284c7', fill: '#f0f9ff' },
      'bpmn:ManualTask': { stroke: '#475569', fill: '#f8fafc' },
      'bpmn:BusinessRuleTask': { stroke: '#d97706', fill: '#fffbeb' },
      'bpmn:ScriptTask': { stroke: '#4f46e5', fill: '#eef2ff' },
      'bpmn:CallActivity': { stroke: '#4338ca', fill: '#eef2ff' },
      // Subprocesses: Royal Violet
      'bpmn:SubProcess': { stroke: '#9333ea', fill: '#faf5ff' },
      // Data Objects / Stores: Slate & Teal
      'bpmn:DataObjectReference': { stroke: '#64748b', fill: '#f1f5f9' },
      'bpmn:DataStoreReference': { stroke: '#475569', fill: '#f8fafc' }
    };

    const grouped = {};
    elementRegistry.forEach(el => {
      if (!el || el.type === 'label' || el.type === 'bpmn:SequenceFlow' || el.type === 'bpmn:Process') return;

      const color = colorRules[el.type];
      if (color) {
        const key = `${color.stroke}_${color.fill}`;
        if (!grouped[key]) grouped[key] = { elements: [], color };
        grouped[key].elements.push(el);
      }
    });

    Object.values(grouped).forEach(({ elements, color }) => {
      if (elements.length > 0) {
        modeling.setColor(elements, color);
      }
    });
  } catch (error) {
    console.warn('Could not apply BPMN colors:', error);
  }
}

function clearBpmnColors() {
  try {
    const modeling = modeler.get('modeling');
    const elementRegistry = modeler.get('elementRegistry');
    if (!modeling || !elementRegistry) return;

    const elementsToReset = [];
    elementRegistry.forEach(el => {
      if (!el || el.type === 'label' || el.type === 'bpmn:SequenceFlow' || el.type === 'bpmn:Process') return;
      elementsToReset.push(el);
    });

    if (elementsToReset.length > 0) {
      modeling.setColor(elementsToReset, null);
    }
  } catch (error) {
    console.warn('Could not clear BPMN colors:', error);
  }
}
