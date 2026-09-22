// Authored from scratch. These observations describe no real person and are
// not reference values, treatment evidence, or a clinically plausible case.
export const demoProfile = 'Synthetic demo'
export const demoDates = ['2024-02-29', '2024-06-15', '2024-11-09', '2025-03-18', '2025-09-12', '2026-02-20']
const markers = [
  ['Glycemic', 'Glucose', 'mmol/L', ['5.10', '4.90', '5.25', '5.00', '5.15', '92.00'], '3.9–6.1'],
  ['Lipids', 'LDL cholesterol', 'mmol/L', ['3.20', '3.05', null, '2.80', '2.95', '2.85'], 'See laboratory report'],
  ['Liver', 'ALT', 'U/L', ['24', '31', '28', '22', '26', '25'], '0–40'],
  ['Hematology', 'Hemoglobin', 'g/L', ['142', '145', '143', '146', '144', '145'], '120–160'],
  ['Thyroid', 'TSH', 'mIU/L', ['1.2300', '1.4500', '1.3100', null, '1.2700', '1.3300'], '0.4–4.0'],
  ['Urinalysis', 'Protein, qualitative', '', ['Negative', null, 'Trace', 'Negative', null, '<0.1'], 'Qualitative result'],
]
export const demoEntries = markers.flatMap(([category, marker, unit, values, reference]) => values.flatMap((value, index) => value === null ? [] : [{
  category, marker, value, date: demoDates[index], unit: marker === 'Glucose' && index === 5 ? 'mg/dL' : unit,
  lab: index < 4 ? 'Synthetic Lab A' : 'Synthetic Lab B',
  method: index < 4 ? 'Synthetic assay A' : 'Synthetic assay B',
  reference: index === 5 && marker === 'Glucose' ? '70–110' : reference,
  notes: 'Invented demo observation. Do not use for medical decisions.',
}]))
