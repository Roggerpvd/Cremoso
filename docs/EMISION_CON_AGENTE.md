# Emitir la boleta con un agente de navegador (Claude en Chrome)

> **Estado: diseñado, NO probado contra el portal de SUNAT.** Quien escribió esto no tiene acceso a SUNAT; los pasos finos del portal los descubre el agente en pantalla y debes validarlos tú con una emisión supervisada.

## Idea
Es el mismo principio de los videos donde alguien pega un atajo en el chat y el navegador llena la boleta: **un agente que usa tu navegador ya autenticado**, no una conexión directa a SUNAT.

1. Tú inicias sesión en SUNAT (Clave SOL, captcha, etc.) en Chrome.
2. En RestoPOS, **Comprobantes → Boleta → Copiar para el agente**.
3. Pegas el bloque en el panel de Claude en Chrome. El agente **te pide permiso** para abrir `https://e-menu.sunat.gob.pe/cl-ti-itmenu/MenuInternet.htm?pestana=*&agrupacion=*`, verifica el RUC, llena el formulario y se detiene.
4. **Tú revisas y presionas Emitir**, e imprimes la boleta con el botón del propio portal.
5. Pegas en RestoPOS la línea `BOLETA_EMITIDA: B001-123` (o la serie-número) y se registra como emitida.

## Por qué el último clic es tuyo
Una boleta emitida no se borra: si sale con un monto o documento equivocado, se corrige con un trámite aparte. Un agente puede equivocarse de campo o de botón. Con revisión humana el costo de un error es una corrección en pantalla, no un comprobante emitido mal.

## Instalación (una vez)
1. Instala la extensión **Claude in Chrome** (disponible en planes de pago; consulta la ayuda de Claude para tu plan).
2. Registra el atajo `/emitir-boleta-sunat` con el contenido de `agent/skills/emitir-boleta-sunat/SKILL.md` (como skill, o guardando ese texto como atajo/slash command; los pasos exactos de la interfaz están en la ayuda de Claude in Chrome).
3. En Ajustes de RestoPOS, completa **RUC** y **razón social**: van en el bloque para que el agente verifique que la sesión es del RUC correcto.

## Seguridad
- **La Clave SOL nunca se la des al agente ni la escribas en el chat.** El atajo le prohíbe pedirla.
- Considera crear en SUNAT un **usuario secundario** con permiso solo para emitir comprobantes (verifica el procedimiento vigente en SUNAT).
- Los agentes de navegador pueden ser engañados por texto malicioso en páginas (inyección de instrucciones). Úsalo solo con el portal de SUNAT en esa ventana, sin otras pestañas sensibles abiertas, y no lo dejes trabajando sin supervisión.
- Revisa si el uso de automatización está permitido por los términos del portal de SUNAT.

## Límites
- Si el login exige captcha o verificación, lo haces tú: el agente espera.
- Si SUNAT cambia sus pantallas, el agente puede preguntar o equivocarse: por eso siempre revisas antes de emitir.
- Solo **boletas**. Facturas y notas de crédito no están cubiertas.
- Consume el uso de tu plan de Claude solo cuando pulsas el atajo (una vez por boleta). No hace falta alternar con otros agentes; si quisieras usar otro agente con navegador, el archivo SKILL.md es texto plano y se puede adaptar, pero no se ha probado con otros.

## Alternativa más robusta
Un proveedor autorizado (PSE/OSE) con API emite sin navegador, sin captcha y sin depender de la pantalla de SUNAT. Cuesta una mensualidad; es la opción a considerar si emites muchas boletas por día.
