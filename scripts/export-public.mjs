import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const files = JSON.parse(fs.readFileSync(path.join(root, 'scripts/public-files.json'), 'utf8'))
const destination = path.resolve(process.argv[2] || path.join(root, 'release', 'public'))
if (new Set(files).size !== files.length) throw new Error('Duplicate release entries.')
const contents = files.map((file) => {
  if (path.isAbsolute(file) || file.split('/').some((part) => part === '..' || part === '.git') || file === '.env' || /\.(?:pdf|xlsx?|sqlite.*|db|pem|key)$/i.test(file)) throw new Error('Unsafe release path.')
  const source = path.join(root, file)
  if (!fs.lstatSync(source).isFile() || fs.realpathSync(source) !== source) throw new Error(`Only regular, in-repository files can be exported: ${file}`)
  const bytes = fs.readFileSync(source)
  return { file, bytes, hash: createHash('sha256').update(bytes).digest('hex') }
})
fs.mkdirSync(path.dirname(destination), { recursive: true })
fs.mkdirSync(destination) // Refuse to merge with or overwrite any existing export.
for (const { file, bytes } of contents) {
  const output = path.join(destination, file)
  fs.mkdirSync(path.dirname(output), { recursive: true })
  fs.writeFileSync(output, bytes, { flag: 'wx' })
}
fs.writeFileSync(path.join(destination, 'PUBLIC_CONTENTS.sha256'), contents.map(({ file, hash }) => `${hash}  ${file}`).join('\n') + '\n', { flag: 'wx' })
console.log(`Exported ${contents.length} allowlisted files and a checksum inventory to ${destination}. No Git history or runtime data was copied.`)
