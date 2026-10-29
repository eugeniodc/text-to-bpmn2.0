// scripts/bpmn-to-d2.js
// Converts BPMN 2.0 XML into clean, modern D2 declarative diagram code.

import BpmnModdle from 'bpmn-moddle';
import { exec, execSync } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import os from 'os';
import path from 'path';

const execAsync = promisify(exec);

/**
 * Locate d2 binary on the system
 */
function getD2Binary() {
  const candidates = [
    'd2',
    '/usr/local/bin/d2',
    '/opt/homebrew/bin/d2',
    '/usr/bin/d2',
    path.join(os.homedir(), '.local/bin/d2')
  ];
  for (const bin of candidates) {
    try {
      execSync(`"${bin}" --version`, { stdio: 'ignore' });
      return bin;
    } catch (e) {}
  }
  return null;
}

/**
 * Clean and escape string for D2 labels
 */
function cleanLabel(str) {
  if (!str) return '';
  return str
    .replace(/["\\]/g, ' ')
    .replace(/\r?\n/g, ' ')
    .trim();
}

/**
 * Determine D2 class and shape from BPMN element type
 */
function getD2Class(bpmnEl) {
  const type = bpmnEl?.$type || '';

  if (type === 'bpmn:StartEvent') return 'event_start';
  if (type === 'bpmn:EndEvent') return 'event_end';
  if (type === 'bpmn:IntermediateCatchEvent' || type === 'bpmn:IntermediateThrowEvent' || type === 'bpmn:BoundaryEvent') {
    return 'event_intermediate';
  }
  if (type.includes('Gateway')) return 'gateway';
  if (type === 'bpmn:UserTask') return 'user_task';
  if (type === 'bpmn:ServiceTask') return 'service_task';
  if (type === 'bpmn:BusinessRuleTask') return 'rule_task';
  if (type === 'bpmn:ManualTask') return 'task';
  if (type === 'bpmn:SendTask' || type === 'bpmn:ReceiveTask') return 'task';
  if (type.includes('Task')) return 'task';
  if (type === 'bpmn:DataObjectReference' || type === 'bpmn:DataObject') return 'data_object';
  if (type === 'bpmn:DataStoreReference' || type === 'bpmn:DataStore') return 'data_store';
  if (type === 'bpmn:SubProcess') return 'subprocess';

  return 'task';
}

/**
 * Converts BPMN 2.0 XML into D2 DSL code.
 * @param {string} bpmnXml - BPMN 2.0 XML string
 * @returns {Promise<string>} - D2 script string
 */
export async function convertBpmnToD2(bpmnXml) {
  const moddle = new BpmnModdle();
  const { rootElement } = await moddle.fromXML(bpmnXml);

  const processes = rootElement?.rootElements?.filter(e => e.$type === 'bpmn:Process') || [];
  const collaborations = rootElement?.rootElements?.filter(e => e.$type === 'bpmn:Collaboration') || [];

  const mainProcess = processes[0];
  const processName = cleanLabel(mainProcess?.name) || 'Diagrama de Proceso de Negocio';

  let d2 = `direction: right

# Configuración y temas modernos
vars: {
  d2-config: {
    layout-engine: elk
    theme-id: 105
  }
}

title: "${processName}" {
  shape: text
  near: top-center
  style: {
    font-size: 20
    bold: true
  }
}

classes: {
  event_start: {
    shape: circle
    style: {
      fill: "#dcfce7"
      stroke: "#16a34a"
      stroke-width: 2
    }
  }
  event_end: {
    shape: circle
    style: {
      fill: "#fee2e2"
      stroke: "#dc2626"
      stroke-width: 4
    }
  }
  event_intermediate: {
    shape: circle
    style: {
      fill: "#ffedd5"
      stroke: "#ea580c"
      stroke-width: 2
      stroke-dash: 3
    }
  }
  gateway: {
    shape: diamond
    style: {
      fill: "#fef9c3"
      stroke: "#ca8a04"
      stroke-width: 2
    }
  }
  task: {
    shape: rectangle
    style: {
      border-radius: 8
      fill: "#eff6ff"
      stroke: "#2563eb"
      stroke-width: 2
      shadow: true
    }
  }
  user_task: {
    shape: rectangle
    style: {
      border-radius: 8
      fill: "#e0f2fe"
      stroke: "#0284c7"
      stroke-width: 2
      shadow: true
    }
  }
  service_task: {
    shape: rectangle
    style: {
      border-radius: 8
      fill: "#f3e8ff"
      stroke: "#7c3aed"
      stroke-width: 2
      shadow: true
    }
  }
  rule_task: {
    shape: rectangle
    style: {
      border-radius: 8
      fill: "#fef3c7"
      stroke: "#d97706"
      stroke-width: 2
      shadow: true
    }
  }
  data_object: {
    shape: document
    style: {
      fill: "#f1f5f9"
      stroke: "#64748b"
      stroke-width: 1.5
    }
  }
  data_store: {
    shape: cylinder
    style: {
      fill: "#f8fafc"
      stroke: "#475569"
      stroke-width: 1.5
    }
  }
  subprocess: {
    shape: rectangle
    style: {
      border-radius: 10
      fill: "#fdf4ff"
      stroke: "#c026d3"
      stroke-dash: 2
    }
  }
}

`;

  // Check for Lanes / Collaboration
  const lanes = [];
  const flowNodeToLane = new Map();

  for (const proc of processes) {
    const laneSets = proc.laneSets || [];
    for (const ls of laneSets) {
      for (const lane of ls.lanes || []) {
        const laneId = lane.id;
        const laneName = cleanLabel(lane.name) || laneId;
        lanes.push({ id: laneId, name: laneName });
        for (const fn of lane.flowNodeRef || []) {
          flowNodeToLane.set(fn.id, laneId);
        }
      }
    }
  }

  // Collect all flow elements and sequence flows
  const allElements = [];
  const allFlows = [];
  const allDataAssocs = [];

  for (const proc of processes) {
    for (const el of proc.flowElements || []) {
      if (el.$type === 'bpmn:SequenceFlow') {
        allFlows.push(el);
      } else {
        allElements.push(el);
      }
    }
    for (const art of proc.artifacts || []) {
      allElements.push(art);
    }
  }

  // Group elements by Lane if lanes exist
  if (lanes.length > 0) {
    for (const lane of lanes) {
      d2 += `\n# Carril / Rol: ${lane.name}\n`;
      d2 += `${lane.id}: "${lane.name}" {\n  style.fill: "#f8fafc"\n  style.stroke: "#cbd5e1"\n`;
      for (const el of allElements) {
        if (flowNodeToLane.get(el.id) === lane.id) {
          const elName = cleanLabel(el.name) || (el.$type.includes('Gateway') ? '¿?' : el.id);
          const elClass = getD2Class(el);
          d2 += `  ${el.id}: "${elName}" { class: ${elClass} }\n`;
        }
      }
      d2 += `}\n`;
    }

    // Elements without lane
    for (const el of allElements) {
      if (!flowNodeToLane.has(el.id)) {
        const elName = cleanLabel(el.name) || (el.$type.includes('Gateway') ? '¿?' : el.id);
        const elClass = getD2Class(el);
        d2 += `${el.id}: "${elName}" { class: ${elClass} }\n`;
      }
    }
  } else {
    // Flat diagram (no swimlanes)
    d2 += `\n# Elementos del proceso\n`;
    for (const el of allElements) {
      const elName = cleanLabel(el.name) || (el.$type.includes('Gateway') ? '¿?' : el.id);
      const elClass = getD2Class(el);
      d2 += `${el.id}: "${elName}" { class: ${elClass} }\n`;
    }
  }

  // Connections (Sequence Flows)
  d2 += `\n# Flujos y Conexiones\n`;
  for (const sf of allFlows) {
    const srcId = sf.sourceRef?.id;
    const tgtId = sf.targetRef?.id;
    if (!srcId || !tgtId) continue;

    const label = cleanLabel(sf.name);
    const labelStr = label ? `: "${label}"` : '';

    // If source or target is inside a lane, construct D2 scoped ID
    const srcScoped = flowNodeToLane.has(srcId) ? `${flowNodeToLane.get(srcId)}.${srcId}` : srcId;
    const tgtScoped = flowNodeToLane.has(tgtId) ? `${flowNodeToLane.get(tgtId)}.${tgtId}` : tgtId;

    d2 += `${srcScoped} -> ${tgtScoped}${labelStr} { style.stroke: "#475569" }\n`;
  }

  return d2;
}

/**
 * Render D2 string to SVG using system d2 binary.
 * @param {string} d2Code - D2 DSL string
 * @param {object} options - theme, layout
 * @returns {Promise<string|null>} - SVG output or null if d2 is not installed
 */
export async function renderD2ToSvg(d2Code, options = {}) {
  const d2Bin = getD2Binary();
  if (!d2Bin) {
    return null;
  }

  const theme = options.theme || '105';
  const layout = options.layout || 'elk';

  const tmpD2Path = path.join(os.tmpdir(), `diagram_${Date.now()}_${Math.random().toString(36).substring(7)}.d2`);
  const tmpSvgPath = tmpD2Path.replace(/\.d2$/, '.svg');

  try {
    await fs.promises.writeFile(tmpD2Path, d2Code, 'utf-8');
    const cmd = `"${d2Bin}" --layout=${layout} --theme=${theme} "${tmpD2Path}" "${tmpSvgPath}"`;
    await execAsync(cmd);
    const svgContent = await fs.promises.readFile(tmpSvgPath, 'utf-8');
    return svgContent;
  } finally {
    // Cleanup temporary files
    try { await fs.promises.unlink(tmpD2Path); } catch (e) {}
    try { await fs.promises.unlink(tmpSvgPath); } catch (e) {}
  }
}
