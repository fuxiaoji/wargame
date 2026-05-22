/**
 * SpineManager — 预加载碧蓝航线 spine JSON 资源
 *
 * 资源格式: JSON (由 SpineSkeletonDataConverter 从 3.6.52 .skel 转换)
 * 运行时: spine-ts 3.6 (global scripts)
 */
import type { SpineAsset } from '../types/spine-types'

const SPINE_MAP_URL = '/spine/ship-spine-map.json'

export const ANIM_MAP: Record<string, string[]> = {
  attack:   ['attack', 'attack_main', 'attack_left', 'skill'],
  damaged:  ['dead', 'yun', 'sleep'],
  moving:   ['walk', 'move', 'move_left'],
  selected: ['stand', 'stand2', 'dance', 'victory'],
  idle:     ['normal', 'stand', 'stand2'],
  victory:  ['victory', 'dance', 'stand'],
}

function loadText(url: string): Promise<string> {
  return fetch(url).then(r => r.text())
}

function loadJson(url: string): Promise<any> {
  return fetch(url).then(r => r.json())
}

function loadTexture(path: string, img: HTMLImageElement): Promise<spine.canvas.CanvasTexture> {
  return new Promise((resolve, reject) => {
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(new spine.canvas.CanvasTexture(img))
    img.onerror = () => reject(new Error(`Image load failed: ${path}`))
    img.src = path
  })
}

class SpineManagerImpl {
  private assets = new Map<string, SpineAsset>()
  private shipToSpineId = new Map<string, string>()
  private loaded = false
  private loadPromise: Promise<void> | null = null

  async preload(): Promise<void> {
    if (this.loaded) return
    if (this.loadPromise) return this.loadPromise
    this.loadPromise = this._doPreload()
    return this.loadPromise
  }

  private async _doPreload(): Promise<void> {
    const res = await fetch(SPINE_MAP_URL)
    const map = await res.json()
    for (const [shipId, spineId] of Object.entries(map)) {
      this.shipToSpineId.set(shipId, spineId as string)
    }

    const entries = Array.from(this.shipToSpineId.entries())
    const results = await Promise.allSettled(
      entries.map(([shipId, spineId]) => this._loadSpine(shipId, spineId))
    )

    let loaded = 0
    results.forEach((r, i) => {
      if (r.status === 'fulfilled' && r.value) {
        this.assets.set(entries[i][1], r.value)
        loaded++
      } else {
        console.warn(`[Spine] ${entries[i][0]} load failed`,
          r.status === 'rejected' ? String(r.reason).slice(0, 80) : '')
      }
    })

    this.loaded = true
    console.log(`SpineManager: ${loaded}/${entries.length} ships loaded`)
  }

  private async _loadSpine(shipId: string, spineId: string): Promise<SpineAsset> {
    const basePath = `/spine/${shipId}/`

    // Load JSON + atlas text + image in parallel
    const jsonUrl = `${basePath}${spineId}.json`
    const atlasUrl = `${basePath}${spineId}.atlas`

    const [jsonData, atlasText] = await Promise.all([
      loadJson(jsonUrl),
      loadText(atlasUrl),
    ])

    // Create texture atlas from atlas text
    const img = new Image()
    const texture = await loadTexture(`${basePath}${spineId}.png`, img)

    // Parse atlas manually for 3.6
    const atlas = new spine.TextureAtlas(atlasText, (path: string) => {
      return texture
    })

    // Load skeleton from JSON
    const attachmentLoader = new spine.AtlasAttachmentLoader(atlas)
    const jsonReader = new spine.SkeletonJson(attachmentLoader)
    jsonReader.scale = 1
    const skeletonData = jsonReader.readSkeletonData(jsonData)

    const animationNames = skeletonData.animations.map((a: spine.Animation) => a.name)

    console.log(`[Spine] ${shipId}: ${skeletonData.bones.length}B/${skeletonData.slots.length}S/${animationNames.length}A`)

    return { skeletonData, animationNames }
  }

  getAsset(shipId: string): SpineAsset | undefined {
    const spineId = this.shipToSpineId.get(shipId)
    if (!spineId) return undefined
    return this.assets.get(spineId)
  }

  isLoaded(): boolean { return this.loaded }
}

export const SpineManager = new SpineManagerImpl()
