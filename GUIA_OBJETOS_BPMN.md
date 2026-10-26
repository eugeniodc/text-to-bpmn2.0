# Guía de Referencia de Objetos BPMN 2.0 para Prompts

Esta guía contiene la lista exhaustiva de objetos, eventos, compuertas y artefactos reconocidos por el sistema **Text-to-BPMN 2.0**, junto con los términos sugeridos (en español e inglés) para utilizarlos en tus descripciones o prompts.

---

## 1. Eventos (Events)

Los eventos representan algo que sucede durante el curso de un proceso y afectan a su flujo (iniciándolo, interrumpiéndolo o finalizándolo).

| Elemento BPMN | Nombres recomendados en el Prompt | Cuándo utilizarlo / Significado |
| :--- | :--- | :--- |
| `<bpmn:startEvent>` | `evento de inicio`, `start event`, `inicio` | Marca el punto de partida estándar del proceso. |
| `<bpmn:startEvent>` + Timer | `inicio por temporizador`, `timer start event`, `evento temporal` | Inicia periódicamente o en una fecha/hora específica. |
| `<bpmn:startEvent>` + Message | `inicio por mensaje`, `message start event`, `al recibir solicitud` | Se activa ante la llegada de un mensaje o evento externo. |
| `<bpmn:startEvent>` + Signal | `inicio por señal`, `signal start event`, `al recibir señal` | Se activa cuando se transmite una señal compartida. |
| `<bpmn:intermediateCatchEvent>` | `evento intermedio de captura`, `espera de mensaje / timer` | Detiene el flujo hasta que ocurre un evento (ej. esperar 48 horas). |
| `<bpmn:intermediateThrowEvent>` | `evento intermedio de lanzamiento`, `emisión de señal / mensaje` | Emite un mensaje o señal a otro carril/sistema y continúa. |
| `<bpmn:boundaryEvent>` | `evento de límite`, `boundary event`, `evento adjunto` | Se asocia al borde de una tarea para manejar errores, excepciones o timeouts. |
| `<bpmn:endEvent>` | `evento de fin`, `end event`, `fin`, `término` | Concluye la rama o la ejecución del proceso. |
| `<bpmn:endEvent>` + Terminate | `fin de terminación`, `terminate end event`, `cancelación total` | Cancela y detiene inmediatamente todas las ramas activas del proceso. |
| `<bpmn:endEvent>` + Error | `fin de error`, `error end event`, `fallo` | Finaliza la rama señalizando un fallo o condición de error. |
| `<bpmn:endEvent>` + Message | `fin con mensaje`, `message end event`, `notificación final` | Envía una notificación o mensaje externo al concluir. |

---

## 2. Actividades y Tipos de Tareas (Tasks & Activities)

Las tareas representan el trabajo realizado. Utilizar el tipo de tarea correcto permite que el modelo y el visor asignen el icono estándar y las reglas de negocio adecuadas.

| Elemento BPMN | Nombres recomendados en el Prompt | Cuándo utilizarlo / Significado |
| :--- | :--- | :--- |
| `<bpmn:task>` | `tarea`, `actividad`, `task` | Tarea estándar o genérica cuando no se requiere especificar el ejecutor. |
| `<bpmn:userTask>` | `tarea de usuario`, `user task`, `tarea humana`, `formulario` | Tarea manual realizada por una persona utilizando un software o interfaz. |
| `<bpmn:serviceTask>` | `tarea de servicio`, `service task`, `servicio automático`, `llamada API` | Tarea automatizada al 100% por un sistema, script backend o servicio web. |
| `<bpmn:sendTask>` | `tarea de envío`, `send task`, `enviar correo / notificación` | Envía un mensaje externo a otro participante. |
| `<bpmn:receiveTask>` | `tarea de recepción`, `receive task`, `esperar confirmación` | Queda a la espera de un mensaje entrante antes de continuar. |
| `<bpmn:manualTask>` | `tarea manual`, `manual task`, `acción física` | Tarea realizada por una persona sin intervención de ningún sistema de software. |
| `<bpmn:businessRuleTask>` | `tarea de regla de negocio`, `business rule task`, `tabla de decisión` | Ejecuta un motor de reglas de negocio, cálculo o matriz de decisión (DMN). |
| `<bpmn:scriptTask>` | `tarea de script`, `script task`, `ejecución de script` | Tarea que ejecuta un script o cálculo interno local. |
| `<bpmn:callActivity>` | `llamada a actividad`, `call activity`, `proceso reutilizable` | Invoca a un proceso independiente y global reutilizable. |
| `<bpmn:subProcess>` | `subproceso`, `sub-process`, `proceso anidado` | Agrupa un conjunto de pasos internos dentro del mismo flujo. |

---

## 3. Compuertas y Decisiones (Gateways)

Controlan cómo convergen o divergen los flujos de secuencia en el proceso.

| Elemento BPMN | Nombres recomendados en el Prompt | Cuándo utilizarlo / Significado |
| :--- | :--- | :--- |
| `<bpmn:exclusiveGateway>` | `compuerta exclusiva`, `exclusive gateway`, `XOR`, `decisión Sí/No` | Bifurcación donde **exactamente una** rama es seleccionada según una condición. |
| `<bpmn:parallelGateway>` | `compuerta paralela`, `parallel gateway`, `AND`, `flujo simultáneo` | Divide el flujo en varias ramas simultáneas o sincroniza la unión de varias. |
| `<bpmn:inclusiveGateway>` | `compuerta inclusiva`, `inclusive gateway`, `OR` | Puede activar **una o más** ramas dependiendo de las condiciones cumplidas. |
| `<bpmn:eventBasedGateway>` | `compuerta basada en eventos`, `event-based gateway` | La decisión se basa en cuál de los eventos siguientes ocurre primero. |
| `<bpmn:complexGateway>` | `compuerta compleja`, `complex gateway` | Para condiciones complejas de sincronización no cubiertas por XOR o AND. |

---

## 4. Datos y Artefactos (Data & Artifacts)

Proporcionan información sobre cómo los datos o documentos se consumen y producen a lo largo del proceso.

| Elemento BPMN | Nombres recomendados en el Prompt | Cuándo utilizarlo / Significado |
| :--- | :--- | :--- |
| `<bpmn:dataObjectReference>` | `objeto de datos`, `data object`, `documento`, `formulario`, `factura` | Representa un elemento de información o documento físico/digital. |
| `<bpmn:dataStoreReference>` | `almacén de datos`, `data store`, `base de datos`, `ERP`, `repositorio` | Representa un repositorio de persistencia que sobrevive al ciclo del proceso. |
| `<bpmn:textAnnotation>` | `anotación de texto`, `text annotation`, `nota`, `comentario` | Nota explicativa vinculada a cualquier paso del diagrama. |

---

## 5. Piscinas, Carriles y Conectores (Pools, Lanes & Connectors)

Organizan las responsabilidades y el flujo de comunicación entre actores.

| Elemento BPMN | Nombres recomendados en el Prompt | Cuándo utilizarlo / Significado |
| :--- | :--- | :--- |
| `<bpmn:participant>` / `Pool` | `piscina`, `pool`, `participante`, `sistema`, `entidad` | Representa un participante o sistema autónomo e independiente. |
| `<bpmn:lane>` / `Lane` | `carril`, `calle`, `lane`, `departamento`, `rol` | Subdivide una piscina por responsabilidades funcionales (ej. Ventas, Logística). |
| `<bpmn:sequenceFlow>` | `flujo de secuencia`, `flecha`, `transición`, `rama` | Conecta el orden de ejecución dentro del mismo proceso o carril. |
| `<bpmn:messageFlow>` | `flujo de mensaje`, `message flow` | Conecta intercambios de información entre dos piscinas (`pools`) distintas. |

---

## 6. Paleta de Colores Estándar del Sistema

Cuando activas el botón **Colors** en la barra de herramientas, el sistema aplica automáticamente la siguiente codificación visual:

* 🟢 **Verde** (`#2e7d32` / `#e8f5e9`): Eventos de Inicio (`StartEvent`).
* 🔴 **Rojo** (`#c62828` / `#ffebee`): Eventos de Fin (`EndEvent`).
* 🟠 **Naranja** (`#ef6c00` / `#fff3e0`): Eventos Intermedios y de Límite (`IntermediateCatchEvent`, `BoundaryEvent`).
* 🟡 **Ámbar / Dorado** (`#f57f17` / `#fff9c4`): Compuertas de Decisión (`Gateways`).
* 🔵 **Azul** (`#1565c0` / `#e3f2fd`): Tareas y Actividades (`UserTask`, `ServiceTask`, `Task`).
* 🟣 **Púrpura** (`#6a1b9a` / `#f3e5f5`): Subprocesos (`SubProcess`).
* 🟢 **Verde azulado** (`#00695c` / `#e0f2f1`): Objetos y Almacenes de Datos (`DataObject`, `DataStore`).

---

## 7. Plantilla y Ejemplo de Prompt Estructurado

Copia y adapta esta estructura para obtener diagramas precisos en el primer intento:

```markdown
Crea un diagrama BPMN 2.0 con una piscina y dos carriles (lanes): 'Atención al Cliente' y 'Departamento Técnico'.

1. 'Atención al Cliente' inicia el flujo con un evento de inicio por mensaje al recibir una incidencia.
2. Se realiza una tarea de usuario: 'Registrar datos de la incidencia' asociada a un objeto de datos 'Ticket de Soporte'.
3. Mediante una compuerta exclusiva (XOR) se evalúa: '¿Requiere intervención técnica?':
   - Rama 'No': se envía una tarea de envío 'Enviar solución estándar al cliente' y se llega a un evento de fin 'Incidencia Resuelta'.
   - Rama 'Sí': el flujo pasa al carril 'Departamento Técnico'.
4. En 'Departamento Técnico':
   - Se ejecuta una tarea de servicio 'Consultar historial en base de datos' vinculada a un almacén de datos 'Base de Datos de Clientes'.
   - Luego una tarea de usuario 'Diagnosticar y reparar problema'.
5. Una compuerta exclusiva evalúa: '¿Reparación exitosa?':
   - Rama 'Sí': se pasa a un evento de fin 'Caso Cerrado con Éxito'.
   - Rama 'No': se escala a un evento de fin de error 'Escalado a Nivel 3'.
```
