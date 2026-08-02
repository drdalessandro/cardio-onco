# Puesta en marcha — paso a paso

Secuencia para llevar Cardio-Onco a `api.medplum.com.ar` con los pacientes
reales del Marie Curie.

**Leer esto antes de empezar:** los pasos 0 a 3 no escriben nada. El primer
paso que toca el servidor es el 4, y el primero que toca pacientes reales es el
6. Cada paso tiene una verificación: si no da lo esperado, parar ahí — todos los
pasos son idempotentes y se pueden repetir, pero corregir después de cargar 352
pacientes cuesta mucho más que corregir antes.

---

## Paso 0 — Antes de tocar nada ✅ *resuelto*

- [x] **Residencia de datos** — São Paulo aceptado.
- [x] **Códigos `(verificar)`** — confirmados.
- [x] **DNIs huérfanos** — entran con `--include-orphans`.

### Qué implica incluir los huérfanos

Son **25 pacientes que sólo existen en las hojas seriadas**, y aportan datos
clínicos reales: 162 `Observation`, 26 `Condition`, 13 `RiskAssessment`. La
migración pasa de 327 a **352 pacientes** y de 15.025 a **15.264 recursos**.

Pero entran **sin sexo y sin fecha de nacimiento**, y eso tiene dos
consecuencias que el sistema hace explícitas:

1. **No se les calcula ningún score.** Todas las ecuaciones (PREVENT,
   Framingham, SCORE2, Globorisk) son sexo-específicas. El motor los omite y lo
   registra en el log, en vez de asumir un sexo y devolver un riesgo inventado.
2. **Quedan marcados** con `meta.tag = incomplete-baseline`, así que son
   buscables y excluibles:

   ```
   Patient?_tag=…/cardiotox-record-id|incomplete-baseline
   ```

   En cualquier análisis que dependa de la demografía hay que excluirlos —
   no que se mezclen sin distinción.

> Las **71 filas sin DNI** de Cardiotox se omiten igual: sin clave de join no
> hay a quién colgarles los datos. Si son pacientes reales, hay que corregir el
> DNI en la planilla y re-migrar (es idempotente).

---

## Paso 1 — Project y credenciales

1. Crear (o elegir) el **Project** en `api.medplum.com.ar`. Debe ser el mismo
   para la app clínica y la del paciente: los recursos **no se comparten entre
   Projects**.
2. Dentro de ese Project, crear **dos `ClientApplication`**:

| Client | AccessPolicy | Para qué |
|---|---|---|
| `cardio-onco-admin` | *(sin política — administra)* | Bootstrap y migración |
| `cardio-onco-research` | `cardio-onco-researcher` | El servidor MCP |

> Dos clients separados no es burocracia: el de investigación **no puede
> escribir** aunque alguien se equivoque de credencial.

3. Cargar el de administración en `.env`:

```env
MEDPLUM_BASE_URL="https://api.medplum.com.ar"
MEDPLUM_CLIENT_ID=…
MEDPLUM_CLIENT_SECRET=…
```

`.env` está en `.gitignore` — no se commitea.

**Verificar:** `npm run bootstrap` (sin `--execute`) no debe quejarse de
credenciales.

---

## Paso 2 — Exportar el libro a CSV

Desde Google Sheets, **Archivo → Descargar → CSV** por cada hoja:

| Hoja | Archivo |
|---|---|
| Cardiotox | `cardiotox.csv` |
| Ecocardiogramas control | `eco.csv` |
| Estudios Complementarios | `ecg.csv` |
| QT cardiotox | `qt.csv` |
| FRCV | `frcv.csv` |

**Verificar:** que el DNI salga como **número entero**, no como `10547059.0`.
El migrador lo normaliza igual (`dniValue`), pero conviene mirarlo: el DNI es la
clave de join.

---

## Paso 3 — `--inspect` (no escribe nada)

```bash
npx tsx src/cardiotox-mapping/migration/migrate.ts cardiotox.csv \
  --echo eco.csv --ecg ecg.csv --qt qt.csv --frcv frcv.csv \
  --include-orphans --inspect
```

**Verificar:**
- `Pacientes: 352` con `--include-orphans` (327 con registro basal + 25
  huérfanos), o el número que corresponda al export del día
- La lista **SIN MAPEAR** sólo debería tener `ultimo control`, `PROXIMO CONTROL`
  y `Uso`. Cualquier columna nueva ahí es un alias que falta agregar — **no un
  dato para descartar**.

Si aparecen columnas nuevas, pasámelas y las cierro antes de seguir.

---

## Paso 4 — Bootstrap del Project ⚠️ *primer paso que escribe*

```bash
npm run build:bots          # genera el bundle de bots
npm run bootstrap           # dry-run: qué instalaría
npm run bootstrap -- --execute
```

Instala, en orden: **AccessPolicy** → terminologías → tipos de encuentro →
cuestionarios → check-in → estudio y cohortes → bots y subscriptions.

**Verificar:**
- Antes de escribir imprime **`Project destino: <nombre> (id …)`** — confirmá
  que es el correcto.
- Al terminar: `✓ 8 paso(s) OK · ✗ 0 con error`.

---

## Paso 5 — Activar la política del paciente 🔒 *el control crítico*

En la consola de administración de Medplum:

1. **`cardio-onco-patient` → default patient access policy del Project.**
2. Asignar `cardio-onco-clinician` a los `ProjectMembership` del equipo.

> El registro de pacientes es **abierto**. Sin la política como default, un
> paciente que se registra entra **sin restricciones**.

### Prueba de intrusión (no es opcional)

1. Registrar dos pacientes de prueba, A y B.
2. Cargar una `Observation` para B y anotar su id.
3. Con la sesión de **A**, pedir `GET /fhir/R4/Observation/<id-de-B>`.

**Debe devolver 403.** Si devuelve el recurso, **parar acá**: la política no
está activa y cargar pacientes reales expondría datos entre ellos.

También probar `GET /fhir/R4/Patient` como A: debe devolver **sólo A**.

---

## Paso 6 — Migración de prueba ⚠️ *primeros datos reales*

```bash
npx tsx src/cardiotox-mapping/migration/migrate.ts cardiotox.csv \
  --echo eco.csv --ecg ecg.csv --qt qt.csv --frcv frcv.csv \
  --include-orphans --limit 5 --execute
```

**Verificar en Medplum, sobre esos 5 pacientes:**

- [ ] 5 `Patient`, cada uno con `identifier` de DNI
- [ ] La **serie de FEVI**: varias `Observation` con LOINC `8806-2` y
      `effectiveDateTime` distintos — no una sola
- [ ] `Condition` con ICD-10 **y** SNOMED
- [ ] `MedicationStatement` con ATC (`L01DB` en quien recibió antraciclinas)
- [ ] `RiskAssessment` con `risk-source = manual` en los scores cargados a mano
- [ ] Si cae algún huérfano en los primeros 5: sin `gender` ni `birthDate`, con
      `meta.tag = incomplete-baseline` y **sin** `RiskAssessment` calculado
- [ ] **Correr el comando de nuevo**: los conteos **no deben cambiar**. Es
      idempotente (PUT por identifier); si algo se duplica, parar.

Si hay que corregir el mapeo: se corrige y se vuelve a correr. Re-migrar
actualiza, no duplica.

---

## Paso 7 — Migración completa

```bash
npx tsx src/cardiotox-mapping/migration/migrate.ts cardiotox.csv \
  --echo eco.csv --ecg ecg.csv --qt qt.csv --frcv frcv.csv \
  --include-orphans --execute
```

Esperado: **352 pacientes · ~15.264 recursos**, progreso cada 25.

**Verificar:**
- `✓ 352 OK · ✗ 0 con error`. Si hay errores, los lista por paciente — se
  corrigen y se re-corre sólo eso.
- `Patient?_tag=…|incomplete-baseline` debe devolver **25**.

---

## Paso 8 — El agente investigador

Cargar el client de investigación en la config de Claude Code:

```json
{
  "mcpServers": {
    "cardio-onco-research": {
      "command": "npx",
      "args": ["tsx", "src/research/mcp-server.ts"],
      "cwd": "/ruta/al/repo/cardio-onco",
      "env": {
        "MEDPLUM_CLIENT_ID": "<el de cardio-onco-research>",
        "MEDPLUM_CLIENT_SECRET": "…"
      }
    }
  }
}
```

Probar suelto primero:

```bash
MEDPLUM_CLIENT_ID=… MEDPLUM_CLIENT_SECRET=… npm run research:mcp
```

Debe imprimir `[research-mcp] conectado … (sólo lectura)`.

### La primera pregunta real

> «¿Cuántos pacientes recibieron antraciclinas y cuántos de ellos tuvieron
> caída de FEVI según criterio ESC 2022?»

El agente debería: llamar `describir_datos` → `buscar_cohorte`
(`farmacos: ['L01DB']`) → `caida_fevi` sobre esos ids.

**Cómo saber si la respuesta sirve.** Tiene que traer:

1. **Las consultas ejecutadas** — reproducibles a mano.
2. **El denominador separado**: `evaluables` vs `sinTrayectoria`. Los que tienen
   una sola FEVI **no son "sin caída"**, son no evaluables.
3. **El criterio explícito**: «caída ≥10 puntos y FEVI final <50%».
4. **Las advertencias** si el n es chico o falta cobertura.

Si contesta un número pelado sin nada de esto, algo salió mal: el valor de esta
capa es que **no se puede dar una respuesta sin procedencia**.

### Preguntas de control

Antes de creerle nada, verificar contra algo conocido:

- «Distribución de FEVI basal en toda la cohorte» → la mediana debería caer en
  un rango fisiológico (~60%). Si da 12 o 200, hay un problema de unidades.
- «Trayectoria de FEVI del paciente `<id>`» → contrastar con la planilla
  original de ese paciente.

> **Al analizar, acordate de los 25 huérfanos.** Tienen FEVI seriada (sirven
> para incidencia de CTRCD) pero no tienen edad ni sexo: cualquier análisis
> ajustado por demografía debe excluirlos con el tag `incomplete-baseline`.

---

## Después

- Desplegar la app clínica (`npm run build`) y la del paciente
  (`apps/programas/setup.sh`).
- `MEDPLUM_PROJECT_ID` de Programas = **el mismo Project**.
- Recién ahí sumar el primer paciente real al circuito de autorreporte.

## Si algo sale mal

| Síntoma | Causa probable |
|---|---|
| `403` al hacer bootstrap | El client no tiene permisos de administración |
| Se instaló en el Project equivocado | El `ClientApplication` era de otro Project — revisar el destino que imprime |
| Columnas nuevas en SIN MAPEAR | La planilla cambió: agregar alias antes de migrar |
| Trayectorias vacías en el front | Divergencia de códigos LOINC — corre `npm test`, hay un test que lo detecta |
| El agente responde sin procedencia | No está usando las herramientas del MCP |
