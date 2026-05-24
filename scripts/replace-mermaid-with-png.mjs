import fs from 'fs'
import path from 'path'

const BASE = path.resolve(process.cwd())
const CHAPTERS_DIR = path.join(BASE, 'chapters')
const IMAGES_DIR = path.join(BASE, 'assets/images')

function getChNum(filename) {
  const m = filename.match(/^(\d+)-/)
  return m ? m[1] : null
}

let totalReplaced = 0
let totalFiles = 0

const files = fs.readdirSync(CHAPTERS_DIR)
  .filter(f => f.endsWith('.md'))
  .sort()

for (const file of files) {
  const chNum = getChNum(file)
  if (!chNum) continue

  const filePath = path.join(CHAPTERS_DIR, file)
  let content = fs.readFileSync(filePath, 'utf-8')

  const regex = /```mermaid\n([\s\S]*?)```/g
  let match
  let index = 0
  let hasChange = false

  while ((match = regex.exec(content)) !== null) {
    index++
    const chPadded = chNum.padStart(2, '0')
    const pngName = `ch${chPadded}-mermaid-${String(index).padStart(2, '0')}.png`
    const pngPath = path.join(IMAGES_DIR, pngName)

    if (!fs.existsSync(pngPath)) {
      console.log(`⚠️ 跳过 ${file} #${index}: ${pngName} 不存在`)
      continue
    }

    const imgUrl = `../assets/images/${pngName}`
    const replacement = `![${pngName}](${imgUrl})`
    content = content.substring(0, match.index) + replacement + content.substring(match.index + match[0].length)
    
    regex.lastIndex = 0
    hasChange = true
    totalReplaced++
  }

  if (hasChange) {
    fs.writeFileSync(filePath, content)
    totalFiles++
    console.log(`✅ ${file}: 替换完成`)
  }
}

console.log(`\n=== 完成 ===`)
console.log(`修改文件: ${totalFiles}`)
console.log(`替换图表: ${totalReplaced}`)
