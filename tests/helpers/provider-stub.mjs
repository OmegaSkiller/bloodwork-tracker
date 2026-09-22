// Test-only preload. Production has no custom endpoint or simulated-AI mode.
import fs from 'node:fs'
globalThis.fetch = async (url, options) => {
  if (url !== 'https://api.openai.com/v1/responses') throw new Error('Tests must not contact external services.')
  const request = JSON.parse(options.body)
  fs.writeFileSync(process.env.PROVIDER_CAPTURE, JSON.stringify({ url, request }))
  if (request.input.some((message) => message.content === 'simulate denied key')) return Response.json({ error: { message: 'Synthetic invalid key' } }, { status: 401 })
  if (request.input.some((message) => message.content === 'simulate failure')) return Response.json({ error: { message: 'Synthetic provider failure' } }, { status: 503 })
  return Response.json({ model: request.model, output: [{ type: 'message', content: [{ type: 'output_text', text: 'Simulated test response, not medical advice.' }] }] })
}
