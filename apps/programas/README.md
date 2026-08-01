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
| `src/Router.tsx` | `+` ruta `check-in` · `−` `membership-and-billing` |
| `.env.defaults` | Apunta a `api.medplum.com.ar`, documenta el Project |

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

- Portar del fork viejo: `get-care`, `lab-results`, `images`, `info` (~800
  líneas). El check-in ya no hace falta portarlo: ahora lo define el backend.
- Marca: `index.html`, textos de `HomePage` y `LandingPage` siguen diciendo
  FooMedical.
- Las imágenes de stock del upstream son de FooMedical — reemplazar por las del
  Marie Curie.
