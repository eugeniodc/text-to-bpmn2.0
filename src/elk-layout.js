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
  const flowNodeMap = new Map();
  const boundaryEvents = [];
  let fnMatch;
  while ((fnMatch = flowNodeRegex.exec(xml)) !== null) {
    const tagName = fnMatch[1];
    const id = fnMatch[2];
    const name = fnMatch[3] || '';
    let size = getElementSize(tagName);
    const isActivity = /task|callActivity|subProcess/i.test(tagName);
    if (isActivity && name.length > 25) {
      if (name.length <= 45) {
        size = { width: 125, height: 80 };
      } else if (name.length <= 70) {
        size = { width: 140, height: 85 };
      } else {
        size = { width: 155, height: 90 };
      }
    }
    const nodeObj = { id, tagName, name, ...size };
    flowNodeMap.set(id, nodeObj);

    if (tagName === 'boundaryEvent') {
      const attachedMatch = fnMatch[0].match(/attachedToRef="([^"]+)"/i);
      boundaryEvents.push({ id, tagName, name, attachedToRef: attachedMatch ? attachedMatch[1] : null, ...size });
    } else {
      flowNodes.push(nodeObj);
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

  // 5. Parse Data Objects, Data Stores, Text Annotations, and Associations
  const dataObjects = [];
  const doRefRegex = /<(?:bpmn:)?(dataObjectReference|dataStoreReference)\b[^>]*id="([^"]+)"(?:\s+name="([^"]*)")?[^>]*\/?>/gi;
  let doMatch;
  while ((doMatch = doRefRegex.exec(xml)) !== null) {
    const isStore = doMatch[1].toLowerCase().includes('datastore');
    dataObjects.push({
      id: doMatch[2],
      name: doMatch[3] || '',
      tagName: doMatch[1],
      width: isStore ? 50 : 36,
      height: 50
    });
  }

  const textAnnotationRegex = /<(?:bpmn:)?textAnnotation\b[^>]*id="([^"]+)"[^>]*>([\s\S]*?)<\/(?:bpmn:)?textAnnotation>/gi;
  let taMatch;
  while ((taMatch = textAnnotationRegex.exec(xml)) !== null) {
    const textMatch = taMatch[2].match(/<(?:bpmn:)?text>([^<]*)<\/(?:bpmn:)?text>/i);
    dataObjects.push({
      id: taMatch[1],
      name: textMatch ? textMatch[1].trim() : '',
      tagName: 'textAnnotation',
      width: 110,
      height: 55
    });
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
  const elkNodes = flowNodes.map(n => {
    const nodeObj = {
      id: n.id,
      width: n.width,
      height: n.height
    };
    if (n.name && n.name.trim()) {
      const tag = (n.tagName || '').toLowerCase();
      if (tag.includes('gateway')) {
        const lblW = Math.min(140, Math.max(65, Math.ceil(n.name.trim().length * 6.8)));
        const numLines = Math.ceil(n.name.trim().length / 18);
        const lblH = Math.max(14, numLines * 14);
        nodeObj.labels = [{
          text: n.name.trim(),
          width: lblW,
          height: lblH,
          layoutOptions: { 'elk.nodeLabels.placement': 'OUTSIDE V_TOP H_CENTER' }
        }];
      } else if (tag.includes('event')) {
        const lblW = Math.min(120, Math.max(45, Math.ceil(n.name.trim().length * 6.8)));
        const numLines = Math.ceil(n.name.trim().length / 16);
        const lblH = Math.max(14, numLines * 14);
        nodeObj.labels = [{
          text: n.name.trim(),
          width: lblW,
          height: lblH,
          layoutOptions: { 'elk.nodeLabels.placement': 'OUTSIDE V_BOTTOM H_CENTER' }
        }];
      }
    }
    return nodeObj;
  });

  const elkEdges = sequenceFlows.map(sf => {
    const edgeObj = {
      id: sf.id,
      sources: [sf.sourceRef],
      targets: [sf.targetRef]
    };
    if (sf.name && sf.name.trim()) {
      edgeObj.labels = [{ text: sf.name.trim(), width: Math.max(35, sf.name.trim().length * 7 + 10), height: 14 }];
    }
    return edgeObj;
  });

  const elkGraph = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.layered.cycleBreaking.strategy': 'DEPTH_FIRST',
      'elk.portConstraints': 'FIXED_SIDE',
      'elk.layered.unnecessaryBendpoints': 'true',
      'elk.layered.thoroughness': '10',
      'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
      'elk.spacing.nodeNode': hasMultipleLanes ? '60' : '50',
      'elk.layered.spacing.nodeNodeBetweenLayers': '85',
      'elk.spacing.edgeNode': '30',
      'elk.spacing.edgeEdge': '20',
      'elk.edgeLabels.placement': 'CENTER',
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
    const orig = flowNodeMap.get(c.id);
    shapesMap.set(c.id, {
      id: c.id,
      tagName: orig?.tagName || '',
      name: orig?.name || '',
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

  let laneHeights = [];
  let laneYOffsets = [];

  if (hasMultipleLanes) {
    // Group shapes by lane
    const laneShapes = [];
    for (let i = 0; i < lanes.length; i++) {
      laneShapes.push([]);
    }
    for (const s of shapesMap.values()) {
      const laneIdx = nodeToLane.get(s.id) ?? 0;
      if (laneShapes[laneIdx]) {
        laneShapes[laneIdx].push(s);
      }
    }

    const TRACK_H = 115;
    const PADDING_V = 30;
    let curY = poolY;

    for (let i = 0; i < lanes.length; i++) {
      const nodes = laneShapes[i];
      nodes.sort((a, b) => a.x - b.x);

      // Assign nodes to non-overlapping vertical tracks in this lane
      const tracks = [];
      for (const node of nodes) {
        let placedTrack = -1;
        for (let t = 0; t < tracks.length; t++) {
          const lastInTrack = tracks[t][tracks[t].length - 1];
          // Ensure at least 30px horizontal clearance before sharing a track
          if (node.x >= lastInTrack.x + lastInTrack.width + 30) {
            tracks[t].push(node);
            placedTrack = t;
            break;
          }
        }
        if (placedTrack === -1) {
          tracks.push([node]);
        }
      }

      const numTracks = Math.max(1, tracks.length);
      const laneH = Math.max(160, PADDING_V * 2 + numTracks * TRACK_H);
      laneHeights.push(laneH);
      laneYOffsets.push(curY);

      // Distribute each track's nodes vertically centered in its track row
      for (let t = 0; t < numTracks; t++) {
        const trackCenterY = curY + PADDING_V + (t + 0.5) * TRACK_H;
        for (const n of (tracks[t] || [])) {
          n.x += shiftX;
          n.y = Math.round(trackCenterY - (n.height / 2));
        }
      }

      curY += laneH;
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

  // 9. Position Data Objects with Guaranteed Collision Avoidance
  const allPositionedShapes = [...shapesMap.values()];
  const dataObjectMap = new Map();
  for (const doObj of dataObjects) {
    dataObjectMap.set(doObj.id, doObj);
  }

  for (const assoc of associations) {
    const isOut = assoc.type === 'output';
    const taskId = isOut ? assoc.source : assoc.target;
    const dataObjId = isOut ? assoc.target : assoc.source;

    if (!shapesMap.has(taskId) || shapesMap.has(dataObjId)) continue;

    const taskShape = shapesMap.get(taskId);
    const doMeta = dataObjectMap.get(dataObjId);
    const doW = doMeta?.width || 36;
    const doH = doMeta?.height || 50;

    // Determine the lane bounds if multiple lanes exist
    const laneIdx = nodeToLane.get(taskId) ?? 0;
    const laneTop = hasMultipleLanes ? (laneYOffsets[laneIdx] || poolY) : poolY;
    const laneBottom = hasMultipleLanes ? (laneTop + (laneHeights[laneIdx] || 160)) : Infinity;

    // Candidate positions: Above task, To the right, Below task
    const candidatePositions = [
      { x: Math.round(taskShape.x + (taskShape.width - doW) / 2), y: Math.round(taskShape.y - doH - 25) },
      { x: Math.round(taskShape.x + taskShape.width + 25), y: Math.round(taskShape.y + (taskShape.height - doH) / 2) },
      { x: Math.round(taskShape.x + (taskShape.width - doW) / 2), y: Math.round(taskShape.y + taskShape.height + 25) }
    ];

    let chosenPos = candidatePositions[0];

    for (const cand of candidatePositions) {
      // Must stay within lane/pool bounds
      if (cand.y < laneTop + 15 || (cand.y + doH) > laneBottom - 15) {
        continue;
      }

      // Check collision against all existing shapes
      let hasCollision = false;
      for (const s of allPositionedShapes) {
        const xOverlap = Math.max(0, Math.min(cand.x + doW, s.x + s.width) - Math.max(cand.x, s.x));
        const yOverlap = Math.max(0, Math.min(cand.y + doH, s.y + s.height) - Math.max(cand.y, s.y));
        if (xOverlap > 0 && yOverlap > 0) {
          hasCollision = true;
          break;
        }
      }

      if (!hasCollision) {
        chosenPos = cand;
        break;
      }
    }

    const doShape = {
      id: dataObjId,
      name: doMeta?.name || '',
      tagName: doMeta?.tagName || 'dataObjectReference',
      x: chosenPos.x,
      y: chosenPos.y,
      width: doW,
      height: doH
    };
    shapesMap.set(dataObjId, doShape);
    allPositionedShapes.push(doShape);
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
      let curY = poolY;
      for (let i = 0; i < lanes.length; i++) {
        const l = lanes[i];
        const laneH = laneHeights[i] || 160;

        laneShapesXml += `
      <bpmndi:BPMNShape id="${l.id}_di" bpmnElement="${l.id}" isHorizontal="true">
        <dc:Bounds x="${poolX + 30}" y="${curY}" width="${poolW - 30}" height="${laneH}" />
      </bpmndi:BPMNShape>`;

        curY += laneH;
      }
      poolH = curY - poolY;
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
    let labelXml = '';
    if (s.name && s.name.trim()) {
      const nameStr = s.name.trim();
      const tag = (s.tagName || '').toLowerCase();
      if (tag.includes('gateway')) {
        const lblW = Math.min(135, Math.max(65, Math.ceil(nameStr.length * 6.8)));
        const numLines = Math.ceil(nameStr.length / 18);
        const lblH = Math.max(14, numLines * 14);
        const lblX = Math.round(s.x + (s.width - lblW) / 2);
        const laneIdx = nodeToLane.get(s.id) ?? 0;
        const laneTop = hasMultipleLanes ? (laneYOffsets[laneIdx] || poolY) : poolY;
        let lblY = Math.round(s.y - lblH - 6);
        if (lblY < laneTop + 10) {
          lblY = Math.round(s.y + s.height + 6);
        }
        labelXml = `\n        <bpmndi:BPMNLabel>\n          <dc:Bounds x="${lblX}" y="${lblY}" width="${lblW}" height="${lblH}" />\n        </bpmndi:BPMNLabel>`;
      } else if (tag.includes('event')) {
        const lblW = Math.min(120, Math.max(45, Math.ceil(nameStr.length * 6.8)));
        const numLines = Math.ceil(nameStr.length / 16);
        const lblH = Math.max(14, numLines * 14);
        const lblX = Math.round(s.x + (s.width - lblW) / 2);
        const laneIdx = nodeToLane.get(s.id) ?? 0;
        const laneTop = hasMultipleLanes ? (laneYOffsets[laneIdx] || poolY) : poolY;
        const laneH = hasMultipleLanes ? (laneHeights[laneIdx] || 160) : Infinity;
        let lblY = Math.round(s.y + s.height + 6);
        if (lblY + lblH > laneTop + laneH - 5) {
          lblY = Math.round(s.y - lblH - 6);
        }
        labelXml = `\n        <bpmndi:BPMNLabel>\n          <dc:Bounds x="${lblX}" y="${lblY}" width="${lblW}" height="${lblH}" />\n        </bpmndi:BPMNLabel>`;
      } else if (tag.includes('dataobject')) {
        const lblW = Math.min(100, Math.max(40, Math.ceil(nameStr.length * 6.5)));
        const numLines = Math.ceil(nameStr.length / 14);
        const lblH = Math.max(14, numLines * 14);
        const lblX = Math.round(s.x + (s.width - lblW) / 2);
        const lblY = Math.round(s.y + s.height + 4);
        labelXml = `\n        <bpmndi:BPMNLabel>\n          <dc:Bounds x="${lblX}" y="${lblY}" width="${lblW}" height="${lblH}" />\n        </bpmndi:BPMNLabel>`;
      }
    }
    flowShapesXml += `
      <bpmndi:BPMNShape id="${s.id}_di" bpmnElement="${s.id}">
        <dc:Bounds x="${s.x}" y="${s.y}" width="${s.width}" height="${s.height}" />${labelXml}
      </bpmndi:BPMNShape>`;
  }

  // 12. Generate DI XML for Sequence Flows
  const outgoingFlowsMap = new Map();
  for (const sf of sequenceFlows) {
    if (!outgoingFlowsMap.has(sf.sourceRef)) {
      outgoingFlowsMap.set(sf.sourceRef, []);
    }
    outgoingFlowsMap.get(sf.sourceRef).push(sf);
  }

  let edgesXml = '';
  const placedEdgeLabels = [];
  for (const sf of sequenceFlows) {
    const sfId = sf.id;
    const sShape = shapesMap.get(sf.sourceRef);
    const tShape = shapesMap.get(sf.targetRef);
    if (!sShape || !tShape) continue;

    let waypoints = [];
    let labelXml = '';

    // If single lane and ELK provided clean sections, use ELK waypoints
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
      const sRight = Math.round(sShape.x + sShape.width);
      const tLeft = Math.round(tShape.x);

      const isForward = sRight < tLeft;
      const isAligned = Math.abs(sCenterY - tCenterY) < 15;

      if (isForward && isAligned) {
        // Direct horizontal connection
        waypoints = [
          { x: sRight, y: sCenterY },
          { x: tLeft, y: tCenterY }
        ];
      } else if (isForward) {
        // Forward flow across different Y levels (tracks or lanes)
        const outgoing = outgoingFlowsMap.get(sf.sourceRef) || [sf];
        const branchIdx = outgoing.findIndex(f => f.id === sf.id);
        const branchCount = outgoing.length;

        const totalGap = tLeft - sRight;
        const staggerStep = branchCount > 1 ? Math.min(25, Math.floor((totalGap * 0.3) / branchCount)) : 0;
        const baseTurnX = Math.round(sRight + Math.max(30, totalGap * 0.35));
        const midX = Math.min(tLeft - 30, baseTurnX + (branchIdx * staggerStep));

        waypoints = [
          { x: sRight, y: sCenterY },
          { x: midX, y: sCenterY },
          { x: midX, y: tCenterY },
          { x: tLeft, y: tCenterY }
        ];
      } else {
        // Loop back / return flow: route around bottom
        const p0x = Math.round(sShape.x + sShape.width / 2);
        const p0y = Math.round(sShape.y + sShape.height);
        const p3x = Math.round(tShape.x + tShape.width / 2);
        const p3y = Math.round(tShape.y + tShape.height);
        const bottomY = Math.max(p0y, p3y) + 32;

        waypoints = [
          { x: p0x, y: p0y },
          { x: p0x, y: bottomY },
          { x: p3x, y: bottomY },
          { x: p3x, y: p3y }
        ];
      }

      if (sf.name && sf.name.trim()) {
        const text = sf.name.trim();
        const lblW = Math.max(35, Math.min(150, Math.round(text.length * 7 + 10)));
        const lblH = 14;
        let lblX, lblY;

        if (isForward && isAligned) {
          // Horizontal flow: center in the gap between shapes
          const gap = tLeft - sRight;
          lblX = Math.round(sRight + (gap - lblW) / 2);
          lblY = Math.round(sCenterY - lblH - 4);
        } else if (isForward) {
          // Multi-step forward flow: place along the arrival segment into target
          const midX = waypoints[1].x;
          const arrivalLen = tLeft - midX;
          if (arrivalLen >= lblW + 16) {
            lblX = Math.round(midX + (arrivalLen - lblW) / 2);
            lblY = Math.round(tCenterY - lblH - 4);
          } else {
            const depLen = midX - sRight;
            if (depLen >= lblW + 16) {
              lblX = Math.round(sRight + (depLen - lblW) / 2);
              lblY = Math.round(sCenterY - lblH - 4);
            } else {
              lblX = Math.max(midX + 5, tLeft - lblW - 10);
              lblY = Math.round(tCenterY - lblH - 4);
            }
          }
        } else {
          // Return flow: place along the horizontal bottom segment (p1 -> p2)
          const leftX = waypoints[2].x;
          const rightX = waypoints[1].x;
          const segLen = Math.abs(rightX - leftX);
          lblX = Math.round(Math.min(leftX, rightX) + (segLen - lblW) / 2);
          lblY = Math.round(waypoints[1].y - lblH - 3);
        }

        // Avoid label collisions with previously placed edge labels
        for (const prev of placedEdgeLabels) {
          const xOverlap = Math.max(0, Math.min(lblX + lblW, prev.x + prev.w) - Math.max(lblX, prev.x));
          const yOverlap = Math.max(0, Math.min(lblY + lblH, prev.y + prev.h) - Math.max(lblY, prev.y));
          if (xOverlap > 0 && yOverlap > 0) {
            lblY = prev.y - lblH - 4;
          }
        }

        // Ensure label doesn't intersect any shape
        for (const s of shapesMap.values()) {
          const xOverlap = Math.max(0, Math.min(lblX + lblW, s.x + s.width) - Math.max(lblX, s.x));
          const yOverlap = Math.max(0, Math.min(lblY + lblH, s.y + s.height) - Math.max(lblY, s.y));
          if (xOverlap > 0 && yOverlap > 0) {
            if (lblX < s.x) {
              lblX = s.x - lblW - 6;
            } else {
              lblX = s.x + s.width + 6;
            }
          }
        }

        placedEdgeLabels.push({ x: lblX, y: lblY, w: lblW, h: lblH });

        labelXml = `
        <bpmndi:BPMNLabel>
          <dc:Bounds x="${lblX}" y="${lblY}" width="${lblW}" height="${lblH}" />
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
