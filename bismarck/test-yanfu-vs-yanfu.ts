import { BismarckEnv } from './engine/env'
import { createYanfuAI } from './cli/state-machine-yanfu'
import { GERMAN_START_HEXES } from './engine/map'
import { BRITISH_FIXED_POSITIONS } from './engine/setup'

const G = 50
let gerWins = 0, britWins = 0, sumTurns = 0, sumVpGer = 0, sumVpBrit = 0

for (let g = 0; g < G; g++) {
  const ai = createYanfuAI()
  const env = new BismarckEnv()
  const game = env.game

  const setupObs = env.getObservation(); (setupObs as any).raw = game.state
  const setupR = ai.selectGerman(setupObs)
  const setupAct = setupObs.actions.find((x: any) => x.id === setupR.actionId)
  if (setupAct) env.step(setupAct)

  // British setup - spread on sea routes
  const s = game.state
  const used = new Set<string>(GERMAN_START_HEXES)
  for (const [hex, shipIds] of Object.entries(BRITISH_FIXED_POSITIONS)) { used.add(hex); for (const id of shipIds) game.placeBritishToken(id, hex) }
  const seaRoutes = ['D2','D3','C3','C4','D5','E1','F4','E4','E5']
  for (const sh of s.britishShips) {
    if (s.britishPositions.has(sh.def.id)) continue
    const route = seaRoutes[Math.floor(Math.random() * seaRoutes.length)]
    game.placeBritishToken(sh.def.id, route)
  }
  const fallback = ['E7','E5','E3','E2','E1','D8','D5','D4','D3','D2','D1','C7','C1','B6','F6','F5','F3','F2','A3','A4','B4']
  for (const sh of s.britishShips) if (!s.britishPositions.has(sh.def.id)) game.placeBritishToken(sh.def.id, fallback[Math.floor(Math.random()*fallback.length)])
  game.finishSetup()

  let steps = 0, stuck = 0, lastPhase = ''
  while (!game.state.gameOver && steps < 500) {
    const obs = env.getObservation(); (obs as any).raw = game.state
    if (obs.phase !== 'setup-british' && obs.actions.length === 0) break
    if (obs.phase === lastPhase) stuck++; else { stuck = 0; lastPhase = obs.phase }
    if (stuck > 30) { const f = obs.actions.find((a: any) => a.type === 'finish-phase'); if (f) { env.step(f); stuck = 0; continue } }

    const isGerman = obs.activePlayer === 'german'
    const r = isGerman ? ai.selectGerman(obs) : ai.selectBritish(obs)
    const aid = r.actionId ?? obs.actions[Math.floor(Math.random()*obs.actions.length)]?.id
    const act = obs.actions.find((x: any) => x.id === aid)
    if (act) env.step(act)
    steps++
  }

  if (game.state.winner === 'german') gerWins++; else britWins++
  sumTurns += game.state.turn
  sumVpGer += game.state.vp.german
  sumVpBrit += game.state.vp.british
  if ((g+1) % 10 === 0) console.log(`  ${g+1}/${G} 德${gerWins} 英${britWins}`)
}

console.log(`\n严父德 vs 严父英 ${G}局:`)
console.log(`德军 ${gerWins}胜 英军 ${britWins}胜 (德军 ${(gerWins/G*100).toFixed(0)}%)`)
console.log(`均T${(sumTurns/G).toFixed(1)} VP德${(sumVpGer/G).toFixed(1)}/英${(sumVpBrit/G).toFixed(1)}`)
