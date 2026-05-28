/**
 * SpineManager — 预加载 .skel 二进制文件
 * 使用 @pixi-spine/all-3.8 的 PIXI.Assets 直接加载 skel
 */
import * as PIXI from 'pixi.js'
import '@pixi-spine/all-3.8'

const SPINE_MAP_URL = '/spine/ship-spine-map.json'

export const ANIM_MAP: Record<string, string[]> = {
  attack:   ['attack', 'attack_main', 'attack_left', 'skill'],
  damaged:  ['dead', 'yun', 'sleep'],
  moving:   ['walk', 'move', 'move_left'],
  selected: ['stand', 'stand2', 'dance', 'victory'],
  idle:     ['normal', 'stand', 'stand2'],
  victory:  ['victory', 'dance', 'stand'],
}

export interface SpineSkelAsset {
  spineData: any  // PIXI.spine.core.SkeletonData
}

class SpineManagerImpl {
  private assets = new Map<string, SpineSkelAsset>()
  private shipToSpineId = new Map<string, string>()
  private loaded = false
  private loadPromise: Promise<void> | null = null

  async preload(): Promise<void> {
    if (this.loaded) return; if (this.loadPromise) return this.loadPromise
    this.loadPromise = this._doPreload(); return this.loadPromise
  }

  private async _doPreload(): Promise<void> {
    const map = await fetch(SPINE_MAP_URL).then(r => r.json())
    for (const [shipId, spineId] of Object.entries(map))
      this.shipToSpineId.set(shipId, spineId as string)

    const entries = Array.from(this.shipToSpineId.entries())
    const results = await Promise.allSettled(
      entries.map(([shipId, spineId]) => this._load(shipId, spineId))
    )
    let loaded = 0
    results.forEach((r, i) => {
      if (r.status === 'fulfilled' && r.value) { this.assets.set(entries[i][1], r.value); loaded++ }
      else console.warn(`[Spine] ${entries[i][0]} load failed`)
    })
    this.loaded = true
    console.log(`SpineManager: ${loaded}/${entries.length} ships loaded`)
  }

  private async _load(shipId: string, spineId: string): Promise<SpineSkelAsset> {
    const skelPath = `/spine/${shipId}/${spineId}.skel`
    const resource = await PIXI.Assets.load(skelPath)
    return { spineData: resource.spineData }
  }

  getAsset(shipId: string): SpineSkelAsset | undefined {
    const sid = this.shipToSpineId.get(shipId)
    return sid ? this.assets.get(sid) : undefined
  }
  isLoaded(): boolean { return this.loaded }
}

export const SpineManager = new SpineManagerImpl()
