# Capa de investigación — hablar con los datos

Cohortes como recursos FHIR y un servidor **MCP** para que un agente LLM consulte
la base sin escribir consultas.

```bash
npm run research:mcp     # requiere credenciales del perfil de investigación
```

## El principio: el modelo no escribe consultas

El agente **elige una herramienta y le pasa parámetros tipados**; el servidor
arma la búsqueda FHIR. No es una limitación técnica, es lo que hace usable el
sistema:

- **Auditable** — cada respuesta trae la consulta exacta que la produjo.
- **Reproducible** — el investigador puede re-correrla a mano y obtener lo mismo.
- **Acotado** — no hay forma de que el agente escape del `AccessPolicy`.

Un LLM que emite FHIR search o SQL libre sobre datos clínicos produce cohortes
sutilmente equivocadas con total seguridad. El problema no es que falle: es que
**falla de forma plausible**. La respuesta no es prompt engineering, es no darle
esa capacidad.

## Herramientas

| Herramienta | Para qué |
|---|---|
| `describir_datos` | Qué se puede preguntar: mediciones (LOINC), diagnósticos (ICD-10), quimioterapia (ATC), scores. **Llamarla primero** — es lo que evita que el modelo invente códigos |
| `buscar_cohorte` | Pacientes que cumplen criterios combinados → ids seudonimizados |
| `distribucion` | n, media, mediana, cuartiles, desvío de una medición |
| `trayectoria` | Serie temporal de una medición para un paciente |
| `caida_fevi` | Detección de CTRCD sobre una lista de pacientes |
| `listar_cohortes` | `Group` y `ResearchStudy` definidos en el proyecto |

`describir_datos` es la pieza que hace que esto funcione: el diccionario de
datos **es** el esquema. Sin ella el modelo adivina que la FEVI es "LVEF" o
"8867-4"; con ella consulta que es LOINC `8806-2` en `%`.

## Seguridad

El servidor se conecta con las credenciales del perfil
**`cardio-onco-researcher`**: sólo lectura y seudonimizado — sin nombre,
contacto, domicilio, identificadores ni texto libre (`note`, `conclusion`,
`presentedForm`). Ver `docs/access-policies.md`.

No expone ninguna herramienta de escritura, y aunque la expusiera el servidor
rechazaría el intento: **un agente no debería poder escribir en la historia
clínica**. La defensa está en el servidor, no en el prompt.

## Honestidad estadística incorporada

Un agente conversacional presenta un n de 4 con la misma seguridad que un n de
400. Por eso las advertencias viajan **con el resultado**, no en la
documentación:

- `n = 0` → "el resultado está vacío, no es un hallazgo negativo"
- `n < 5` → no interpretable y con riesgo de reidentificación; no publicar
- `n < 30` → intervalos amplios, interpretar con cautela
- cobertura < 50% → "el resto no es *normal*, es **dato faltante**"

Esa última importa especialmente acá: en la planilla original, una celda vacía
puede significar cinco cosas distintas (ver `docs/fhir-mapping-cardiotox.md`).
Tratar el dato faltante como normal es el error más fácil de cometer y el más
difícil de detectar en una conclusión.

## Los umbrales son parámetros, no constantes

`caida_fevi` usa por defecto el criterio CTRCD de la guía **ESC 2022** (caída
≥10 puntos absolutos hasta FEVI <50%), pero los expone como parámetros
explícitos. La definición de CTRCD tiene variantes (leve/moderada/grave, con y
sin GLS y biomarcadores) y **el motor no elige el criterio por el
investigador**: lo declara en cada análisis y queda registrado en la respuesta.

Mismo criterio que con SAC: no se hornean decisiones clínicas en el código.

## Denominadores

`caida_fevi` separa `evaluables` de `sinTrayectoria`. Un paciente con una sola
medición de FEVI **no es "sin caída"**: es no evaluable, y meterlo en el
denominador subestima la incidencia. Por eso existe la cohorte
`fevi-seriada` (≥2 mediciones) como denominador válido.

## Cohortes como recursos

`data/core/research-study.json` instala un `ResearchStudy` y tres `Group`:

| Cohorte | Por qué |
|---|---|
| `antraciclinas` (ATC L01DB) | Exposición de mayor riesgo cardiotóxico documentado |
| `anti-her2` (ATC L01FD) | Su cardiotoxicidad suele ser reversible — analizar por separado |
| `fevi-seriada` (≥2 × LOINC 8806-2) | El denominador válido de cualquier análisis de CTRCD |

Son recursos FHIR, no filtros ad-hoc: se versionan, se citan en una publicación
y el agente las descubre con `listar_cohortes`.

## Límites conocidos

**FHIR search no hace joins ni agrega.** "Pacientes con diagnóstico X y droga Y"
son dos consultas cuya intersección se resuelve sobre los ids — así lo hace
`buscar_cohorte`, y por eso devuelve el arreglo de consultas. Para dashboards
con `GROUP BY` sobre miles de pacientes esto no escala: hace falta un **read
model** (vistas materializadas sobre una réplica de lectura) o export a un store
analítico. No intentar resolverlo con más `search`.

**`hiddenFields` no es anonimización.** Reduce la exposición, pero una cohorte
chica con fecha de nacimiento y diagnóstico sigue siendo reidentificable.
Publicar requiere agregación y supresión de celdas chicas — decisión del comité
de ética, no del código.

**Sin verificar contra el servidor.** El MCP no se probó contra
`api.medplum.com.ar` (el entorno de desarrollo no tiene salida a ese host). La
lógica pura (`src/research/cohort.ts`) sí está testeada: 30 tests sobre
estadística, detección de caída de FEVI y traducción de criterios a búsquedas.

## Conectarlo

El servidor es un **proceso local** (stdio): Claude lo ejecuta en la máquina
donde corre. Ver el paso 8 de [`puesta-en-marcha.md`](puesta-en-marcha.md) para
el detalle.

- **Claude Code** — el repo trae `.mcp.json` listo. Exportá
  `MEDPLUM_RESEARCH_CLIENT_ID` y `MEDPLUM_RESEARCH_CLIENT_SECRET` y abrí
  `claude` desde la raíz del repo.
- **Claude Desktop** — `claude_desktop_config.json`, con `cwd` apuntando al repo.
- **Claude Code en la web** — no sirve para este caso: corre en un contenedor
  remoto cuya política de red no llega a `api.medplum.com.ar`.

Usar siempre el `ClientApplication` con `AccessPolicy = cardio-onco-researcher`.
Con las credenciales del perfil clínico el agente vería PHI: **no lo hagas**.
`.mcp.json` está versionado a propósito **sin secretos** — los toma del entorno.
