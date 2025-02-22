import { Bot } from 'mineflayer'
import { Vec3 } from 'vec3'
import { Entity } from 'prismarine-entity'
import { Block } from 'prismarine-block'
import { EventEmitter } from 'events'
import { isItemActivatable, isBlockActivatable } from './itemBlocksStatic'
import { debug } from './debug'
import { raycastEntity } from './entityRaycast'

interface MouseEvents {
  'blockBreakProgress': (block: Block, stage: number) => void
  'blockBreakAborted': (block: Block) => void
  'armSwing': (hand: 'right' | 'left') => void
}

class MouseManager {
  cursorBlock: Block | null = null
  prevBreakState: number | null = null
  currentDigTime: number | null = null
  prevOnGround: boolean | null = null
  lastBlockPlaced: number = 4
  lastSwing = 0
  buttons = [false, false, false] as [boolean, boolean, boolean]
  lastButtons = [false, false, false] as [boolean, boolean, boolean]
  breakStartTime: number | undefined = 0
  lastDugBlock: Vec3 | null = null
  lastDigged: number = 0
  debugDigStatus: string = 'none'
  currentBreakBlock: { block: Block, stage: number } | null = null
  swingTimeout: any = null
  // todo clear when got a packet from server
  brokenBlocks: Block[] = []

  constructor(private bot: Bot) {
    this.initBotEvents()
  }

  private initBotEvents() {
    this.bot.on('physicsTick', () => {
      if (this.lastBlockPlaced < 4) this.lastBlockPlaced++
    })

    this.bot.on('diggingCompleted', (block) => {
      this.breakStartTime = undefined
      this.lastDugBlock = block.position
      this.lastDigged = Date.now()
      this.debugDigStatus = 'done'
      this.brokenBlocks = [...this.brokenBlocks.slice(-5), block]
      // this.bot.emit('blockBreakComplete', block)
    })

    this.bot.on('diggingAborted', (block) => {
      if (!this.cursorBlock?.position.equals(block.position)) return
      this.debugDigStatus = 'aborted'
      this.breakStartTime = undefined
      if (this.buttons[0]) {
        this.buttons[0] = false
        this.update()
        this.buttons[0] = true // trigger again
      }
      this.lastDugBlock = null
    })

    // Add new event listeners for block breaking and swinging
    this.bot.on('entitySwingArm', (entity: Entity) => {
      if (entity.id === this.bot.entity.id) {
        if (this.swingTimeout) {
          clearTimeout(this.swingTimeout)
        }
        this.bot.emit('botArmSwingStart', 'right')
        this.swingTimeout = setTimeout(() => {
          this.bot.emit('botArmSwingEnd', 'right')
          this.swingTimeout = null
        }, 250)
      }
    })

    //@ts-ignore
    this.bot.on('blockBreakProgressObserved', (block: Block, destroyStage: number, entity: Entity) => {
      if (this.cursorBlock?.position.equals(block.position) && entity.id === this.bot.entity.id) {
        if (!this.buttons[0]) {
          this.buttons[0] = true
          this.update()
        }
        this.bot.emit('blockBreakProgress', block, destroyStage)
      }
    })

    //@ts-ignore
    this.bot.on('blockBreakProgressEnd', (block: Block, entity: Entity) => {
      if (this.currentBreakBlock?.block.position.equals(block.position) && entity.id === this.bot.entity.id) {
        if (!this.buttons[0]) {
          this.buttons[0] = false
          this.update()
        }
      }
    })

    this.bot._client.on('acknowledge_player_digging', (data: { location: { x: number, y: number, z: number }, block: number, status: number, successful: boolean } | { sequenceId: number }) => {
      if ('location' in data && !data.successful) {
        const packetPos = new Vec3(data.location.x, data.location.y, data.location.z)
        if (this.cursorBlock?.position.equals(packetPos)) {
          // restore the block to the world if already digged
          if (this.bot.world.getBlockStateId(packetPos) === 0) {
            const block = this.brokenBlocks.find(b => b.position.equals(packetPos))
            if (block) {
              this.bot.world.setBlock(packetPos, block)
            } else {
              debug(`Cannot find block to restore at ${packetPos}`)
            }
          }
          this.buttons[0] = false
          this.update()
        }
      }
    })
  }

  activateEntity(entity: Entity) {
    // mineflayer has completely wrong implementation of this action
    if (this.bot.supportFeature('armAnimationBeforeUse')) {
      this.bot.swingArm('right')
    }
    this.bot._client.write('use_entity', {
      target: entity.id,
      mouse: 2,
      // todo do not fake
      x: 0.581_012_585_759_162_9,
      y: 0.581_012_585_759_162_9,
      z: 0.581_012_585_759_162_9,
      sneaking: this.bot.getControlState('sneak'),
      hand: 0
    })
    this.bot._client.write('use_entity', {
      target: entity.id,
      mouse: 0,
      sneaking: this.bot.getControlState('sneak'),
      hand: 0
    })
    if (!this.bot.supportFeature('armAnimationBeforeUse')) {
      this.bot.swingArm('right')
    }
  }

  beforeUpdateChecks() {
    if (!document.hasFocus()) {
      // deactive all buttons
      this.buttons.fill(false)
    }
  }

  update() {
    this.beforeUpdateChecks()
    const inSpectator = this.bot.game.gameMode === 'spectator'
    const inAdventure = this.bot.game.gameMode === 'adventure'
    const entity = raycastEntity(this.bot)
    let _cursorBlock = this.bot.blockAtCursor(5)
    if (entity) {
      _cursorBlock = null
    }
    this.cursorBlock = _cursorBlock
    const { cursorBlock } = this

    let cursorBlockDiggable = cursorBlock
    if (cursorBlock && (!this.bot.canDigBlock(cursorBlock) || inAdventure) && this.bot.game.gameMode !== 'creative') cursorBlockDiggable = null

    const cursorChanged = cursorBlock && this.cursorBlock ? !this.cursorBlock.position.equals(cursorBlock.position) : this.cursorBlock !== cursorBlock

    // Place / interact / activate
    if (this.buttons[2] && this.lastBlockPlaced >= 4) {
      if (cursorBlock) {
        const vecArray = [new Vec3(0, -1, 0), new Vec3(0, 1, 0), new Vec3(0, 0, -1), new Vec3(0, 0, 1), new Vec3(-1, 0, 0), new Vec3(1, 0, 0)]
        //@ts-ignore
        const delta = cursorBlock.intersect.minus(cursorBlock.position)

        if (this.bot.heldItem && isItemActivatable(this.bot.heldItem.name)) {
          //@ts-ignore
          this.bot._placeBlockWithOptions(cursorBlock, vecArray[cursorBlock.face], { delta, forceLook: 'ignore' }).catch(console.warn)
        } else if (cursorBlock && isBlockActivatable(cursorBlock.name)) {
          // Handle activatable block
          //@ts-ignore
          this.bot.activateBlock(cursorBlock, vecArray[cursorBlock.face], delta).finally(() => {
            this.bot.lookAt = oldLookAt // ?
          }).catch(console.warn)
        } else {
          const oldLookAt = this.bot.lookAt
          //@ts-ignore
          this.bot.lookAt = (pos) => { }
          //@ts-ignore
          this.bot.activateBlock(cursorBlock, vecArray[cursorBlock.face], delta).finally(() => {
            this.bot.lookAt = oldLookAt
          }).catch(console.warn)
        }
        this.bot.emit('botArmSwingStart', 'right')
      }
      this.lastBlockPlaced = 0
    }

    // Stop break
    if ((!this.buttons[0] && this.lastButtons[0]) || cursorChanged) {
      try {
        this.bot.stopDigging()
      } catch (e) { }
    }

    // We stopped breaking
    if ((!this.buttons[0] && this.lastButtons[0])) {
      this.lastDugBlock = null
      this.breakStartTime = undefined
      this.debugDigStatus = 'cancelled'
    }

    const onGround = this.bot.entity.onGround || this.bot.game.gameMode === 'creative'
    this.prevOnGround ??= onGround

    // Start break
    if (this.buttons[0]) {
      if (cursorBlockDiggable
        && (!this.lastButtons[0] || ((cursorChanged || (this.lastDugBlock && !this.lastDugBlock.equals(cursorBlock!.position))) && Date.now() - (this.lastDigged ?? 0) > 300) || onGround !== this.prevOnGround)
        && onGround) {
        this.lastDugBlock = null
        this.debugDigStatus = 'breaking'
        this.currentDigTime = this.bot.digTime(cursorBlockDiggable)
        this.breakStartTime = performance.now()
        const vecArray = [new Vec3(0, -1, 0), new Vec3(0, 1, 0), new Vec3(0, 0, -1), new Vec3(0, 0, 1), new Vec3(-1, 0, 0), new Vec3(1, 0, 0)]
        this.bot.dig(
          //@ts-ignore
          cursorBlockDiggable, 'ignore', vecArray[cursorBlockDiggable.face]
        ).catch((err) => {
          if (err.message === 'Digging aborted') return
          throw err
        })
        this.bot.emit('botDigStart', cursorBlockDiggable)
        this.lastDigged = Date.now()
        this.bot.emit('botArmSwingStart', 'right')
      } else if (performance.now() - this.lastSwing > 200) {
        this.bot.swingArm('right')
        this.lastSwing = performance.now()
      }
    }

    this.prevOnGround = onGround
    this.lastButtons[0] = this.buttons[0]
    this.lastButtons[1] = this.buttons[1]
    this.lastButtons[2] = this.buttons[2]
  }
}

export function inject(bot: Bot) {
  const mouse = new MouseManager(bot)
  bot.mouse = mouse
  return mouse
}

declare module 'mineflayer' {
  interface Bot {
    mouse: MouseManager
  }
  interface BotEvents {
    'botArmSwingStart': (hand: 'right' | 'left') => void
    'botArmSwingEnd': (hand: 'right' | 'left') => void
    'blockBreakProgress': (block: Block, stage: number) => void
    'botDigStart': (block: Block) => void
  }
}

export { MouseManager as MousePlugin }
