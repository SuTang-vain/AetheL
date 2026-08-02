import { strict as assert } from 'node:assert'
import { classifyWorkshopInput, workshopSkillForKind } from '../../src/lib/workshopInput.js'

type TestCase = {
  name: string
  run: () => Promise<void>
}

const tests: TestCase[] = []

function test(name: string, run: () => Promise<void>) {
  tests.push({ name, run })
}

test('普通短文本分类为想法（idea）', async () => {
  assert.equal(classifyWorkshopInput('做一个帮用户记录灵感的应用'), 'idea')
  assert.equal(classifyWorkshopInput('   '), 'idea')
  assert.equal(classifyWorkshopInput(''), 'idea')
})

test('包含 URL 的输入分类为链接导入（link）', async () => {
  assert.equal(classifyWorkshopInput('https://www.bilibili.com/video/BV1xx411c7mD'), 'link')
  assert.equal(classifyWorkshopInput('这个视频讲本地优先 https://v.douyin.com/abc/ 值得看'), 'link')
})

test('长文本或文档结构标记分类为 PRD（prd）', async () => {
  const longText = '需求背景：用户需要更好的记录方式。'.repeat(40)
  assert.equal(classifyWorkshopInput(longText), 'prd')
  assert.equal(classifyWorkshopInput('# 需求背景\n## 用户故事\n- 作为用户…\n## 验收标准'), 'prd')
  assert.equal(classifyWorkshopInput('PRD：灵感气泡应用 v2'), 'prd')
})

test('workshopSkillForKind 映射正确', async () => {
  assert.equal(workshopSkillForKind('idea'), 'idea-to-bubbles')
  assert.equal(workshopSkillForKind('link'), 'link-to-evidence')
  assert.equal(workshopSkillForKind('prd'), 'prd-to-bubbles')
})

async function main() {
  for (const item of tests) {
    await item.run()
    console.log(`✓ ${item.name}`)
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
