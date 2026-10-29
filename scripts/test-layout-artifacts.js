import { layoutBpmnWithElk } from '../src/elk-layout.js';
import BpmnModdle from 'bpmn-moddle';

const testXml1 = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
                  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
                  xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
                  id="Definitions_1"
                  targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:collaboration id="Collaboration_1">
    <bpmn:participant id="Participant_1" name="Empresa" processRef="Process_1" />
  </bpmn:collaboration>

  <bpmn:process id="Process_1" isExecutable="false">
    <bpmn:laneSet id="LaneSet_1">
      <bpmn:lane id="Lane_Admin" name="Administración">
        <bpmn:flowNodeRef>Start_1</bpmn:flowNodeRef>
        <bpmn:flowNodeRef>Task_Registrar</bpmn:flowNodeRef>
        <bpmn:flowNodeRef>Gateway_Validar</bpmn:flowNodeRef>
        <bpmn:flowNodeRef>Task_Rechazar</bpmn:flowNodeRef>
        <bpmn:flowNodeRef>End_Rechazado</bpmn:flowNodeRef>
      </bpmn:lane>
      <bpmn:lane id="Lane_Finanzas" name="Finanzas">
        <bpmn:flowNodeRef>Task_Pagar</bpmn:flowNodeRef>
        <bpmn:flowNodeRef>End_Exito</bpmn:flowNodeRef>
      </bpmn:lane>
    </bpmn:laneSet>

    <bpmn:startEvent id="Start_1" name="Recepción Factura">
      <bpmn:outgoing>Flow_1</bpmn:outgoing>
    </bpmn:startEvent>

    <bpmn:userTask id="Task_Registrar" name="Registrar Factura">
      <bpmn:incoming>Flow_1</bpmn:incoming>
      <bpmn:outgoing>Flow_2</bpmn:outgoing>
      <bpmn:dataOutputAssociation id="DOA_Factura">
        <bpmn:targetRef>Doc_Factura</bpmn:targetRef>
      </bpmn:dataOutputAssociation>
    </bpmn:userTask>

    <bpmn:exclusiveGateway id="Gateway_Validar" name="¿Importe correcto?">
      <bpmn:incoming>Flow_2</bpmn:incoming>
      <bpmn:outgoing>Flow_Rechazo</bpmn:outgoing>
      <bpmn:outgoing>Flow_Aprobado</bpmn:outgoing>
    </bpmn:exclusiveGateway>

    <bpmn:task id="Task_Rechazar" name="Notificar Discrepancia">
      <bpmn:incoming>Flow_Rechazo</bpmn:incoming>
      <bpmn:outgoing>Flow_3</bpmn:outgoing>
    </bpmn:task>

    <bpmn:endEvent id="End_Rechazado" name="Factura Rechazada">
      <bpmn:incoming>Flow_3</bpmn:incoming>
    </bpmn:endEvent>

    <bpmn:serviceTask id="Task_Pagar" name="Emitir Pago">
      <bpmn:incoming>Flow_Aprobado</bpmn:incoming>
      <bpmn:outgoing>Flow_4</bpmn:outgoing>
      <bpmn:dataInputAssociation id="DIA_Factura">
        <bpmn:sourceRef>Doc_Factura</bpmn:sourceRef>
      </bpmn:dataInputAssociation>
      <bpmn:dataOutputAssociation id="DOA_ERP">
        <bpmn:targetRef>Store_ERP</bpmn:targetRef>
      </bpmn:dataOutputAssociation>
    </bpmn:serviceTask>

    <bpmn:endEvent id="End_Exito" name="Pago Completado">
      <bpmn:incoming>Flow_4</bpmn:incoming>
    </bpmn:endEvent>

    <bpmn:dataObjectReference id="Doc_Factura" name="Factura PDF" />
    <bpmn:dataStoreReference id="Store_ERP" name="Base de Datos ERP" />

    <bpmn:textAnnotation id="Annot_1">
      <bpmn:text>SLA: Verificación obligatoria en menos de 2h</bpmn:text>
    </bpmn:textAnnotation>
    <bpmn:association id="Assoc_1" sourceRef="Annot_1" targetRef="Task_Registrar" />

    <bpmn:textAnnotation id="Annot_Gw">
      <bpmn:text>Criterio: Diferencia tolerada &lt; 1%</bpmn:text>
    </bpmn:textAnnotation>
    <bpmn:association id="Assoc_2" sourceRef="Annot_Gw" targetRef="Gateway_Validar" />

    <bpmn:sequenceFlow id="Flow_1" sourceRef="Start_1" targetRef="Task_Registrar" />
    <bpmn:sequenceFlow id="Flow_2" sourceRef="Task_Registrar" targetRef="Gateway_Validar" />
    <bpmn:sequenceFlow id="Flow_Rechazo" name="No válido" sourceRef="Gateway_Validar" targetRef="Task_Rechazar" />
    <bpmn:sequenceFlow id="Flow_Aprobado" name="Válido" sourceRef="Gateway_Validar" targetRef="Task_Pagar" />
    <bpmn:sequenceFlow id="Flow_3" sourceRef="Task_Rechazar" targetRef="End_Rechazado" />
    <bpmn:sequenceFlow id="Flow_4" sourceRef="Task_Pagar" targetRef="End_Exito" />
  </bpmn:process>
</bpmn:definitions>
`;

const testXml2 = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
                  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
                  xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
                  id="Definitions_2"
                  targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_2" isExecutable="false">
    <bpmn:startEvent id="Start_2" name="Inicio">
      <bpmn:outgoing>F1</bpmn:outgoing>
    </bpmn:startEvent>

    <bpmn:userTask id="Task_Evaluar" name="Evaluar Solicitud">
      <bpmn:incoming>F1</bpmn:incoming>
      <bpmn:outgoing>F2</bpmn:outgoing>
      <bpmn:dataInputAssociation id="DIA_Solicitud">
        <bpmn:sourceRef>Doc_Solicitud</bpmn:sourceRef>
      </bpmn:dataInputAssociation>
      <bpmn:dataOutputAssociation id="DOA_Informe">
        <bpmn:targetRef>Doc_Informe</bpmn:targetRef>
      </bpmn:dataOutputAssociation>
    </bpmn:userTask>

    <bpmn:serviceTask id="Task_RegistrarBD" name="Registrar en CRM">
      <bpmn:incoming>F2</bpmn:incoming>
      <bpmn:outgoing>F3</bpmn:outgoing>
      <bpmn:dataInputAssociation id="DIA_Informe">
        <bpmn:sourceRef>Doc_Informe</bpmn:sourceRef>
      </bpmn:dataInputAssociation>
      <bpmn:dataOutputAssociation id="DOA_CRM">
        <bpmn:targetRef>Store_CRM</bpmn:targetRef>
      </bpmn:dataOutputAssociation>
    </bpmn:serviceTask>

    <bpmn:endEvent id="End_2" name="Fin">
      <bpmn:incoming>F3</bpmn:incoming>
    </bpmn:endEvent>

    <bpmn:dataObjectReference id="Doc_Solicitud" name="Solicitud Entrada" />
    <bpmn:dataObjectReference id="Doc_Informe" name="Informe Evaluación" />
    <bpmn:dataStoreReference id="Store_CRM" name="CRM Clientes" />

    <bpmn:textAnnotation id="Annot_Task1">
      <bpmn:text>Revisar DNI y nóminas adjuntas</bpmn:text>
    </bpmn:textAnnotation>
    <bpmn:association id="Assoc_T1" sourceRef="Annot_Task1" targetRef="Task_Evaluar" />

    <bpmn:textAnnotation id="Annot_Task2">
      <bpmn:text>SLA: Actualización en menos de 5 segundos</bpmn:text>
    </bpmn:textAnnotation>
    <bpmn:association id="Assoc_T2" sourceRef="Annot_Task2" targetRef="Task_RegistrarBD" />

    <bpmn:sequenceFlow id="F1" sourceRef="Start_2" targetRef="Task_Evaluar" />
    <bpmn:sequenceFlow id="F2" sourceRef="Task_Evaluar" targetRef="Task_RegistrarBD" />
    <bpmn:sequenceFlow id="F3" sourceRef="Task_RegistrarBD" targetRef="End_2" />
  </bpmn:process>
</bpmn:definitions>
`;

const testXml3 = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
                  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
                  xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
                  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
                  id="Definitions_Alta_Proveedor"
                  targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:collaboration id="Collaboration_1">
    <bpmn:participant id="Participant_Org" name="Organización - Alta de Proveedores" processRef="Process_Alta_Proveedor" />
  </bpmn:collaboration>

  <bpmn:process id="Process_Alta_Proveedor" name="Alta y Homologación de Proveedores" isExecutable="false">
    <bpmn:laneSet id="LaneSet_1">
      <bpmn:lane id="Lane_Compras" name="Departamento de Compras">
        <bpmn:flowNodeRef>Start_Solicitud</bpmn:flowNodeRef>
        <bpmn:flowNodeRef>Task_Registrar</bpmn:flowNodeRef>
        <bpmn:flowNodeRef>Gateway_Fork</bpmn:flowNodeRef>
        <bpmn:flowNodeRef>Gateway_Join</bpmn:flowNodeRef>
        <bpmn:flowNodeRef>Task_Decidir</bpmn:flowNodeRef>
        <bpmn:flowNodeRef>Gateway_Aprobado</bpmn:flowNodeRef>
        <bpmn:flowNodeRef>Task_Comunicar_Alta</bpmn:flowNodeRef>
        <bpmn:flowNodeRef>End_Alta_Exitosa</bpmn:flowNodeRef>
        <bpmn:flowNodeRef>Task_Notificar_Rechazo</bpmn:flowNodeRef>
        <bpmn:flowNodeRef>End_Rechazo</bpmn:flowNodeRef>
      </bpmn:lane>
      <bpmn:lane id="Lane_Finanzas" name="Departamento Financiero">
        <bpmn:flowNodeRef>Task_Validar_Fiscal</bpmn:flowNodeRef>
      </bpmn:lane>
      <bpmn:lane id="Lane_Seguridad" name="Departamento de Seguridad">
        <bpmn:flowNodeRef>Task_Revisar_Seguridad</bpmn:flowNodeRef>
      </bpmn:lane>
    </bpmn:laneSet>

    <!-- Inicio en Compras -->
    <bpmn:startEvent id="Start_Solicitud" name="Recepción Solicitud Alta">
      <bpmn:outgoing>Flow_1</bpmn:outgoing>
      <bpmn:messageEventDefinition id="MsgStart_1" />
    </bpmn:startEvent>

    <bpmn:sequenceFlow id="Flow_1" sourceRef="Start_Solicitud" targetRef="Task_Registrar" />

    <bpmn:userTask id="Task_Registrar" name="Registrar Petición de Alta">
      <bpmn:incoming>Flow_1</bpmn:incoming>
      <bpmn:outgoing>Flow_2</bpmn:outgoing>
      <bpmn:dataOutputAssociation id="DOA_Expediente_Compras">
        <bpmn:targetRef>Doc_Expediente_Compras</bpmn:targetRef>
      </bpmn:dataOutputAssociation>
      <bpmn:dataOutputAssociation id="DOA_Portal_SRM">
        <bpmn:targetRef>Store_SRM_Compras</bpmn:targetRef>
      </bpmn:dataOutputAssociation>
    </bpmn:userTask>

    <bpmn:sequenceFlow id="Flow_2" sourceRef="Task_Registrar" targetRef="Gateway_Fork" />

    <!-- Bifurcación Paralela -->
    <bpmn:parallelGateway id="Gateway_Fork" name="Revisiones en Paralelo">
      <bpmn:incoming>Flow_2</bpmn:incoming>
      <bpmn:outgoing>Flow_Hacia_Finanzas</bpmn:outgoing>
      <bpmn:outgoing>Flow_Hacia_Seguridad</bpmn:outgoing>
    </bpmn:parallelGateway>

    <!-- Rama 1: Finanzas -->
    <bpmn:sequenceFlow id="Flow_Hacia_Finanzas" sourceRef="Gateway_Fork" targetRef="Task_Validar_Fiscal" />

    <bpmn:serviceTask id="Task_Validar_Fiscal" name="Validar Datos Fiscales">
      <bpmn:incoming>Flow_Hacia_Finanzas</bpmn:incoming>
      <bpmn:outgoing>Flow_Desde_Finanzas</bpmn:outgoing>
      <bpmn:dataInputAssociation id="DIA_Expediente_Finanzas">
        <bpmn:sourceRef>Doc_Expediente_Finanzas</bpmn:sourceRef>
      </bpmn:dataInputAssociation>
      <bpmn:dataOutputAssociation id="DOA_ERP_Finanzas">
        <bpmn:targetRef>Store_ERP_Finanzas</bpmn:targetRef>
      </bpmn:dataOutputAssociation>
    </bpmn:serviceTask>

    <bpmn:sequenceFlow id="Flow_Desde_Finanzas" sourceRef="Task_Validar_Fiscal" targetRef="Gateway_Join" />

    <!-- Rama 2: Seguridad -->
    <bpmn:sequenceFlow id="Flow_Hacia_Seguridad" sourceRef="Gateway_Fork" targetRef="Task_Revisar_Seguridad" />

    <bpmn:userTask id="Task_Revisar_Seguridad" name="Revisar Requisitos Acceso">
      <bpmn:incoming>Flow_Hacia_Seguridad</bpmn:incoming>
      <bpmn:outgoing>Flow_Desde_Seguridad</bpmn:outgoing>
      <bpmn:dataInputAssociation id="DIA_Expediente_Seguridad">
        <bpmn:sourceRef>Doc_Expediente_Seguridad</bpmn:sourceRef>
      </bpmn:dataInputAssociation>
      <bpmn:dataOutputAssociation id="DOA_SecDB_Seguridad">
        <bpmn:targetRef>Store_SecDB_Seguridad</bpmn:targetRef>
      </bpmn:dataOutputAssociation>
    </bpmn:userTask>

    <bpmn:sequenceFlow id="Flow_Desde_Seguridad" sourceRef="Task_Revisar_Seguridad" targetRef="Gateway_Join" />

    <!-- Sincronización Paralela -->
    <bpmn:parallelGateway id="Gateway_Join" name="Sincronizar Revisiones">
      <bpmn:incoming>Flow_Desde_Finanzas</bpmn:incoming>
      <bpmn:incoming>Flow_Desde_Seguridad</bpmn:incoming>
      <bpmn:outgoing>Flow_Hacia_Decision</bpmn:outgoing>
    </bpmn:parallelGateway>

    <bpmn:sequenceFlow id="Flow_Hacia_Decision" sourceRef="Gateway_Join" targetRef="Task_Decidir" />

    <!-- Decisión de Compras -->
    <bpmn:userTask id="Task_Decidir" name="Decidir Aprobación">
      <bpmn:incoming>Flow_Hacia_Decision</bpmn:incoming>
      <bpmn:outgoing>Flow_Hacia_Gateway_Dec</bpmn:outgoing>
      <bpmn:dataInputAssociation id="DIA_Dictamen_Compras">
        <bpmn:sourceRef>Doc_Dictamen_Compras</bpmn:sourceRef>
      </bpmn:dataInputAssociation>
    </bpmn:userTask>

    <bpmn:sequenceFlow id="Flow_Hacia_Gateway_Dec" sourceRef="Task_Decidir" targetRef="Gateway_Aprobado" />

    <bpmn:exclusiveGateway id="Gateway_Aprobado" name="¿Aprobado?">
      <bpmn:incoming>Flow_Hacia_Gateway_Dec</bpmn:incoming>
      <bpmn:outgoing>Flow_Aprobado</bpmn:outgoing>
      <bpmn:outgoing>Flow_Rechazado</bpmn:outgoing>
    </bpmn:exclusiveGateway>

    <!-- Camino Aprobado -->
    <bpmn:sequenceFlow id="Flow_Aprobado" name="Sí" sourceRef="Gateway_Aprobado" targetRef="Task_Comunicar_Alta" />

    <bpmn:sendTask id="Task_Comunicar_Alta" name="Comunicar Alta">
      <bpmn:incoming>Flow_Aprobado</bpmn:incoming>
      <bpmn:outgoing>Flow_Fin_Exito</bpmn:outgoing>
      <bpmn:dataOutputAssociation id="DOA_Certificado_Alta">
        <bpmn:targetRef>Doc_Certificado_Alta</bpmn:targetRef>
      </bpmn:dataOutputAssociation>
      <bpmn:dataOutputAssociation id="DOA_ERP_Alta">
        <bpmn:targetRef>Store_ERP_Alta</bpmn:targetRef>
      </bpmn:dataOutputAssociation>
    </bpmn:sendTask>

    <bpmn:sequenceFlow id="Flow_Fin_Exito" sourceRef="Task_Comunicar_Alta" targetRef="End_Alta_Exitosa" />

    <bpmn:endEvent id="End_Alta_Exitosa" name="Alta Finalizada">
      <bpmn:incoming>Flow_Fin_Exito</bpmn:incoming>
      <bpmn:messageEventDefinition id="MsgEnd_Exito" />
    </bpmn:endEvent>

    <!-- Camino Rechazado -->
    <bpmn:sequenceFlow id="Flow_Rechazado" name="No" sourceRef="Gateway_Aprobado" targetRef="Task_Notificar_Rechazo" />

    <bpmn:sendTask id="Task_Notificar_Rechazo" name="Notificar Rechazo">
      <bpmn:incoming>Flow_Rechazado</bpmn:incoming>
      <bpmn:outgoing>Flow_Fin_Rechazo</bpmn:outgoing>
      <bpmn:dataOutputAssociation id="DOA_Resolucion_Rechazo">
        <bpmn:targetRef>Doc_Resolucion_Rechazo</bpmn:targetRef>
      </bpmn:dataOutputAssociation>
    </bpmn:sendTask>

    <bpmn:sequenceFlow id="Flow_Fin_Rechazo" sourceRef="Task_Notificar_Rechazo" targetRef="End_Rechazo" />

    <bpmn:endEvent id="End_Rechazo" name="Solicitud Rechazada">
      <bpmn:incoming>Flow_Fin_Rechazo</bpmn:incoming>
    </bpmn:endEvent>

    <!-- Artefactos Duplicados Locales: Objetos de Datos -->
    <bpmn:dataObjectReference id="Doc_Expediente_Compras" name="Expediente [Registro]" />
    <bpmn:dataObjectReference id="Doc_Expediente_Finanzas" name="Expediente [Finanzas]" />
    <bpmn:dataObjectReference id="Doc_Expediente_Seguridad" name="Expediente [Seguridad]" />
    <bpmn:dataObjectReference id="Doc_Dictamen_Compras" name="Dictámenes Conjuntos" />
    <bpmn:dataObjectReference id="Doc_Certificado_Alta" name="Certificado de Alta" />
    <bpmn:dataObjectReference id="Doc_Resolucion_Rechazo" name="Carta de Rechazo" />

    <!-- Bases de Datos Locales por Departamento -->
    <bpmn:dataStoreReference id="Store_SRM_Compras" name="Portal SRM" />
    <bpmn:dataStoreReference id="Store_ERP_Finanzas" name="ERP Contable" />
    <bpmn:dataStoreReference id="Store_SecDB_Seguridad" name="DB Accesos" />
    <bpmn:dataStoreReference id="Store_ERP_Alta" name="ERP Proveedores" />

    <!-- Anotaciones de Texto y Comentarios -->
    <bpmn:textAnnotation id="Annot_Registro">
      <bpmn:text>SLA: Registro inicial en menos de 4h</bpmn:text>
    </bpmn:textAnnotation>
    <bpmn:association id="Assoc_Annot_Registro" sourceRef="Annot_Registro" targetRef="Task_Registrar" />

    <bpmn:textAnnotation id="Annot_Fiscal">
      <bpmn:text>Validación VIES y certificados tributarios</bpmn:text>
    </bpmn:textAnnotation>
    <bpmn:association id="Assoc_Annot_Fiscal" sourceRef="Annot_Fiscal" targetRef="Task_Validar_Fiscal" />

    <bpmn:textAnnotation id="Annot_Seguridad">
      <bpmn:text>Verificación ISO 27001 y políticas ENS</bpmn:text>
    </bpmn:textAnnotation>
    <bpmn:association id="Assoc_Annot_Seguridad" sourceRef="Annot_Seguridad" targetRef="Task_Revisar_Seguridad" />

    <bpmn:textAnnotation id="Annot_Decision">
      <bpmn:text>Criterio: Ambas revisiones deben ser favorables</bpmn:text>
    </bpmn:textAnnotation>
    <bpmn:association id="Assoc_Annot_Decision" sourceRef="Annot_Decision" targetRef="Gateway_Aprobado" />

  </bpmn:process>
</bpmn:definitions>
`;

async function testDiagram(name, xml) {
  console.log(`\n========================================`);
  console.log(`Running Test: ${name}`);
  console.log(`========================================`);
  const resultXml = await layoutBpmnWithElk(xml);

  const moddle = new BpmnModdle();
  const { rootElement, warnings } = await moddle.fromXML(resultXml);
  if (warnings && warnings.length > 0) {
    console.warn(`⚠️ Moddle Warnings (${warnings.length}):`, warnings.map(w => w.message));
  } else {
    console.log(`✅ BPMN Moddle: 0 warnings, parsed successfully (${rootElement.$type})`);
  }

  const shapeRegex = /<bpmndi:BPMNShape\b[^>]*id="([^"]+)"[^>]*>[\s\S]*?<dc:Bounds\s+x="([^"]+)"\s+y="([^"]+)"\s+width="([^"]+)"\s+height="([^"]+)"/g;
  let match;
  const shapes = [];
  while ((match = shapeRegex.exec(resultXml)) !== null) {
    shapes.push({
      id: match[1],
      x: parseFloat(match[2]),
      y: parseFloat(match[3]),
      w: parseFloat(match[4]),
      h: parseFloat(match[5])
    });
  }

  const edgeRegex = /<bpmndi:BPMNEdge\b[^>]*id="([^"]+)"[^>]*>([\s\S]*?)<\/bpmndi:BPMNEdge>/g;
  const edges = [];
  while ((match = edgeRegex.exec(resultXml)) !== null) {
    const edgeId = match[1];
    const inner = match[2];
    const wpRegex = /<di:waypoint\s+x="([^"]+)"\s+y="([^"]+)"/g;
    let wpMatch;
    const waypoints = [];
    while ((wpMatch = wpRegex.exec(inner)) !== null) {
      waypoints.push({ x: parseFloat(wpMatch[1]), y: parseFloat(wpMatch[2]) });
    }
    edges.push({ id: edgeId, waypoints });
  }

  console.log(`Placed ${shapes.length} shapes and ${edges.length} edges.`);
  console.log('\n--- Shapes: ---');
  for (const s of shapes) {
    console.log(`  ${s.id}: x=${s.x}, y=${s.y}, w=${s.w}, h=${s.h}`);
  }

  console.log('\n--- Edges: ---');
  for (const e of edges) {
    console.log(`  ${e.id}:`);
    for (const w of e.waypoints) {
      console.log(`    -> (${w.x}, ${w.y})`);
    }
  }

  // Check 1: Shapes should not overlap with each other (excluding pool and lanes)
  let shapeOverlapCount = 0;
  for (let i = 0; i < shapes.length; i++) {
    for (let j = i + 1; j < shapes.length; j++) {
      const s1 = shapes[i];
      const s2 = shapes[j];
      if (/Participant|Lane/i.test(s1.id) || /Participant|Lane/i.test(s2.id)) continue;
      const xOv = Math.max(0, Math.min(s1.x + s1.w, s2.x + s2.w) - Math.max(s1.x, s2.x));
      const yOv = Math.max(0, Math.min(s1.y + s1.h, s2.y + s2.h) - Math.max(s1.y, s2.y));
      if (xOv > 0 && yOv > 0) {
        console.error(`❌ Shapes ${s1.id} and ${s2.id} overlap!`);
        shapeOverlapCount++;
      }
    }
  }

  // Check 2: Lines should not intersect shape bodies
  let lineOverlapCount = 0;
  for (const e of edges) {
    for (let i = 0; i < e.waypoints.length - 1; i++) {
      const p1 = e.waypoints[i];
      const p2 = e.waypoints[i + 1];
      const isH = p1.y === p2.y;
      const isV = p1.x === p2.x;

      for (const s of shapes) {
        if (/Participant|Lane/i.test(s.id)) continue;
        if (e.id.includes(s.id.replace('_di', ''))) continue;

        if (isH) {
          const xMin = Math.min(p1.x, p2.x);
          const xMax = Math.max(p1.x, p2.x);
          if (xMax > s.x + 5 && xMin < s.x + s.w - 5 && p1.y > s.y + 5 && p1.y < s.y + s.h - 5) {
            console.error(`❌ Edge ${e.id} segment ${i} (horizontal at y=${p1.y}) crosses interior of shape ${s.id}`);
            lineOverlapCount++;
          }
        } else if (isV) {
          const yMin = Math.min(p1.y, p2.y);
          const yMax = Math.max(p1.y, p2.y);
          if (yMax > s.y + 5 && yMin < s.y + s.h - 5 && p1.x > s.x + 5 && p1.x < s.x + s.w - 5) {
            console.error(`❌ Edge ${e.id} segment ${i} (vertical at x=${p1.x}) crosses interior of shape ${s.id}`);
            lineOverlapCount++;
          }
        }
      }
    }
  }

  // Check 3: No two lines should share overlapping collinear segments
  let lineCoincidenceCount = 0;
  for (let i = 0; i < edges.length; i++) {
    for (let j = i + 1; j < edges.length; j++) {
      const e1 = edges[i];
      const e2 = edges[j];
      for (let s1 = 0; s1 < e1.waypoints.length - 1; s1++) {
        const a1 = e1.waypoints[s1];
        const a2 = e1.waypoints[s1 + 1];
        const isH1 = a1.y === a2.y;
        const isV1 = a1.x === a2.x;

        for (let s2 = 0; s2 < e2.waypoints.length - 1; s2++) {
          const b1 = e2.waypoints[s2];
          const b2 = e2.waypoints[s2 + 1];
          const isH2 = b1.y === b2.y;
          const isV2 = b1.x === b2.x;

          if (isH1 && isH2 && a1.y === b1.y) {
            const minA = Math.min(a1.x, a2.x);
            const maxA = Math.max(a1.x, a2.x);
            const minB = Math.min(b1.x, b2.x);
            const maxB = Math.max(b1.x, b2.x);
            if (Math.max(minA, minB) < Math.min(maxA, maxB) - 5) {
              console.error(`❌ Edge ${e1.id} and ${e2.id} share overlapping horizontal segment at y=${a1.y}!`);
              lineCoincidenceCount++;
            }
          } else if (isV1 && isV2 && a1.x === b1.x) {
            const minA = Math.min(a1.y, a2.y);
            const maxA = Math.max(a1.y, a2.y);
            const minB = Math.min(b1.y, b2.y);
            const maxB = Math.max(b1.y, b2.y);
            if (Math.max(minA, minB) < Math.min(maxA, maxB) - 5) {
              console.error(`❌ Edge ${e1.id} and ${e2.id} share overlapping vertical segment at x=${a1.x}!`);
              lineCoincidenceCount++;
            }
          }
        }
      }
    }
  }

  if (shapeOverlapCount === 0 && lineOverlapCount === 0 && lineCoincidenceCount === 0) {
    console.log(`\n✅ TEST PASSED: No shape overlaps, no line-shape crossings, and no overlapping collinear lines!`);
    return true;
  } else {
    console.error(`\n❌ TEST FAILED: ${shapeOverlapCount} shape overlaps, ${lineOverlapCount} line crossings, ${lineCoincidenceCount} collinear line overlaps.`);
    return false;
  }
}

async function main() {
  let allOk = true;
  const ok1 = await testDiagram('Test 1: Multi-lane Process with Shared Artifact', testXml1);
  const ok2 = await testDiagram('Test 2: Single-lane Process with Annotations and Data Objects', testXml2);
  const ok3 = await testDiagram('Test 3: Homologación de Proveedores (Paralelo, Duplicados, BD y Anotaciones)', testXml3);
  allOk = ok1 && ok2 && ok3;
  if (!allOk) process.exit(1);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
