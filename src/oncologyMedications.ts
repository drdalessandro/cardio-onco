// Codes from the ANMAT vademecum CodeSystem (https://anmat.gob.ar/vademecum)
// that correspond to oncology treatments (chemotherapy, targeted therapy,
// immunotherapy, hormone therapy). Cardioprotective and supportive-care
// drugs are intentionally excluded.
export const ONCOLOGY_CODES = new Set([
  // Antraciclinas
  'antraciclinas', 'doxorrubicina', 'epirrubicina', 'idarrubicina', 'mitoxantrona', 'daunorrubicina',
  // Taxanos
  'taxanos', 'paclitaxel', 'docetaxel', 'nab-paclitaxel',
  // Anti-HER2
  'anticuerpos-anti-her2', 'trastuzumab', 'pertuzumab', 'lapatinib', 'neratinib',
  'trastuzumab-emtansina', 'trastuzumab-deruxtecan',
  // Alquilantes
  'alquilantes', 'ciclofosfamida', 'ifosfamida', 'clorambucilo', 'melfalano',
  'dacarbazina', 'temozolomida',
  // Platinos
  'platinos', 'cisplatino', 'carboplatino', 'oxaliplatino',
  // Antimetabolitos
  'antimetabolitos', 'fluorouracilo', 'capecitabina', 'gemcitabina', 'metotrexato',
  'pemetrexed', 'citarabina', 'fludarabina', 'cladribina',
  // Alcaloides de la Vinca
  'alcaloides-vinca', 'vincristina', 'vinorelbina', 'vinblastina',
  // Hormonoterapia
  'hormonoterapia', 'tamoxifeno', 'letrozol', 'anastrozol', 'exemestano',
  'fulvestrant', 'leuprolida', 'goserelina', 'bicalutamida', 'enzalutamida', 'abiraterona',
  // Inhibidores CDK 4/6
  'inhibidores-cdk', 'palbociclib', 'ribociclib', 'abemaciclib',
  // Inhibidores PARP
  'inhibidores-parp', 'olaparib', 'niraparib', 'rucaparib',
  // Anti-VEGF / Antiangiogénicos
  'inhibidores-vegf', 'bevacizumab', 'sunitinib', 'sorafenib', 'pazopanib',
  'regorafenib', 'lenvatinib', 'cabozantinib',
  // Inhibidores EGFR
  'inhibidores-egfr', 'erlotinib', 'gefitinib', 'afatinib', 'osimertinib',
  'cetuximab', 'panitumumab',
  // Inmunoterapia checkpoint
  'inmunoterapia', 'pembrolizumab', 'nivolumab', 'ipilimumab', 'atezolizumab',
  'durvalumab', 'avelumab',
  // Inhibidores Tirosina Kinasa
  'inhibidores-tirosina-kinasa', 'imatinib', 'dasatinib', 'nilotinib', 'bosutinib',
  'ponatinib', 'ibrutinib', 'acalabrutinib',
  // Inhibidores mTOR
  'inhibidores-mtor', 'everolimus', 'temsirolimus',
  // Otros oncológicos
  'otros-oncologicos', 'irinotecan', 'etoposido', 'rituximab', 'obinutuzumab',
  'bortezomib', 'carfilzomib', 'lenalidomida', 'pomalidomida', 'venetoclax',
]);

// Normalized display names (lowercase, no accents) for name-based matching.
// Used when the FHIR resource lacks a code from the ANMAT system.
const ONCOLOGY_NAMES = new Set([
  'doxorrubicina', 'epirrubicina', 'idarrubicina', 'mitoxantrona', 'daunorrubicina',
  'paclitaxel', 'docetaxel', 'nab-paclitaxel', 'abraxane',
  'trastuzumab', 'pertuzumab', 'lapatinib', 'neratinib',
  'trastuzumab emtansina', 't-dm1', 'trastuzumab deruxtecan', 't-dxd',
  'ciclofosfamida', 'ifosfamida', 'clorambucilo', 'melfalano', 'dacarbazina', 'temozolomida',
  'cisplatino', 'carboplatino', 'oxaliplatino',
  'fluorouracilo', '5-fu', 'capecitabina', 'gemcitabina', 'metotrexato',
  'pemetrexed', 'citarabina', 'fludarabina', 'cladribina',
  'vincristina', 'vinorelbina', 'vinblastina',
  'tamoxifeno', 'letrozol', 'anastrozol', 'exemestano', 'fulvestrant',
  'leuprolida', 'goserelina', 'bicalutamida', 'enzalutamida', 'abiraterona',
  'palbociclib', 'ribociclib', 'abemaciclib',
  'olaparib', 'niraparib', 'rucaparib',
  'bevacizumab', 'sunitinib', 'sorafenib', 'pazopanib', 'regorafenib', 'lenvatinib', 'cabozantinib',
  'erlotinib', 'gefitinib', 'afatinib', 'osimertinib', 'cetuximab', 'panitumumab',
  'pembrolizumab', 'nivolumab', 'ipilimumab', 'atezolizumab', 'durvalumab', 'avelumab',
  'imatinib', 'dasatinib', 'nilotinib', 'bosutinib', 'ponatinib', 'ibrutinib', 'acalabrutinib',
  'everolimus', 'temsirolimus',
  'irinotecan', 'irinotecán', 'etoposido', 'etopósido', 'rituximab', 'obinutuzumab',
  'bortezomib', 'carfilzomib', 'lenalidomida', 'pomalidomida', 'venetoclax',
]);

function normalize(str: string): string {
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

/**
 * Returns true if a medication should be shown in the Medicaciones Oncológicas panel.
 * Matches by FHIR code (system https://anmat.gob.ar/vademecum) first,
 * then falls back to normalized display-name substring matching.
 */
export function isOncologyMedication(name: string, fhirCodes: { system?: string; code?: string }[]): boolean {
  for (const coding of fhirCodes) {
    const code = coding.code?.toLowerCase() ?? '';
    if (ONCOLOGY_CODES.has(code)) return true;
  }
  const normalizedName = normalize(name);
  for (const known of ONCOLOGY_NAMES) {
    if (normalizedName.includes(normalize(known))) return true;
  }
  return false;
}
