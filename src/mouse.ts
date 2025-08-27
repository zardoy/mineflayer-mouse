import { Bot } from 'mineflayer'
import { Vec3 } from 'vec3'
import { Entity } from 'prismarine-entity'
import PrismarineItem from 'prismarine-item'
import { Block } from 'prismarine-block'
import { EventEmitter } from 'events'
import { debug } from './debug'
import { raycastEntity } from './entityRaycast'
import { BlockPlacePredictionOverride, botTryPlaceBlockPrediction, directionToVector } from './blockPlacePrediction'
import { isItemActivatable } from './itemActivatable'

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
  /** @default true */
  warnings?: boolean
  /** @default true */
  blockPlacePrediction?: boolean
  /** @default 0 */
  blockPlacePredictionDelay?: number
  /** @default true */
  blockPlacePredictionCheckEntities?: boolean
  blockPlacePredictionHandler?: BlockPlacePredictionOverride
  blockInteractionHandlers?: Record<string, BlockInteractionHandler>

  noBreakPositiveUpdate?: boolean
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

// The delay is always 5 ticks between blocks
// https://github.com/extremeheat/extracted_minecraft_data/blob/158aff8ad2a9051505e05703f554af8e50741d69/client/net/minecraft/client/multiplayer/MultiPlayerGameMode.java#L200
const BLOCK_BREAK_DELAY_TICKS = 5

export class MouseManager {
  /** stateId - seconds */
  customBreakTime: Record<string, number> = {}
  customBreakTimeToolAllowance: Set<string> = new Set()

  buttons = [false, false, false] as [boolean, boolean, boolean]
  lastButtons = [false, false, false] as [boolean, boolean, boolean]
  cursorBlock: Block | null = null
  prevBreakState: number | null = null
  currentDigTime: number | null = null
  prevOnGround: boolean | null = null
  rightClickDelay: number = 4
  breakStartTime: number | undefined = undefined
  ended = false
  lastDugBlock: Vec3 | null = null
  lastDugTime: number = 0
  /** a visually synced one */
  currentBreakBlock: { block: Block, stage: number } | null = null

  debugDigStatus: string = 'none'
  debugLastStopReason: string = 'none'
  brokenBlocks: Block[] = []
  lastSwing = 0
  itemBeingUsed: ItemUseState | null = null

  swingTimeout: any = null
  // todo clear when got a packet from server
  private blockHandlers: Record<string, BlockInteractionHandler>
  originalDigTime: (block: Block) => number

  constructor(private bot: Bot, public settings: BotPluginSettings = {}) {
    this.blockHandlers = {
      ...defaultBlockHandlers,
      ...(settings.blockInteractionHandlers ?? {})
    }
    this.initBotEvents()

    // patch mineflayer
    this.originalDigTime = bot.digTime
    bot.digTime = this.digTime.bind(this)
  }

  resetDiggingVisual(block: Block) {
    this.bot.emit('blockBreakProgressStage', block, null)
    this.currentBreakBlock = null
    this.prevBreakState = null
  }

  stopDiggingCompletely(reason: string, tempStopping = false) {
    // try { this.bot.stopDigging() } catch (err) { console.warn('stopDiggingCompletely', err) }
    try { this.bot.stopDigging() } catch (err) { }
    this.breakStartTime = undefined
    if (this.currentBreakBlock) {
      this.resetDiggingVisual(this.currentBreakBlock.block)
    }
    this.debugDigStatus = `stopped by ${reason}`
    this.debugLastStopReason = reason
    this.currentDigTime = null
    if (!tempStopping) {
      this.bot.emit('botArmSwingEnd', 'right')
    }
  }

  private initBotEvents() {
    this.bot.on('physicsTick', () => {
      if (this.rightClickDelay < 4) this.rightClickDelay++
      this.update()
    })

    this.bot.on('end', () => {
      this.ended = true
    })

    this.bot.on('diggingCompleted', (block) => {
      this.breakStartTime = undefined
      this.lastDugBlock = block.position
      this.lastDugTime = Date.now()
      this.debugDigStatus = 'success'
      this.brokenBlocks = [...this.brokenBlocks.slice(-5), block]
      this.resetDiggingVisual(block)
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
      this.resetDiggingVisual(block)
    })

    this.bot.on('entitySwingArm', (entity: Entity) => {
      if (this.bot.entity && entity.id === this.bot.entity.id) {
        if (this.swingTimeout) {
          clearTimeout(this.swingTimeout)
        }
        this.bot.swingArm('right')
        this.bot.emit('botArmSwingStart', 'right')
        this.swingTimeout = setTimeout(() => {
          if (this.ended) return
          this.bot.emit('botArmSwingEnd', 'right')
          this.swingTimeout = null
        }, 250)
      }
    })

    //@ts-ignore
    this.bot.on('blockBreakProgressStageObserved', (block: Block, destroyStage: number, entity: Entity) => {
      if (this.bot.entity && this.cursorBlock?.position.equals(block.position) && entity.id === this.bot.entity.id) {
        if (!this.buttons[0]) {
          this.buttons[0] = true
          this.update()
        }
      }
    })

    //@ts-ignore
    this.bot.on('blockBreakProgressStageEnd', (block: Block, entity: Entity) => {
      if (this.bot.entity && this.currentBreakBlock?.block.position.equals(block.position) && entity.id === this.bot.entity.id) {
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
    this.bot.emit('botArmSwingStart', 'right')
    this.bot.emit('botArmSwingEnd', 'right')
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
        this.bot.emit('botArmSwingStart', 'right')
        this.bot.emit('botArmSwingEnd', 'right')
        this.bot.attack(entity) // already swings to server
      } else if (this.buttons[2] && !this.lastButtons[2]) {
        // Right click - interact
        this.activateEntity(entity)
      }
    } else {
      if (this.buttons[2] && (this.rightClickDelay >= 4 || !this.lastButtons[2])) {
        this.updatePlaceInteract(cursorBlock)
      }

      this.updateBreaking(cursorBlock, cursorBlockDiggable, cursorChanged)
    }

    this.updateButtonStates()
  }

  getCursorState(): CursorState {
    const inSpectator = this.bot.game.gameMode === 'spectator'
    const inAdventure = this.bot.game.gameMode === 'adventure'
    const entity = this.bot.entity ? raycastEntity(this.bot) : null

    // If entity is found, we should stop any current digging
    let cursorBlock = this.bot.entity ? this.bot.blockAtCursor(5) : null
    if (entity) {
      cursorBlock = null
      if (this.breakStartTime !== undefined) {
        this.stopDiggingCompletely('entity interference')
      }
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

  async placeBlock(cursorBlock: Block, direction: Vec3, delta: Vec3, offhand: boolean, forceLook: 'ignore' | 'lookAt' | 'lookAtForce' = 'ignore', doClientSwing = true) {
    const handToPlaceWith = offhand ? 1 : 0
    if (offhand && this.bot.supportFeature('doesntHaveOffHandSlot')) {
      return
    }

    let dx = 0.5 + direction.x * 0.5
    let dy = 0.5 + direction.y * 0.5
    let dz = 0.5 + direction.z * 0.5

    if (delta) {
      dx = delta.x
      dy = delta.y
      dz = delta.z
    }
    if (forceLook !== 'ignore') {
      await this.bot.lookAt(cursorBlock.position.offset(dx, dy, dz), forceLook === 'lookAtForce')
    }
    const pos = cursorBlock.position

    const Item = PrismarineItem(this.bot.version)
    const { bot } = this

    if (bot.supportFeature('blockPlaceHasHeldItem')) {
      const packet = {
        location: pos,
        direction: vectorToDirection(direction),
        heldItem: Item.toNotch(bot.heldItem),
        cursorX: Math.floor(dx * 16),
        cursorY: Math.floor(dy * 16),
        cursorZ: Math.floor(dz * 16)
      }
      bot._client.write('block_place', packet)
    } else if (bot.supportFeature('blockPlaceHasHandAndIntCursor')) {
      bot._client.write('block_place', {
        location: pos,
        direction: vectorToDirection(direction),
        hand: handToPlaceWith,
        cursorX: Math.floor(dx * 16),
        cursorY: Math.floor(dy * 16),
        cursorZ: Math.floor(dz * 16)
      })
    } else if (bot.supportFeature('blockPlaceHasHandAndFloatCursor')) {
      bot._client.write('block_place', {
        location: pos,
        direction: vectorToDirection(direction),
        hand: handToPlaceWith,
        cursorX: dx,
        cursorY: dy,
        cursorZ: dz
      })
    } else if (bot.supportFeature('blockPlaceHasInsideBlock')) {
      bot._client.write('block_place', {
        location: pos,
        direction: vectorToDirection(direction),
        hand: handToPlaceWith,
        cursorX: dx,
        cursorY: dy,
        cursorZ: dz,
        insideBlock: false,
        sequence: 0, // 1.19.0
        worldBorderHit: false // 1.21.3
      })
    }

    if (!offhand) {
      this.bot.swingArm(offhand ? 'left' : 'right')
    }
    if (doClientSwing) {
      this.bot.emit('botArmSwingStart', offhand ? 'left' : 'right')
      this.bot.emit('botArmSwingEnd', offhand ? 'left' : 'right')
    }
  }

  private updatePlaceInteract(cursorBlock: Block | null) {
    // Check for special block handlers first
    let handled = false
    if (!this.bot.getControlState('sneak') && cursorBlock) {
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

    const activateMain = this.bot.heldItem && isItemActivatable(this.bot.version, this.bot.heldItem)
    const offHandItem = this.bot.inventory.slots[45]

    if (!handled) {
      let possiblyPlaceOffhand = () => {}
      if (cursorBlock) {
        const delta = cursorBlock['intersect'].minus(cursorBlock.position)
        const faceNum: number = cursorBlock['face']
        const direction = directionToVector[faceNum]!
        // TODO support offhand prediction
        const blockPlacementPredicted = botTryPlaceBlockPrediction(
          this.bot,
          cursorBlock,
          faceNum,
          delta,
          this.settings.blockPlacePrediction ?? true,
          this.settings.blockPlacePredictionDelay ?? 0,
          this.settings.blockPlacePredictionHandler ?? null,
          this.settings.blockPlacePredictionCheckEntities ?? true
        )
        if (blockPlacementPredicted) {
          this.bot.emit('mouseBlockPlaced', cursorBlock, direction, delta, false, true)
        }
        // always emit block_place when looking at block
        this.placeBlock(cursorBlock, direction, delta, false, undefined, !activateMain)
        if (!this.bot.supportFeature('doesntHaveOffHandSlot')) {
          possiblyPlaceOffhand = () => {
            this.placeBlock(cursorBlock, direction, delta, true, undefined, false /* todo. complex. many scenarious like pickaxe or food */)
          }
        }
      }

      if (activateMain || !cursorBlock) {
        const offhand = activateMain ? false : isItemActivatable(this.bot.version, offHandItem!)
        const item = offhand ? offHandItem : this.bot.heldItem
        if (item) {
          this.startUsingItem(item, offhand)
        }
      }

      possiblyPlaceOffhand()
    }

    this.rightClickDelay = 0
  }

  getCustomBreakTime(block: Block) {
    if (this.customBreakTimeToolAllowance.size) {
      const heldItemId = this.bot.heldItem?.name
      if (!this.customBreakTimeToolAllowance.has(heldItemId ?? '')) {
        return undefined
      }
    }

    return this.customBreakTime[block.stateId] ?? this.customBreakTime[block.name] ?? this.customBreakTime['*']
  }

  digTime(block: Block) {
    const customTime = this.getCustomBreakTime(block)
    if (customTime !== undefined) return customTime * 1000
    const time = this.originalDigTime(block)
    if (!time) return time
    return time
  }

  private startUsingItem(item: { name: string }, isOffhand: boolean) {
    if (this.itemBeingUsed) return // hands busy
    if (isOffhand && this.bot.supportFeature('doesntHaveOffHandSlot')) return
    const slot = isOffhand ? 45 : this.bot.quickBarSlot
    this.bot.activateItem(isOffhand)
    this.itemBeingUsed = {
      item,
      isOffhand,
      name: item.name
    }
    this.bot.emit('startUsingItem', item, slot, isOffhand, -1)
  }

  // TODO use it when item cant be used (define another map)
  // useItemOnce(item: { name: string }, isOffhand: boolean) {
  // }

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
    if (cursorChanged) {
      this.stopDiggingCompletely('block change delay', !!cursorBlockDiggable)
    }

    // We stopped breaking
    if (!this.buttons[0] && this.lastButtons[0]) {
      this.stopDiggingCompletely('user stopped')
    }

    const hasCustomBreakTime = cursorBlockDiggable ? this.getCustomBreakTime(cursorBlockDiggable) !== undefined : false
    const onGround = this.bot.entity?.onGround || this.bot.game.gameMode === 'creative' || hasCustomBreakTime
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
    if (cursorBlockDiggable && this.breakStartTime !== undefined && this.bot.game.gameMode !== 'creative') {
      const elapsed = performance.now() - this.breakStartTime
      const time = this.digTime(cursorBlockDiggable)
      if (time !== this.currentDigTime) {
        console.warn('dig time changed! cancelling!', this.currentDigTime, '->', time)
        this.stopDiggingCompletely('dig time changed')
      } else {
        const state = Math.floor((elapsed / time) * 10)
        if (state !== this.prevBreakState) {
          this.bot.emit('blockBreakProgressStage', cursorBlockDiggable, Math.min(state, 9))
          this.currentBreakBlock = { block: cursorBlockDiggable, stage: state }
        }
        this.prevBreakState = state
      }
    }
  }

  private maybeStartBreaking(cursorBlock: Block | null, cursorBlockDiggable: Block | null, cursorChanged: boolean, onGround: boolean) {
    const justStartingNewBreak = !this.lastButtons[0]
    const blockChanged = cursorChanged || (this.lastDugBlock && cursorBlock && !this.lastDugBlock.equals(cursorBlock.position))
    const diggingCompletedEnoughTimePassed = !this.lastDugTime || (Date.now() - this.lastDugTime > BLOCK_BREAK_DELAY_TICKS * 1000 / 20)
    const hasCustomBreakTime = cursorBlockDiggable && this.getCustomBreakTime(cursorBlockDiggable) !== undefined
    const breakStartConditionsChanged = onGround !== this.prevOnGround && !this.currentBreakBlock

    if (cursorBlockDiggable) {
      if (
        onGround
        && (justStartingNewBreak || (diggingCompletedEnoughTimePassed && (blockChanged || breakStartConditionsChanged)))
      ) {
        this.startBreaking(cursorBlockDiggable)
      }
    } else if (performance.now() - this.lastSwing > 200) {
      this.bot.swingArm('right')
      this.bot.emit('botArmSwingStart', 'right')
      this.bot.emit('botArmSwingEnd', 'right')
      this.lastSwing = performance.now()
    }
  }

  setConfigFromPacket(packet: any) {
    if (packet.customBreakTime) {
      this.customBreakTime = packet.customBreakTime
    }
    if (packet.customBreakTimeToolAllowance) {
      this.customBreakTimeToolAllowance = new Set(packet.customBreakTimeToolAllowance)
    }
    if (packet.noBreakPositiveUpdate !== undefined) {
      this.settings.noBreakPositiveUpdate = packet.noBreakPositiveUpdate
    }

    if (packet.blockPlacePrediction !== undefined) {
      this.settings.blockPlacePrediction = packet.blockPlacePrediction
    }
    if (packet.blockPlacePredictionDelay !== undefined) {
      this.settings.blockPlacePredictionDelay = packet.blockPlacePredictionDelay
    }
    if (packet.blockPlacePredictionCheckEntities !== undefined) {
      this.settings.blockPlacePredictionCheckEntities = packet.blockPlacePredictionCheckEntities
    }
  }

  private startBreaking(block: Block) {
    // patch mineflayer
    if (this.settings.noBreakPositiveUpdate && !this.bot['_updateBlockStateOld']) {
      this.bot['_updateBlockStateOld'] = this.bot['_updateBlockState']
      this.bot['_updateBlockState'] = () => {}
    } else if (!this.settings.noBreakPositiveUpdate && this.bot['_updateBlockStateOld']) {
      this.bot['_updateBlockState'] = this.bot['_updateBlockStateOld']
      delete this.bot['_updateBlockStateOld']
    }

    this.lastDugBlock = null
    this.debugDigStatus = 'breaking'
    this.currentDigTime = this.digTime(block)
    this.breakStartTime = performance.now()

    // Reset break state when starting new break
    this.prevBreakState = null

    const vecArray = [new Vec3(0, -1, 0), new Vec3(0, 1, 0), new Vec3(0, 0, -1), new Vec3(0, 0, 1), new Vec3(-1, 0, 0), new Vec3(1, 0, 0)]
    this.bot.dig(
      //@ts-ignore
      block, 'ignore', vecArray[block.face], block.face
    ).catch((err) => {
      if (err.message === 'Digging aborted') return
      throw err
    })

    this.bot.emit('startDigging', block)
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

export const versionToNumber = (ver: string) => {
  const [x, y = '0', z = '0'] = ver.split('.')
  return +`${x!.padStart(2, '0')}${y.padStart(2, '0')}${z.padStart(2, '0')}`
}

const OLD_UNSUPPORTED_VERSIONS = versionToNumber('1.16.5')

let warningPrinted = false
export function inject(bot: Bot, settings: BotPluginSettings) {
  if (settings.warnings !== false && !warningPrinted && versionToNumber(bot.version) <= OLD_UNSUPPORTED_VERSIONS) {
    console.warn(`[mineflayer-mouse] This version of Minecraft (${bot.version}) has known issues like doors interactions or item using. Please upgrade to a newer, better tested version for now.`)
    warningPrinted = true
  }

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
    bot.leftClickEnd()
  }
  bot.rightClick = () => {
    bot.rightClickStart()
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
    'mouseBlockPlaced': (block: Block, direction: Vec3, delta: Vec3, offhand: boolean, wasPredicted: boolean) => void
  }
}


export { MouseManager as MousePlugin }

function vectorToDirection (v: Vec3) {
  if (v.y < 0) {
    return 0
  } else if (v.y > 0) {
    return 1
  } else if (v.z < 0) {
    return 2
  } else if (v.z > 0) {
    return 3
  } else if (v.x < 0) {
    return 4
  } else if (v.x > 0) {
    return 5
  }
  throw new Error(`invalid direction vector ${v}`)
}
