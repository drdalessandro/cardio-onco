# Mapeo FHIR R4 — Tabla **Cardiotox** (160 campos)

> Proyecto **Favaloro | Medplum Argentina** · Servidor FHIR R4 Medplum en `https://api.medplum.com.ar`
> Plataforma Cardio-Onco · Guías ESC 2022 de Cardio-Oncología
>
> **Estado:** especificación v0.1 — pendiente de validación clínica antes de implementar los cálculos de riesgo.

---

## Reglas de diseño (innegociables)

1. **Todo es interoperable — FHIR R4.** Cada dato de la tabla se persiste como un recurso FHIR estándar, nunca como una columna propietaria.
2. **El dato se adapta al estándar FHIR, no el estándar al formato de la tabla.** En consecuencia:
   - Los campos **calculados/derivados NO se almacenan** como tales: se derivan en lectura (`Edad` ← `Patient.birthDate`; `Día en estudio` ← `EpisodeOfCare.period.start`; `IMC` se almacena solo como `Observation` estándar 39156-5 porque LOINC lo contempla).
   - Donde existe un código estándar (LOINC, SNOMED CT, ICD-10, RxNorm/ATC, UCUM) se usa ese código.
   - Donde **no** existe código universal (algoritmos de score, algunas mediciones eco/ECG argentinas), se usa un **CodeSystem local** bajo `https://api.epa-bienestar.com.ar/fhir/CodeSystem/...`, siempre dentro de una estructura FHIR estándar. Estos están marcados `LOCAL`.
   - Códigos LOINC/SNOMED que requieren confirmación de un terminólogo están marcados `(verificar)`.

---

## Recursos FHIR utilizados

| Recurso FHIR | Para qué |
|---|---|
| **Patient** | Identidad, sexo, nacimiento, contacto, fallecimiento |
| **Coverage** | Cobertura / obra social, capacidad de compra de medicación |
| **EpisodeOfCare** | El seguimiento cardio-oncológico (inicio, estado, día en estudio) |
| **Condition** | Antecedentes y diagnósticos (ICD-10 / SNOMED): HTA, DBT, IC, IAM, FA, cáncer, etc. |
| **Observation** | Toda medición: antropometría, signos vitales, eco, ECG, laboratorio, estadios, clases funcionales |
| **DiagnosticReport** | Agrupa Observations de un estudio (Ecocardiograma, ECG, SPECT, Eco-Doppler vascular, serología) |
| **Procedure** | Radioterapia, ATC, CRM, procedimientos |
| **MedicationStatement / MedicationAdministration** | Esquemas de quimioterapia y dosis acumuladas; medicación cardiovascular |
| **FamilyMemberHistory** | Antecedentes heredofamiliares (AHF) |
| **RiskAssessment** | **Todos los scores de riesgo**: PREVENT, SAC, ESC, OPS, Framingham, HFA-ICOS |
| **CarePlan / Task** | Protocolo de vigilancia por estrato (ya implementado) |
| **Appointment** | Último control / próximo control |

---

## 1. Patient — Datos personales e identificación

| Campo tabla | Recurso · path | Sistema · código | Notas |
|---|---|---|---|
| `Nombre` | `Patient.name[0].given` | — | — |
| `Apellido` | `Patient.name[0].family` | — | — |
| `DNI` | `Patient.identifier` | system `https://www.argentina.gob.ar/dni` · `use: official` | Identificador nacional AR |
| `F` | `Patient.identifier` | system `.../CodeSystem/cardiotox-record-id` `LOCAL` · `use: secondary` | Nº de ficha/fila de la tabla origen (trazabilidad de migración) |
| `Sexo` | `Patient.gender` | `male` \| `female` \| `other` \| `unknown` | Sexo administrativo. Para scores se usa sexo biológico → ver `Observation` 76689-9 si difiere |
| `Edad` | **derivado** de `Patient.birthDate` | — | **NO se almacena.** Se carga `birthDate`; la edad se calcula |
| `Telefono` | `Patient.telecom[].value` (`system: phone`) | — | — |
| `Estado paciente` | `Patient.active` (+ `Flag` si requiere semántica clínica) | — | Activo/inactivo administrativo |
| `Muerte` | `Patient.deceasedBoolean` / `deceasedDateTime` | — | — |
| `Causa CV` | `Observation` (causa de muerte) | LOINC `79378-6` "Cause of death" + valor SNOMED CV `(verificar)` | Alternativa: `Condition` con `Observation` de causa. Booleano "causa CV" → `valueCodeableConcept` |

---

## 2. EpisodeOfCare — Seguimiento

| Campo tabla | Recurso · path | Sistema · código | Notas |
|---|---|---|---|
| `Inicio seguimiento` | `EpisodeOfCare.period.start` | — | Fecha de ingreso al programa cardio-onco |
| `Estado seguimiento` | `EpisodeOfCare.status` | `planned\|active\|onhold\|finished\|cancelled` | Mapear estados de la tabla a este value set |
| `Día en estudio` | **derivado** = `today − period.start` | — | **NO se almacena** |
| `ultimo control` | `Appointment` (status `fulfilled`) o `Encounter` previo | — | — |
| `PROXIMO CONTROL` | `Appointment` (status `booked`) | — | — |
| `CON QT Y SEG`, `Completo QT`, `RT y control` | `EpisodeOfCare.statusHistory` / `CarePlan.activity[].detail.status` | — | Hitos del tratamiento; modelar como estado de actividades del CarePlan |

`EpisodeOfCare.type` = `LOCAL .../episode-type#cardio-oncology-followup`. `EpisodeOfCare.diagnosis` referencia la `Condition` del cáncer.

---

## 3. Observation — Antropometría y signos vitales

Categoría `vital-signs`. Unidades en **UCUM**.

| Campo tabla | LOINC | UCUM | Notas |
|---|---|---|---|
| `Peso (kg)` | `29463-7` Body weight | `kg` | — |
| `Peso minimo` | `29463-7` + `Observation.component`/extensión o `valueQuantity` con `Observation.code` LOCAL `peso-minimo` | `kg` | Peso mínimo registrado en seguimiento (relevante en caquexia oncológica) |
| `Altura (m)` | `8302-2` Body height | `m` (o `cm`) | — |
| `IMC` | `39156-5` BMI | `kg/m2` | Derivado pero LOINC lo estandariza → se persiste como Observation |
| `Peri Abd (cm)` / `Peri abd (mts)` | `8280-0` Waist circumference | `cm` | Unificar a `cm`. No duplicar campo m/cm |
| `Indice cintura/altura` | `LOCAL .../waist-height-ratio` `(no hay LOINC)` | `{ratio}` | Derivable de 8280-0 ÷ 8302-2 |
| `TAS` | `8480-6` Systolic BP (componente del panel `85354-9`) | `mm[Hg]` | TA sistólica. Diastólica → `8462-4` si se agrega |

---

## 4. Observation — Ecocardiograma

Agrupadas en un `DiagnosticReport` (LOINC `59063-1` "US Cardiac study") con categoría `imaging`; cada parámetro es una `Observation` miembro.

| Campo tabla | LOINC / código | UCUM | Notas |
|---|---|---|---|
| `FEY` | `8806-2` LV Ejection fraction | `%` | FEVI. Código ya usado en la app |
| `MAPSE` | `LOCAL .../mapse` `(no LOINC claro)` | `mm` | Excursión sistólica del plano del anillo mitral |
| `IMVI` | `90049-4` LV mass index `(verificar)` | `g/m2` | Índice de masa VI |
| `EPR` | `LOCAL .../relative-wall-thickness` | `{ratio}` | Espesor parietal relativo |
| `Trastornos motildad` | `Observation` `valueCodeableConcept` SNOMED `(verificar)` | — | Trastornos de motilidad segmentaria |
| `área AI` | `LOCAL .../left-atrial-area` | `cm2` | Área aurícula izquierda |
| `Vol AI` | `90069-2` LA volume `(verificar)` o LOCAL | `mL` | Volumen AI (idealmente indexado) |
| `Vel IT` | `LOCAL .../tricuspid-regurg-velocity` | `m/s` | Velocidad de insuficiencia tricuspídea |
| `PSAP` | `8403-8` Pulmonary artery systolic pressure `(verificar)` | `mm[Hg]` | PSAP estimada |
| `Patrón de relajación` | `Observation` `valueCodeableConcept` | — | Patrón de llenado diastólico |
| `É` (e') | `LOCAL .../tissue-doppler-e-prime` | `cm/s` | Onda e' tisular |
| `E/É` (E/e') | `LOCAL .../e-over-e-prime` | `{ratio}` | — |
| `S Lat` | `LOCAL .../tissue-doppler-s-lateral` | `cm/s` | Onda S' lateral |
| `Disf Diasto` | `Observation` `valueCodeableConcept` SNOMED `(verificar)` | — | Grado de disfunción diastólica |
| `Valvulopatia leve/moderada/severa/grave` | `Condition` (ICD-10 `I34–I39`) + `Observation` severidad | — | Una `Condition` por válvula con severidad como `Observation` o `Condition.severity` |
| `Derrame pericardico` | `Condition` SNOMED `373945007` / ICD-10 `I31.3` + `Observation` cuantía | — | — |

---

## 5. Observation — Electrocardiograma (ECG)

`DiagnosticReport` LOINC `11524-6` "EKG study"; miembros:

| Campo tabla | LOINC / código | UCUM | Notas |
|---|---|---|---|
| `RS` (ritmo sinusal) | `LOCAL .../cardiac-rhythm` valueCodeableConcept SNOMED `251150004` | — | Ritmo |
| `FA` (ECG) | `Condition` ICD-10 `I48.91` SNOMED `49436004` | — | Fibrilación auricular |
| `AA` (aleteo) | `Condition` ICD-10 `I48.92` | — | Aleteo auricular |
| `PR (mseg)` | `8625-6` P-R interval | `ms` | — |
| `QRS` | `8633-0` QRS duration | `ms` | — |
| `QT (mseg)` | `8634-8` QT interval | `ms` | — |
| `QTc` | `8636-3` QTc interval | `ms` | — |
| `FC` | `8867-4` Heart rate | `/min` | — |
| `QTC >480` | **derivado** de `8636-3` con `interpretation` H | — | Booleano de la tabla → no se almacena; se evalúa el umbral |
| `Trast rep` | `Observation` valueCodeableConcept | — | Trastorno de repolarización |
| `Trast conduc` | `Observation` valueCodeableConcept | — | Trastorno de conducción |
| `BAV` | `Condition` ICD-10 `I44.x` | — | Bloqueo AV (grado) |
| `Q pat` | `Observation` valueCodeableConcept SNOMED `164865005` | — | Onda Q patológica |

---

## 6. Observation — Laboratorio

Categoría `laboratory`. Unidades UCUM (ajustar según informe del laboratorio).

| Campo tabla | LOINC | UCUM | Notas |
|---|---|---|---|
| `Trop inicial` / `Trop Seguimiento` | `89579-7` Troponin I.cardiac (hs) | `ng/L` | Usar el LOINC del ensayo real (hs-TnT `67151-1`). Inicial vs seguimiento se distinguen por `effectiveDateTime`, no por código |
| `Pro BNP basal` / `ProBNP seguimiento` | `33762-6` NT-proBNP | `pg/mL` | Basal vs seguimiento → fecha |
| `Cr` | `2160-0` Creatinine | `mg/dL` | — |
| `HB` | `718-7` Hemoglobin | `g/dL` | — |
| `Col T` | `2093-3` Cholesterol total | `mg/dL` | Input PREVENT/Framingham |
| `HDL` | `2085-9` HDL cholesterol | `mg/dL` | Input PREVENT/Framingham |
| `LDL` | `13457-7` LDL (calc) | `mg/dL` | — |
| `Trig` | `2571-8` Triglycerides | `mg/dL` | — |
| `LPa` | `10835-7` Lipoprotein(a) mass | `mg/dL` | Modificador de riesgo PREVENT |
| `HbA1c` | `4548-4` HbA1c | `%` | — |
| `eritro` | `30341-2` ESR | `mm/h` | Eritrosedimentación |
| `Glu` | `2345-7` Glucose | `mg/dL` | — |
| `Clcr cal` | `98979-8` eGFR CKD-EPI 2021 `(verificar)` | `mL/min/{1.73_m2}` | Función renal — input PREVENT |
| `Microalb` | `14957-5` Microalbumin (orina) | `mg/L` | Considerar `14959-1` ACR |

---

## 7. Eco-Doppler vascular, perfusión y serología

| Campo tabla | Recurso · código | Notas |
|---|---|---|
| `SPECT normal` / `SPECT patológico` | `DiagnosticReport` LOINC `39184-9` perfusión miocárdica + `Observation` conclusión | Booleanos → `Observation.valueCodeableConcept` normal/anormal |
| `Fey Radiocardiograma` | `Observation` `LOCAL .../lvef-muga` o LOINC `(verificar)` `%` | FEVI por radiocardiograma/MUGA |
| `EMI normal` / `EMI aumentado` | `Observation` `LOCAL .../carotid-imt` `mm` | Espesor mio-intimal carotídeo |
| `Ateromatosis leve/significativa`, `Carótidas ateromatosas` | `Observation`/`Condition` placa carotídea SNOMED `(verificar)` | Eco-Doppler de vasos de cuello |
| `Femorales normales/ateromatosas` | `Observation`/`Condition` ateromatosis femoral | — |
| `HAI`, `ELISA`, `Anticuerpos`, `IFI` | `DiagnosticReport` serología **Chagas** + `Observation` por técnica | HAI `LOINC 16949-2 (verificar)`, ELISA T. cruzi, IFI. Relevante en cardiopatía chagásica AR |
| `Total` | revisar semántica con clínico | Probable total/score agregado — no mapear hasta confirmar |

---

## 8. Condition — Factores de riesgo y antecedentes

Una `Condition` por antecedente. `clinicalStatus`, `verificationStatus`, categoría `problem-list-item`. Los booleanos de la tabla = **presencia/ausencia** de la Condition.

| Campo tabla | ICD-10 | SNOMED | Notas |
|---|---|---|---|
| `HTA` | `I10` | `38341003` | Hipertensión |
| `Dx reciente HTA` / `HTA controlada` | `I10` + `Condition.onset` reciente + `Observation` control | — | "Reciente" → `onsetDateTime`; "controlada" → `Observation`/`Goal` |
| `DBT` / `Dx reciente DBT` | `E11.9` | `44054006` | — |
| `TBQ` (fumador) | `Observation` `72166-2` Tobacco smoking status | SNOMED `77176002` current | **Observation**, no Condition (US Core) |
| `EX TBQ` | `Observation` `72166-2` valor `8517006` former smoker | — | Misma Observation, valor distinto |
| `Obesidad` | `E66.9` | `414916001` | También evaluable por IMC ≥30 |
| `DLP` / `Dx reciente DLP` / `DLP controlada` | `E78.5` | `370992007` | — |
| `DBT`/`DLP` controladas | `Goal` + `Observation` de control | — | Estado de control → `Goal.achievementStatus` |
| `AHF` | `FamilyMemberHistory` | — | Antecedentes heredofamiliares (no es Condition del paciente) |
| `SDT` (sedentarismo) | `Observation` `LOCAL` o SNOMED `415510005` | — | Confirmar significado de `SDT` con clínico |
| `Drogas de abuso` | `Z72.2` / `Condition` SNOMED `(verificar)` | — | — |
| `IC FEy pre` (IC FE preservada) | `I50.31/I50.32` | `446221000` HFpEF | — |
| `IC FEy red` (IC FE reducida) | `I50.21/I50.22` | `703272007` HFrEF | — |
| `Valvulopatia grave` | `I34–I39` | — | Ver §4 |
| `IAM/ cardipatia isq` | `I21` / `I25.x` | `22298006` / `414545008` | Distinguir IAM agudo vs cardiopatía isquémica crónica |
| `ACV` | `I63.9` | `230690007` | — |
| `Enfer arterial` (EAP) | `I73.9` | `399957001` | — |
| `HP` (hipertensión pulmonar) | `I27.20` | `70995007` | — |
| `Trombosis arterial` | `I74.x` | — | — |
| `TVP TEP` | `I82.4` / `I26.x` | — | — |
| `FA/AA` | `I48.x` | `49436004` | Antecedente de FA/aleteo |
| `Arritmia ventricular` | `I47.2` | — | — |
| `Otra arritmia` | `I49.x` | — | — |
| `Diagnostico reciente cardiopatia isquemica` | `I25.x` + `onset` reciente | — | — |
| `Quimio o RT previa` | `Procedure` (historial) / `Condition` Z92.2/Z92.3 | — | Exposición previa — input de riesgo |

---

## 9. Procedure — Procedimientos y radioterapia

| Campo tabla | Recurso · código | Notas |
|---|---|---|
| `ATC` | `Procedure` SNOMED `415070008` (PCI) / ICD-10-PCS | Angioplastia coronaria |
| `CRM` | `Procedure` SNOMED `232717009` CABG | Cirugía de revascularización miocárdica |
| `Tx izquierdo` | `Procedure` radioterapia (SNOMED `108290001`) + `bodySite` mama/torácica izquierda | RT de mama/pared torácica izquierda — alto riesgo cardíaco |
| `Mediastino` | `Procedure` radioterapia + `bodySite` mediastino | RT mediastinal — input de riesgo CTRCD |

---

## 10. Medication* — Quimioterapia y medicación cardiovascular

Cada familia citostática = `MedicationStatement` (o `MedicationAdministration` con dosis). El campo booleano de familia + su `Tipo` se modelan en **un** recurso: la familia como categoría y el `Tipo` como `medicationCodeableConcept` (RxNorm/ATC).

| Campo tabla (familia + tipo) | Medication code (ATC) | Notas |
|---|---|---|
| `Antraciclinas` + `Tipo de Antraciclina` | ATC `L01DB` (doxorrubicina `L01DB01`, epirrubicina `L01DB03`…) | — |
| `Dosis acu Antra` | `Observation` `LOCAL .../cumulative-anthracycline-dose` `mg/m2` **+** `MedicationStatement.dosage` | **Dato crítico de cardiotoxicidad.** Equivalente doxorrubicina |
| `Taxanos` + `Tipo` | ATC `L01CD` | — |
| `Alcaloides Vinca` + `Tipo` | ATC `L01CA` | — |
| `Monoclonales` + `Tipo` | ATC `L01FD` (trastuzumab `L01FD01`), bevacizumab `L01FG01` | Anti-HER2 / anti-VEGF |
| `Antimetabolitos` + `Tipo` | ATC `L01B` (5-FU, capecitabina) | Riesgo isquémico |
| `Alquilantes` + `Tipo` | ATC `L01A` (ciclofosfamida) | — |
| `Inhibidores quinasa` + `Tipo` | ATC `L01E` (VEGFR-TKI) | — |
| `Inh check point` + `Tipo` | ATC `L01FF` (nivolumab, pembrolizumab) | Miocarditis por ICI |
| `otros` | `MedicationStatement` texto/código | — |
| `Toma anti HTA` | `MedicationStatement` ATC `C02/C03/C07/C08/C09` | Booleano de la tabla → existencia del MedicationStatement. **Input PREVENT (tratamiento antihipertensivo)** |
| `Toma Antilipidicos` | `MedicationStatement` ATC `C10` (estatinas) | — |

---

## 11. Condition — Cáncer y evolución oncológica

| Campo tabla | Recurso · código | Notas |
|---|---|---|
| `Tipo de cancer` | `Condition` ICD-10 `C00–C97` (+ ICD-O-3 morfología) | Diagnóstico oncológico primario; referenciado por `EpisodeOfCare.diagnosis` |
| `Estadio` | `Observation` estadio TNM (LOINC `21908-9` Stage group) o `Condition.stage` | — |
| `Grupo` / `Sub grupo` | `Condition.stage` adicional / extensión clínica | Confirmar taxonomía con oncología |

---

## 12. Coverage — Cobertura y aspectos sociales

| Campo tabla | Recurso · path | Notas |
|---|---|---|
| `Cobertura` | `Coverage.payor` / `Coverage.type` | Obra social / prepaga / público |
| `Puede Comprar med` | `Observation` determinante social `LOCAL` o SDOH | Capacidad de adquirir medicación — afecta adherencia |

---

## 13. RiskAssessment — Scores de riesgo (el núcleo del objetivo)

**Todos** los scores se modelan como `RiskAssessment` (mismo patrón ya usado por HFA-ICOS). No se inventan columnas: el resultado vive en un recurso estándar y trazable.

Estructura común:

```jsonc
{
  "resourceType": "RiskAssessment",
  "status": "final",
  "subject": { "reference": "Patient/..." },
  "occurrenceDateTime": "2026-06-24T...",
  "method": {                                  // identifica el algoritmo
    "coding": [{ "system": ".../CodeSystem/risk-score-method", "code": "PREVENT-AHA-2023" }]
  },
  "basis": [                                   // ⬅ trazabilidad: Observations/Conditions de entrada
    { "reference": "Observation/<colesterol>" },
    { "reference": "Observation/<TAS>" },
    { "reference": "Observation/<eGFR>" }
  ],
  "prediction": [{
    "outcome": { "text": "Riesgo CV total a 10 años" },
    "probabilityDecimal": 7.8,                 // % calculado
    "qualitativeRisk": {                       // categoría
      "coding": [{ "system": "http://terminology.hl7.org/CodeSystem/risk-probability", "code": "moderate" }]
    },
    "whenRange": { "high": { "value": 10, "unit": "a" } }
  }]
}
```

### CodeSystem local de métodos — `.../CodeSystem/risk-score-method`

| Campo(s) tabla | `method.code` | Algoritmo | Categorías (de la tabla) |
|---|---|---|---|
| `PREVENT...`, `Prevent calculado` | `PREVENT-AHA-2023` | **AHA PREVENT 2023 — modelo completo** (riesgo CV total a 10 **y 30** años) | bajo <5 · intermedio 5–7.5 · moderado 7.5–10 · alto >10 |
| `SAC`, `SAC calculado` | `SAC` | Score Sociedad Argentina de Cardiología | bajo/moderado/alto |
| `ESC` | `ESC-SCORE2` | ESC SCORE2 / SCORE2-OP | bajo/moderado/alto/muy alto |
| `OPS`, `OPS calculado` | `OPS-PAHO` | Tablas OPS/OMS región AMR | por categoría |
| `Framingham`, `Framingham calculado` | `FRAMINGHAM` | Framingham Risk Score | por categoría |
| (HFA-ICOS ya existe) | `HFA-ICOS-ESC-2022` | CTRCD ESC 2022 | low/moderate/high/very-high |

> **Doble columna `X` / `X calculado`:** la tabla guarda el valor cargado a mano **y** el calculado. En FHIR ambos son `RiskAssessment` del mismo `method`; se distinguen por `RiskAssessment.performer` (humano vs Bot) y/o una extensión `.../risk-source = manual|computed`. El cálculo automático lo produce un **Bot Medplum** a partir del `basis`.

### Inputs que cada score consume (mapeo → Observations/Conditions ya definidos)

| Input clínico | Origen FHIR | PREVENT | SAC | ESC SCORE2 | Framingham |
|---|---|:--:|:--:|:--:|:--:|
| Edad | `Patient.birthDate` | ✓ | ✓ | ✓ | ✓ |
| Sexo | `Patient.gender` | ✓ | ✓ | ✓ | ✓ |
| Colesterol total | Obs `2093-3` | ✓ | ✓ | ✓ (no-HDL) | ✓ |
| HDL | Obs `2085-9` | ✓ | ✓ | ✓ | ✓ |
| TAS | Obs `8480-6` | ✓ | ✓ | ✓ | ✓ |
| Tto antihipertensivo | MedicationStatement `C02–C09` | ✓ | — | — | ✓ |
| Tabaquismo | Obs `72166-2` | ✓ | ✓ | ✓ | ✓ |
| Diabetes | Condition `E11` | ✓ | ✓ | ✓ | ✓ |
| eGFR | Obs `98979-8` | ✓ | — | — | — |
| HbA1c (modelo completo) | Obs `4548-4` | ✓ | — | — | — |
| Índice albúmina/creatinina — UACR (`Microalb`) | Obs `14959-1` `(verificar)` | ✓ | — | — | — |
| Índice de deprivación social (SDI, por código postal) | Obs/extensión SDOH `LOCAL` | ✓ | — | — | — |
| Uso de estatina | MedicationStatement `C10` | ✓ | — | — | — |
| (modificador) Lp(a), IMC | Obs `10835-7` / `39156-5` | ✓ | — | — | — |

> **PREVENT 2023 — modelo completo (definido):** además de la base, el cálculo a 10 **y 30** años usa **HbA1c**, **UACR** (campo `Microalb`) y **SDI** (deprivación social por código postal). El campo `Microalb` de la tabla pasa de microalbuminuria simple a alimentar el índice albúmina/creatinina; conviene registrar también creatinina urinaria para el cociente. SDI requiere el código postal del paciente (`Patient.address.postalCode`).

Las clases funcionales que la tabla lista junto a los scores se modelan como **Observation**, no como RiskAssessment:

| Campo | LOINC / código | Valor |
|---|---|---|
| `ECOG` | `89247-1` ECOG performance status `(verificar)` | 0–4 |
| `NYHA` | `LOCAL .../nyha-class` (SNOMED `420816009` `(verificar)`) | I–IV |
| `KANSAS` (KCCQ) | `QuestionnaireResponse` KCCQ + `Observation` score resumen | 0–100 |

---

## Campos derivados — NO se almacenan (se calculan en lectura)

`Edad`, `Día en estudio`, `QTC >480`, `Indice cintura/altura`, y cada `*calculado* / *riesgo bajo...*` (son salidas de los RiskAssessment, no entradas).

---

## Identificadores y CodeSystems locales (namespace del proyecto)

```
https://api.epa-bienestar.com.ar/fhir/CodeSystem/risk-score-method
https://api.epa-bienestar.com.ar/fhir/CodeSystem/cardiotox-record-id
https://api.epa-bienestar.com.ar/fhir/CodeSystem/echo-measures          (MAPSE, EPR, e', E/e', S', área AI, Vel IT…)
https://api.epa-bienestar.com.ar/fhir/CodeSystem/vascular-doppler        (IMT, ateromatosis)
https://api.epa-bienestar.com.ar/fhir/StructureDefinition/risk-source    (manual | computed)
```

---

## Roadmap de desarrollo (post-validación de este mapeo)

1. **CodeSystems/ValueSets locales** (`data/core/`) para los códigos `LOCAL` y los métodos de score.
2. **Diccionario de datos** `src/cardiotox-mapping/data-dictionary.ts` (machine-readable de este documento) — *incluido en este PR*.
3. **Bot de ingesta** `Cardiotox row → Bundle FHIR` (migración de la tabla existente, idempotente vía `ifNoneExist`).
4. **Motor de scores** (`src/cardiotox-mapping/scores/`): funciones puras `PREVENT`, `SAC`, `ESC SCORE2`, `Framingham`, `OPS` → `RiskAssessment`. Cada una con su fuente bibliográfica y tests.
5. **Bot de recálculo**: al crear/actualizar las Observations de entrada → recalcula los `RiskAssessment` (performer = Bot).
6. **UI**: panel "Scores de riesgo" en `PatientDetails` que muestre PREVENT + todos los scores al abrir un paciente en seguimiento (objetivo final).

> ⚠️ Los coeficientes de cada algoritmo (PREVENT, Framingham, SCORE2, SAC, OPS) se implementarán citando la fuente y con tests de casos publicados, en el paso 4 — **no** se codifican hasta validar este mapeo clínicamente.
