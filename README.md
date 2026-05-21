<h1 align="center">
  <br/>
  🫀 Cardio Onco
  <br/>
</h1>

<p align="center">
  <strong>Open-source clinical platform for Cardio-Oncology follow-up</strong><br/>
  Built on FHIR R4 · ESC 2022 Guidelines · Designed for real clinical environments
</p>

<p align="center">
  <a href="https://cardio-onco.epa-bienestar.com.ar">
    <img src="https://img.shields.io/badge/Live%20Demo-cardio--onco.epa--bienestar.com.ar-0ea5e9?style=for-the-badge&logo=vercel" />
  </a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/FHIR-R4-orange?style=flat-square&logo=hl7" />
  <img src="https://img.shields.io/badge/Medplum-5.0-blueviolet?style=flat-square" />
  <img src="https://img.shields.io/badge/React-19-61dafb?style=flat-square&logo=react" />
  <img src="https://img.shields.io/badge/TypeScript-5-3178c6?style=flat-square&logo=typescript" />
  <img src="https://img.shields.io/badge/License-Apache%202.0-green?style=flat-square" />
</p>

---

## What is Cardio Onco?

**Cardio Onco** is a specialized clinical decision-support platform for **cardio-oncology teams**. It enables real-time monitoring of cancer patients undergoing cardiotoxic therapies — anthracyclines, trastuzumab, bevacizumab, and more — following the **ESC 2022 Cardio-Oncology Guidelines**.

Built on top of [Medplum AR](https://www.medplum.com.ar/), an open-source FHIR-native EHR backend, it runs entirely on open standards: every data point is a FHIR resource, every workflow is reproducible.

> Developed at **Hospital Municipal de Oncología Marie Curie**, Argentina.  
> Designed by clinicians, for clinicians.

---

## ✨ Key Features

### 🔴 Cardiotoxicity Risk Dashboard
Real-time LVEF tracking and risk stratification per **ESC 2022**:

| Status | Criteria | Action |
|--------|----------|--------|
| 🔴 High risk | LVEF drop ≥10 pp → <50% | Urgent cardiology referral |
| 🟡 Moderate | LVEF drop ≥10 pp (LVEF ≥50%) or 50–54% | Close monitoring |
| 🟢 Low risk | LVEF ≥55%, <10 pp drop | Continue treatment |

### 📊 Longitudinal Observation Graphs
Interactive Chart.js visualizations for LVEF, blood pressure, heart rate, weight, BMI, and other LOINC-coded observations over time.

### 🧮 HFA-ICOS Calculator
Automated 5-year heart failure survival prediction, pre-filled from FHIR `Condition` resources. Includes the full **Monitoring Schedule** per ESC risk group.

### 🚨 Biomarker Alerts
Threshold-based clinical flag system for troponin, BNP, NT-proBNP, and other cardiac biomarkers. Surfaces active `Flag` resources directly on the patient dashboard.

### 💊 Anthracycline Survivor Follow-up
Dedicated long-term monitoring dashboard for survivors of anthracycline-based regimens, with cumulative dose tracking and FHIR `MedicationAdministration` history.

### 📋 Structured Cardio-Oncology Referral
Clinical referral workflow (Interconsulta) modeled as FHIR `ServiceRequest`, with pre-structured recommendations aligned to cardio-oncology protocols.

### 📤 FHIR Export & Download
One-click patient data export from the patient record:
- **FHIR Everything** — full FHIR R4 Bundle (JSON)
- **C-CDA** — HL7 Clinical Document Architecture (XML)
- **C-CDA Referral** — Structured referral document (XML)
- Optional **start/end date** filters for time-bounded exports

### 🗂️ Complete Clinical Chart
Full Medplum-powered patient chart: encounter notes, SOAP format, clinical impressions, medication requests, conditions (ICD-10), allergy list, and version history.

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────┐
│                   Browser (React 19)             │
│                                                  │
│  ┌─────────────┐  ┌──────────────────────────┐  │
│  │ Patient     │  │  Clinical Modules         │  │
│  │ Chart       │  │  - CardiotoxicityDashboard│  │
│  │ (Medplum    │  │  - HFAICOSCalculator      │  │
│  │  React)     │  │  - BiomarkerAlerts        │  │
│  │             │  │  - PatientObservations    │  │
│  │             │  │  - AnthracyclineSurvivor  │  │
│  │             │  │  - Interconsulta          │  │
│  │             │  │  - Resumen / FHIR Export  │  │
│  └──────┬──────┘  └────────────┬─────────────┘  │
│         │                      │                 │
└─────────┼──────────────────────┼─────────────────┘
          │    FHIR R4 REST API  │
          ▼                      ▼
┌─────────────────────────────────────────────────┐
│          Medplum Server (FHIR R4)                │
│          https://api.epa-bienestar.com.ar        │
│                                                  │
│  Patient · Observation · Condition · Encounter   │
│  MedicationRequest · ClinicalImpression · Flag   │
│  ServiceRequest · DiagnosticReport · Questionnaire│
└─────────────────────────────────────────────────┘
```

**Stack:**

| Layer | Technology |
|-------|-----------|
| Frontend | React 19 + TypeScript + Vite 7 |
| UI Components | Mantine 8 + Tabler Icons |
| FHIR Client | Medplum Core 5.0 + Medplum React |
| Charts | Chart.js 4 |
| Backend | Medplum Server (self-hosted or cloud) |
| Standard | HL7 FHIR R4 |

---

## 🚀 Getting Started

### Prerequisites

- Node.js ≥ 20
- A running [Medplum AR](https://www.medplum.com.ar/docs/self-hosting) instance (self-hosted or [cloud](https://app.medplum.com.ar))

### 1. Clone the repo

```bash
git clone https://github.com/drdalessandro/cardio-onco.git
cd cardio-onco
```

### 2. Configure environment

```bash
cp .env.defaults .env
```

Edit `.env` and set your Medplum instance:

```env
MEDPLUM_BASE_URI=https://api.medplum.com.ar   # or your own instance
MEDPLUM_CLIENT_ID=your-client-id
```

### 3. Install dependencies

```bash
npm install
```

### 4. Load reference data

Upload terminologies, questionnaires, and ICD-10 conditions:

```bash
npm run upload:core
```

Optionally load example patient data:

```bash
npm run upload:example
```

### 5. Build and deploy bots

```bash
npm run build:bots
npm run deploy:bots
```

### 6. Run locally

```bash
npm run dev
```

App runs at **http://localhost:3000** 🎉

---

## 🔧 Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `MEDPLUM_BASE_URI` | Base URL of your Medplum FHIR server | `https://api.medplum.com.ar/` |
| `MEDPLUM_CLIENT_ID` | OAuth2 client ID for your Medplum project | — |

---

## 📁 Project Structure

```
cardio-onco/
├── src/
│   ├── components/
│   │   ├── CardiotoxicityDashboard.tsx   # ESC 2022 risk stratification
│   │   ├── HFAICOSCalculator.tsx         # 5-year HF survival + monitoring
│   │   ├── BiomarkerAlerts.tsx           # Troponin / BNP threshold alerts
│   │   ├── PatientObservations.tsx       # Longitudinal vitals & LVEF graphs
│   │   ├── AnthracyclineSurvivorDashboard.tsx
│   │   ├── InterconsultaCardioOnco.tsx   # FHIR ServiceRequest referral
│   │   ├── Resumen.tsx                   # FHIR export (Everything / C-CDA)
│   │   ├── ClinicalImpressionDisplay.tsx
│   │   └── PatientDetails.tsx            # Main tabbed patient view
│   ├── pages/
│   ├── bots/                             # Medplum serverless bots
│   └── App.tsx
├── data/
│   ├── core/                             # Terminologies, questionnaires
│   └── example/                          # Demo patient data
└── package.json
```

---

## 🩺 Clinical Standards

This application implements the following evidence-based guidelines:

- **ESC 2022 Guidelines on Cardio-Oncology** — risk stratification, monitoring intervals, LVEF thresholds
- **HFA-ICOS Risk Score** — 5-year heart failure prediction in cancer patients
- **ICD-10 / SNOMED CT** — standardized disease coding
- **LOINC** — standardized observation coding (LVEF `8806-2`, BP `85354-9`, troponin, BNP, etc.)
- **HL7 FHIR R4** — interoperable data exchange
- **C-CDA R2.1** — clinical document export

---

## 🤝 Contributing

Contributions are welcome, especially from clinicians and health informaticists.

```bash
# Create your feature branch
git checkout -b feature/my-clinical-feature

# Commit your changes
git commit -m "Add: my clinical feature"

# Push and open a PR
git push origin feature/my-clinical-feature
```

Please follow existing TypeScript and FHIR resource patterns. Clinical content changes should reference the relevant guideline or evidence source.

---

## 👥 Authors

| Author | Role |
|--------|------|
| **Dr. Alejandro Sergio D'Alessandro** | Clinical design, cardio-oncology domain expertise |
| **Claude Code** (Anthropic) | Software engineering, FHIR implementation |

Built with ❤️ for patients and clinicians at **Hospital Municipal de Oncología Marie Curie**, Argentina.

---

## 📄 License

Licensed under the [Apache License 2.0](LICENSE.txt).

```
Copyright 2025 Dr. Alejandro Sergio D'Alessandro

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0
```

---

## 🔗 Resources

- 📖 [Medplum Documentation](https://www.medplum.com.ar/docs)
- 🧩 [Medplum React Components](https://storybook.medplum.com.ar/)
- 🏥 [ESC 2022 Cardio-Oncology Guidelines](https://www.escardio.org/Guidelines/Clinical-Practice-Guidelines/Cardio-Oncology-Guidelines)
- 🌐 [Live App](https://cardio-onco.epa-bienestar.com.ar)

---

<p align="center">
  <sub>Built on open standards. Open to the world.</sub>
</p>
