/**
 * SpineCharacter — PixiJS + @pixi-spine/all-3.8
 * 直接加载 .skel 二进制，不需要 JSON 转换
 */
import { Application } from 'pixi.js'
import { Spine } from '@pixi-spine/all-3.8'
import { ANIM_MAP, type SpineSkelAsset } from './SpineManager'

export type AnimEvent = 'idle' | 'selected' | 'moving' | 'attack' | 'damaged' | 'victory'

export class SpineCharacter {
  private app: Application
  private spine: Spine | null = null
  private animationNames: string[] = []
  private currentAnim: AnimEvent = 'idle'

  constructor(asset: SpineSkelAsset, canvasW: number, canvasH: number) {
    this.app = new Application({
      width: canvasW, height: canvasH,
      backgroundAlpha: 0, antialias: true, resolution: 1,
    })

    const sd = asset.spineData
    this.animationNames = sd.animations.map((a: any) => a.name)

    this.spine = new Spine(sd)
    const dw = Math.abs(sd.width) || 250
    const dh = Math.abs(sd.height) || 350
    const s = Math.min(canvasW / dw * 0.85, canvasH / dh * 0.85, 1.0)
    this.spine.scale.set(s)
    this.spine.x = canvasW / 2
    this.spine.y = canvasH * 0.78

    this.app.stage.addChild(this.spine)
    this._playAnimation('idle')
  }

  private _playAnimation(event: AnimEvent): void {
    if (!this.spine?.state) return
    const candidates = ANIM_MAP[event]
    if (!candidates) return
    for (const name of candidates) {
      if (this.animationNames.includes(name)) {
        this.spine.state.setAnimation(0, name, event === 'idle' || event === 'selected')
        return
      }
    }
    if (this.animationNames.length > 0)
      this.spine.state.setAnimation(0, this.animationNames[0], true)
  }

  setAnimation(event: AnimEvent): void {
    if (event === this.currentAnim) return
    this.currentAnim = event
    this._playAnimation(event)
  }

  getCanvas(): HTMLCanvasElement { return this.app.canvas }
  destroy(): void { this.app.destroy(true, { children: true }) }
}
