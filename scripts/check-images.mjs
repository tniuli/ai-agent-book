import fs from 'fs'
import path from 'path'

const BASE = path.resolve(process.cwd())
const CHAPTERS_DIR = path.join(BASE, 'chapters')
const IMAGES_DIR = path.join(BASE, 'assets/images')

const mermaidRe = /^```mermaid$/m
const pngRefRe = /mermaid-\d+\.png/g

let totalSrc = 0
let totalRef = 0
let totalPng = 0
let okFiles = 0
let issues = []

const files = fs.readdirSync(CHAPTERS_DIR)
  .filter(f => f.endsWith('.md'))
  .sort()

console.log('='.repeat(70))
console.log('  101 张 Mermaid 图片引用完整性检查清单')
console.log('='.repeat(70))
console.log('')
console.log(`{"章节文件":^44s} {"源码":>4s} {"引用":>4s}  状态`)
console.log('-'.repeat(70))

for (const file of files) {
  const filePath = path.join(CHAPTERS_DIR, file)
  const content = fs.readFileSync(filePath, 'utf-8')

  const srcMatches = content.match(mermaidRe) || []
  const refMatches = content.match(pngRefRe) || []
  const srcCount = srcMatches.length
  const refCount = refMatches.length

  totalSrc += srcCount
  totalRef += refCount

  let status
  if (srcCount > 0) {
    status = `FAIL  仍有 ${srcCount} 个 mermaid 代码块未替换`
    issues.push({ file, type: 'unreplaced', count: srcCount })
  } else if (refCount === 0 && hasAnyDiagram(file)) {
    status = 'SKIP  无图表'
  } else {
    status = 'OK'
    okFiles++
  }

  console.log(`${file.padEnd(44)} ${String(srcCount).padStart(4)} ${String(refCount).padStart(4)}  ${status}`)
}

function hasAnyDiagram(f) {
  return f.match(/^\d+/) !== null
}

const allPngs = fs.readdirSync(IMAGES_DIR).filter(f => f.includes('mermaid'))
totalPng = allPngs.length

console.log('-'.repeat(70))
console.log('')
console.log('='.repeat(70))
console.log('  汇总')
console.log('='.repeat(70))
console.log(`  章节含 mermaid 源码块:   ${totalSrc}  (应 = 0，全部替换为 PNG 引用)`)
console.log(`  章节含图片引用:         ${totalRef}  (应 = 101)`)
console.log(`  assets/images/ PNG 数:  ${totalPng}  (应 = 101)`)
console.log(`  正常章节:               ${okFiles} / 19`)
console.log(`  问题项:                 ${issues.length}`)
console.log('')

if (issues.length > 0) {
  console.log('  --- 问题详情 ---')
  for (const i of issues) {
    console.log(`  [${i.type}] ${i.file}: ${i.count}`)
  }
}

console.log('')
const pass = totalSrc === 0 && totalRef === 101 && totalPng === 101
console.log(pass ? '  ✅ 全部通过' : `  ❌ 有 ${issues.length} 项需要修复`)

process.exit(pass ? 0 : 1)
