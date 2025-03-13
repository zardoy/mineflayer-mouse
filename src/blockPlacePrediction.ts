import { Bot } from 'mineflayer';
import { activatableBlockWithoutItemPatterns, itemToBlockRemaps } from './itemBlocksStatic';
import  PrismarineBlock, {Block}  from 'prismarine-block'
import { Vec3 } from 'vec3';
import MinecraftData from 'minecraft-data'

export const directionToVector = [new Vec3(0, -1, 0), new Vec3(0, 1, 0), new Vec3(0, 0, -1), new Vec3(0, 0, 1), new Vec3(-1, 0, 0), new Vec3(1, 0, 0)]
const directionToAxis = ['y', 'y', 'z', 'z', 'x', 'x']
const directionToFacing = ['south', 'west', 'north', 'east', 'up', 'down']

export const botTryPlaceBlockPrediction = (bot: Bot, cursorBlock: Block, faceNum: number, delta: Vec3, doWorldUpdate: boolean) => {
    if (!bot.heldItem) return false
    const isSneaking = bot.controlState.sneak;
    const adventurePlaceAllowed = bot.heldItem.blocksCanPlaceOn?.some(([blockName]) => blockName === cursorBlock.name) ?? false
    const isBlockPlaceAction =
        bot.game.gameMode === 'adventure' ? adventurePlaceAllowed : (
            isSneaking ||
            // not interact action
            activatableBlockWithoutItemPatterns.every(pattern => !pattern.test(cursorBlock.name))
        )
    if (!isBlockPlaceAction) return false;

    const referencePosition = cursorBlock.position.clone()
    const block = bot.world.getBlock(referencePosition)
    const directionVector = block?.boundingBox === 'empty' ? new Vec3(0, 0, 0) : directionToVector[faceNum]!

    if (doWorldUpdate) {
        const cursorY = delta.y
        let half = cursorY > 0.5 ? 'top' : 'bottom'
        if (faceNum === 0) half = 'top'
        else if (faceNum === 1) half = 'bottom'
        const placedPosition = referencePosition.plus(directionVector)
        const axis = directionToAxis[faceNum]!
        const facing = directionToFacing[faceNum]!
        const mcData = MinecraftData(bot.version)
        const itemName = bot.heldItem.name;
        const block = mcData.blocksByName[itemToBlockRemaps[itemName] ?? itemName]
        if (block) {
            const prismarineBlock = PrismarineBlock(bot.version).fromStateId(block.defaultState, 0)
            const finalBlock = getBlockFromProperties(PrismarineBlock(bot.version), prismarineBlock, block, [
                {
                    // like slabs
                    matchingState: 'type',
                    requireValues: ['bottom', 'top', 'double'],
                    // todo support double
                    value: half
                },
                {
                    // like stairs
                    matchingState: 'axis',
                    requireValues: ['x', 'y', 'z'],
                    value: axis
                },
                {
                    // like fences, signs
                    matchingState: 'facing',
                    requireValues: ['north', 'south', 'east', 'west', 'up', 'down'],
                    value: facing
                },
            ])
            bot.world.setBlockStateId(placedPosition, finalBlock.stateId)
        }
    }
    // const placingBlock =
    return true
}

interface SetBlockProperty {
    matchingState: string
    requireValues?: string[]
    value: string | number | boolean
}

const getBlockFromProperties = (prismarineBlockInstance: typeof Block, prismarineBlock: Block, blockData: MinecraftData.Block, properties: SetBlockProperty[]) => {
    const states = blockData.states;
    if (!states) return prismarineBlock
    const defaultProps = prismarineBlock.getProperties()

    const finalProps = {} as Record<string, any>
    for (const prop of states) {
        const propName = prop.name
        const propValue = properties.find(p => {
            if (p.matchingState !== propName) return false
            if (p.requireValues) {
                if (!p.requireValues.every(v => prop.values?.includes(v))) return false
            }
            return true
        })?.value
        finalProps[propName] = propValue ?? defaultProps[propName]
    }

    return prismarineBlockInstance.fromProperties(blockData.id, finalProps, 0)
}
