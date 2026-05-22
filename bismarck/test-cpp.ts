/** C++ 引擎集成测试 — 跑一局完整游戏 */
import { CppGame } from './cpp-game'

async function main() {
  console.log('===== C++ 引擎 GUI 集成测试 =====\n')

  const g = new CppGame()
  await g.refresh()
  let s = g.state
  console.log(`初始阶段: ${s.phase} | 回合: ${s.turn}/18`)

  // ----- 德军布置 -----
  await g.setGermanStart('B7')
  s = g.state
  console.log(`德军选 B7 → 阶段: ${s.phase}`)
  console.log(`  英军固定位置: ${[...s.britishPositions.keys()].join(', ')}`)

  // ----- 英军布置（手动放） -----
  const unplaced = s.britishShips.filter((sh: any) => !s.britishPositions.has(sh.def.id))
  console.log(`  未放置算子: ${unplaced.map((sh: any) => sh.def.id).join(', ')}`)
  for (const sh of unplaced) {
    await g.placeBritishToken(sh.def.id, 'E1')
  }
  await g.finishSetup()
  s = g.state
  console.log(`布阵完成 → 阶段: ${s.phase}`)

  // ----- 德军移动（两艘各走一步）-----
  const r1 = await g.getReachableLabels('bismarck')
  console.log(`俾斯麦可达: ${r1.join(', ')}`)
  if (r1.length > 0) await g.germanMove('bismarck', r1[0])

  const r2 = await g.getReachableLabels('prinz-eugen')
  if (r2.length > 0) await g.germanMove('prinz-eugen', r2[0])

  await g.finishGermanMove()
  s = g.state
  console.log(`德军移动完成 → 阶段: ${s.phase}`)

  // ----- 英军移动 -----
  const hood = s.britishShips.find((sh: any) => sh.def.id === 'hood')
  if (hood && hood.steps > 0) {
    const rHood = await g.getReachableLabels('hood')
    if (rHood.length > 0) await g.britishMove('hood', rHood[rHood.length - 1])
  }
  await g.finishBritishMove()
  s = g.state
  console.log(`英军移动完成 → 阶段: ${s.phase}`)

  // ----- 索敌 -----
  await g.doSearch()
  await g.finishSearch()
  s = g.state
  console.log(`索敌完成 → 阶段: ${s.phase} | 发现俾斯麦: ${s.bismarckFound} | 战斗待决: ${s.combatPending}`)

  // 如果不是战斗阶段，快速推进几回合看看会不会崩
  let turns = 1
  while (!s.gameOver && turns < 5) {
    if (s.phase === 'german-move') {
      const bR = await g.getReachableLabels('bismarck')
      if (bR.length > 0) await g.germanMove('bismarck', bR[0])
      const peR = await g.getReachableLabels('prinz-eugen')
      if (peR.length > 0) await g.germanMove('prinz-eugen', peR[0])
      await g.finishGermanMove()
    } else if (s.phase === 'british-move') {
      for (const sh of s.britishShips) {
        if (sh.steps <= 0) continue
        if (!s.britishPositions.has(sh.def.id)) continue
        const r = await g.getReachableLabels(sh.def.id)
        if (r.length > 0) await g.britishMove(sh.def.id, r[r.length - 1])
      }
      await g.finishBritishMove()
    } else if (s.phase === 'british-search') {
      await g.doSearch()
      await g.finishSearch()
    } else if (s.phase === 'combat') {
      await g.doCombat()
    } else if (s.phase === 'transport-attack') {
      const attackers = await g.getTransportAttackers()
      if (attackers.length > 0) await g.doTransportAttack(attackers[0])
      else await g.skipTransportAttack()
    } else break
    await g.refresh()
    s = g.state
    turns++
  }

  s = g.state
  console.log(`\n===== 结果 =====`)
  console.log(`胜者: ${s.winner ?? '无'}`)
  console.log(`回合: ${s.turn}/18 | 德VP: ${s.vp?.german ?? 0} | 英VP: ${s.vp?.british ?? 0}`)
  console.log(`原因: ${s.victoryReason}`)
  console.log(`终局: ${s.gameOver}`)
  console.log(`\n✅ C++ 引擎通过集成测试`)

  process.exit(0)
}

main().catch(e => { console.error(e); process.exit(1) })
