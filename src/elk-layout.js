import ELK from 'elkjs/lib/elk.bundled.js';

const elk = new ELK();

// Standard BPMN 2.0 element dimensions
const ELEMENT_SIZES = {
  // Events (36x36)
  startEvent: { width: 36, height: 36 },
  endEvent: { width: 36, height: 36 },
  intermediateCatchEvent: { width: 36, height: 36 },
  intermediateThrowEvent: { width: 36, height: 36 },
  boundaryEvent: { width: 36, height: 36 },

  // Gateways (50x50)
  exclusiveGateway: { width: 50, height: 50 },
  parallelGateway: { width: 50, height: 50 },
  inclusiveGateway: { width: 50, height: 50 },
  complexGateway: { width: 50, height: 50 },
  eventBasedGateway: { width: 50, height: 50 },

  // Tasks & Activities (100x80)
  task: { width: 100, height: 80 },
  userTask: { width: 100, height: 80 },
  serviceTask: { width: 100, height: 80 },
  sendTask: { width: 100, height: 80 },
  receiveTask: { width: 100, height: 80 },
  manualTask: { width: 100, height: 80 },
  businessRuleTask: { width: 100, height: 80 },
  scriptTask: { width: 100, height: 80 },
  callActivity: { width: 100, height: 80 },
  subProcess: { width: 180, height: 120 },

  // Data Objects & Artifacts
  dataObjectReference: { width: 36, height: 50 },
  dataStoreReference: { width: 50, height: 50 },
  textAnnotation: { width: 100, height: 50 }
};

function getElementSize(tagName) {
  const cleanTag = tagName.replace(/^bpmn:/i, '');
  return ELEMENT_SIZES[cleanTag] || { width: 100, height: 80 };
}

/**
 * Automatically calculates professional layout for BPMN 2.0 XML using ELK (Eclipse Layout Kernel).
 * Handles Pools, Swimlanes, Gateways, Data Objects, Boundary Events, and orthogonal arrow routing.
 */
export async function layoutBpmnWithElk(inputXml) {
  if (!inputXml || typeof inputXml !== 'string') return inputXml;

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

  // 2. Parse collaboration, participants, and lanes
  const collabMatch = xml.match(/<bpmn:collaboration\b[^>]*id="([^"]+)"/i);
  const participantMatches = [...xml.matchAll(/<bpmn:participant\b[^>]*id="([^"]+)"(?:\s+name="([^"]*)")?/gi)];
  const laneMatches = [...xml.matchAll(/<bpmn:lane\b[^>]*id="([^"]+)"(?:\s+name="([^"]*)")?[^>]*>([\s\S]*?)<\/bpmn:lane>/gi)];

  const lanes = [];
  const nodeToLane = new Map();

  for (let i = 0; i < laneMatches.length; i++) {
    const lId = laneMatches[i][1];
    const lName = laneMatches[i][2] || `Lane ${i + 1}`;
    const lInner = laneMatches[i][3];
    const nodeRefs = [...lInner.matchAll(/<bpmn:flowNodeRef>([^<]+)<\/bpmn:flowNodeRef>/gi)].map(m => m[1].trim());
    lanes.push({ id: lId, name: lName, index: i, nodeRefs });
    for (const ref of nodeRefs) {
      nodeToLane.set(ref, i);
    }
  }

  const hasMultipleLanes = lanes.length > 1;
  const hasLanes = lanes.length > 0;
  const hasPool = participantMatches.length > 0 || hasLanes;

  // 3. Parse flow nodes (Tasks, Gateways, Events)
  const flowNodeRegex = /<(?:bpmn:)?(startEvent|endEvent|intermediateCatchEvent|intermediateThrowEvent|boundaryEvent|exclusiveGateway|parallelGateway|inclusiveGateway|complexGateway|eventBasedGateway|task|userTask|serviceTask|sendTask|receiveTask|manualTask|businessRuleTask|scriptTask|callActivity|subProcess)\b[^>]*id="([^"]+)"(?:\s+name="([^"]*)")?[^>]*>/gi;

  const flowNodes = [];
  const boundaryEvents = [];
  let fnMatch;
  while ((fnMatch = flowNodeRegex.exec(xml)) !== null) {
    const tagName = fnMatch[1];
    const id = fnMatch[2];
    const name = fnMatch[3] || '';
    const size = getElementSize(tagName);

    if (tagName === 'boundaryEvent') {
      const attachedMatch = fnMatch[0].match(/attachedToRef="([^"]+)"/i);
      boundaryEvents.push({ id, tagName, name, attachedToRef: attachedMatch ? attachedMatch[1] : null, ...size });
    } else {
      flowNodes.push({ id, tagName, name, ...size });
    }
  }

  // 4. Parse sequence flows
  const sfRegex = /<bpmn:sequenceFlow\b[^>]*id="([^"]+)"(?:\s+name="([^"]*)")?[^>]*sourceRef="([^"]+)"[^>]*targetRef="([^"]+)"/gi;
  const sequenceFlows = [];
  let sfMatch;
  while ((sfMatch = sfRegex.exec(xml)) !== null) {
    sequenceFlows.push({
      id: sfMatch[1],
      name: sfMatch[2] || '',
      sourceRef: sfMatch[3],
      targetRef: sfMatch[4]
    });
  }

  // Fallback lane assignment for nodes without explicit flowNodeRef: inherit from incoming source
  const incomingMap = new Map();
  for (const sf of sequenceFlows) {
    incomingMap.set(sf.targetRef, sf.sourceRef);
  }
  for (const n of flowNodes) {
    if (!nodeToLane.has(n.id)) {
      const src = incomingMap.get(n.id);
      const laneIdx = (src && nodeToLane.has(src)) ? nodeToLane.get(src) : 0;
      nodeToLane.set(n.id, laneIdx);
    }
  }

  // 5. Parse Data Objects and Associations
  const dataObjects = [];
  const doRefRegex = /<bpmn:dataObjectReference\b[^>]*id="([^"]+)"(?:\s+name="([^"]*)")?[^>]*\/>/gi;
  let doMatch;
  while ((doMatch = doRefRegex.exec(xml)) !== null) {
    dataObjects.push({ id: doMatch[1], name: doMatch[2] || '', width: 36, height: 50 });
  }

  const associations = [];
  // Standard associations
  const assocRegex = /<bpmn:association\b[^>]*id="([^"]+)"[^>]*sourceRef="([^"]+)"[^>]*targetRef="([^"]+)"/gi;
  let aMatch;
  while ((aMatch = assocRegex.exec(xml)) !== null) {
    associations.push({ id: aMatch[1], source: aMatch[2], target: aMatch[3], type: 'association' });
  }

  // Data Associations inside tasks
  const taskInnerRegex = /<(?:bpmn:)?(?:userTask|serviceTask|task|sendTask|receiveTask|manualTask|businessRuleTask|scriptTask|callActivity|subProcess)[^>]*id="([^"]+)"[^>]*>([\s\S]*?)<\/(?:bpmn:)?(?:userTask|serviceTask|task|sendTask|receiveTask|manualTask|businessRuleTask|scriptTask|callActivity|subProcess)>/gi;
  let tMatch;
  while ((tMatch = taskInnerRegex.exec(xml)) !== null) {
    const taskId = tMatch[1];
    const inner = tMatch[2];

    const doaMatches = [...inner.matchAll(/<bpmn:dataOutputAssociation[^>]*id="([^"]+)"[^>]*>[\s\S]*?<bpmn:targetRef>([^<]+)<\/bpmn:targetRef>[\s\S]*?<\/bpmn:dataOutputAssociation>/gi)];
    for (const doa of doaMatches) {
      associations.push({ id: doa[1], source: taskId, target: doa[2].trim(), type: 'output' });
    }

    const diaMatches = [...inner.matchAll(/<bpmn:dataInputAssociation[^>]*id="([^"]+)"[^>]*>[\s\S]*?<bpmn:sourceRef>([^<]+)<\/bpmn:sourceRef>[\s\S]*?<\/bpmn:dataInputAssociation>/gi)];
    for (const dia of diaMatches) {
      associations.push({ id: dia[1], source: dia[2].trim(), target: taskId, type: 'input' });
    }
  }

  // 6. Build ELK Graph and Execute Layout
  const elkNodes = flowNodes.map(n => ({
    id: n.id,
    width: n.width,
    height: n.height
  }));

  const elkEdges = sequenceFlows.map(sf => {
    const edgeObj = {
      id: sf.id,
      sources: [sf.sourceRef],
      targets: [sf.targetRef]
    };
    if (sf.name && sf.name.trim()) {
      edgeObj.labels = [{ text: sf.name.trim(), width: Math.max(30, sf.name.trim().length * 7), height: 14 }];
    }
    return edgeObj;
  });

  const elkGraph = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.spacing.nodeNode': hasMultipleLanes ? '50' : '40',
      'elk.layered.spacing.nodeNodeBetweenLayers': '65',
      'elk.spacing.edgeNode': '25',
      'elk.spacing.edgeEdge': '15',
      'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
      'elk.layered.mergeEdges': 'true'
    },
    children: elkNodes,
    edges: elkEdges
  };

  const elkResult = await elk.layout(elkGraph);

  // Map calculated shapes
  const shapesMap = new Map();
  for (const c of elkResult.children) {
    shapesMap.set(c.id, {
      id: c.id,
      x: Math.round(c.x),
      y: Math.round(c.y),
      width: c.width,
      height: c.height
    });
  }

  // Map calculated edge routes from ELK
  const edgeRoutesMap = new Map();
  for (const e of elkResult.edges) {
    if (e.sections && e.sections.length > 0) {
      edgeRoutesMap.set(e.id, {
        section: e.sections[0],
        labels: e.labels || []
      });
    }
  }

  // 7. Apply Multi-Lane Positioning Adjustments (if process has lanes)
  const poolX = 20;
  const poolY = 20;
  const shiftX = hasPool ? 120 : 40;

  if (hasMultipleLanes) {
    // Group shapes by lane
    const laneShapes = new Map();
    for (let i = 0; i < lanes.length; i++) {
      laneShapes.set(i, []);
    }
    for (const s of shapesMap.values()) {
      const laneIdx = nodeToLane.get(s.id) ?? 0;
      if (!laneShapes.has(laneIdx)) laneShapes.set(laneIdx, []);
      laneShapes.get(laneIdx).push(s);
    }

    // Calculate dynamic lane heights based on max concurrent nodes at similar X
    const laneHeights = [];
    for (let i = 0; i < lanes.length; i++) {
      const nodes = laneShapes.get(i) || [];
      nodes.sort((a, b) => a.x - b.x);

      let maxConcurrent = 1;
      for (let j = 0; j < nodes.length; j++) {
        const concurrent = nodes.filter(other => Math.abs(other.x - nodes[j].x) < 55).length;
        if (concurrent > maxConcurrent) maxConcurrent = concurrent;
      }
      const dynHeight = Math.max(160, maxConcurrent * 105 + 45);
      laneHeights.push(dynHeight);
    }

    // Calculate Y offset for each lane
    const laneYOffsets = [];
    let curY = poolY;
    for (let i = 0; i < lanes.length; i++) {
      laneYOffsets.push(curY);
      curY += laneHeights[i];
    }

    // Position shapes inside each lane
    for (let i = 0; i < lanes.length; i++) {
      const nodes = laneShapes.get(i) || [];
      const laneY = laneYOffsets[i];
      const laneH = laneHeights[i];

      // Cluster nodes by X to detect parallel branches
      const clusters = [];
      for (const n of nodes) {
        let placed = false;
        for (const cluster of clusters) {
          if (Math.abs(cluster.x - n.x) < 55) {
            cluster.nodes.push(n);
            placed = true;
            break;
          }
        }
        if (!placed) {
          clusters.push({ x: n.x, nodes: [n] });
        }
      }

      for (const cluster of clusters) {
        const k = cluster.nodes.length;
        if (k === 1) {
          const n = cluster.nodes[0];
          n.x += shiftX;
          n.y = Math.round(laneY + (laneH - n.height) / 2);
        } else {
          // Evenly distribute concurrent nodes vertically
          const step = laneH / (k + 1);
          for (let j = 0; j < k; j++) {
            const n = cluster.nodes[j];
            n.x += shiftX;
            n.y = Math.round(laneY + (j + 1) * step - (n.height / 2));
          }
        }
      }
    }
  } else {
    // Single lane or no lanes: apply simple padding shift
    const shiftY = hasPool ? 60 : 40;
    for (const s of shapesMap.values()) {
      s.x += shiftX;
      s.y += shiftY;
    }
    // Shift ELK edge waypoints as well
    for (const [edgeId, route] of edgeRoutesMap.entries()) {
      const s = route.section;
      s.startPoint.x += shiftX;
      s.startPoint.y += shiftY;
      s.endPoint.x += shiftX;
      s.endPoint.y += shiftY;
      if (s.bendPoints) {
        for (const b of s.bendPoints) {
          b.x += shiftX;
          b.y += shiftY;
        }
      }
      for (const lbl of route.labels) {
        lbl.x += shiftX;
        lbl.y += shiftY;
      }
    }
  }

  // 8. Dock Boundary Events to host task perimeter
  for (const be of boundaryEvents) {
    if (be.attachedToRef && shapesMap.has(be.attachedToRef)) {
      const host = shapesMap.get(be.attachedToRef);
      const beX = Math.round(host.x + host.width - be.width - 15);
      const beY = Math.round(host.y + host.height - (be.height / 2));
      shapesMap.set(be.id, { id: be.id, x: beX, y: beY, width: be.width, height: be.height });
    }
  }

  // 9. Position Data Objects
  const taskDoCounts = new Map();
  for (const assoc of associations) {
    const isOut = assoc.type === 'output';
    const taskId = isOut ? assoc.source : assoc.target;
    const dataObjId = isOut ? assoc.target : assoc.source;

    if (!shapesMap.has(taskId) || shapesMap.has(dataObjId)) continue;

    const taskShape = shapesMap.get(taskId);
    const count = taskDoCounts.get(taskId) || 0;
    taskDoCounts.set(taskId, count + 1);

    const doW = 36, doH = 50;
    const doX = Math.round(taskShape.x + (taskShape.width - doW) / 2 + (count * 45));
    const doY = Math.max(30, Math.round(taskShape.y - doH - 25));

    shapesMap.set(dataObjId, { id: dataObjId, x: doX, y: doY, width: doW, height: doH });
  }

  // 10. Calculate Pool and Lane Dimensions
  let poolW = 400;
  let poolH = 200;
  let laneShapesXml = '';
  let poolShapeXml = '';

  if (shapesMap.size > 0) {
    let maxX = 0;
    let maxY = 0;
    for (const s of shapesMap.values()) {
      if (s.x + s.width > maxX) maxX = s.x + s.width;
      if (s.y + s.height > maxY) maxY = s.y + s.height;
    }
    poolW = Math.round(maxX - poolX + 80);

    if (hasMultipleLanes) {
      // Re-sum dynamic lane heights
      let totalLaneH = 0;
      let curY = poolY;

      for (let i = 0; i < lanes.length; i++) {
        const l = lanes[i];
        const nodesInLane = [...shapesMap.values()].filter(s => nodeToLane.get(s.id) === i);
        let maxConcurrent = 1;
        for (let j = 0; j < nodesInLane.length; j++) {
          const concurrent = nodesInLane.filter(o => Math.abs(o.x - nodesInLane[j].x) < 55).length;
          if (concurrent > maxConcurrent) maxConcurrent = concurrent;
        }
        const laneH = Math.max(160, maxConcurrent * 105 + 45);

        laneShapesXml += `
      <bpmndi:BPMNShape id="${l.id}_di" bpmnElement="${l.id}" isHorizontal="true">
        <dc:Bounds x="${poolX + 30}" y="${curY}" width="${poolW - 30}" height="${laneH}" />
      </bpmndi:BPMNShape>`;

        curY += laneH;
        totalLaneH += laneH;
      }
      poolH = totalLaneH;
    } else {
      poolH = Math.round(maxY - poolY + 50);
      if (lanes.length === 1) {
        laneShapesXml += `
      <bpmndi:BPMNShape id="${lanes[0].id}_di" bpmnElement="${lanes[0].id}" isHorizontal="true">
        <dc:Bounds x="${poolX + 30}" y="${poolY}" width="${poolW - 30}" height="${poolH}" />
      </bpmndi:BPMNShape>`;
      }
    }

    if (hasPool) {
      for (const p of participantMatches) {
        poolShapeXml += `
      <bpmndi:BPMNShape id="${p[1]}_di" bpmnElement="${p[1]}" isHorizontal="true">
        <dc:Bounds x="${poolX}" y="${poolY}" width="${poolW}" height="${poolH}" />
      </bpmndi:BPMNShape>`;
      }
    }
  }

  // 11. Generate DI XML for Flow Nodes
  let flowShapesXml = '';
  for (const s of shapesMap.values()) {
    flowShapesXml += `
      <bpmndi:BPMNShape id="${s.id}_di" bpmnElement="${s.id}">
        <dc:Bounds x="${s.x}" y="${s.y}" width="${s.width}" height="${s.height}" />
      </bpmndi:BPMNShape>`;
  }

  // 12. Generate DI XML for Sequence Flows
  let edgesXml = '';
  for (const sf of sequenceFlows) {
    const sfId = sf.id;
    const sShape = shapesMap.get(sf.sourceRef);
    const tShape = shapesMap.get(sf.targetRef);
    if (!sShape || !tShape) continue;

    let waypoints = [];
    let labelXml = '';

    // If single lane, try to use ELK's precise orthogonal route
    if (!hasMultipleLanes && edgeRoutesMap.has(sfId)) {
      const route = edgeRoutesMap.get(sfId);
      const s = route.section;
      waypoints = [
        { x: Math.round(s.startPoint.x), y: Math.round(s.startPoint.y) },
        ...(s.bendPoints || []).map(b => ({ x: Math.round(b.x), y: Math.round(b.y) })),
        { x: Math.round(s.endPoint.x), y: Math.round(s.endPoint.y) }
      ];
      if (route.labels && route.labels.length > 0) {
        const lbl = route.labels[0];
        labelXml = `
        <bpmndi:BPMNLabel>
          <dc:Bounds x="${Math.round(lbl.x)}" y="${Math.round(lbl.y)}" width="${Math.round(lbl.width)}" height="${Math.round(lbl.height)}" />
        </bpmndi:BPMNLabel>`;
      }
    } else {
      // Multi-lane routing: compute clean Manhattan orthogonal waypoints
      const sCenterY = Math.round(sShape.y + sShape.height / 2);
      const tCenterY = Math.round(tShape.y + tShape.height / 2);

      if (Math.abs(sCenterY - tCenterY) < 15) {
        // Horizontally aligned
        waypoints = [
          { x: Math.round(sShape.x + sShape.width), y: sCenterY },
          { x: Math.round(tShape.x), y: tCenterY }
        ];
      } else if (sShape.x < tShape.x) {
        // Left to right across different Y levels / lanes
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
        // Loop back / return flow
        const p1x = Math.round(sShape.x + sShape.width / 2);
        const p1y = Math.round(sShape.y + sShape.height);
        const p2x = Math.round(tShape.x + tShape.width / 2);
        const p2y = Math.round(tShape.y + tShape.height);
        const bottomY = Math.max(p1y, p2y) + 35;
        waypoints = [
          { x: p1x, y: p1y },
          { x: p1x, y: bottomY },
          { x: p2x, y: bottomY },
          { x: p2x, y: p2y }
        ];
      }

      if (sf.name && sf.name.trim()) {
        const lblW = Math.max(30, sf.name.trim().length * 7);
        const lblX = waypoints.length > 2 ? waypoints[1].x + 5 : Math.round(waypoints[0].x + (waypoints[1].x - waypoints[0].x) / 2 - lblW / 2);
        const lblY = waypoints.length > 2 ? Math.round(waypoints[1].y - 18) : Math.round(waypoints[0].y - 18);
        labelXml = `
        <bpmndi:BPMNLabel>
          <dc:Bounds x="${lblX}" y="${lblY}" width="${lblW}" height="14" />
        </bpmndi:BPMNLabel>`;
      }
    }

    edgesXml += `
      <bpmndi:BPMNEdge id="${sfId}_di" bpmnElement="${sfId}">
${waypoints.map(w => `        <di:waypoint x="${w.x}" y="${w.y}" />`).join('\n')}${labelXml}
      </bpmndi:BPMNEdge>`;
  }

  // 13. Generate DI XML for Associations (Data Objects)
  for (const assoc of associations) {
    const sShape = shapesMap.get(assoc.source);
    const tShape = shapesMap.get(assoc.target);
    if (!sShape || !tShape) continue;

    const p1 = { x: Math.round(sShape.x + sShape.width / 2), y: Math.round(sShape.y + sShape.height) };
    const p2 = { x: Math.round(tShape.x + tShape.width / 2), y: Math.round(tShape.y) };

    edgesXml += `
      <bpmndi:BPMNEdge id="${assoc.id}_di" bpmnElement="${assoc.id}">
        <di:waypoint x="${p1.x}" y="${p1.y}" />
        <di:waypoint x="${p2.x}" y="${p2.y}" />
      </bpmndi:BPMNEdge>`;
  }

  // 14. Assemble Complete BPMNDiagram
  const planeElementRef = collabMatch ? collabMatch[1] : (xml.match(/<bpmn:process\b[^>]*id="([^"]+)"/i)?.[1] || 'Process_1');

  const bpmnDiagramSnippet = `
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="${planeElementRef}">
${poolShapeXml}${laneShapesXml}${flowShapesXml}${edgesXml}
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
`;

  // Strip any old or broken BPMNDiagram and insert new clean diagram
  let cleanXml = xml.replace(/<bpmndi:BPMNDiagram[\s\S]*?<\/bpmndi:BPMNDiagram>/gi, '').trim();

  // Ensure standard namespaces exist
  if (!cleanXml.includes('xmlns:bpmndi=')) {
    cleanXml = cleanXml.replace(
      /(<(?:\w+:)?definitions)/i,
      '$1 xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI"'
    );
  }

  return cleanXml.replace('</bpmn:definitions>', `${bpmnDiagramSnippet}</bpmn:definitions>`);
}
