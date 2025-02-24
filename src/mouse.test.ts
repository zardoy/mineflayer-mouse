import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Bot } from 'mineflayer'
import { Vec3 } from 'vec3'
import { Block } from 'prismarine-block'
import { Entity } from 'prismarine-entity'
import { MouseManager, inject } from './mouse'
import { EventEmitter } from 'events'
import * as entityRaycast from './entityRaycast'

// Track method calls and events
interface TestState {
    methodCalls: string[]
    emittedEvents: string[]
}

function createMockBot(testState: TestState): Bot {
    const bot = new EventEmitter() as Bot

    // Track emitted events
    const originalEmit = bot.emit
    bot.emit = function (event: string, ...args: any[]) {
        testState.emittedEvents.push(event)
        //@ts-ignore
        return originalEmit.call(this, event, ...args)
    }

    bot.entity = {
        id: 1,
        position: new Vec3(0, 0, 0),
        onGround: true
    } as any
    bot.game = { gameMode: 'survival' } as any
    bot._client = new EventEmitter() as any
    bot.canDigBlock = () => true
    bot.digTime = () => 1000 // 1 second break time
    bot.blockAtCursor = () => null

    // Track method calls
    bot.dig = vi.fn().mockImplementation(async (block) => {
        testState.methodCalls.push('startdig')
    })
    bot.stopDigging = vi.fn().mockImplementation(() => {
        testState.methodCalls.push('stopdig')
    })
    bot.swingArm = vi.fn()
    bot.attack = vi.fn().mockImplementation((entity) => {
        testState.methodCalls.push('attack')
    })
    bot.supportFeature = () => true as any
    bot.world = {
        getBlockStateId: () => 1,
        setBlock: vi.fn()
    } as any

    return bot
}

function createMockBlock(position: Vec3): Block {
    return {
        position,
        name: 'stone',
        shapes: [[0, 0, 0, 1, 1, 1]],
        face: 1,
        stateId: 1,
        type: 1,
        metadata: 0,
        light: 0,
    } as unknown as Block
}

function createMockEntity(): Entity {
    return {
        id: 2,
        position: new Vec3(1, 1, 1),
        type: 'mob'
    } as Entity
}

// At the top of the file, before tests
vi.mock('./entityRaycast', () => ({
    raycastEntity: vi.fn().mockImplementation((bot) => null)
}))

describe('MouseManager', () => {
    let bot: Bot
    let mouse: MouseManager
    let testState: TestState

    beforeEach(() => {
        vi.useFakeTimers()
        testState = {
            methodCalls: [],
            emittedEvents: []
        }
        bot = createMockBot(testState)
        mouse = inject(bot, {})
    })

    afterEach(() => {
        vi.useRealTimers()
        vi.clearAllMocks()
    })

    describe('Block Breaking', () => {
        it('should handle break sequence with block change', () => {
            // Initial block
            const block1 = createMockBlock(new Vec3(1, 1, 1))
            bot.blockAtCursor = vi.fn().mockReturnValue(block1)

            // Start breaking first block
            bot.leftClickStart()
            expect(testState.methodCalls).toEqual(['stopdig', 'startdig'])

            // Complete breaking
            bot.emit('diggingCompleted', block1)

            // Change cursor to new block
            const block2 = createMockBlock(new Vec3(2, 2, 2))
            bot.blockAtCursor = vi.fn().mockReturnValue(block2)

            // Should start breaking new block
            bot.mouse.update()
            expect(testState.methodCalls).toEqual(['stopdig', 'startdig', 'stopdig'])
            vi.advanceTimersByTime(400)
            bot.mouse.update()
            expect(testState.methodCalls).toEqual(['stopdig', 'startdig', 'stopdig', 'startdig'])

            bot.leftClickEnd()
            expect(testState.methodCalls).toEqual(['stopdig', 'startdig', 'stopdig', 'startdig', 'stopdig'])
        })

        it.only('should handle break sequence with entity interference', () => {
            // Initial setup with block
            const block = createMockBlock(new Vec3(1, 1, 1))
            bot.blockAtCursor = vi.fn().mockReturnValue(block)

            // Start breaking
            bot.leftClickStart()
            expect(testState.methodCalls).toEqual(['stopdig', 'startdig'])

            // Entity appears
            const mockEntity = createMockEntity()
            vi.mocked(entityRaycast.raycastEntity).mockReturnValue(mockEntity)
            bot.mouse.update()

            // Should stop digging and attack entity
            expect(testState.methodCalls).toEqual(['stopdig', 'startdig', 'stopdig', 'attack'])

            // Entity disappears
            vi.mocked(entityRaycast.raycastEntity).mockReturnValue(null)
            vi.advanceTimersByTime(400) // Wait for dig cooldown
            bot.mouse.update()

            // Should resume digging
            expect(testState.methodCalls).toEqual(['stopdig', 'startdig', 'stopdig', 'attack', 'stopdig', 'startdig'])

            bot.leftClickEnd()
            expect(testState.methodCalls).toEqual(['stopdig', 'startdig', 'stopdig', 'attack', 'stopdig', 'startdig', 'stopdig'])
        })
    })

    describe('Entity Interaction', () => {
        it('should handle entity attack', () => {
            const mockEntity = createMockEntity()
            vi.mocked(entityRaycast.raycastEntity).mockReturnValue(mockEntity)

            bot.leftClickStart()
            expect(testState.methodCalls).toEqual(['attack'])

            vi.advanceTimersByTime(500)
            expect(testState.methodCalls).toEqual(['attack']) // No additional calls

            bot.leftClickEnd()
            expect(testState.methodCalls).toEqual(['attack']) // Still no additional calls
        })
    })

    describe('Block Placing', () => {
        it('should handle block placement timing', () => {
            const mockBlock = createMockBlock(new Vec3(1, 1, 1))
            bot.blockAtCursor = vi.fn().mockReturnValue(mockBlock)
                ; (bot as any)._placeBlockWithOptions = vi.fn()

            bot.rightClickStart()

            for (let i = 0; i < 12; i++) {
                bot.emit('physicsTick')
            }

            vi.advanceTimersByTime(500)
            bot.rightClickEnd()

            expect((bot as any)._placeBlockWithOptions).toHaveBeenCalledTimes(3)
        })
    })
})
