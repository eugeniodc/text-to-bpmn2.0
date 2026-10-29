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

  // 0. Normalize broken / typo prefixes (e.g. <bn:flowNodeRef>, <bp:tag>, <bpm:tag>, <bpmn2:tag>) to standard <bpmn:tag>
  xml = xml.replace(/<\/?(?:bn|bpm|bpmn2|bp):([a-zA-Z0-9_-]+)/gi, (match, tag) => {
    return match.startsWith('</') ? `</bpmn:${tag}` : `<bpmn:${tag}`;
  });

  // Normalize any untyped BPMN tags without prefix (e.g. <flowNodeRef>, <lane>, <laneSet>)
  xml = xml.replace(/<(flowNodeRef|laneSet|lane|sequenceFlow|exclusiveGateway|parallelGateway|inclusiveGateway|complexGateway|eventBasedGateway|task|userTask|serviceTask|sendTask|receiveTask|manualTask|businessRuleTask|scriptTask|callActivity|subProcess|startEvent|endEvent|intermediateCatchEvent|intermediateThrowEvent|boundaryEvent|dataObjectReference|dataStoreReference|textAnnotation|association)\b/gi, '<bpmn:$1')
           .replace(/<\/(flowNodeRef|laneSet|lane|sequenceFlow|exclusiveGateway|parallelGateway|inclusiveGateway|complexGateway|eventBasedGateway|task|userTask|serviceTask|sendTask|receiveTask|manualTask|businessRuleTask|scriptTask|callActivity|subProcess|startEvent|endEvent|intermediateCatchEvent|intermediateThrowEvent|boundaryEvent|dataObjectReference|dataStoreReference|textAnnotation|association)>/gi, '</bpmn:$1>');

  // Normalize <bpmn:dataAssociation> directly under process into valid <bpmn:association>
  xml = xml.replace(/<bpmn:dataAssociation\b/gi, '<bpmn:association')
           .replace(/<\/bpmn:dataAssociation>/gi, '</bpmn:association>');

  // Ensure standard namespaces exist
  if (!xml.includes('xmlns:bpmn=')) {
    xml = xml.replace(
      /(<(?:\w+:)?definitions)/i,
      '$1 xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI"'
    );
  }

  // Ensure alias namespaces exist to prevent parser crashes on any residual prefixes
  if (!xml.includes('xmlns:bn=')) {
    xml = xml.replace(/(<(?:\w+:)?definitions\b[^>]*)/i, '$1 xmlns:bn="http://www.omg.org/spec/BPMN/20100524/MODEL"');
  }
  if (!xml.includes('xmlns:bpmn2=')) {
    xml = xml.replace(/(<(?:\w+:)?definitions\b[^>]*)/i, '$1 xmlns:bpmn2="http://www.omg.org/spec/BPMN/20100524/MODEL"');
  }

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

  // 3. Detect Embedded SubProcesses and internal elements
  const subProcessRegex = /<(?:bpmn:)?subProcess\b[^>]*id="([^"]+)"(?:\s+name="([^"]*)")?[^>]*>([\s\S]*?)<\/(?:bpmn:)?subProcess>/gi;
  const subProcessMap = new Map();
  const innerNodeIdSet = new Set();
  const innerFlowIdSet = new Set();
  let spMatch;
  while ((spMatch = subProcessRegex.exec(xml)) !== null) {
    const spId = spMatch[1];
    const spName = spMatch[2] || '';
    const spContent = spMatch[3];

    // Find inner flow nodes inside this subProcess
    const innerFnRegex = /<(?:bpmn:)?(startEvent|endEvent|intermediateCatchEvent|intermediateThrowEvent|exclusiveGateway|parallelGateway|inclusiveGateway|complexGateway|eventBasedGateway|task|userTask|serviceTask|sendTask|receiveTask|manualTask|businessRuleTask|scriptTask|callActivity)\b[^>]*id="([^"]+)"(?:\s+name="([^"]*)")?[^>]*>/gi;
    let ifn;
    const innerNodes = [];
    while ((ifn = innerFnRegex.exec(spContent)) !== null) {
      const tagName = ifn[1];
      const id = ifn[2];
      const name = ifn[3] || '';
      let size = getElementSize(tagName);
      if (/task|callActivity/i.test(tagName) && name.length > 25) {
        size = { width: Math.min(155, 100 + Math.min(55, Math.round(name.length * 1.5))), height: 80 };
      }
      innerNodes.push({ id, tagName, name, ...size, parentSubProcess: spId });
      innerNodeIdSet.add(id);
    }

    // Find inner sequence flows inside this subProcess
    const innerSfRegex = /<bpmn:sequenceFlow\b[^>]*id="([^"]+)"(?:\s+name="([^"]*)")?[^>]*sourceRef="([^"]+)"[^>]*targetRef="([^"]+)"/gi;
    let isf;
    const innerFlows = [];
    while ((isf = innerSfRegex.exec(spContent)) !== null) {
      innerFlows.push({ id: isf[1], name: isf[2] || '', sourceRef: isf[3], targetRef: isf[4], parentSubProcess: spId });
      innerFlowIdSet.add(isf[1]);
    }

    if (innerNodes.length > 0) {
      let totalW = 0;
      for (const n of innerNodes) {
        totalW += n.width + 35;
      }
      const calcW = Math.max(380, totalW + 50);
      const calcH = 175;
      subProcessMap.set(spId, { id: spId, name: spName, nodes: innerNodes, flows: innerFlows, width: calcW, height: calcH, isExpanded: true });
    }
  }

  // 3b. Parse top-level flow nodes (Tasks, Gateways, Events, SubProcesses)
  const flowNodeRegex = /<(?:bpmn:)?(startEvent|endEvent|intermediateCatchEvent|intermediateThrowEvent|boundaryEvent|exclusiveGateway|parallelGateway|inclusiveGateway|complexGateway|eventBasedGateway|task|userTask|serviceTask|sendTask|receiveTask|manualTask|businessRuleTask|scriptTask|callActivity|subProcess)\b[^>]*id="([^"]+)"(?:\s+name="([^"]*)")?[^>]*>/gi;

  const flowNodes = [];
  const flowNodeMap = new Map();
  const boundaryEvents = [];
  let fnMatch;
  while ((fnMatch = flowNodeRegex.exec(xml)) !== null) {
    const tagName = fnMatch[1];
    const id = fnMatch[2];
    const name = fnMatch[3] || '';

    let size;
    if (tagName === 'subProcess' && subProcessMap.has(id)) {
      const spInfo = subProcessMap.get(id);
      size = { width: spInfo.width, height: spInfo.height, isExpanded: true };
    } else {
      size = getElementSize(tagName);
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
    }

    const nodeObj = { id, tagName, name, ...size };
    flowNodeMap.set(id, nodeObj);

    if (tagName === 'boundaryEvent') {
      const attachedMatch = fnMatch[0].match(/attachedToRef="([^"]+)"/i);
      boundaryEvents.push({ id, tagName, name, attachedToRef: attachedMatch ? attachedMatch[1] : null, ...size });
    } else if (!innerNodeIdSet.has(id)) {
      // Only include top-level nodes in the root ELK graph
      flowNodes.push(nodeObj);
    }
  }

  // 4. Parse sequence flows (excluding internal subProcess flows for top-level ELK)
  const sfRegex = /<bpmn:sequenceFlow\b[^>]*id="([^"]+)"(?:\s+name="([^"]*)")?[^>]*sourceRef="([^"]+)"[^>]*targetRef="([^"]+)"/gi;
  const sequenceFlows = [];
  let sfMatch;
  while ((sfMatch = sfRegex.exec(xml)) !== null) {
    sequenceFlows.push({
      id: sfMatch[1],
      name: sfMatch[2] || '',
      sourceRef: sfMatch[3],
      targetRef: sfMatch[4],
      isInner: innerFlowIdSet.has(sfMatch[1])
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
  const doRefRegex = /<(?:bpmn:)?(dataObjectReference|dataStoreReference|dataObject)\b([^>]*)\/?>/gi;
  let doMatch;
  while ((doMatch = doRefRegex.exec(xml)) !== null) {
    const rawTag = doMatch[1];
    const attrs = doMatch[2];
    const idMatch = attrs.match(/\bid="([^"]+)"/i);
    if (!idMatch) continue;
    const nameMatch = attrs.match(/\bname="([^"]*)"/i);
    const isStore = rawTag.toLowerCase().includes('datastore');
    const tagName = isStore ? 'dataStoreReference' : 'dataObjectReference';
    dataObjects.push({
      id: idMatch[1],
      name: nameMatch ? nameMatch[1] : '',
      tagName: tagName,
      width: isStore ? 50 : 36,
      height: 50
    });
  }

  const textAnnotationRegex = /<(?:bpmn:)?textAnnotation\b[^>]*id="([^"]+)"[^>]*>([\s\S]*?)<\/(?:bpmn:)?textAnnotation>/gi;
  let taMatch;
  while ((taMatch = textAnnotationRegex.exec(xml)) !== null) {
    const textMatch = taMatch[2].match(/<(?:bpmn:)?text>([^<]*)<\/(?:bpmn:)?text>/i);
    const text = textMatch ? textMatch[1].trim() : '';
    const textLen = text.length;
    let annotW = 120;
    let annotH = 50;
    if (textLen > 60) {
      annotW = Math.min(190, Math.max(120, Math.round(textLen * 3.5)));
      const lines = Math.ceil(textLen / 28);
      annotH = Math.max(50, Math.min(110, lines * 16 + 18));
    } else if (textLen > 30) {
      annotW = 145;
      annotH = 55;
    }
    dataObjects.push({
      id: taMatch[1],
      name: text,
      tagName: 'textAnnotation',
      width: annotW,
      height: annotH
    });
  }

  const associations = [];
  // Standard associations (support any attribute order)
  const assocRegex = /<(?:bpmn:)?association\b([^>]*)\/?>/gi;
  let aMatch;
  while ((aMatch = assocRegex.exec(xml)) !== null) {
    const attrs = aMatch[1];
    const idMatch = attrs.match(/\bid="([^"]+)"/i);
    const srcMatch = attrs.match(/\bsourceRef="([^"]+)"/i);
    const tgtMatch = attrs.match(/\btargetRef="([^"]+)"/i);
    if (srcMatch && tgtMatch) {
      const aId = idMatch ? idMatch[1] : `Assoc_${srcMatch[1]}_${tgtMatch[1]}`;
      associations.push({ id: aId, source: srcMatch[1], target: tgtMatch[1], type: 'association' });
    }
  }

  // Data Associations inside tasks and events (support missing/optional id, any tag prefix)
  const taskInnerRegex = /<(?:bpmn:)?(?:userTask|serviceTask|task|sendTask|receiveTask|manualTask|businessRuleTask|scriptTask|callActivity|subProcess|startEvent|endEvent|intermediateCatchEvent|intermediateThrowEvent)[^>]*id="([^"]+)"[^>]*>([\s\S]*?)<\/(?:bpmn:)?(?:userTask|serviceTask|task|sendTask|receiveTask|manualTask|businessRuleTask|scriptTask|callActivity|subProcess|startEvent|endEvent|intermediateCatchEvent|intermediateThrowEvent)>/gi;
  let tMatch;
  while ((tMatch = taskInnerRegex.exec(xml)) !== null) {
    const taskId = tMatch[1];
    const inner = tMatch[2];

    const doaMatches = [...inner.matchAll(/<(?:bpmn:)?dataOutputAssociation(?:\s+[^>]*?id="([^"]*)")?[^>]*>[\s\S]*?<(?:bpmn:)?targetRef>([^<]+)<\/(?:bpmn:)?targetRef>[\s\S]*?<\/(?:bpmn:)?dataOutputAssociation>/gi)];
    for (let i = 0; i < doaMatches.length; i++) {
      const doa = doaMatches[i];
      const tgt = doa[2].trim();
      const aId = doa[1] ? doa[1].trim() : `DOA_${taskId}_${tgt}`;
      associations.push({ id: aId, source: taskId, target: tgt, type: 'output' });
    }

    const diaMatches = [...inner.matchAll(/<(?:bpmn:)?dataInputAssociation(?:\s+[^>]*?id="([^"]*)")?[^>]*>[\s\S]*?<(?:bpmn:)?sourceRef>([^<]+)<\/(?:bpmn:)?sourceRef>[\s\S]*?<\/(?:bpmn:)?dataInputAssociation>/gi)];
    for (let i = 0; i < diaMatches.length; i++) {
      const dia = diaMatches[i];
      const src = dia[2].trim();
      const aId = dia[1] ? dia[1].trim() : `DIA_${taskId}_${src}`;
      associations.push({ id: aId, source: src, target: taskId, type: 'input' });
    }
  }

  // 5b. Auto-duplicate any artifact shared across multiple action objects (tasks, gateways, events)
  // Ensures every artifact belongs strictly to ONE action object, eliminating long crossing lines.
  const initialDoMap = new Map();
  for (const d of dataObjects) {
    initialDoMap.set(d.id, d);
  }

  const doAssocMap = new Map();
  for (const assoc of associations) {
    let doId = null;
    let flowNodeId = null;
    let isDoSource = false;
    if (initialDoMap.has(assoc.source)) {
      doId = assoc.source;
      flowNodeId = assoc.target;
      isDoSource = true;
    } else if (initialDoMap.has(assoc.target)) {
      doId = assoc.target;
      flowNodeId = assoc.source;
      isDoSource = false;
    }
    if (doId && flowNodeId) {
      if (!doAssocMap.has(doId)) doAssocMap.set(doId, []);
      doAssocMap.get(doId).push({ assoc, flowNodeId, isDoSource });
    }
  }

  for (const [doId, linkList] of doAssocMap.entries()) {
    if (linkList.length <= 1) continue;

    const origDo = initialDoMap.get(doId);
    if (!origDo) continue;

    // Link 0 keeps the original artifact; links 1..N get duplicated artifacts
    for (let i = 1; i < linkList.length; i++) {
      const { assoc, flowNodeId, isDoSource } = linkList[i];
      const dupId = `${doId}_${flowNodeId}`;
      const dupObj = {
        ...origDo,
        id: dupId,
        name: origDo.name
      };
      dataObjects.push(dupObj);
      initialDoMap.set(dupId, dupObj);

      // Re-point the association
      if (isDoSource) {
        assoc.source = dupId;
      } else {
        assoc.target = dupId;
      }
      const origAssocId = assoc.id;
      const dupAssocId = `${origAssocId}_dup${i}`;
      assoc.id = dupAssocId;

      // Insert duplicated artifact element in XML before </bpmn:process>
      const tag = origDo.tagName || 'dataObjectReference';
      const nameAttr = origDo.name ? ` name="${origDo.name}"` : '';
      xml = xml.replace('</bpmn:process>', `  <bpmn:${tag} id="${dupId}"${nameAttr} />\n  </bpmn:process>`);

      // Update sourceRef / targetRef and association id inside the flowNode block in XML
      const nodeBlockRegex = new RegExp(`(<(?:bpmn:)?([a-zA-Z0-9_-]+)\\b[^>]*id="${flowNodeId}"[\\s\\S]*?<\\/(?:bpmn:)?\\2>)`, 'i');
      xml = xml.replace(nodeBlockRegex, (nodeBlock) => {
        let updatedBlock = nodeBlock;
        if (new RegExp(`id="${origAssocId}"`).test(updatedBlock)) {
          updatedBlock = updatedBlock.replace(new RegExp(`(<(?:bpmn:)?(?:dataInputAssociation|dataOutputAssociation)\\b[^>]*id=")${origAssocId}(")`, 'g'), `$1${dupAssocId}$2`);
        } else {
          // If the tag didn't have an explicit id, inject id into the association tag wrapping doId
          const assocWrapRegex = new RegExp(`(<(?:bpmn:)?(?:dataInputAssociation|dataOutputAssociation)\\b)([^>]*>([\\s\\S]*?<(?:bpmn:)?(?:sourceRef|targetRef)>\\s*${doId}\\s*<\\/(?:bpmn:)?(?:sourceRef|targetRef)>[\\s\\S]*?<\\/(?:bpmn:)?(?:dataInputAssociation|dataOutputAssociation)>))`, 'i');
          updatedBlock = updatedBlock.replace(assocWrapRegex, `$1 id="${dupAssocId}"$2`);
        }
        return updatedBlock
          .replace(new RegExp(`(<(?:bpmn:)?sourceRef>)\\s*${doId}\\s*(<\\/(?:bpmn:)?sourceRef>)`, 'g'), `$1${dupId}$2`)
          .replace(new RegExp(`(<(?:bpmn:)?targetRef>)\\s*${doId}\\s*(<\\/(?:bpmn:)?targetRef>)`, 'g'), `$1${dupId}$2`);
      });

      // Update standard association in XML if present
      const assocTagRegex = new RegExp(`(<(?:bpmn:)?association\\b[^>]*id="${origAssocId}"[^>]*)`, 'i');
      xml = xml.replace(assocTagRegex, (tagStr) => {
        return tagStr
          .replace(new RegExp(`id="${origAssocId}"`, 'g'), `id="${dupAssocId}"`)
          .replace(new RegExp(`sourceRef="${doId}"`, 'g'), `sourceRef="${dupId}"`)
          .replace(new RegExp(`targetRef="${doId}"`, 'g'), `targetRef="${dupId}"`);
      });
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

  const flowNodeIdSet = new Set(flowNodes.map(n => n.id));
  const boundaryToHostMap = new Map();
  for (const be of boundaryEvents) {
    if (be.attachedToRef) {
      boundaryToHostMap.set(be.id, be.attachedToRef);
    }
  }

  const elkEdges = [];
  for (const sf of sequenceFlows) {
    if (sf.isInner) continue; // Skip subProcess internal flows from top-level ELK graph
    const srcId = boundaryToHostMap.get(sf.sourceRef) || sf.sourceRef;
    const tgtId = boundaryToHostMap.get(sf.targetRef) || sf.targetRef;

    // Both source and target MUST exist in elkNodes, and must not be identical
    if (flowNodeIdSet.has(srcId) && flowNodeIdSet.has(tgtId) && srcId !== tgtId) {
      const edgeObj = {
        id: sf.id,
        sources: [srcId],
        targets: [tgtId]
      };
      if (sf.name && sf.name.trim()) {
        edgeObj.labels = [{ text: sf.name.trim(), width: Math.max(35, sf.name.trim().length * 7 + 10), height: 14 }];
      }
      elkEdges.push(edgeObj);
    }
  }

  const hasDataObjects = dataObjects.length > 0;

  const elkGraph = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.layered.cycleBreaking.strategy': 'DEPTH_FIRST',
      'elk.portConstraints': 'FIXED_SIDE',
      'elk.layered.unnecessaryBendpoints': 'true',
      'elk.layered.thoroughness': '25',
      'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
      'elk.spacing.nodeNode': hasDataObjects ? '100' : (hasMultipleLanes ? '95' : '90'),
      'elk.layered.spacing.nodeNodeBetweenLayers': hasDataObjects ? '150' : '140',
      'elk.spacing.edgeNode': '55',
      'elk.spacing.edgeEdge': '35',
      'elk.edgeLabels.placement': 'CENTER',
      'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
      'elk.layered.mergeEdges': 'false',
      'elk.layered.compaction.postCompaction.strategy': 'EDGE_LENGTH'
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

  // Build incoming and outgoing flow maps early for layout decisions
  const incomingFlowsMap = new Map();
  const outgoingFlowsMap = new Map();
  for (const sf of sequenceFlows) {
    if (!outgoingFlowsMap.has(sf.sourceRef)) {
      outgoingFlowsMap.set(sf.sourceRef, []);
    }
    outgoingFlowsMap.get(sf.sourceRef).push(sf);

    if (!incomingFlowsMap.has(sf.targetRef)) {
      incomingFlowsMap.set(sf.targetRef, []);
    }
    incomingFlowsMap.get(sf.targetRef).push(sf);
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

    const TRACK_H = hasDataObjects ? 160 : 115;
    const PADDING_V = hasDataObjects ? 80 : 30;
    let curY = poolY;

    for (let i = 0; i < lanes.length; i++) {
      const nodes = laneShapes[i];
      nodes.sort((a, b) => a.x - b.x);

      // Assign nodes to non-overlapping vertical tracks in this lane with predecessor track affinity
      const tracks = [];
      const nodeTrackMap = new Map();

      for (const node of nodes) {
        let placedTrack = -1;

        // 1. If this node has an incoming flow from a predecessor already placed in a track in this lane,
        // prefer placing it in that same track to keep the flow strictly horizontal
        const inFlows = incomingFlowsMap.get(node.id) || [];
        for (const f of inFlows) {
          const predTrack = nodeTrackMap.get(f.sourceRef);
          if (predTrack !== undefined && tracks[predTrack]) {
            const lastInTrack = tracks[predTrack][tracks[predTrack].length - 1];
            if (node.x >= lastInTrack.x + lastInTrack.width + 25) {
              tracks[predTrack].push(node);
              nodeTrackMap.set(node.id, predTrack);
              placedTrack = predTrack;
              break;
            }
          }
        }

        // 2. Otherwise, check existing tracks in order
        if (placedTrack === -1) {
          for (let t = 0; t < tracks.length; t++) {
            const lastInTrack = tracks[t][tracks[t].length - 1];
            // Ensure at least 30px horizontal clearance before sharing a track
            if (node.x >= lastInTrack.x + lastInTrack.width + 30) {
              tracks[t].push(node);
              nodeTrackMap.set(node.id, t);
              placedTrack = t;
              break;
            }
          }
        }

        // 3. If no existing track fits, start a new track
        if (placedTrack === -1) {
          nodeTrackMap.set(node.id, tracks.length);
          tracks.push([node]);
        }
      }

      const numTracks = Math.max(1, tracks.length);
      const laneH = Math.max(hasDataObjects ? 260 : 160, PADDING_V * 2 + numTracks * TRACK_H);
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
    // Single lane or no lanes: apply padding shift with extra top room for data objects
    const shiftY = hasDataObjects ? (hasPool ? 130 : 100) : (hasPool ? 60 : 40);
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

  // 8. Dock Boundary Events to host task perimeter with clean non-overlapping distribution
  const boundaryByHost = new Map();
  for (const be of boundaryEvents) {
    if (be.attachedToRef) {
      if (!boundaryByHost.has(be.attachedToRef)) boundaryByHost.set(be.attachedToRef, []);
      boundaryByHost.get(be.attachedToRef).push(be);
    }
  }

  for (const [hostId, beList] of boundaryByHost.entries()) {
    if (shapesMap.has(hostId)) {
      const host = shapesMap.get(hostId);
      for (let i = 0; i < beList.length; i++) {
        const be = beList[i];
        // Distribute along bottom perimeter from right to left
        const beX = Math.round(host.x + host.width - 55 - (i * 70));
        const beY = Math.round(host.y + host.height - (be.height / 2));
        be.x = beX;
        be.y = beY;
        be.attachedToRef = hostId;
        const beObj = {
          id: be.id,
          tagName: be.tagName || 'boundaryEvent',
          name: be.name || '',
          x: beX,
          y: beY,
          width: be.width,
          height: be.height,
          attachedToRef: hostId
        };
        shapesMap.set(be.id, beObj);
        flowNodeMap.set(be.id, beObj);
      }
    } else {
      for (let i = 0; i < beList.length; i++) {
        const be = beList[i];
        const beObj = {
          id: be.id,
          tagName: be.tagName || 'boundaryEvent',
          name: be.name || '',
          x: 100 + i * 60,
          y: 100,
          width: be.width,
          height: be.height,
          attachedToRef: hostId
        };
        shapesMap.set(be.id, beObj);
        flowNodeMap.set(be.id, beObj);
      }
    }
  }

  // 8b. Position inner nodes of each expanded SubProcess inside its bounding box
  for (const [spId, spInfo] of subProcessMap.entries()) {
    if (shapesMap.has(spId)) {
      const spShape = shapesMap.get(spId);
      spShape.isExpanded = true;
      let curInnerX = spShape.x + 35;
      const innerY = spShape.y + 55;
      for (const node of spInfo.nodes) {
        node.x = curInnerX;
        node.y = Math.round(innerY + (80 - node.height) / 2);
        shapesMap.set(node.id, node);
        flowNodeMap.set(node.id, node);
        curInnerX += node.width + 35;
      }
    }
  }

  // 9. Position Data Objects, Data Stores, and Text Annotations with Unified Baseline Alignment
  const allPositionedShapes = [...shapesMap.values()];
  const dataObjectMap = new Map();
  for (const doObj of dataObjects) {
    dataObjectMap.set(doObj.id, doObj);
  }

  // Map each data object to all its associated tasks/nodes
  const dataObjLinks = new Map();
  for (const assoc of associations) {
    let taskId = null, doId = null, role = null;
    if (shapesMap.has(assoc.source) && dataObjectMap.has(assoc.target)) {
      taskId = assoc.source; doId = assoc.target; role = 'output';
    } else if (shapesMap.has(assoc.target) && dataObjectMap.has(assoc.source)) {
      taskId = assoc.target; doId = assoc.source; role = 'input';
    } else if (shapesMap.has(assoc.source) && assoc.target) {
      taskId = assoc.source; doId = assoc.target; role = 'output';
    } else if (shapesMap.has(assoc.target) && assoc.source) {
      taskId = assoc.target; doId = assoc.source; role = 'input';
    }
    if (taskId && doId) {
      if (!dataObjLinks.has(doId)) dataObjLinks.set(doId, []);
      dataObjLinks.get(doId).push({ taskId, role, assocId: assoc.id });
    }
  }

  // Pre-calculate clean, unified baselines per lane or for single-lane diagram
  let minFlowY = Infinity;
  let maxFlowBottom = -Infinity;
  for (const s of shapesMap.values()) {
    if (s.y < minFlowY) minFlowY = s.y;
    if (s.y + s.height > maxFlowBottom) maxFlowBottom = s.y + s.height;
  }
  const globalTopBaselineY = Math.max(30, minFlowY - 50 - 35);
  const globalBottomBaselineY = maxFlowBottom + 35;

  function getLaneTopBaselineY(laneIdx) {
    if (hasMultipleLanes && laneYOffsets[laneIdx] !== undefined) {
      return laneYOffsets[laneIdx] + 30;
    }
    return globalTopBaselineY;
  }

  function getLaneBottomBaselineY(laneIdx) {
    if (hasMultipleLanes && laneYOffsets[laneIdx] !== undefined && laneHeights[laneIdx] !== undefined) {
      return laneYOffsets[laneIdx] + laneHeights[laneIdx] - 30 - 50;
    }
    return globalBottomBaselineY;
  }

  // Track assigned slots per host element: 'TOP', 'BOTTOM'
  const hostSlotMap = new Map();

  for (const doObj of dataObjects) {
    if (shapesMap.has(doObj.id)) continue;

    const doW = doObj.width;
    const doH = doObj.height;
    const tag = (doObj.tagName || '').toLowerCase();
    const isStore = tag.includes('datastore');
    const isAnnot = tag.includes('textannotation');

    const links = dataObjLinks.get(doObj.id) || [];
    let chosenX = 200;
    let chosenY = 200;

    if (links.length >= 2) {
      // Shared artifact between 2 or more tasks (e.g. T1 produces, T2 consumes)
      const prodLink = links.find(l => l.role === 'output') || links[0];
      const t1 = shapesMap.get(prodLink.taskId);
      if (t1) {
        const laneIdx = hasMultipleLanes ? (nodeToLane.get(t1.id) ?? 0) : 0;
        chosenX = Math.round(t1.x + t1.width / 2 - doW / 2);
        chosenY = getLaneBottomBaselineY(laneIdx);
        const slots = hostSlotMap.get(t1.id) || new Set();
        slots.add('BOTTOM');
        hostSlotMap.set(t1.id, slots);
      }
    } else if (links.length === 1) {
      // Associated with a single node
      const t1 = shapesMap.get(links[0].taskId);
      if (t1) {
        const tCx = Math.round(t1.x + t1.width / 2);
        const laneIdx = hasMultipleLanes ? (nodeToLane.get(t1.id) ?? 0) : 0;
        const topY = getLaneTopBaselineY(laneIdx);
        const botY = getLaneBottomBaselineY(laneIdx);
        const isGw = /gateway/i.test(t1.tagName || '');
        const hostSlots = hostSlotMap.get(t1.id) || new Set();

        if (isGw) {
          // Gateway: check if it branches North
          const outFlows = sequenceFlows.filter(sf => sf.sourceRef === t1.id);
          const hasUpperTarget = outFlows.some(sf => {
            const tgt = shapesMap.get(sf.targetRef);
            return tgt && (tgt.y + tgt.height / 2 < t1.y);
          });
          if (hasUpperTarget) {
            // North is busy, place to LEFT of gateway
            chosenX = Math.round(t1.x - doW - 15);
            chosenY = Math.round(t1.y + (t1.height - doH) / 2);
          } else {
            // North is free, place on top baseline
            chosenX = Math.round(tCx - doW / 2);
            chosenY = topY;
            hostSlots.add('TOP');
          }
        } else if (isStore) {
          chosenX = Math.round(tCx - doW / 2);
          chosenY = botY;
          hostSlots.add('BOTTOM');
        } else if (isAnnot) {
          if (!hostSlots.has('TOP')) {
            chosenX = Math.round(tCx - doW / 2);
            chosenY = topY;
            hostSlots.add('TOP');
          } else if (!hostSlots.has('BOTTOM')) {
            chosenX = Math.round(tCx - doW / 2);
            chosenY = botY;
            hostSlots.add('BOTTOM');
          } else {
            chosenX = Math.round(tCx - doW / 2);
            chosenY = topY;
          }
        } else if (links[0].role === 'input') {
          if (!hostSlots.has('TOP')) {
            chosenX = Math.round(tCx - doW / 2);
            chosenY = topY;
            hostSlots.add('TOP');
          } else if (!hostSlots.has('BOTTOM')) {
            chosenX = Math.round(tCx - doW / 2);
            chosenY = botY;
            hostSlots.add('BOTTOM');
          } else {
            chosenX = Math.round(tCx - doW / 2);
            chosenY = topY;
          }
        } else {
          if (!hostSlots.has('BOTTOM')) {
            chosenX = Math.round(tCx - doW / 2);
            chosenY = botY;
            hostSlots.add('BOTTOM');
          } else {
            chosenX = Math.round(tCx - doW / 2);
            chosenY = botY;
          }
        }
        hostSlotMap.set(t1.id, hostSlots);
      }
    } else {
      chosenX = 150;
      chosenY = globalBottomBaselineY;
    }

    const doShape = {
      id: doObj.id,
      name: doObj.name || '',
      tagName: doObj.tagName || 'dataObjectReference',
      x: chosenX,
      y: chosenY,
      width: doW,
      height: doH
    };
    shapesMap.set(doObj.id, doShape);
    allPositionedShapes.push(doShape);
  }

  // Ensure artifacts sharing the exact same baseline do not overlap horizontally
  const baselineGroups = new Map();
  for (const s of shapesMap.values()) {
    if (!dataObjectMap.has(s.id)) continue;
    if (!baselineGroups.has(s.y)) baselineGroups.set(s.y, []);
    baselineGroups.get(s.y).push(s);
  }

  for (const group of baselineGroups.values()) {
    if (group.length <= 1) continue;
    group.sort((a, b) => a.x - b.x);
    for (let i = 1; i < group.length; i++) {
      const prev = group[i - 1];
      const curr = group[i];
      if (curr.x < prev.x + prev.width + 20) {
        curr.x = prev.x + prev.width + 20;
      }
    }
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

  // Pre-assign distinct exit aristas (NORTH, SOUTH, EAST) for all condition blocks (Gateways)
  // with multiple outgoing branches to prevent them from exiting from the same arista,
  // merging ("juntarse"), or crossing each other.
  const gatewayBranchAristaMap = new Map();
  const gatewayUsedAristasMap = new Map();

  for (const [nodeId, outFlows] of outgoingFlowsMap.entries()) {
    const sNode = shapesMap.get(nodeId);
    if (!sNode) continue;
    const isGateway = /gateway/i.test(sNode.tagName || '');
    if (!isGateway || outFlows.length < 2) continue;

    const sCenterX = Math.round(sNode.x + sNode.width / 2);
    const sCenterY = Math.round(sNode.y + sNode.height / 2);

    const loopbacks = [];
    const forwards = [];

    for (const f of outFlows) {
      const tgt = shapesMap.get(f.targetRef);
      if (!tgt) continue;
      const tgtCenterX = Math.round(tgt.x + tgt.width / 2);
      const tgtRight = Math.round(tgt.x + tgt.width);
      if (tgtRight <= sNode.x + 10 || tgtCenterX < sCenterX - 15) {
        loopbacks.push(f);
      } else {
        forwards.push(f);
      }
    }

    const usedAristas = new Set();

    // Assign loopbacks
    for (const lf of loopbacks) {
      const tgt = shapesMap.get(lf.targetRef);
      const tgtY = tgt ? Math.round(tgt.y + tgt.height / 2) : sCenterY;
      const arista = (tgtY < sCenterY) ? 'NORTH' : 'SOUTH';
      gatewayBranchAristaMap.set(lf.id, arista);
      usedAristas.add(arista);
    }

    // Sort forward flows by target center Y (ascending: top to bottom)
    forwards.sort((a, b) => {
      const tA = shapesMap.get(a.targetRef);
      const tB = shapesMap.get(b.targetRef);
      const yA = tA ? (tA.y + tA.height / 2) : 0;
      const yB = tB ? (tB.y + tB.height / 2) : 0;
      return yA - yB;
    });

    if (forwards.length === 1) {
      const arista = usedAristas.has('EAST') ? (shapesMap.get(forwards[0].targetRef)?.y < sCenterY ? 'NORTH' : 'SOUTH') : 'EAST';
      gatewayBranchAristaMap.set(forwards[0].id, arista);
      usedAristas.add(arista);
    } else if (forwards.length === 2) {
      const fTop = forwards[0];
      const fBot = forwards[1];
      const tTop = shapesMap.get(fTop.targetRef);
      const tBot = shapesMap.get(fBot.targetRef);
      const tTopY = tTop ? (tTop.y + tTop.height / 2) : sCenterY;
      const tBotY = tBot ? (tBot.y + tBot.height / 2) : sCenterY;

      if (tTopY < sCenterY - 15 && Math.abs(tBotY - sCenterY) <= 35) {
        gatewayBranchAristaMap.set(fTop.id, 'NORTH');
        gatewayBranchAristaMap.set(fBot.id, 'EAST');
        usedAristas.add('NORTH'); usedAristas.add('EAST');
      } else if (Math.abs(tTopY - sCenterY) <= 35 && tBotY > sCenterY + 15) {
        gatewayBranchAristaMap.set(fTop.id, 'EAST');
        gatewayBranchAristaMap.set(fBot.id, 'SOUTH');
        usedAristas.add('EAST'); usedAristas.add('SOUTH');
      } else if (tTopY < sCenterY && tBotY > sCenterY) {
        gatewayBranchAristaMap.set(fTop.id, 'NORTH');
        gatewayBranchAristaMap.set(fBot.id, 'SOUTH');
        usedAristas.add('NORTH'); usedAristas.add('SOUTH');
      } else if (tBotY < sCenterY - 15) {
        gatewayBranchAristaMap.set(fTop.id, 'NORTH');
        gatewayBranchAristaMap.set(fBot.id, 'EAST');
        usedAristas.add('NORTH'); usedAristas.add('EAST');
      } else if (tTopY > sCenterY + 15) {
        gatewayBranchAristaMap.set(fTop.id, 'EAST');
        gatewayBranchAristaMap.set(fBot.id, 'SOUTH');
        usedAristas.add('EAST'); usedAristas.add('SOUTH');
      } else {
        gatewayBranchAristaMap.set(fTop.id, 'NORTH');
        gatewayBranchAristaMap.set(fBot.id, 'SOUTH');
        usedAristas.add('NORTH'); usedAristas.add('SOUTH');
      }
    } else if (forwards.length === 3) {
      gatewayBranchAristaMap.set(forwards[0].id, 'NORTH');
      gatewayBranchAristaMap.set(forwards[1].id, 'EAST');
      gatewayBranchAristaMap.set(forwards[2].id, 'SOUTH');
      usedAristas.add('NORTH'); usedAristas.add('EAST'); usedAristas.add('SOUTH');
    } else if (forwards.length >= 4) {
      gatewayBranchAristaMap.set(forwards[0].id, 'NORTH');
      gatewayBranchAristaMap.set(forwards[forwards.length - 1].id, 'SOUTH');
      usedAristas.add('NORTH'); usedAristas.add('SOUTH');
      for (let i = 1; i < forwards.length - 1; i++) {
        gatewayBranchAristaMap.set(forwards[i].id, 'EAST');
        usedAristas.add('EAST');
      }
    }

    gatewayUsedAristasMap.set(nodeId, usedAristas);
  }

  // Pre-assign distinct entrance aristas (NORTH, SOUTH, WEST) for merging Gateways
  const gatewayIncomingAristaMap = new Map();
  for (const [nodeId, inFlows] of incomingFlowsMap.entries()) {
    const tNode = shapesMap.get(nodeId);
    if (!tNode) continue;
    const isGateway = /gateway/i.test(tNode.tagName || '');
    if (!isGateway || inFlows.length < 2) continue;

    const tCenterY = Math.round(tNode.y + tNode.height / 2);

    const loopbacks = [];
    const forwards = [];
    for (const f of inFlows) {
      const src = shapesMap.get(f.sourceRef);
      if (!src) continue;
      const isLoopback = (src.x + src.width) > tNode.x + tNode.width + 10;
      if (isLoopback) {
        loopbacks.push(f);
      } else {
        forwards.push(f);
      }
    }

    for (const lf of loopbacks) {
      const src = shapesMap.get(lf.sourceRef);
      const srcCenterY = src ? Math.round(src.y + src.height / 2) : tCenterY;
      gatewayIncomingAristaMap.set(lf.id, srcCenterY < tCenterY ? 'NORTH' : 'SOUTH');
    }

    // Sort forward incoming flows by source center Y (ascending: top to bottom)
    forwards.sort((a, b) => {
      const sA = shapesMap.get(a.sourceRef);
      const sB = shapesMap.get(b.sourceRef);
      const yA = sA ? (sA.y + sA.height / 2) : tCenterY;
      const yB = sB ? (sB.y + sB.height / 2) : tCenterY;
      return yA - yB;
    });

    if (forwards.length === 1) {
      const src = shapesMap.get(forwards[0].sourceRef);
      const srcCenterY = src ? Math.round(src.y + src.height / 2) : tCenterY;
      if (srcCenterY < tNode.y - 15) {
        gatewayIncomingAristaMap.set(forwards[0].id, 'NORTH');
      } else if (srcCenterY > tNode.y + tNode.height + 15) {
        gatewayIncomingAristaMap.set(forwards[0].id, 'SOUTH');
      } else {
        gatewayIncomingAristaMap.set(forwards[0].id, 'WEST');
      }
    } else if (forwards.length === 2) {
      const f1 = forwards[0];
      const f2 = forwards[1];
      const s1 = shapesMap.get(f1.sourceRef);
      const s2 = shapesMap.get(f2.sourceRef);
      const y1 = s1 ? (s1.y + s1.height / 2) : tCenterY;
      const y2 = s2 ? (s2.y + s2.height / 2) : tCenterY;

      if (y1 < tCenterY - 15 && y2 > tCenterY + 15) {
        gatewayIncomingAristaMap.set(f1.id, 'NORTH');
        gatewayIncomingAristaMap.set(f2.id, 'SOUTH');
      } else if (y1 < tCenterY - 15 && Math.abs(y2 - tCenterY) <= 35) {
        gatewayIncomingAristaMap.set(f1.id, 'NORTH');
        gatewayIncomingAristaMap.set(f2.id, 'WEST');
      } else if (Math.abs(y1 - tCenterY) <= 35 && y2 > tCenterY + 15) {
        gatewayIncomingAristaMap.set(f1.id, 'WEST');
        gatewayIncomingAristaMap.set(f2.id, 'SOUTH');
      } else if (y1 > tCenterY + 15 && y2 > tCenterY + 15) {
        // Both enter from below: upper branch enters WEST, lower branch enters SOUTH
        gatewayIncomingAristaMap.set(f1.id, 'WEST');
        gatewayIncomingAristaMap.set(f2.id, 'SOUTH');
      } else if (y1 < tCenterY - 15 && y2 < tCenterY - 15) {
        // Both enter from above: upper branch enters NORTH, lower branch enters WEST
        gatewayIncomingAristaMap.set(f1.id, 'NORTH');
        gatewayIncomingAristaMap.set(f2.id, 'WEST');
      } else {
        gatewayIncomingAristaMap.set(f1.id, 'WEST');
        gatewayIncomingAristaMap.set(f2.id, 'SOUTH');
      }
    } else if (forwards.length >= 3) {
      gatewayIncomingAristaMap.set(forwards[0].id, 'NORTH');
      gatewayIncomingAristaMap.set(forwards[1].id, 'WEST');
      for (let i = 2; i < forwards.length; i++) {
        gatewayIncomingAristaMap.set(forwards[i].id, 'SOUTH');
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
        let lblX = Math.round(s.x + (s.width - lblW) / 2);
        const laneIdx = nodeToLane.get(s.id) ?? 0;
        const laneTop = hasMultipleLanes ? (laneYOffsets[laneIdx] || poolY) : poolY;
        const laneH = hasMultipleLanes ? (laneHeights[laneIdx] || 160) : Infinity;

        const usedAristas = gatewayUsedAristasMap.get(s.id) || new Set();
        let lblY;

        if (usedAristas.has('NORTH') && !usedAristas.has('SOUTH')) {
          lblY = Math.round(s.y + s.height + 6);
          if (lblY + lblH > laneTop + laneH - 5) {
            lblY = Math.round(s.y - lblH - 6);
            lblX = Math.round(s.x - lblW / 2 - 6);
          }
        } else if (usedAristas.has('SOUTH') && !usedAristas.has('NORTH')) {
          lblY = Math.round(s.y - lblH - 6);
          if (lblY < laneTop + 10) {
            lblY = Math.round(s.y + s.height + 6);
            lblX = Math.round(s.x - lblW / 2 - 6);
          }
        } else if (usedAristas.has('NORTH') && usedAristas.has('SOUTH')) {
          lblX = Math.round(s.x - lblW / 2 - 8);
          lblY = Math.round(s.y - lblH - 4);
        } else {
          lblY = Math.round(s.y - lblH - 6);
          if (lblY < laneTop + 10) {
            lblY = Math.round(s.y + s.height + 6);
          }
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
      } else if (tag.includes('dataobject') || tag.includes('datastore')) {
        const lblW = Math.min(100, Math.max(40, Math.ceil(nameStr.length * 6.5)));
        const numLines = Math.ceil(nameStr.length / 14);
        const lblH = Math.max(14, numLines * 14);
        const lblX = Math.round(s.x + (s.width - lblW) / 2);
        const lblY = Math.round(s.y + s.height + 4);
        labelXml = `\n        <bpmndi:BPMNLabel>\n          <dc:Bounds x="${lblX}" y="${lblY}" width="${lblW}" height="${lblH}" />\n        </bpmndi:BPMNLabel>`;
      }
    }
    const isExpAttr = s.tagName === 'subProcess' && s.isExpanded ? ' isExpanded="true"' : '';
    flowShapesXml += `
      <bpmndi:BPMNShape id="${s.id}_di" bpmnElement="${s.id}"${isExpAttr}>
        <dc:Bounds x="${s.x}" y="${s.y}" width="${s.width}" height="${s.height}" />${labelXml}
      </bpmndi:BPMNShape>`;
  }

  // 12. Generate DI XML for Sequence Flows

  /**
   * Finds a clear X corridor for a vertical routing segment, avoiding all shape bounding boxes.
   * Starting from `preferredX`, steps left and right in increments until a clear slot is found.
   */
  function findClearXCorridor(preferredX, minY, maxY, margin = 14, minAllowedX = -Infinity) {
    const yLo = Math.min(minY, maxY);
    const yHi = Math.max(minY, maxY);
    function isClear(x) {
      if (x < minAllowedX) return false;
      for (const s of shapesMap.values()) {
        const xHit = x > s.x - margin && x < s.x + s.width + margin;
        const yHit = yLo < s.y + s.height - margin && yHi > s.y + margin;
        if (xHit && yHit) return false;
      }
      return true;
    }
    if (isClear(preferredX)) return preferredX;
    for (let delta = 16; delta <= 200; delta += 16) {
      if (isClear(preferredX + delta)) return preferredX + delta;
      if (preferredX - delta >= minAllowedX && isClear(preferredX - delta)) return preferredX - delta;
    }
    return Math.max(preferredX, minAllowedX);
  }

  /**
   * Finds a clear Y corridor for a horizontal routing segment (loop-backs),
   * avoiding all shape bounding boxes.
   */
  function findClearYCorridor(preferredY, minX, maxX, margin = 14, direction = 1) {
    const xLo = Math.min(minX, maxX);
    const xHi = Math.max(minX, maxX);
    function isClear(y) {
      for (const s of shapesMap.values()) {
        const xHit = xLo < s.x + s.width + margin && xHi > s.x - margin;
        const yHit = y > s.y - margin && y < s.y + s.height + margin;
        if (xHit && yHit) return false;
      }
      return true;
    }
    if (isClear(preferredY)) return preferredY;
    for (let delta = 16; delta <= 160; delta += 16) {
      const candidate = preferredY + direction * delta;
      if (isClear(candidate)) return candidate;
    }
    return preferredY;
  }

  let edgesXml = '';
  const placedEdgeLabels = [];
  const placedFlowSegments = [];
  for (const sf of sequenceFlows) {
    const sfId = sf.id;
    const sShape = shapesMap.get(sf.sourceRef);
    const tShape = shapesMap.get(sf.targetRef);
    if (!sShape || !tShape) continue;

    let waypoints = [];
    let labelXml = '';

    if (sf.isInner) {
      // Internal flow inside a SubProcess: direct horizontal connection between siblings
      waypoints = [
        { x: Math.round(sShape.x + sShape.width), y: Math.round(sShape.y + sShape.height / 2) },
        { x: Math.round(tShape.x),                y: Math.round(tShape.y + tShape.height / 2) }
      ];
    } else if (sShape.tagName === 'boundaryEvent') {
      // Flow leaving a Boundary Event: strictly exits from the RIGHT perimeter of the circle,
      // avoiding event labels below, never cutting through the host task/subProcess,
      // and routing cleanly around sibling boundary events.
      const sRight   = Math.round(sShape.x + sShape.width);
      const sCenterY = Math.round(sShape.y + sShape.height / 2);
      const tLeft    = Math.round(tShape.x);
      const tCenterY = Math.round(tShape.y + tShape.height / 2);
      const pStart   = { x: sRight, y: sCenterY };

      const host = sShape.attachedToRef ? shapesMap.get(sShape.attachedToRef) : null;
      const hostRight = host ? Math.round(host.x + host.width) : sRight;

      // Check if there is another boundary event to the right on the same host perimeter
      const otherBeToRight = boundaryEvents.find(other => {
        if (other.id === sShape.id || other.attachedToRef !== sShape.attachedToRef) return false;
        const otherShape = shapesMap.get(other.id);
        return otherShape && otherShape.x > sShape.x && Math.abs(otherShape.y - sShape.y) < 15;
      });

      // Stagger index for multiple boundary events on the same host
      const hostBeList = boundaryEvents.filter(b => b.attachedToRef === sShape.attachedToRef);
      const beIdx = hostBeList.findIndex(b => b.id === sShape.id);
      const staggerX = (beIdx >= 0 ? beIdx : 0) * 20;

      if (otherBeToRight) {
        // Step into clear gap between boundary events, drop below circles and labels, then proceed right
        const otherShape = shapesMap.get(otherBeToRight.id);
        const gapMidX = Math.round(sRight + Math.max(8, (otherShape.x - sRight) / 2));
        const dropY = Math.round(sShape.y + sShape.height + 42);
        const clearTurnX = Math.max(hostRight + 25 + staggerX, Math.round(otherShape.x + otherShape.width + 25 + staggerX));
        const midX = Math.min(tLeft - 25, Math.max(clearTurnX, Math.round(sRight + (tLeft - sRight) * 0.45)));
        waypoints = [
          pStart,
          { x: gapMidX, y: sCenterY },
          { x: gapMidX, y: dropY },
          { x: midX,    y: dropY },
          { x: midX,    y: tCenterY },
          { x: tLeft,   y: tCenterY }
        ];
      } else if (tLeft > sRight) {
        // Target is forward (to the right)
        if (Math.abs(sCenterY - tCenterY) < 15) {
          // Direct horizontal connection
          waypoints = [
            pStart,
            { x: tLeft, y: tCenterY }
          ];
        } else {
          // If target is above bottom perimeter of host, must clear hostRight before turning up
          const clearTurnX = (tCenterY < sCenterY)
            ? Math.max(hostRight + 25 + staggerX, sRight + 25)
            : Math.round(sRight + Math.max(25, (tLeft - sRight) * 0.35) + staggerX);
          const midX = Math.min(tLeft - 25, Math.max(clearTurnX, Math.round(sRight + (tLeft - sRight) * 0.4)));
          waypoints = [
            pStart,
            { x: midX,  y: sCenterY },
            { x: midX,  y: tCenterY },
            { x: tLeft, y: tCenterY }
          ];
        }
      } else {
        // Target is below or backwards: clear right edge first, then step to target
        const clearX = Math.max(sRight + 25, hostRight + 25);
        waypoints = [
          pStart,
          { x: clearX, y: sCenterY },
          { x: clearX, y: tCenterY },
          { x: tLeft,  y: tCenterY }
        ];
      }
    } else if (gatewayBranchAristaMap.has(sfId)) {
      // Condition block (Gateway) branch: strictly routes out of its assigned arista
      // (NORTH, SOUTH, EAST) to guarantee condition branches never exit the same face,
      // never merge/overlap ("no se juntan"), and never cross each other ("no se cruzan").
      const outArista = gatewayBranchAristaMap.get(sfId);
      const inArista  = gatewayIncomingAristaMap.get(sfId) || 'WEST';

      const sCenterX = Math.round(sShape.x + sShape.width / 2);
      const sCenterY = Math.round(sShape.y + sShape.height / 2);
      const tCenterX = Math.round(tShape.x + tShape.width / 2);
      const tCenterY = Math.round(tShape.y + tShape.height / 2);
      const tLeft    = Math.round(tShape.x);

      let tgtPort;
      if (inArista === 'NORTH') {
        tgtPort = { x: tCenterX, y: Math.round(tShape.y), side: 'NORTH' };
      } else if (inArista === 'SOUTH') {
        tgtPort = { x: tCenterX, y: Math.round(tShape.y + tShape.height), side: 'SOUTH' };
      } else {
        tgtPort = { x: tLeft, y: tCenterY, side: 'WEST' };
      }

      if (outArista === 'NORTH') {
        const pStart = { x: sCenterX, y: Math.round(sShape.y) };
        const isLoopback = tgtPort.x < sShape.x;

        if (isLoopback) {
          const topY = findClearYCorridor(sShape.y - 35, tgtPort.x, pStart.x, 14, -1);
          if (tgtPort.side === 'NORTH') {
            waypoints = [
              pStart,
              { x: pStart.x,  y: topY },
              { x: tgtPort.x, y: topY },
              tgtPort
            ];
          } else {
            waypoints = [
              pStart,
              { x: pStart.x,       y: topY },
              { x: tgtPort.x - 25, y: topY },
              { x: tgtPort.x - 25, y: tgtPort.y },
              tgtPort
            ];
          }
        } else {
          // Forward flow
          if (tgtPort.side === 'NORTH') {
            const upY = Math.min(pStart.y - 25, tgtPort.y - 25);
            waypoints = [
              pStart,
              { x: pStart.x,  y: upY },
              { x: tgtPort.x, y: upY },
              tgtPort
            ];
          } else if (tgtPort.y < pStart.y - 10) {
            // Target is above top vertex
            waypoints = [
              pStart,
              { x: pStart.x,  y: tgtPort.y },
              tgtPort
            ];
          } else {
            // Target is level or below top vertex: step up first to clear diamond
            const stepUpY = Math.min(pStart.y - 30, tgtPort.y - 20);
            const midX = findClearXCorridor(
              Math.min(tgtPort.x - 25, Math.round(pStart.x + Math.max(30, (tgtPort.x - pStart.x) * 0.4))),
              stepUpY,
              tgtPort.y
            );
            waypoints = [
              pStart,
              { x: pStart.x, y: stepUpY },
              { x: midX,     y: stepUpY },
              { x: midX,     y: tgtPort.y },
              tgtPort
            ];
          }
        }
      } else if (outArista === 'SOUTH') {
        const pStart = { x: sCenterX, y: Math.round(sShape.y + sShape.height) };
        const isLoopback = tgtPort.x < sShape.x;

        if (isLoopback) {
          const botY = findClearYCorridor(pStart.y + 35, tgtPort.x, pStart.x, 14, 1);
          if (tgtPort.side === 'SOUTH') {
            waypoints = [
              pStart,
              { x: pStart.x,  y: botY },
              { x: tgtPort.x, y: botY },
              tgtPort
            ];
          } else {
            waypoints = [
              pStart,
              { x: pStart.x,       y: botY },
              { x: tgtPort.x - 25, y: botY },
              { x: tgtPort.x - 25, y: tgtPort.y },
              tgtPort
            ];
          }
        } else {
          // Forward flow
          if (tgtPort.side === 'SOUTH') {
            const downY = Math.max(pStart.y + 25, tgtPort.y + 25);
            waypoints = [
              pStart,
              { x: pStart.x,  y: downY },
              { x: tgtPort.x, y: downY },
              tgtPort
            ];
          } else if (tgtPort.y > pStart.y + 10) {
            // Target is below bottom vertex
            waypoints = [
              pStart,
              { x: pStart.x,  y: tgtPort.y },
              tgtPort
            ];
          } else {
            // Target is level or above bottom vertex: step down first
            const stepDownY = Math.max(pStart.y + 30, tgtPort.y + 20);
            const midX = findClearXCorridor(
              Math.min(tgtPort.x - 25, Math.round(pStart.x + Math.max(30, (tgtPort.x - pStart.x) * 0.4))),
              stepDownY,
              tgtPort.y
            );
            waypoints = [
              pStart,
              { x: pStart.x, y: stepDownY },
              { x: midX,     y: stepDownY },
              { x: midX,     y: tgtPort.y },
              tgtPort
            ];
          }
        }
      } else {
        // EAST arista
        const pStart = { x: Math.round(sShape.x + sShape.width), y: sCenterY };
        if (tgtPort.side === 'NORTH') {
          waypoints = [
            pStart,
            { x: tgtPort.x, y: pStart.y },
            tgtPort
          ];
        } else if (tgtPort.side === 'SOUTH') {
          waypoints = [
            pStart,
            { x: tgtPort.x, y: pStart.y },
            tgtPort
          ];
        } else if (tgtPort.side === 'WEST' && Math.abs(tgtPort.y - pStart.y) <= 18 && pStart.y >= tShape.y + 10 && pStart.y <= tShape.y + tShape.height - 10) {
          // Snap entry Y on target left face so connection is 100% horizontal
          waypoints = [
            pStart,
            { x: tgtPort.x, y: pStart.y }
          ];
        } else if (tgtPort.y === pStart.y && tgtPort.side === 'WEST') {
          waypoints = [
            pStart,
            tgtPort
          ];
        } else {
          const midX = findClearXCorridor(
            Math.min(tgtPort.x - 25, Math.max(pStart.x + 25, Math.round(pStart.x + (tgtPort.x - pStart.x) * 0.4))),
            pStart.y,
            tgtPort.y,
            14,
            pStart.x + 15
          );
          waypoints = [
            pStart,
            { x: midX, y: pStart.y },
            { x: midX, y: tgtPort.y },
            tgtPort
          ];
        }
      }

      // Edge label placement for condition branch
      if (sf.name && sf.name.trim()) {
        const text = sf.name.trim();
        const lblW = Math.max(35, Math.min(150, Math.round(text.length * 7 + 10)));
        const lblH = 14;
        let lblX, lblY;

        if (outArista === 'NORTH') {
          lblX = sCenterX + 8;
          lblY = Math.round(sShape.y - 18);
        } else if (outArista === 'SOUTH') {
          lblX = sCenterX + 8;
          lblY = Math.round(sShape.y + sShape.height + 4);
        } else {
          lblX = Math.round(sShape.x + sShape.width + 10);
          lblY = Math.round(sCenterY - 18);
        }

        placedEdgeLabels.push({ x: lblX, y: lblY, w: lblW, h: lblH });
        labelXml = `
        <bpmndi:BPMNLabel>
          <dc:Bounds x="${lblX}" y="${lblY}" width="${lblW}" height="${lblH}" />
        </bpmndi:BPMNLabel>`;
      }
    } else if (!hasMultipleLanes && edgeRoutesMap.has(sfId) && !gatewayIncomingAristaMap.has(sfId) && (outgoingFlowsMap.get(sf.sourceRef)?.length || 0) <= 1) {
      // If single lane and ELK provided clean sections (not entering a merging gateway), use ELK waypoints
      const route = edgeRoutesMap.get(sfId);
      const s = route.section;
      waypoints = [
        { x: Math.round(s.startPoint.x), y: Math.round(s.startPoint.y) },
        ...(s.bendPoints || []).map(b => ({ x: Math.round(b.x), y: Math.round(b.y) })),
        { x: Math.round(s.endPoint.x), y: Math.round(s.endPoint.y) }
      ];

      // Ensure round events (intermediateCatchEvent, startEvent, etc.) always dock cleanly to right face
      const isSrcEvent = /event/i.test(sShape.tagName || '');
      const isTgtEvent = /event/i.test(tShape.tagName || '');

      if (isSrcEvent) {
        const expX = Math.round(sShape.x + sShape.width);
        const expY = Math.round(sShape.y + sShape.height / 2);
        waypoints[0] = { x: expX, y: expY };
        if (waypoints.length > 2 && Math.abs(waypoints[1].y - expY) < 20) {
          waypoints[1].y = expY;
        }
      }

      if (isTgtEvent) {
        const expX = Math.round(tShape.x);
        const expY = Math.round(tShape.y + tShape.height / 2);
        const lastIdx = waypoints.length - 1;
        waypoints[lastIdx] = { x: expX, y: expY };
        if (waypoints.length > 2 && Math.abs(waypoints[lastIdx - 1].y - expY) < 20) {
          waypoints[lastIdx - 1].y = expY;
        }
      }

      // Convert any remaining diagonal 2-point connections into orthogonal Manhattan steps
      if (waypoints.length === 2 && Math.abs(waypoints[0].y - waypoints[1].y) >= 15) {
        const midX = Math.round(waypoints[0].x + (waypoints[1].x - waypoints[0].x) / 2);
        waypoints = [
          waypoints[0],
          { x: midX, y: waypoints[0].y },
          { x: midX, y: waypoints[1].y },
          waypoints[1]
        ];
      }

      if (route.labels && route.labels.length > 0) {
        const lbl = route.labels[0];
        labelXml = `
        <bpmndi:BPMNLabel>
          <dc:Bounds x="${Math.round(lbl.x)}" y="${Math.round(lbl.y)}" width="${Math.round(lbl.width)}" height="${Math.round(lbl.height)}" />
        </bpmndi:BPMNLabel>`;
      }
    } else {
      // General multi-lane routing and multiple-outgoing branch routing
      // with obstacle avoidance, staggered departure coordinates, and target port alignment.
      const inArista  = gatewayIncomingAristaMap.get(sfId) || 'WEST';
      const sCenterY  = Math.round(sShape.y + sShape.height / 2);
      const sRight    = Math.round(sShape.x + sShape.width);
      const tCenterX  = Math.round(tShape.x + tShape.width / 2);
      const tCenterY  = Math.round(tShape.y + tShape.height / 2);
      const tLeft     = Math.round(tShape.x);

      let tgtPort;
      if (inArista === 'NORTH') {
        tgtPort = { x: tCenterX, y: Math.round(tShape.y), side: 'NORTH' };
      } else if (inArista === 'SOUTH') {
        tgtPort = { x: tCenterX, y: Math.round(tShape.y + tShape.height), side: 'SOUTH' };
      } else {
        tgtPort = { x: tLeft, y: tCenterY, side: 'WEST' };
      }

      const isForward = sRight < tgtPort.x;
      const outgoing  = outgoingFlowsMap.get(sf.sourceRef) || [sf];
      const branchCount = outgoing.length;

      // Stagger start Y if non-gateway source has multiple outgoing flows
      let startY = sCenterY;
      if (branchCount > 1 && !/event/i.test(sShape.tagName || '')) {
        const branchIdx = outgoing.findIndex(f => f.id === sf.id);
        startY = Math.round(sCenterY + (branchIdx - (branchCount - 1) / 2) * 20);
      }
      const pStart = { x: sRight, y: startY };

      const isAligned = tgtPort.side === 'WEST' && (
        (Math.abs(startY - tgtPort.y) <= 18 && startY >= tShape.y + 10 && startY <= tShape.y + tShape.height - 10) ||
        startY === tgtPort.y
      );

      if (isForward && isAligned) {
        // Direct horizontal connection
        waypoints = [
          pStart,
          { x: tgtPort.x, y: startY }
        ];
      } else if (isForward) {
        // Forward flow crossing different Y levels
        const branchIdx = outgoing.findIndex(f => f.id === sf.id);
        const totalGap = tgtPort.x - sRight;
        const staggerStep = branchCount > 1 ? Math.min(22, Math.floor((totalGap * 0.25) / branchCount)) : 0;
        const baseTurnX = Math.round(sRight + Math.max(35, totalGap * 0.4));
        const rawMidX = Math.min(tgtPort.x - 30, baseTurnX + branchIdx * staggerStep);

        const clearMidX = findClearXCorridor(rawMidX, startY, tgtPort.y, 14, pStart.x + 15);

        if (tgtPort.side === 'NORTH' || tgtPort.side === 'SOUTH') {
          waypoints = [
            pStart,
            { x: tgtPort.x, y: startY },
            tgtPort
          ];
        } else {
          waypoints = [
            pStart,
            { x: clearMidX, y: startY },
            { x: clearMidX, y: tgtPort.y },
            tgtPort
          ];
        }
      } else {
        // Loop back / return flow: route around shapes
        const isSrcEvent = /event/i.test(sShape.tagName || '');
        const p0x = Math.round(sShape.x + sShape.width / 2);
        const p0y = Math.round(sShape.y + sShape.height);
        const rawBottom = Math.max(p0y, tgtPort.y) + 36;
        const bottomY = findClearYCorridor(rawBottom, Math.min(p0x, tgtPort.x), Math.max(p0x, tgtPort.x), 14, 1);

        if (isSrcEvent) {
          waypoints = [
            { x: sRight,      y: sCenterY },
            { x: sRight + 20, y: sCenterY },
            { x: sRight + 20, y: bottomY },
            { x: tgtPort.x,   y: bottomY },
            tgtPort
          ];
        } else if (tgtPort.side === 'SOUTH') {
          waypoints = [
            { x: p0x,       y: p0y },
            { x: p0x,       y: bottomY },
            { x: tgtPort.x, y: bottomY },
            tgtPort
          ];
        } else {
          waypoints = [
            { x: p0x,            y: p0y },
            { x: p0x,            y: bottomY },
            { x: tgtPort.x - 20, y: bottomY },
            { x: tgtPort.x - 20, y: tgtPort.y },
            tgtPort
          ];
        }
      }

      if (sf.name && sf.name.trim()) {
        const text = sf.name.trim();
        const lblW = Math.max(35, Math.min(150, Math.round(text.length * 7 + 10)));
        const lblH = 14;
        let lblX, lblY;

        if (isForward && isAligned) {
          // Horizontal flow: center in the gap between shapes
          const gap = tgtPort.x - sRight;
          lblX = Math.round(sRight + (gap - lblW) / 2);
          lblY = Math.round(startY - lblH - 4);
        } else if (isForward && waypoints.length >= 3) {
          // Multi-step forward flow: place along the arrival segment into target
          const arrivalLen = tgtPort.x - waypoints[1].x;
          if (arrivalLen >= lblW + 16) {
            lblX = Math.round(waypoints[1].x + (arrivalLen - lblW) / 2);
            lblY = Math.round(tgtPort.y - lblH - 4);
          } else {
            const depLen = waypoints[1].x - sRight;
            if (depLen >= lblW + 16) {
              lblX = Math.round(sRight + (depLen - lblW) / 2);
              lblY = Math.round(startY - lblH - 4);
            } else {
              lblX = Math.max(waypoints[1].x + 5, tgtPort.x - lblW - 10);
              lblY = Math.round(tgtPort.y - lblH - 4);
            }
          }
        } else {
          // Return flow: place along the horizontal bottom segment (p1 -> p2)
          const leftX = waypoints[2]?.x || tgtPort.x;
          const rightX = waypoints[1]?.x || sRight;
          const segLen = Math.abs(rightX - leftX);
          lblX = Math.round(Math.min(leftX, rightX) + (segLen - lblW) / 2);
          lblY = Math.round((waypoints[1]?.y || startY) - lblH - 3);
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

    for (let i = 0; i < waypoints.length - 1; i++) {
      const p1 = waypoints[i];
      const p2 = waypoints[i + 1];
      placedFlowSegments.push({
        p1,
        p2,
        isHorizontal: p1.y === p2.y,
        isVertical: p1.x === p2.x
      });
    }

    edgesXml += `
      <bpmndi:BPMNEdge id="${sfId}_di" bpmnElement="${sfId}">
${waypoints.map(w => `        <di:waypoint x="${w.x}" y="${w.y}" />`).join('\n')}${labelXml}
      </bpmndi:BPMNEdge>`;
  }

  // 13. Generate DI XML for Associations (Data Objects, Data Stores, Text Annotations)
  // Ensures connections attach to top/bottom of tasks (never interfering with sequence flow ports),
  // and routes with clean orthogonal waypoints when there is a horizontal offset,
  // avoiding all shape bounding boxes and never crossing sequence flows.

  // Helper to simplify colinear orthogonal waypoints
  function simplifyOrthogonalWaypoints(pts) {
    if (pts.length <= 2) return pts;
    const res = [pts[0]];
    for (let i = 1; i < pts.length - 1; i++) {
      const prev = res[res.length - 1];
      const curr = pts[i];
      const next = pts[i + 1];
      const colinearH = (prev.y === curr.y && curr.y === next.y);
      const colinearV = (prev.x === curr.x && curr.x === next.x);
      if (!colinearH && !colinearV) {
        res.push(curr);
      }
    }
    res.push(pts[pts.length - 1]);
    return res;
  }

  // Helper to check if horizontal segment [minX, maxX] at Y is clear of all shapes and flows
  const placedAssocSegments = [];

  function isAssocYClear(y, minX, maxX, excludeIds, margin = 8) {
    const xLo = Math.min(minX, maxX);
    const xHi = Math.max(minX, maxX);
    for (const s of shapesMap.values()) {
      if (excludeIds.has(s.id)) continue;
      const xHit = xHi > s.x - margin && xLo < s.x + s.width + margin;
      const yHit = y > s.y - margin && y < s.y + s.height + margin;
      if (xHit && yHit) return false;
    }
    for (const seg of placedFlowSegments) {
      if (seg.isHorizontal) {
        if (Math.abs(y - seg.p1.y) < 10) {
          const segLo = Math.min(seg.p1.x, seg.p2.x);
          const segHi = Math.max(seg.p1.x, seg.p2.x);
          if (Math.max(xLo, segLo) < Math.min(xHi, segHi)) return false;
        }
      }
    }
    for (const seg of placedAssocSegments) {
      if (seg.isHorizontal) {
        if (Math.abs(y - seg.p1.y) < 10) {
          const segLo = Math.min(seg.p1.x, seg.p2.x);
          const segHi = Math.max(seg.p1.x, seg.p2.x);
          if (Math.max(xLo, segLo) < Math.min(xHi, segHi)) return false;
        }
      }
    }
    return true;
  }

  // Helper to find a clear Y corridor around preferredY
  function findClearAssocYCorridor(preferredY, minX, maxX, excludeIds, margin = 8) {
    if (isAssocYClear(preferredY, minX, maxX, excludeIds, margin)) return preferredY;
    for (let delta = 8; delta <= 140; delta += 8) {
      if (isAssocYClear(preferredY + delta, minX, maxX, excludeIds, margin)) return preferredY + delta;
      if (isAssocYClear(preferredY - delta, minX, maxX, excludeIds, margin)) return preferredY - delta;
    }
    return preferredY;
  }

  // Helper to check if vertical segment at X between [minY, maxY] is clear
  function isAssocXClear(x, minY, maxY, excludeIds, margin = 8) {
    const yLo = Math.min(minY, maxY);
    const yHi = Math.max(minY, maxY);
    for (const s of shapesMap.values()) {
      if (excludeIds.has(s.id)) continue;
      const xHit = x > s.x - margin && x < s.x + s.width + margin;
      const yHit = yHi > s.y - margin && yLo < s.y + s.height + margin;
      if (xHit && yHit) return false;
    }
    for (const seg of placedFlowSegments) {
      if (seg.isVertical) {
        if (Math.abs(x - seg.p1.x) < 10) {
          const segLo = Math.min(seg.p1.y, seg.p2.y);
          const segHi = Math.max(seg.p1.y, seg.p2.y);
          if (Math.max(yLo, segLo) < Math.min(yHi, segHi)) return false;
        }
      }
    }
    for (const seg of placedAssocSegments) {
      if (seg.isVertical) {
        if (Math.abs(x - seg.p1.x) < 10) {
          const segLo = Math.min(seg.p1.y, seg.p2.y);
          const segHi = Math.max(seg.p1.y, seg.p2.y);
          if (Math.max(yLo, segLo) < Math.min(yHi, segHi)) return false;
        }
      }
    }
    return true;
  }

  const usedArtifactFaces = new Map();

  for (const assoc of associations) {
    const sShape = shapesMap.get(assoc.source);
    const tShape = shapesMap.get(assoc.target);
    if (!sShape || !tShape) continue;

    const isSourceFlow = /task|callActivity|subProcess|gateway|event/i.test(sShape.tagName || '');
    const isTargetFlow = /task|callActivity|subProcess|gateway|event/i.test(tShape.tagName || '');

    let nodeShape, artShape, isNodeSource;
    if (isSourceFlow && !isTargetFlow) {
      nodeShape = sShape; artShape = tShape; isNodeSource = true;
    } else if (!isSourceFlow && isTargetFlow) {
      nodeShape = tShape; artShape = sShape; isNodeSource = false;
    } else {
      nodeShape = sShape; artShape = tShape; isNodeSource = true;
    }

    const nodeCx = Math.round(nodeShape.x + nodeShape.width / 2);
    const nodeCy = Math.round(nodeShape.y + nodeShape.height / 2);
    const artCx  = Math.round(artShape.x + artShape.width / 2);
    const artCy  = Math.round(artShape.y + artShape.height / 2);

    const isArtAbove = (artShape.y + artShape.height) <= nodeShape.y + 10;
    const isArtBelow = artShape.y >= (nodeShape.y + nodeShape.height - 10);
    const isArtLeft  = (artShape.x + artShape.width) <= nodeShape.x + 10;
    const isArtRight = artShape.x >= (nodeShape.x + nodeShape.width - 10);

    const excludeIds = new Set([nodeShape.id, artShape.id]);
    let rawWaypoints = [];
    const artUsedFaces = usedArtifactFaces.get(artShape.id) || new Set();

    if (isArtAbove) {
      // Artifact is above node: connect node TOP to artifact BOTTOM
      const canAlignX = (artCx >= nodeShape.x + 12 && artCx <= nodeShape.x + nodeShape.width - 12);
      const nodePortX = canAlignX ? artCx : Math.max(nodeShape.x + 15, Math.min(nodeShape.x + nodeShape.width - 15, artCx));
      const artPortX  = canAlignX ? artCx : Math.max(artShape.x + 15, Math.min(artShape.x + artShape.width - 15, nodePortX));
      const nodePort  = { x: nodePortX, y: Math.round(nodeShape.y) };
      const artPort   = { x: artPortX,  y: Math.round(artShape.y + artShape.height) };

      if (nodePort.x === artPort.x && isAssocXClear(nodePort.x, artPort.y, nodePort.y, excludeIds)) {
        rawWaypoints = [nodePort, artPort];
      } else {
        const prefMidY = Math.round((artPort.y + nodePort.y) / 2);
        const midY = findClearAssocYCorridor(prefMidY, nodePort.x, artPort.x, excludeIds);
        rawWaypoints = [
          nodePort,
          { x: nodePort.x, y: midY },
          { x: artPort.x,  y: midY },
          artPort
        ];
      }
      artUsedFaces.add('BOTTOM');
    } else if (isArtBelow) {
      if (!isNodeSource && artUsedFaces.has('TOP') && nodeShape.x > artShape.x + artShape.width / 2) {
        // Artifact already has incoming connection at its TOP face; route out of its EAST face!
        const artPort = { x: Math.round(artShape.x + artShape.width), y: Math.round(artShape.y + artShape.height / 2) };
        const nodePortX = Math.max(nodeShape.x + 15, Math.min(nodeShape.x + nodeShape.width - 15, artPort.x + 30));
        const nodePort  = { x: nodePortX, y: Math.round(nodeShape.y + nodeShape.height) };
        const prefMidY  = Math.round(artShape.y + artShape.height / 2);
        const midY      = findClearAssocYCorridor(prefMidY, artPort.x, nodePort.x, excludeIds);
        rawWaypoints = [
          nodePort,
          { x: nodePort.x, y: midY },
          { x: artPort.x,  y: midY },
          artPort
        ];
        artUsedFaces.add('EAST');
      } else {
        // Artifact is below node: connect node BOTTOM to artifact TOP
        const canAlignX = (artCx >= nodeShape.x + 12 && artCx <= nodeShape.x + nodeShape.width - 12);
        const nodePortX = canAlignX ? artCx : Math.max(nodeShape.x + 15, Math.min(nodeShape.x + nodeShape.width - 15, artCx));
        const artPortX  = canAlignX ? artCx : Math.max(artShape.x + 15, Math.min(artShape.x + artShape.width - 15, nodePortX));
        const nodePort  = { x: nodePortX, y: Math.round(nodeShape.y + nodeShape.height) };
        const artPort   = { x: artPortX,  y: Math.round(artShape.y) };

        if (nodePort.x === artPort.x && isAssocXClear(nodePort.x, nodePort.y, artPort.y, excludeIds)) {
          rawWaypoints = [nodePort, artPort];
        } else {
          const prefMidY = Math.round((nodePort.y + artPort.y) / 2);
          const midY = findClearAssocYCorridor(prefMidY, nodePort.x, artPort.x, excludeIds);
          rawWaypoints = [
            nodePort,
            { x: nodePort.x, y: midY },
            { x: artPort.x,  y: midY },
            artPort
          ];
        }
        artUsedFaces.add('TOP');
      }
    } else if (isArtRight) {
      // Artifact is laterally to the right of node: connect node EAST to artifact WEST
      const nodePortY = Math.max(nodeShape.y + 15, Math.min(nodeShape.y + nodeShape.height - 15, artCy));
      const artPortY  = Math.max(artShape.y + 15, Math.min(artShape.y + artShape.height - 15, nodePortY));
      const nodePort  = { x: Math.round(nodeShape.x + nodeShape.width), y: nodePortY };
      const artPort   = { x: Math.round(artShape.x), y: artPortY };

      if (nodePort.y === artPort.y) {
        rawWaypoints = [nodePort, artPort];
      } else {
        const midX = Math.round((nodePort.x + artPort.x) / 2);
        rawWaypoints = [
          nodePort,
          { x: midX, y: nodePort.y },
          { x: midX, y: artPort.y },
          artPort
        ];
      }
      artUsedFaces.add('WEST');
    } else if (isArtLeft) {
      // Artifact is laterally to the left of node: connect node WEST to artifact EAST
      const nodePortY = Math.max(nodeShape.y + 15, Math.min(nodeShape.y + nodeShape.height - 15, artCy));
      const artPortY  = Math.max(artShape.y + 15, Math.min(artShape.y + artShape.height - 15, nodePortY));
      const nodePort  = { x: Math.round(nodeShape.x), y: nodePortY };
      const artPort   = { x: Math.round(artShape.x + artShape.width), y: artPortY };

      if (nodePort.y === artPort.y) {
        rawWaypoints = [nodePort, artPort];
      } else {
        const midX = Math.round((nodePort.x + artPort.x) / 2);
        rawWaypoints = [
          nodePort,
          { x: midX, y: nodePort.y },
          { x: midX, y: artPort.y },
          artPort
        ];
      }
      artUsedFaces.add('EAST');
    } else {
      // Diagonal or inter-lane connection fallback
      const useTop = artCy < nodeCy;
      const nodePort = {
        x: Math.max(nodeShape.x + 15, Math.min(nodeShape.x + nodeShape.width - 15, artCx)),
        y: useTop ? Math.round(nodeShape.y) : Math.round(nodeShape.y + nodeShape.height)
      };
      const artPort = {
        x: Math.max(artShape.x + 15, Math.min(artShape.x + artShape.width - 15, nodePort.x)),
        y: useTop ? Math.round(artShape.y + artShape.height) : Math.round(artShape.y)
      };

      const prefMidY = Math.round((nodePort.y + artPort.y) / 2);
      const midY = findClearAssocYCorridor(prefMidY, nodePort.x, artPort.x, excludeIds);
      rawWaypoints = [
        nodePort,
        { x: nodePort.x, y: midY },
        { x: artPort.x,  y: midY },
        artPort
      ];
    }

    usedArtifactFaces.set(artShape.id, artUsedFaces);

    const directedWaypoints = isNodeSource ? rawWaypoints : [...rawWaypoints].reverse();
    const finalWaypoints = simplifyOrthogonalWaypoints(directedWaypoints);

    // Record placed association segments to prevent future association lines from overlapping them
    for (let i = 0; i < finalWaypoints.length - 1; i++) {
      const p1 = finalWaypoints[i];
      const p2 = finalWaypoints[i + 1];
      placedAssocSegments.push({
        p1,
        p2,
        isHorizontal: p1.y === p2.y,
        isVertical: p1.x === p2.x,
        assocId: assoc.id
      });
    }

    edgesXml += `
      <bpmndi:BPMNEdge id="${assoc.id}_di" bpmnElement="${assoc.id}">
${finalWaypoints.map(w => `        <di:waypoint x="${w.x}" y="${w.y}" />`).join('\n')}
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
