import { Bot } from 'mineflayer'
import { Vec3 } from 'vec3'
import { Entity } from 'prismarine-entity'
import { Block } from 'prismarine-block'
import { EventEmitter } from 'events'
import { isItemActivatable } from './itemBlocksStatic'
import { debug } from './debug'
import { raycastEntity } from './entityRaycast'

export interface BlockInteractionHandler {
  test: (block: Block) => boolean
  handle: (block: Block, bot: Bot) => void
}

export interface ItemUseState {
  item: { name: string }
  isOffhand: boolean
  name: string
}

export interface BotPluginSettings {
  blockInteractionHandlers?: Record<string, BlockInteractionHandler>
}

const defaultBlockHandlers: Record<string, BlockInteractionHandler> = {
  bed: {
    test: (block) => block.name === 'bed' || block.name.endsWith('_bed'),
    handle: async (block, bot) => {
      bot.emit('goingToSleep', block)
      await bot.sleep(block)
    }
  }
}

export interface CursorState {
  cursorBlock: Block | null
  cursorBlockDiggable: Block | null
  cursorChanged: boolean
  entity: Entity | null
}

export class MouseManager {
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
  private blockHandlers: Record<string, BlockInteractionHandler>
  itemBeingUsed: ItemUseState | null = null

  constructor(private bot: Bot, public settings: BotPluginSettings = {}) {
    this.blockHandlers = {
      ...defaultBlockHandlers,
      ...(settings.blockInteractionHandlers ?? {})
    }
    this.initBotEvents()
  }

  private initBotEvents() {
    this.bot.on('physicsTick', () => {
      if (this.lastBlockPlaced < 4) this.lastBlockPlaced++
      this.update()
    })

    this.bot.on('diggingCompleted', (block) => {
      this.breakStartTime = undefined
      this.lastDugBlock = block.position
      this.lastDigged = Date.now()
      this.debugDigStatus = 'done'
      this.brokenBlocks = [...this.brokenBlocks.slice(-5), block]
      // Hide breaking animation when complete
      this.bot.emit('blockBreakProgressStage', block, null)
      // TODO: If the tool and enchantments immediately exceed the hardness times 30, the block breaks with no delay; SO WE NEED TO CHECK THAT
      // TODO: Any blocks with a breaking time of 0.05
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
      // Hide breaking animation when aborted
      this.bot.emit('blockBreakProgressStage', block, null)
    })

    // Add new event listeners for block breaking and swinging
    this.bot.on('entitySwingArm', (entity: Entity) => {
      if (entity.id === this.bot.entity.id) {
        if (this.swingTimeout) {
          clearTimeout(this.swingTimeout)
        }
        this.bot.swingArm('right')
        this.bot.emit('botArmSwingStart', 'right')
        this.swingTimeout = setTimeout(() => {
          this.bot.emit('botArmSwingEnd', 'right')
          this.swingTimeout = null
        }, 250)
      }
    })

    //@ts-ignore
    this.bot.on('blockBreakProgressStageObserved', (block: Block, destroyStage: number, entity: Entity) => {
      if (this.cursorBlock?.position.equals(block.position) && entity.id === this.bot.entity.id) {
        if (!this.buttons[0]) {
          this.buttons[0] = true
          this.update()
        }
      }
    })

    //@ts-ignore
    this.bot.on('blockBreakProgressStageEnd', (block: Block, entity: Entity) => {
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

    this.bot.on('heldItemChanged' as any, () => {
      if (this.itemBeingUsed && !this.itemBeingUsed.isOffhand) {
        this.stopUsingItem()
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

  beforeUpdateChecks() { }

  update() {
    this.beforeUpdateChecks()
    const { cursorBlock, cursorBlockDiggable, cursorChanged, entity } = this.getCursorState()

    // Handle item deactivation
    if (this.itemBeingUsed && !this.buttons[2]) {
      this.stopUsingItem()
    }

    // Handle entity interactions
    if (entity) {
      if (this.buttons[0] && !this.lastButtons[0]) {
        // Left click - attack
        this.bot.attack(entity)
      } else if (this.buttons[2] && !this.lastButtons[2]) {
        // Right click - interact
        this.activateEntity(entity)
      }
    } else {
      if (this.buttons[2] && this.lastBlockPlaced >= 4) {
        this.updatePlaceInteract(cursorBlock)
      }

      this.updateBreaking(cursorBlock, cursorBlockDiggable, cursorChanged)
    }

    this.updateButtonStates()
  }

  getCursorState(): CursorState {
    const inSpectator = this.bot.game.gameMode === 'spectator'
    const inAdventure = this.bot.game.gameMode === 'adventure'
    const entity = raycastEntity(this.bot)

    let cursorBlock = this.bot.blockAtCursor(5)
    if (entity) {
      cursorBlock = null
    }

    let cursorBlockDiggable = cursorBlock
    if (cursorBlock && (!this.bot.canDigBlock(cursorBlock) || inAdventure) && this.bot.game.gameMode !== 'creative') {
      cursorBlockDiggable = null
    }

    const cursorChanged = cursorBlock && this.cursorBlock ?
      !this.cursorBlock.position.equals(cursorBlock.position) :
      this.cursorBlock !== cursorBlock

    if (cursorChanged) {
      this.bot.emit('highlightCursorBlock', cursorBlock ? { block: cursorBlock } : undefined)
    }

    this.cursorBlock = cursorBlock
    return { cursorBlock, cursorBlockDiggable, cursorChanged, entity }
  }

  private updatePlaceInteract(cursorBlock: Block | null) {
    if (!cursorBlock) return

    const vecArray = [new Vec3(0, -1, 0), new Vec3(0, 1, 0), new Vec3(0, 0, -1), new Vec3(0, 0, 1), new Vec3(-1, 0, 0), new Vec3(1, 0, 0)]
    //@ts-ignore
    const delta = cursorBlock.intersect.minus(cursorBlock.position)

    // Check for special block handlers first
    let handled = false
    if (!this.bot.getControlState('sneak')) {
      for (const handler of Object.values(this.blockHandlers)) {
        if (handler.test(cursorBlock)) {
          try {
            handler.handle(cursorBlock, this.bot)
            handled = true
            break
          } catch (err) {
            this.bot.emit('error', err)
          }
        }
      }
    }

    const activate = this.bot.heldItem && isItemActivatable(this.bot.heldItem.name)

    if (cursorBlock && !activate && !handled) {
      if (this.bot.heldItem) {
        //@ts-ignore
        this.bot._placeBlockWithOptions(cursorBlock, vecArray[cursorBlock.face], { delta, forceLook: 'ignore' })
          .catch(console.warn)
      } else {
        // https://discord.com/channels/413438066984747026/413438150594265099/1198724637572477098
        const oldLookAt = this.bot.lookAt
        //@ts-ignore
        this.bot.lookAt = (pos) => { }
        //@ts-ignore
        // TODO it still must 1. fire block place 2. swing arm (right)
        this.bot.activateBlock(cursorBlock, vecArray[cursorBlock.face], delta)
          .finally(() => {
            this.bot.lookAt = oldLookAt
          })
          .catch(console.warn)
      }
      this.bot.emit('botArmSwingStart', 'right')
      this.bot.emit('botArmSwingEnd', 'right')
    } else if (!handled) {
      const offhand = activate ? false : isItemActivatable(this.bot.inventory.slots[45]?.name ?? '')
      this.bot.activateItem(offhand)
      const item = offhand ? this.bot.inventory.slots[45] : this.bot.heldItem
      if (item) {
        this.startUsingItem(item, offhand)
      }
    }

    this.lastBlockPlaced = 0
  }

  private startUsingItem(item: { name: string }, isOffhand: boolean) {
    const slot = isOffhand ? 45 : this.bot.quickBarSlot
    this.bot.activateItem(isOffhand)
    this.itemBeingUsed = {
      item,
      isOffhand,
      name: item.name
    }
    this.bot.emit('startUsingItem', item, slot, isOffhand, -1)
  }

  private stopUsingItem() {
    if (this.itemBeingUsed) {
      const { isOffhand, item } = this.itemBeingUsed
      const slot = isOffhand ? 45 : this.bot.quickBarSlot
      this.bot.emit('stopUsingItem', item, slot, isOffhand)
      this.bot.deactivateItem()
      this.itemBeingUsed = null
    }
  }

  private updateBreaking(cursorBlock: Block | null, cursorBlockDiggable: Block | null, cursorChanged: boolean) {
    // Stop break
    if ((!this.buttons[0] && this.lastButtons[0]) || cursorChanged) {
      try {
        this.bot.stopDigging()
        this.debugDigStatus = 'temporary stopped'
        if (this.cursorBlock) {
          this.bot.emit('blockBreakProgressStage', this.cursorBlock, null)
        }
      } catch (e) { } // to be reworked in mineflayer, then remove the try here
    }

    // We stopped breaking
    if (!this.buttons[0] && this.lastButtons[0]) {
      this.lastDugBlock = null
      this.breakStartTime = undefined
      this.debugDigStatus = 'cancelled'
      if (this.cursorBlock) {
        this.bot.emit('blockBreakProgressStage', this.cursorBlock, null)
      }
    }

    const onGround = this.bot.entity.onGround || this.bot.game.gameMode === 'creative'
    this.prevOnGround ??= onGround // todo this should be fixed in mineflayer to involve correct calculations when this changes as this is very important when mining straight down

    this.updateBreakingBlockState(cursorBlockDiggable)

    // Start break
    if (this.buttons[0]) {
      this.maybeStartBreaking(cursorBlock, cursorBlockDiggable, cursorChanged, onGround)
    }

    this.prevOnGround = onGround
  }

  private updateBreakingBlockState(cursorBlockDiggable: Block | null) {
    // Calculate and emit break progress
    if (cursorBlockDiggable && this.breakStartTime && this.bot.game.gameMode !== 'creative') {
      const elapsed = performance.now() - this.breakStartTime
      const time = this.bot.digTime(cursorBlockDiggable)
      if (time !== this.currentDigTime) {
        console.warn('dig time changed! cancelling!', time, 'from', this.currentDigTime)
        try {
          this.bot.stopDigging()
          this.bot.emit('blockBreakProgressStage', cursorBlockDiggable, null)
        } catch { }
      } else {
        const state = Math.floor((elapsed / time) * 10)
        if (state !== this.prevBreakState) {
          this.bot.emit('blockBreakProgressStage', cursorBlockDiggable, Math.min(state, 9))
        }
        this.prevBreakState = state
      }
    }
  }

  private maybeStartBreaking(cursorBlock: Block | null, cursorBlockDiggable: Block | null, cursorChanged: boolean, onGround: boolean) {
    if (cursorBlockDiggable
      && (!this.lastButtons[0] ||
        ((cursorChanged || (this.lastDugBlock && !this.lastDugBlock.equals(cursorBlock!.position)))
          && Date.now() - (this.lastDigged ?? 0) > 300)
        || onGround !== this.prevOnGround)
      && onGround) {
      this.startBreaking(cursorBlockDiggable)
    } else if (performance.now() - this.lastSwing > 200) {
      this.bot.swingArm('right')
      this.lastSwing = performance.now()
    }
  }

  private startBreaking(block: Block) {
    this.lastDugBlock = null
    this.debugDigStatus = 'breaking'
    this.currentDigTime = this.bot.digTime(block)
    this.breakStartTime = performance.now()

    // Reset break state when starting new break
    this.prevBreakState = null

    const vecArray = [new Vec3(0, -1, 0), new Vec3(0, 1, 0), new Vec3(0, 0, -1), new Vec3(0, 0, 1), new Vec3(-1, 0, 0), new Vec3(1, 0, 0)]
    this.bot.dig(
      //@ts-ignore
      block, 'ignore', vecArray[block.face]
    ).catch((err) => {
      if (err.message === 'Digging aborted') return
      throw err
    })

    this.bot.emit('startDigging', block)
    this.lastDigged = Date.now()
    this.bot.emit('botArmSwingStart', 'right')
  }

  private updateButtonStates() {
    this.lastButtons[0] = this.buttons[0]
    this.lastButtons[1] = this.buttons[1]
    this.lastButtons[2] = this.buttons[2]
  }

  getDataFromShape(shape: [number, number, number, number, number, number]) {
    const width = shape[3] - shape[0]
    const height = shape[4] - shape[1]
    const depth = shape[5] - shape[2]
    const centerX = (shape[3] + shape[0]) / 2
    const centerY = (shape[4] + shape[1]) / 2
    const centerZ = (shape[5] + shape[2]) / 2
    const position = new Vec3(centerX, centerY, centerZ)
    return { position, width, height, depth }
  }

  getBlockCursorShapes(block: Block): [number, number, number, number, number, number][] {
    const shapes = [...block.shapes ?? [], ...block['interactionShapes'] ?? []]
    if (!shapes.length) return []

    return shapes
  }

  getMergedCursorShape(block: Block): [number, number, number, number, number, number] | undefined {
    const shapes = this.getBlockCursorShapes(block)
    if (!shapes.length) return undefined

    return shapes.reduce((acc, cur) => {
      return [
        Math.min(acc[0]!, cur[0]!),
        Math.min(acc[1]!, cur[1]!),
        Math.min(acc[2]!, cur[2]!),
        Math.max(acc[3]!, cur[3]!),
        Math.max(acc[4]!, cur[4]!),
        Math.max(acc[5]!, cur[5]!)
      ]
    }) as [number, number, number, number, number, number]
  }
}

export function inject(bot: Bot, settings: BotPluginSettings) {
  const mouse = new MouseManager(bot, settings)
  bot.mouse = mouse

  bot.rightClickStart = () => {
    mouse.buttons[2] = true
    mouse.update()
  }
  bot.rightClickEnd = () => {
    mouse.buttons[2] = false
    mouse.update()
  }
  bot.leftClickStart = () => {
    mouse.buttons[0] = true
    mouse.update()
  }
  bot.leftClickEnd = () => {
    mouse.buttons[0] = false
    mouse.update()
  }
  bot.leftClick = () => {
    bot.leftClickStart()
    bot.mouse.update()
    bot.leftClickEnd()
  }
  bot.rightClick = () => {
    bot.rightClickStart()
    bot.mouse.update()
    bot.rightClickEnd()
  }
  Object.defineProperty(bot, 'usingItem', {
    get: () => mouse.itemBeingUsed
  })

  return mouse
}

declare module 'mineflayer' {
  interface Bot {
    mouse: MouseManager

    rightClickStart: () => void
    rightClickEnd: () => void
    leftClickStart: () => void
    leftClickEnd: () => void
    leftClick: () => void
    rightClick: () => void
    readonly usingItem: ItemUseState | null
  }

  interface BotEvents {
    'botArmSwingStart': (hand: 'right' | 'left') => void
    'botArmSwingEnd': (hand: 'right' | 'left') => void
    'blockBreakProgressStage': (block: Block, stage: number | null) => void
    'startDigging': (block: Block) => void
    'goingToSleep': (block: Block) => void
    'startUsingItem': (item: { name: string }, slot: number, isOffhand: boolean, duration: number) => void
    'stopUsingItem': (item: { name: string }, slot: number, isOffhand: boolean) => void
    'highlightCursorBlock': (data?: { block: Block }) => void
  }
}


export { MouseManager as MousePlugin }
