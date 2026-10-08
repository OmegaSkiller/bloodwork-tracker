// Test-only preload. Production has no custom endpoint or simulated-AI mode.
import fs from 'node:fs'
globalThis.fetch = async (url, options) => {
  if (url !== 'https://api.openai.com/v1/responses') throw new Error('Tests must not contact external services.')
  const request = JSON.parse(options.body)
  fs.writeFileSync(process.env.PROVIDER_CAPTURE, JSON.stringify({ url, request }))
  const file = request.input.find((message) => Array.isArray(message.content))?.content.find((item) => item.type === 'input_file')
  if (file) {
    const pdf = Buffer.from(file.file_data.split(',')[1], 'base64').toString('latin1')
    if (pdf.includes('SIMULATE_FAILURE')) return Response.json({ error: { message: 'Synthetic provider failure' } }, { status: 503 })
    if (pdf.includes('SIMULATE_INCOMPLETE')) return Response.json({ status: 'incomplete', incomplete_details: { reason: 'synthetic' } })
    if (pdf.includes('SIMULATE_INVALID')) return Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ patientName: null, observations: [{ marker: 'Example', value: { invented: '9' }, unit: null, date: null, lab: null, reference: null, method: null, page: 1 }] }) }] }] })
    const extraction = { patientName: 'Synthetic Alice', observations: [
      { marker: 'Example', value: '2.3450', unit: 'mmol/L', date: '2025-03-01', lab: 'Synthetic Lab', reference: '1–3', method: 'Synthetic assay', page: 1 },
      { marker: 'Example', value: '4.10', unit: 'mmol/L', date: null, lab: 'Synthetic Lab', reference: '1–3', method: null, page: 1 },
    ] }
    return Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(extraction) }] }] })
  }
  if (request.input.some((message) => message.content === 'simulate denied key')) return Response.json({ error: { message: 'Synthetic invalid key' } }, { status: 401 })
  if (request.input.some((message) => message.content === 'simulate failure')) return Response.json({ error: { message: 'Synthetic provider failure' } }, { status: 503 })
  return Response.json({ model: request.model, output: [{ type: 'message', content: [{ type: 'output_text', text: 'Simulated test response, not medical advice.' }] }] })
}
