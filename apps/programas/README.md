# Programas — app del paciente (re-fork de FooMedical)

App con la que el paciente carga sus datos, reconstruida desde **FooMedical
5.1.27** en vez de seguir el fork viejo.

```bash
./setup.sh                 # clona el upstream y aplica el overlay
cd ../../../programas-cardio-onco
npm install && npm run dev
```

## Por qué re-forkear y no actualizar el fork

| | Fork anterior (`EPA-Bienestar-com/programas`) | Upstream 5.1.27 |
|---|---|---|
| Medplum | **0.9.33** | **5.1.27** |
| UI | Tailwind | **Mantine 8** — igual que cardio-onco |
| React / Vite | — | 19 / 8 |
| Configuración | hardcodeada en `src/config.ts` | **`import.meta.env`** |

Entre 0.9 y 5.1 hubo **reescritura completa de UI** (Tailwind → Mantine): un
upgrade in-place obliga a reescribir cada componente igual, y encima arrastra el
fork viejo. El trabajo propio del fork eran ~1.300 líneas (check-in 433,
get-care 201, lab-results 226, images 183, info 175, observation 49) — se porta
en días.

Dos cosas se arreglan solas al re-forkear: el **hardcodeo** (upstream ya es
env-driven, así que apuntarlo a `api.medplum.com.ar` es una variable) y la
divergencia de stack con cardio-onco (ambos pasan a Mantine 8 + React 19).

## Overlay, no vendorizado

`setup.sh` clona el upstream y copia encima `overlay/`. El upstream queda como
remoto `upstream`, así que actualizar Medplum es `git pull upstream main`.

**El fork anterior se pudrió en 0.9.33 precisamente porque divergió.** Mantener
el delta chico y explícito es lo que evita repetirlo. Tampoco se vendorizan los
2,5 MB de fotos de stock de FooMedical, que no sirven para el Marie Curie.

| Archivo del overlay | Qué cambia |
|---|---|
| `src/pages/CheckInPage.tsx` | Check-in cardio-oncológico (nuevo) |
| `src/pages/MyAppointmentsPage.tsx` | Mis turnos — el upstream sólo permite **reservar**, no lista los que ya tenés |
| `src/pages/info/articles.ts` | 6 artículos de educación al paciente (**copiado textual** del fork) |
| `src/pages/info/InfoPage.tsx` | Índice y lectura de artículos (Tailwind → Mantine) |
| `src/pages/health-record/Measurement.data.ts` | Catálogo en castellano + FEVI, NT-proBNP, troponinas |
| `src/pages/health-record/Measurement.tsx` | Series múltiples por código, no por `component[]` (ver abajo) |
| `src/pages/health-record/Vitals.tsx` | Índice navegable de trayectorias |
| `src/Router.tsx` | `+` `check-in`, `mis-turnos`, `info` · `−` `membership-and-billing` |
| `.env.defaults` | Apunta a `api.medplum.com.ar`, documenta el Project |

## Páginas portadas del fork anterior

`EchoMeasurement.tsx` y `LabMeasurement.tsx` (~250 líneas con el LOINC
hardcodeado adentro) **no se portaron como páginas**: la página genérica
`Measurement.tsx` del upstream ya grafica cualquier entrada del catálogo, así
que FEVI, NT-proBNP y troponinas son ahora *datos*. Agregar una medición es
agregar un objeto a `Measurement.data.ts`.

Los artículos de `info/` se copiaron **textuales**: están adaptados de las guías
ESC/SEC de cardio-oncología para pacientes y reescribirlos sería una decisión
clínica, no técnica.

### Por qué `Measurement.tsx` se sobrescribe

Cuando una medición tiene más de una serie, el upstream busca **un** Observation
panel y lee `obs.component[i]` — así modela la presión arterial. Este backend
escribe **una Observation por medición**: sistólica y diastólica son recursos
separados, igual que troponina I y T, porque es lo que dice el mapeo FHIR del
proyecto y lo que producen el migrador y el check-in.

Con la lógica del upstream, la presión arterial mostraría un gráfico vacío y la
troponina rompería al leer `component[0]`. El overlay consulta cada serie por su
propio código y alinea las fechas entre series.

> Este desajuste lo encontró un test, no una prueba manual:
> `src/cardiotox-mapping/front-catalog-consistency.test.ts` (en el repo
> cardio-onco) verifica que **todo código LOINC del catálogo del front exista en
> el diccionario del backend**. Si divergen, la trayectoria queda vacía sin
> ningún error visible. También detectó que faltaba hs-cTnT (`67151-1`) en el
> diccionario.

`setup.sh` además borra `MembershipAndBilling.tsx`: la facturación viene
heredada de FooMedical, no aplica a un hospital público, y su recurso
(`PaymentNotice`) no está en la AccessPolicy del paciente — la página daría 403.

## El check-in no sabe qué pregunta

Es el punto del enfoque backend-first. `CheckInPage.tsx` no declara ni una
pregunta: resuelve el `Questionnaire` del servidor y lo renderiza.

```
data/core/questionnaire-checkin-cardio-onco.json   ← el significado clínico
        ↓ (el front sólo lo renderiza)
    QuestionnaireForm
        ↓
    QuestionnaireResponse
        ↓ checkin-to-observations-bot   ← usa los códigos del recurso
    Observation (LOINC 8480-6, 72166-2, …)
        ↓ subscription de scores
    RiskAssessment  →  lo ve el equipo clínico
```

**Agregar una pregunta al check-in es editar un recurso en el servidor**: no se
toca esta app ni se redeploya. El mismo check-in en el fork viejo eran 433
líneas de React.

`CheckInPage` completa dos campos que el bot necesita y que `QuestionnaireForm`
no pone: `subject` (de quién es cada Observation) y `questionnaire` (para
resolver los códigos).

## Requisitos del backend

1. `npm run bootstrap -- --execute` en el repo cardio-onco — instala las
   AccessPolicy y el `Questionnaire` del check-in.
2. `MEDPLUM_PROJECT_ID` debe ser **el mismo Project que cardio-onco**. Los
   recursos no se comparten entre Projects: en otro Project, el equipo clínico
   nunca vería lo que carga el paciente.
3. `cardio-onco-patient` marcada como **default patient access policy**. El
   registro es abierto; sin eso un paciente nuevo entra sin restricciones. Ver
   `docs/access-policies.md`.

## Pendiente

- **Marca**: `index.html` y los textos de `HomePage` / `LandingPage` siguen
  diciendo FooMedical.
- **Imágenes**: las del upstream son fotos de stock de FooMedical — reemplazar
  por las del Marie Curie.
- **PDF de la guía**: `articles.ts` enlaza a
  `/guia-esc-cardio-oncologia-pacientes.pdf`; copiar el archivo a `public/`
  desde el repo del fork anterior o el link queda roto.
- **Navegación**: agregar `check-in`, `mis-turnos` e `info` al menú (hoy las
  rutas existen pero no hay entrada de menú).
