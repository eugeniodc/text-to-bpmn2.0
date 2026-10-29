# 📚 Banco de Ejemplos para Pruebas de Text-to-BPMN

Esta carpeta contiene prompts de prueba en lenguaje natural clasificados por complejidad y características de BPMN 2.0. Están diseñados para validar el rendimiento del modelo LLM local (oMLX Qwen3.6-35B), el motor de auto-layout (ELK) y el linter (bpmnlint).

---

## 📂 Índice de Ejemplos

| Archivo | Nivel | Elementos BPMN Evaluados |
|---------|-------|--------------------------|
| [`01_lineal_vacaciones.txt`](01_lineal_vacaciones.txt) | 🟢 Básico | Secuencia lineal, `userTask`, `serviceTask`, `sendTask`, `startEvent`, `endEvent`. |
| [`02_decision_y_bucle_gastos.txt`](02_decision_y_bucle_gastos.txt) | 🟡 Intermedio | `exclusiveGateway` (XOR), ramas con condiciones, bucle de retorno, compuerta de unión (valida regla anti-`fake-join`). |
| [`03_paralelo_alta_empleado.txt`](03_paralelo_alta_empleado.txt) | 🟡 Intermedio | `parallelGateway` (AND), bifurcación simultánea (fork), sincronización (join), `manualTask`. |
| [`04_carriles_tramitacion_pedidos.txt`](04_carriles_tramitacion_pedidos.txt) | 🟠 Avanzado | Swimlanes: `collaboration`, `participant` (Pool) y múltiples `laneSet`/`lane` con distribución por roles. |
| [`05_datos_y_documentos_facturacion.txt`](05_datos_y_documentos_facturacion.txt) | 🟠 Avanzado | `dataObjectReference`, `dataStoreReference`, `dataInputAssociation`, `dataOutputAssociation`, `textAnnotation`. |
| [`06_subproceso_temporizador_boundary.txt`](06_subproceso_temporizador_boundary.txt) | 🔴 Complejo | `subProcess` embebido, `boundaryEvent` (timer y error), `intermediateCatchEvent` con timer, fin de terminación (`terminateEventDefinition`). |
| [`07_gestion_incidentes_itil.txt`](07_gestion_incidentes_itil.txt) | 🔴 Complejo | `businessRuleTask`, `callActivity`, compuertas mixtas (XOR + AND), flujo end-to-end de soporte técnico ITIL. |
| [`08_alta_proveedores_paralelo_artefactos.txt`](08_alta_proveedores_paralelo_artefactos.txt) | 🔴 Complejo | Homologación multi-carril en paralelo (Compras, Finanzas, Seguridad), compuertas AND/XOR, artefactos y almacenes duplicados por carril, anotaciones con SLA y reglas de negocio. |

---

## 🚀 Cómo utilizarlos

1. **Copiar y Pegar**: Abre cualquier archivo `.txt`, copia su contenido y pégalo directamente en la caja de chat de la aplicación web.
2. **Arrastrar y Soltar (Drag & Drop)**: Puedes arrastrar el archivo `.txt` directamente sobre el panel de chat o sobre el lateral de la interfaz. La aplicación extraerá el texto y enviará la solicitud automáticamente.
3. **Botón Adjuntar**: Usa el icono de clip o adjunto en el chat para seleccionar el archivo.

---

## 🔍 Qué observar durante las pruebas

- **Pensamiento (Thinking)**: Observa si el modelo razona la estructura antes de generar el XML y no emite etiquetas dentro del bloque de razonamiento.
- **Validación del Linter (bpmnlint)**: Comprueba que el badge superior no marque errores (especialmente `fake-join` o `superfluous-gateway`).
- **Diagramado automático (ELK)**: Verifica que las flechas sean ortogonales, no se superpongan textos con figuras y las swimlanes mantengan sus carriles ordenados.
- **Velocidad y respuesta**: Gracias al `max_tokens: 16384`, ANE prefill y MTP, los diagramas extensos (ejemplos 04, 06 y 07) deben generarse fluidamente sin cortes de etiquetas.
