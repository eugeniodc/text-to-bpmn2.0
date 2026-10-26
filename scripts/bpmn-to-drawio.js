// scripts/bpmn-to-drawio.js
// Convert BPMN 2.0 XML to Draw.io (mxGraphModel) XML format

import fs from 'fs';
import path from 'path';
import BpmnModdle from 'bpmn-moddle';

/**
 * Escapes characters for XML attribute or value.
 */
function escapeXml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Maps BPMN element type to draw.io mxCell style.
 */
function getShapeStyle(bpmnEl) {
  const type = bpmnEl?.$type || '';

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
    if (bpmnEl.eventDefinitions?.some(d => d.$type === 'bpmn:TimerEventDefinition')) symbol = 'timer';
    if (bpmnEl.eventDefinitions?.some(d => d.$type === 'bpmn:MessageEventDefinition')) symbol = 'message';
    if (bpmnEl.eventDefinitions?.some(d => d.$type === 'bpmn:SignalEventDefinition')) symbol = 'signal';
    return `shape=mxgraph.bpmn.shape;html=1;verticalLabelPosition=bottom;labelBackgroundColor=none;verticalAlign=top;align=center;perimeter=ellipsePerimeter;outlineConnect=0;aspect=fixed;outline=standard;symbol=${symbol};strokeColor=#2e7d32;fillColor=#e8f5e9;strokeWidth=2;fontFamily=Helvetica;fontSize=11;`;
  }

  if (type === 'bpmn:EndEvent') {
    let symbol = 'general';
    if (bpmnEl.eventDefinitions?.some(d => d.$type === 'bpmn:TerminateEventDefinition')) symbol = 'terminate';
    if (bpmnEl.eventDefinitions?.some(d => d.$type === 'bpmn:MessageEventDefinition')) symbol = 'message';
    if (bpmnEl.eventDefinitions?.some(d => d.$type === 'bpmn:ErrorEventDefinition')) symbol = 'error';
    if (bpmnEl.eventDefinitions?.some(d => d.$type === 'bpmn:SignalEventDefinition')) symbol = 'signal';
    return `shape=mxgraph.bpmn.shape;html=1;verticalLabelPosition=bottom;labelBackgroundColor=none;verticalAlign=top;align=center;perimeter=ellipsePerimeter;outlineConnect=0;aspect=fixed;outline=end;symbol=${symbol};strokeColor=#c62828;fillColor=#ffebee;strokeWidth=3;fontFamily=Helvetica;fontSize=11;`;
  }

  if (type === 'bpmn:IntermediateCatchEvent' || type === 'bpmn:IntermediateThrowEvent' || type === 'bpmn:BoundaryEvent') {
    let symbol = 'general';
    if (bpmnEl.eventDefinitions?.some(d => d.$type === 'bpmn:TimerEventDefinition')) symbol = 'timer';
    if (bpmnEl.eventDefinitions?.some(d => d.$type === 'bpmn:MessageEventDefinition')) symbol = 'message';
    if (bpmnEl.eventDefinitions?.some(d => d.$type === 'bpmn:SignalEventDefinition')) symbol = 'signal';
    if (bpmnEl.eventDefinitions?.some(d => d.$type === 'bpmn:ErrorEventDefinition')) symbol = 'error';
    const outline = type === 'bpmn:IntermediateThrowEvent' ? 'throwing' : 'catching';
    return `shape=mxgraph.bpmn.shape;html=1;verticalLabelPosition=bottom;labelBackgroundColor=none;verticalAlign=top;align=center;perimeter=ellipsePerimeter;outlineConnect=0;aspect=fixed;outline=${outline};symbol=${symbol};strokeColor=#ef6c00;fillColor=#fff3e0;strokeWidth=2;fontFamily=Helvetica;fontSize=11;`;
  }

  // Gateways
  const baseGateway = 'shape=mxgraph.bpmn.shape;html=1;verticalLabelPosition=bottom;labelBackgroundColor=none;verticalAlign=top;align=center;perimeter=rhombusPerimeter;background=gateway;outline=none;strokeColor=#f57f17;fillColor=#fff9c4;strokeWidth=2;fontFamily=Helvetica;fontSize=11;';
  if (type === 'bpmn:ExclusiveGateway') {
    return baseGateway + 'symbol=exclusiveGw;';
  }
  if (type === 'bpmn:ParallelGateway') {
    return baseGateway + 'symbol=parallelGw;';
  }
  if (type === 'bpmn:InclusiveGateway') {
    return baseGateway + 'symbol=inclusiveGw;';
  }
  if (type === 'bpmn:EventBasedGateway' || type === 'bpmn:ComplexGateway') {
    return baseGateway + 'symbol=complexGw;';
  }

  // SubProcesses
  if (type === 'bpmn:SubProcess') {
    return 'shape=mxgraph.bpmn.subProcess;whiteSpace=wrap;html=1;rounded=1;arcSize=14;strokeColor=#6a1b9a;fillColor=#f3e5f5;strokeWidth=2;align=center;fontFamily=Helvetica;fontSize=12;';
  }

  // Artifacts & Data
  if (type === 'bpmn:DataObjectReference' || type === 'bpmn:DataObject') {
    return 'shape=note;whiteSpace=wrap;html=1;backgroundOutline=1;size=14;strokeColor=#00695c;fillColor=#e0f2f1;strokeWidth=1.5;align=center;fontFamily=Helvetica;fontSize=11;';
  }
  if (type === 'bpmn:DataStoreReference' || type === 'bpmn:DataStore') {
    return 'shape=cylinder3;whiteSpace=wrap;html=1;boundedLbl=1;backgroundOutline=1;size=10;strokeColor=#00695c;fillColor=#e0f2f1;strokeWidth=1.5;align=center;fontFamily=Helvetica;fontSize=11;';
  }
  if (type === 'bpmn:TextAnnotation') {
    return 'shape=callout;whiteSpace=wrap;html=1;perimeter=calloutPerimeter;size=20;position=0.5;strokeColor=#666666;fillColor=#f9f9f9;align=left;fontFamily=Helvetica;fontSize=11;';
  }

  // Fallback
  return 'rounded=1;whiteSpace=wrap;html=1;strokeColor=#333333;fillColor=#ffffff;strokeWidth=1.5;fontFamily=Helvetica;fontSize=12;';
}

/**
 * Converts BPMN 2.0 XML string into Draw.io (.drawio) XML format.
 * @param {string} bpmnXml - BPMN 2.0 XML string
 * @returns {Promise<string>} - Draw.io XML string
 */
export async function convertBpmnToDrawio(bpmnXml) {
  const moddle = new BpmnModdle();
  const { rootElement } = await moddle.fromXML(bpmnXml);

  const plane = rootElement?.diagrams?.[0]?.plane;
  if (!plane || !Array.isArray(plane.planeElement)) {
    throw new Error('No BPMN diagram or plane found in the provided BPMN file.');
  }

  const shapes = plane.planeElement.filter(e => e.$type === 'bpmndi:BPMNShape');
  const edges = plane.planeElement.filter(e => e.$type === 'bpmndi:BPMNEdge');

  // Compute bounding box of entire diagram to calculate appropriate page size
  let maxX = 800;
  let maxY = 600;

  let cellsXml = '';

  for (const s of shapes) {
    const bpmnEl = s.bpmnElement;
    if (!bpmnEl) continue;

    const id = bpmnEl.id || s.id;
    const name = bpmnEl.name || '';
    const style = getShapeStyle(bpmnEl);
    const b = s.bounds || { x: 100, y: 100, width: 80, height: 60 };

    if (b.x + b.width > maxX) maxX = b.x + b.width;
    if (b.y + b.height > maxY) maxY = b.y + b.height;

    cellsXml += `        <mxCell id="${escapeXml(id)}" value="${escapeXml(name)}" style="${escapeXml(style)}" vertex="1" parent="1">\n`;
    cellsXml += `          <mxGeometry x="${Math.round(b.x)}" y="${Math.round(b.y)}" width="${Math.round(b.width)}" height="${Math.round(b.height)}" as="geometry" />\n`;
    cellsXml += `        </mxCell>\n`;
  }

  for (const e of edges) {
    const bpmnEl = e.bpmnElement;
    if (!bpmnEl) continue;

    const id = bpmnEl.id || e.id;
    const name = bpmnEl.name || '';
    const sourceId = bpmnEl.sourceRef?.id || '';
    const targetId = bpmnEl.targetRef?.id || '';
    const style = 'edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;endArrow=block;endFill=1;strokeColor=#424242;strokeWidth=1.5;fontFamily=Helvetica;fontSize=11;labelBackgroundColor=#ffffff;';

    cellsXml += `        <mxCell id="${escapeXml(id)}" value="${escapeXml(name)}" style="${escapeXml(style)}" edge="1" parent="1" source="${escapeXml(sourceId)}" target="${escapeXml(targetId)}">\n`;
    cellsXml += `          <mxGeometry relative="1" as="geometry">\n`;

    const waypoints = e.waypoint || [];
    // If there are intermediate waypoints, preserve them
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

    cellsXml += `          </mxGeometry>\n`;
    cellsXml += `        </mxCell>\n`;
  }

  const pageWidth = Math.max(1200, maxX + 100);
  const pageHeight = Math.max(800, maxY + 100);

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

  return drawioXml;
}

// CLI usage support
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename || '')) {
  const inputArg = process.argv[2] || 'public/diagram/default.bpmn';
  const outputArg = process.argv[3] || inputArg.replace(/\.bpmn$/i, '.drawio');

  try {
    const bpmnContent = fs.readFileSync(inputArg, 'utf-8');
    const drawioContent = await convertBpmnToDrawio(bpmnContent);
    fs.writeFileSync(outputArg, drawioContent, 'utf-8');
    console.log(`✅ Converted ${inputArg} -> ${outputArg} successfully!`);
  } catch (err) {
    console.error('❌ Error converting BPMN to Draw.io:', err);
    process.exit(1);
  }
}
