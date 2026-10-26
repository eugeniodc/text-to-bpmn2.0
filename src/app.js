// Copyright (c) 2025 Davide Chen
// SPDX-License-Identifier: MIT

import * as BpmnAutoLayout from 'bpmn-auto-layout';
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
 // true or false

  const response = await fetch('/api/process', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, model, reasoner})
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

// Complete auto-layout and diagram enrichment pipeline:
// 1. Ensures collaboration/pool exists if laneSet or roles are present
// 2. Isolates process flow nodes from abstract data objects/associations so BpmnAutoLayout produces compact horizontal flow
// 3. Re-injects semantic data objects into process
// 4. Shifts flow nodes right (+120px) and down (+90px) to provide ample margin for Pool/Lane headers and Data Objects
// 5. Positions Data Objects neatly above their respective tasks and creates visible dashed association edges
// 6. Connects any orphan sequence flows
// 7. Generates valid BPMNShape for Pool (Participant) and Lanes (Lane) with exact bounding boxes
// 8. Places Pool and Lane shapes at the START of BPMNPlane so they render behind flow elements in SVG DOM order
async function layoutAndEnrichDiagram(inputXml) {
  if (!inputXml) return inputXml;

  let xml = inputXml;

  // 1. Synthesize collaboration/participant if process has laneSet but no collaboration wrapper
  const hasCollab = /<bpmn:collaboration\b/i.test(xml);
  const laneSetMatch = xml.match(/<bpmn:laneSet\b[^>]*>/i);
  if (!hasCollab && laneSetMatch) {
    const procMatch = xml.match(/<bpmn:process\b[^>]*id="([^"]+)"(?:\s+name="([^"]+)")?/i);
    if (procMatch) {
      const procId = procMatch[1];
      const procName = procMatch[2] || 'Proceso Principal';
      const collabSnippet = `  <bpmn:collaboration id="Collaboration_1">\n    <bpmn:participant id="Participant_1" name="${procName}" processRef="${procId}" />\n  </bpmn:collaboration>\n`;
      xml = xml.replace(/(<bpmn:process\b)/i, `${collabSnippet}  $1`);
    }
  }

  // 2. Collect full dataOutputAssociation & dataInputAssociation tags with targetRef/sourceRef
  const dataAssocReplacements = [];
  const doaFullMatches = [...xml.matchAll(/<bpmn:dataOutputAssociation\b[^>]*id="([^"]+)"[^>]*>([\s\S]*?)<\/bpmn:dataOutputAssociation>/gi)];
  for (const m of doaFullMatches) {
    dataAssocReplacements.push({ id: m[1], full: m[0] });
  }
  const diaFullMatches = [...xml.matchAll(/<bpmn:dataInputAssociation\b[^>]*id="([^"]+)"[^>]*>([\s\S]*?)<\/bpmn:dataInputAssociation>/gi)];
  for (const m of diaFullMatches) {
    dataAssocReplacements.push({ id: m[1], full: m[0] });
  }

  // Strip abstract dataObjects, dataObjectReferences, and top-level associations
  // so BpmnAutoLayout produces a clean, non-bloated, compact horizontal process layout
  const semanticFlowOnly = xml
    .replace(/<bpmn:dataObject\b(?![^>]*Reference)[^>]*>[\s\S]*?<\/bpmn:dataObject>/gi, '')
    .replace(/<bpmn:dataObject\b(?![^>]*Reference)[^>]*\/>/gi, '')
    .replace(/<bpmn:dataObjectReference\b[^>]*\/>/gi, '')
    .replace(/<bpmn:association\b[^>]*\/>/gi, '');

  let layouted = await BpmnAutoLayout.layoutProcess(semanticFlowOnly);

  // Restore full dataOutputAssociation & dataInputAssociation tags with targetRef/sourceRef
  for (const rep of dataAssocReplacements) {
    const emptyRegex = new RegExp(`<bpmn:(?:dataOutputAssociation|dataInputAssociation)\\b[^>]*id="${rep.id}"[^>]*\\/>`, 'i');
    if (emptyRegex.test(layouted)) {
      layouted = layouted.replace(emptyRegex, rep.full);
    }
  }

  // 3. Re-inject stripped semantic elements into <bpmn:process>
  const procMatch = xml.match(/<bpmn:process[^>]*>([\s\S]*?)<\/bpmn:process>/i);
  if (procMatch) {
    const inner = procMatch[1];
    const dataObjects = [...inner.matchAll(/<bpmn:dataObject\b(?![^>]*Reference)[^>]*\/>/gi)].map(m => m[0]);
    const dataObjRefs = [...inner.matchAll(/<bpmn:dataObjectReference\b[^>]*\/>/gi)].map(m => m[0]);
    const associations = [...inner.matchAll(/<bpmn:association\b[^>]*\/>/gi)].map(m => m[0]);

    let inject = '';
    for (const d of dataObjects) {
      const id = d.match(/id="([^"]+)"/)?.[1];
      if (id && !new RegExp(`<bpmn:dataObject\\b[^>]*id="${id}"`, 'i').test(layouted)) {
        inject += `    ${d}\n`;
      }
    }
    for (const r of dataObjRefs) {
      const id = r.match(/id="([^"]+)"/)?.[1];
      if (id && !new RegExp(`<bpmn:dataObjectReference\\b[^>]*id="${id}"`, 'i').test(layouted)) {
        inject += `    ${r}\n`;
      }
    }
    for (const a of associations) {
      const id = a.match(/id="([^"]+)"/)?.[1];
      if (id && !new RegExp(`<bpmn:association\\b[^>]*id="${id}"`, 'i').test(layouted)) {
        inject += `    ${a}\n`;
      }
    }
    if (inject) {
      layouted = layouted.replace('</bpmn:process>', inject + '  </bpmn:process>');
    }
  }

  // 4. Map existing flow shapes
  const shapes = new Map();
  const shapeRegex = /<bpmndi:BPMNShape[^>]*id="([^"]+)"[^>]*bpmnElement="([^"]+)"[^>]*>[\s\S]*?<dc:Bounds[^>]*x="([^"]+)"[^>]*y="([^"]+)"[^>]*width="([^"]+)"[^>]*height="([^"]+)"[^>]*\/>[\s\S]*?<\/bpmndi:BPMNShape>/gi;
  let match;
  while ((match = shapeRegex.exec(layouted)) !== null) {
    shapes.set(match[2], {
      shapeId: match[1],
      bpmnElement: match[2],
      x: parseFloat(match[3]),
      y: parseFloat(match[4]),
      width: parseFloat(match[5]),
      height: parseFloat(match[6])
    });
  }

  // 5. Parse lanes and map flowNodeRefs -> laneIndex
  const laneMatches = [...xml.matchAll(/<bpmn:lane\b[^>]*id="([^"]+)"[^>]*>([\s\S]*?)<\/bpmn:lane>/gi)];
  const nodeToLane = new Map();
  const lanes = [];

  for (let i = 0; i < laneMatches.length; i++) {
    const lId = laneMatches[i][1];
    const lInner = laneMatches[i][2];
    const nodeRefs = [...lInner.matchAll(/<bpmn:flowNodeRef>([^<]+)<\/bpmn:flowNodeRef>/gi)].map(m => m[1].trim());
    lanes.push({ laneId: lId, index: i, nodeRefs });
    for (const ref of nodeRefs) {
      nodeToLane.set(ref, i);
    }
  }

  const hasMultipleLanes = lanes.length > 1;

  // Map incoming source for fallback lane assignment if node wasn't explicitly in flowNodeRef
  const seqFlowMatches = [...xml.matchAll(/<bpmn:sequenceFlow[^>]*id="([^"]+)"[^>]*sourceRef="([^"]+)"[^>]*targetRef="([^"]+)"/gi)];
  const incomingSource = new Map();
  for (const sf of seqFlowMatches) {
    incomingSource.set(sf[3], sf[2]);
  }

  const collabMatch = xml.match(/<bpmn:collaboration\b[^>]*id="([^"]+)"/i);
  const participantMatches = [...xml.matchAll(/<bpmn:participant\b[^>]*id="([^"]+)"/gi)];
  const hasPool = participantMatches.length > 0 || hasMultipleLanes;

  const poolX = 20;
  const poolY = 20;
  const shiftX = hasPool ? 120 : 30;
  const laneHeight = 180;

  if (hasMultipleLanes) {
    // Resolve any unassigned nodes
    for (const s of shapes.values()) {
      if (!nodeToLane.has(s.bpmnElement)) {
        const src = incomingSource.get(s.bpmnElement);
        const resolvedLane = (src && nodeToLane.has(src)) ? nodeToLane.get(src) : 0;
        nodeToLane.set(s.bpmnElement, resolvedLane);
      }
    }

    // Group shapes by lane
    const laneNodes = new Map();
    for (const s of shapes.values()) {
      const laneIdx = nodeToLane.get(s.bpmnElement) ?? 0;
      if (!laneNodes.has(laneIdx)) laneNodes.set(laneIdx, []);
      laneNodes.get(laneIdx).push(s);
    }

    for (const [laneIdx, nodeShapes] of laneNodes.entries()) {
      const curLaneY = poolY + (laneIdx * laneHeight);
      const laneCenterY = curLaneY + (laneHeight / 2);

      nodeShapes.sort((a, b) => a.x - b.x);

      for (let j = 0; j < nodeShapes.length; j++) {
        const s = nodeShapes[j];
        s.x += shiftX;

        // Check if there are parallel/branching nodes in the same lane at similar X
        const overlapping = nodeShapes.filter((other, k) => k !== j && Math.abs(other.x - s.x) < 50);
        if (overlapping.length > 0) {
          const isSecond = nodeShapes.indexOf(s) > nodeShapes.indexOf(overlapping[0]);
          s.y = isSecond ? Math.round(laneCenterY + 15) : Math.round(laneCenterY - s.height - 15);
        } else {
          s.y = Math.round(laneCenterY - (s.height / 2));
        }
      }
    }

    // Update shapes in XML
    for (const s of shapes.values()) {
      const sRegex = new RegExp(`(<bpmndi:BPMNShape[^>]*bpmnElement="${s.bpmnElement}"[^>]*>[\\s\\S]*?<dc:Bounds)[^>]*(\\/>)`, 'i');
      layouted = layouted.replace(sRegex, `$1 x="${s.x}" y="${s.y}" width="${s.width}" height="${s.height}"$2`);
    }

    // Recalculate sequence flow waypoints across lanes
    let updatedEdges = '';
    for (const sf of seqFlowMatches) {
      const sfId = sf[1];
      const sRef = sf[2];
      const tRef = sf[3];
      const sShape = shapes.get(sRef);
      const tShape = shapes.get(tRef);
      if (!sShape || !tShape) continue;

      let waypoints = [];
      const sCenterY = Math.round(sShape.y + sShape.height / 2);
      const tCenterY = Math.round(tShape.y + tShape.height / 2);

      if (Math.abs(sCenterY - tCenterY) < 30) {
        // Horizontally aligned
        const p1x = Math.round(sShape.x + sShape.width);
        const p2x = Math.round(tShape.x);
        waypoints = [{ x: p1x, y: sCenterY }, { x: p2x, y: tCenterY }];
      } else if (sShape.x < tShape.x) {
        // Left to right across different lane heights
        const p1x = Math.round(sShape.x + sShape.width);
        const p2x = Math.round(tShape.x);
        const midX = Math.round(p1x + (p2x - p1x) / 2);
        waypoints = [
          { x: p1x, y: sCenterY },
          { x: midX, y: sCenterY },
          { x: midX, y: tCenterY },
          { x: p2x, y: tCenterY }
        ];
      } else {
        // Return loop (target is to the left of source)
        const p1x = Math.round(sShape.x + sShape.width / 2);
        const p1y = Math.round(sShape.y + sShape.height);
        const p2x = Math.round(tShape.x + tShape.width / 2);
        const p2y = Math.round(tShape.y + tShape.height);
        const bottomY = Math.max(p1y, p2y) + 30;
        waypoints = [
          { x: p1x, y: p1y },
          { x: p1x, y: bottomY },
          { x: p2x, y: bottomY },
          { x: p2x, y: p2y }
        ];
      }

      const edgeXml = `
      <bpmndi:BPMNEdge id="${sfId}_di" bpmnElement="${sfId}">
${waypoints.map(w => `        <di:waypoint x="${w.x}" y="${w.y}" />`).join('\n')}
      </bpmndi:BPMNEdge>`;

      if (layouted.includes(`bpmnElement="${sfId}"`)) {
        const oldEdgeRegex = new RegExp(`<bpmndi:BPMNEdge[^>]*bpmnElement="${sfId}"[\\s\\S]*?<\\/bpmndi:BPMNEdge>`, 'i');
        layouted = layouted.replace(oldEdgeRegex, edgeXml.trim());
      } else {
        updatedEdges += edgeXml;
      }
    }
    if (updatedEdges) {
      layouted = layouted.replace('</bpmndi:BPMNPlane>', updatedEdges + '\n    </bpmndi:BPMNPlane>');
    }
  } else {
    // Single lane or no lanes: shift all shapes by shiftX and shiftY
    const shiftY = 90;
    for (const s of shapes.values()) {
      const oldX = s.x;
      const oldY = s.y;
      s.x += shiftX;
      s.y += shiftY;
      const sRegex = new RegExp(`(<bpmndi:BPMNShape[^>]*bpmnElement="${s.bpmnElement}"[^>]*>[\\s\\S]*?<dc:Bounds[^>]*x=")${oldX}("[^>]*y=")${oldY}(")`, 'i');
      layouted = layouted.replace(sRegex, `$1${s.x}$2${s.y}$3`);
    }

    layouted = layouted.replace(/<di:waypoint[^>]*x="([^"]+)"[^>]*y="([^"]+)"[^>]*\/>/gi, (full, wx, wy) => {
      return `<di:waypoint x="${parseFloat(wx) + shiftX}" y="${parseFloat(wy) + shiftY}" />`;
    });
  }

  // 6. Collect associations and data associations
  const associations = [];

  const assocMatches = [...xml.matchAll(/<bpmn:association\b[^>]*id="([^"]+)"[^>]*sourceRef="([^"]+)"[^>]*targetRef="([^"]+)"/gi)];
  for (const m of assocMatches) {
    associations.push({ assocId: m[1], source: m[2], target: m[3], type: 'association' });
  }

  const taskMatches = [...xml.matchAll(/<(?:bpmn:)?(?:userTask|serviceTask|task|sendTask|receiveTask|manualTask|businessRuleTask|scriptTask|subProcess|callActivity)[^>]*id="([^"]+)"[^>]*>([\s\S]*?)<\/(?:bpmn:)?(?:userTask|serviceTask|task|sendTask|receiveTask|manualTask|businessRuleTask|scriptTask|subProcess|callActivity)>/gi)];
  for (const tMatch of taskMatches) {
    const taskId = tMatch[1];
    const inner = tMatch[2];

    const doaMatches = [...inner.matchAll(/<bpmn:dataOutputAssociation[^>]*id="([^"]+)"[^>]*>[\s\S]*?<bpmn:targetRef>([^<]+)<\/bpmn:targetRef>[\s\S]*?<\/bpmn:dataOutputAssociation>/gi)];
    for (const doa of doaMatches) {
      associations.push({ assocId: doa[1], source: taskId, target: doa[2].trim(), type: 'output' });
    }

    const diaMatches = [...inner.matchAll(/<bpmn:dataInputAssociation[^>]*id="([^"]+)"[^>]*>[\s\S]*?<bpmn:sourceRef>([^<]+)<\/bpmn:sourceRef>[\s\S]*?<\/bpmn:dataInputAssociation>/gi)];
    for (const dia of diaMatches) {
      associations.push({ assocId: dia[1], source: dia[2].trim(), target: taskId, type: 'input' });
    }
  }

  let newShapes = '';
  let newEdges = '';
  const positionedDataObjects = new Set();
  const taskOffsets = new Map();

  for (const assoc of associations) {
    let taskShape = shapes.get(assoc.source) || shapes.get(assoc.target);
    let dataObjId = (assoc.type === 'output' ? assoc.target : assoc.source);

    if (!taskShape) {
      if (shapes.has(assoc.source) && !shapes.has(assoc.target)) {
        taskShape = shapes.get(assoc.source);
        dataObjId = assoc.target;
      } else if (shapes.has(assoc.target) && !shapes.has(assoc.source)) {
        taskShape = shapes.get(assoc.target);
        dataObjId = assoc.source;
      }
    }
    if (!taskShape) continue;

    const doW = 36;
    const doH = 50;

    let dataObjShape = shapes.get(dataObjId);
    if (!positionedDataObjects.has(dataObjId)) {
      positionedDataObjects.add(dataObjId);

      const offsetIndex = taskOffsets.get(taskShape.bpmnElement) || 0;
      taskOffsets.set(taskShape.bpmnElement, offsetIndex + 1);

      const newDoX = Math.round(taskShape.x + (taskShape.width - doW) / 2 + (offsetIndex * 40));
      const newDoY = Math.max(25, Math.round(taskShape.y - doH - 25));

      dataObjShape = { shapeId: `${dataObjId}_di`, bpmnElement: dataObjId, x: newDoX, y: newDoY, width: doW, height: doH };
      shapes.set(dataObjId, dataObjShape);

      if (layouted.includes(`bpmnElement="${dataObjId}"`)) {
        const oldBoundsRegex = new RegExp(`(<bpmndi:BPMNShape[^>]*bpmnElement="${dataObjId}"[^>]*>[\\s\\S]*?<dc:Bounds)[^>]*(\\/>)`, 'i');
        layouted = layouted.replace(oldBoundsRegex, `$1 x="${newDoX}" y="${newDoY}" width="${doW}" height="${doH}"$2`);
      } else {
        newShapes += `
      <bpmndi:BPMNShape id="${dataObjId}_di" bpmnElement="${dataObjId}">
        <dc:Bounds x="${newDoX}" y="${newDoY}" width="${doW}" height="${doH}" />
      </bpmndi:BPMNShape>`;
      }
    }

    if (!dataObjShape) dataObjShape = shapes.get(dataObjId);
    if (!dataObjShape) continue;

    const taskEdgePoint = { x: Math.round(taskShape.x + taskShape.width / 2), y: Math.round(taskShape.y) };
    const doEdgePoint = { x: Math.round(dataObjShape.x + doW / 2), y: Math.round(dataObjShape.y + doH) };

    const pt1 = assoc.type === 'input' ? doEdgePoint : taskEdgePoint;
    const pt2 = assoc.type === 'input' ? taskEdgePoint : doEdgePoint;

    if (!layouted.includes(`bpmnElement="${assoc.assocId}"`)) {
      newEdges += `
      <bpmndi:BPMNEdge id="${assoc.assocId}_di" bpmnElement="${assoc.assocId}">
        <di:waypoint x="${pt1.x}" y="${pt1.y}" />
        <di:waypoint x="${pt2.x}" y="${pt2.y}" />
      </bpmndi:BPMNEdge>`;
    }
  }

  // 7. Ensure sequence flows have edges (if any missing)
  for (const sf of seqFlowMatches) {
    const sfId = sf[1];
    const sRef = sf[2];
    const tRef = sf[3];
    if (!layouted.includes(`bpmnElement="${sfId}"`)) {
      const sShape = shapes.get(sRef);
      const tShape = shapes.get(tRef);
      if (sShape && tShape) {
        const p1x = Math.round(sShape.x + sShape.width);
        const p1y = Math.round(sShape.y + sShape.height / 2);
        const p2x = Math.round(tShape.x);
        const p2y = Math.round(tShape.y + tShape.height / 2);
        newEdges += `
      <bpmndi:BPMNEdge id="${sfId}_di" bpmnElement="${sfId}">
        <di:waypoint x="${p1x}" y="${p1y}" />
        <di:waypoint x="${p2x}" y="${p2y}" />
      </bpmndi:BPMNEdge>`;
      }
    }
  }

  // 8. Pool and Lane structures
  let poolShapes = '';
  if (hasPool && shapes.size > 0) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const s of shapes.values()) {
      if (s.x < minX) minX = s.x;
      if (s.y < minY) minY = s.y;
      if (s.x + s.width > maxX) maxX = s.x + s.width;
      if (s.y + s.height > maxY) maxY = s.y + s.height;
    }

    const poolW = Math.round((maxX - poolX) + 80);
    const poolH = hasMultipleLanes ? (laneHeight * lanes.length) : Math.round((maxY - poolY) + 35);

    if (collabMatch) {
      layouted = layouted.replace(/(<bpmndi:BPMNPlane[^>]*bpmnElement=")[^"]+(")/i, `$1${collabMatch[1]}$2`);
    }

    for (const p of participantMatches) {
      const pId = p[1];
      if (!layouted.includes(`bpmnElement="${pId}"`)) {
        poolShapes += `
      <bpmndi:BPMNShape id="${pId}_di" bpmnElement="${pId}" isHorizontal="true">
        <dc:Bounds x="${poolX}" y="${poolY}" width="${poolW}" height="${poolH}" />
      </bpmndi:BPMNShape>`;
      }
    }

    if (hasMultipleLanes) {
      for (let i = 0; i < lanes.length; i++) {
        const l = lanes[i];
        const curY = poolY + (i * laneHeight);
        poolShapes += `
      <bpmndi:BPMNShape id="${l.laneId}_di" bpmnElement="${l.laneId}" isHorizontal="true">
        <dc:Bounds x="${poolX + 30}" y="${curY}" width="${poolW - 30}" height="${laneHeight}" />
      </bpmndi:BPMNShape>`;
      }
    } else if (lanes.length === 1) {
      const lId = lanes[0].laneId;
      if (!layouted.includes(`bpmnElement="${lId}"`)) {
        poolShapes += `
      <bpmndi:BPMNShape id="${lId}_di" bpmnElement="${lId}" isHorizontal="true">
        <dc:Bounds x="${poolX + 30}" y="${poolY}" width="${poolW - 30}" height="${poolH}" />
      </bpmndi:BPMNShape>`;
      }
    }
  }

  // Prepend Pool & Lane to BPMNPlane so they render in background
  if (poolShapes) {
    layouted = layouted.replace(/(<bpmndi:BPMNPlane[^>]*>)/i, `$1${poolShapes}`);
  }
  if (newShapes || newEdges) {
    layouted = layouted.replace('</bpmndi:BPMNPlane>', newShapes + newEdges + '\n    </bpmndi:BPMNPlane>');
  }

  return layouted;
}

// Imports BPMN if present and shows the outcome to the user
async function tryImportBpmn(xml) {
  if (!xml) {
    addMsg('No valid BPMN XML found in the response ❌. Please try again with more details.', 'bot');
    return;
  }

  // Normalize <bpmn:dataAssociation> directly under process into valid <bpmn:association>
  let cleanXml = xml.replace(/<bpmn:dataAssociation\b/gi, '<bpmn:association')
                    .replace(/<\/bpmn:dataAssociation>/gi, '</bpmn:association>');

  // Ensure standard namespaces exist
  if (!cleanXml.includes('xmlns:bpmn=')) {
    cleanXml = cleanXml.replace(
      /(<(?:\w+:)?definitions)/i,
      '$1 xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI"'
    );
  }

  const hasDiagram = cleanXml.includes('bpmndi:BPMNDiagram') && cleanXml.includes('bpmndi:BPMNPlane');

  try {
    if (!hasDiagram) {
      console.log('BPMNDiagram missing, applying auto-layout and enrichment...');
      let layouted = await layoutAndEnrichDiagram(cleanXml);
      await modeler.importXML(layouted);
      if (colorsEnabled) applyBpmnColors();
      fitView();
      addMsg('Diagram generated and auto-arranged successfully ✅', 'bot');
      return;
    }

    // Diagram already has DI coordinates
    let layouted = await layoutAndEnrichDiagram(cleanXml);
    await modeler.importXML(layouted);
    if (colorsEnabled) applyBpmnColors();
    fitView();
    addMsg('Diagram generated successfully ✅', 'bot');
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

  // Ensure standard BPMN namespaces exist if omitted
  if (!cleanXml.includes('xmlns:bpmn=')) {
    cleanXml = cleanXml.replace(
      /(<(?:\w+:)?definitions)/i,
      '$1 xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI"'
    );
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
  modeler.saveXML({ format: true }).then(({ xml }) => download('diagram.bpmn', xml));
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

    // Canonical BPMN 2.0 colors (Camunda / bpmn.io convention)
    const colorRules = {
      // Start Events: Green
      'bpmn:StartEvent': { stroke: '#2e7d32', fill: '#e8f5e9' },
      // End Events: Red
      'bpmn:EndEvent': { stroke: '#c62828', fill: '#ffebee' },
      // Intermediate / Boundary Events: Orange
      'bpmn:IntermediateCatchEvent': { stroke: '#ef6c00', fill: '#fff3e0' },
      'bpmn:IntermediateThrowEvent': { stroke: '#ef6c00', fill: '#fff3e0' },
      'bpmn:BoundaryEvent': { stroke: '#ef6c00', fill: '#fff3e0' },
      // Gateways: Amber / Gold
      'bpmn:ExclusiveGateway': { stroke: '#f57f17', fill: '#fff9c4' },
      'bpmn:ParallelGateway': { stroke: '#f57f17', fill: '#fff9c4' },
      'bpmn:InclusiveGateway': { stroke: '#f57f17', fill: '#fff9c4' },
      'bpmn:ComplexGateway': { stroke: '#f57f17', fill: '#fff9c4' },
      'bpmn:EventBasedGateway': { stroke: '#f57f17', fill: '#fff9c4' },
      // Tasks / Activities: Blue
      'bpmn:Task': { stroke: '#1565c0', fill: '#e3f2fd' },
      'bpmn:UserTask': { stroke: '#1565c0', fill: '#e3f2fd' },
      'bpmn:ServiceTask': { stroke: '#1565c0', fill: '#e3f2fd' },
      'bpmn:SendTask': { stroke: '#1565c0', fill: '#e3f2fd' },
      'bpmn:ReceiveTask': { stroke: '#1565c0', fill: '#e3f2fd' },
      'bpmn:ManualTask': { stroke: '#1565c0', fill: '#e3f2fd' },
      'bpmn:BusinessRuleTask': { stroke: '#1565c0', fill: '#e3f2fd' },
      'bpmn:ScriptTask': { stroke: '#1565c0', fill: '#e3f2fd' },
      'bpmn:CallActivity': { stroke: '#1565c0', fill: '#e3f2fd' },
      // Subprocesses: Purple
      'bpmn:SubProcess': { stroke: '#6a1b9a', fill: '#f3e5f5' },
      // Data Objects / Stores: Teal
      'bpmn:DataObjectReference': { stroke: '#00695c', fill: '#e0f2f1' },
      'bpmn:DataStoreReference': { stroke: '#00695c', fill: '#e0f2f1' }
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
