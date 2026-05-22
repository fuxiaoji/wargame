/**
 * SpineCharacter — 单个 spine 角色实例 (spine-ts 3.6)
 */
import { ANIM_MAP, type SpineAsset } from './SpineManager'

export type AnimEvent = 'idle' | 'selected' | 'moving' | 'attack' | 'damaged' | 'victory'

export class SpineCharacter {
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private renderer: spine.canvas.SkeletonRenderer
  private skeleton: spine.Skeleton
  private animState: spine.AnimationState
  private asset: SpineAsset

  private currentAnim: AnimEvent = 'idle'
  private animFrameId = 0
  private lastTime = 0
  private _destroyed = false

  constructor(asset: SpineAsset, canvasW: number, canvasH: number) {
    this.asset = asset
    this.canvas = document.createElement('canvas')
    this.canvas.width = canvasW
    this.canvas.height = canvasH

    const ctx = this.canvas.getContext('2d')!
    this.ctx = ctx
    this.renderer = new spine.canvas.SkeletonRenderer(ctx)

    this.skeleton = new spine.Skeleton(asset.skeletonData)

    // 根据骨架数据计算合适的缩放
    const dataW = Math.abs(asset.skeletonData.width) || 250
    const dataH = Math.abs(asset.skeletonData.height) || 350
    const scaleX = canvasW / dataW * 0.85
    const scaleY = canvasH / dataH * 0.85
    const scale = Math.min(scaleX, scaleY, 1.0)

    this.skeleton.scaleX = scale
    this.skeleton.scaleY = scale
    this.skeleton.x = canvasW / 2
    this.skeleton.y = canvasH * 0.78
    this.skeleton.setToSetupPose()

    const animData = new spine.AnimationStateData(asset.skeletonData)
    animData.defaultMix = 0.2
    this.animState = new spine.AnimationState(animData)

    this._playAnimation('idle')
  }

  private _playAnimation(event: AnimEvent): void {
    const candidates = ANIM_MAP[event]
    if (!candidates) return
    for (const name of candidates) {
      if (this.asset.animationNames.includes(name)) {
        const loop = event === 'idle' || event === 'selected'
        this.animState.setAnimation(0, name, loop)
        return
      }
    }
    if (this.asset.animationNames.length > 0) {
      this.animState.setAnimation(0, this.asset.animationNames[0], true)
    }
  }

  setAnimation(event: AnimEvent): void {
    if (event === this.currentAnim) return
    this.currentAnim = event
    this._playAnimation(event)
  }

  getCanvas(): HTMLCanvasElement { return this.canvas }

  start(): void {
    if (this._destroyed) return
    this.lastTime = performance.now()
    this._tick()
  }

  stop(): void {
    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId)
      this.animFrameId = 0
    }
  }

  private _tick = (): void => {
    if (this._destroyed) return
    const now = performance.now()
    const delta = Math.min((now - this.lastTime) / 1000, 0.1)
    this.lastTime = now

    if (this.currentAnim === 'damaged' && this.animState.getCurrent(0)?.isComplete()) {
      this.currentAnim = 'idle'
      this._playAnimation('idle')
    }

    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
    this.animState.update(delta)
    this.animState.apply(this.skeleton)
    this.skeleton.updateWorldTransform()
    this.renderer.draw(this.skeleton)

    this.animFrameId = requestAnimationFrame(this._tick)
  }

  destroy(): void {
    this._destroyed = true
    this.stop()
  }
}
